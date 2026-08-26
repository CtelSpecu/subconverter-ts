import type { Proxy, RegexMatchConfig } from '../types.js';
import { regFind, regReplace } from '../utils/regexp.js';

/**
 * nodemanip.ts — pipeline node manipulation (spec §7, §9)
 *
 * C++ origins:
 *  - applyMatcher     : generator/config/subexport.cpp:115-169
 *  - matchRange       : generator/config/subexport.cpp:64-113
 *  - groupGenerate    : generator/config/subexport.cpp:196-230
 *  - nodeRename       : generator/config/nodemanip.cpp:403-407
 *  - addEmoji/removeEmoji : nodemanip.cpp:432-461 / 470-471
 *  - preprocessNodes  : nodemanip.cpp:466-515 + interfaces.cpp:736
 *  - processRemark    : subexport.cpp:186-193
 *
 * All functions are forgiving: invalid regex / unexpected shapes never
 * throw uncaught; they return safe defaults.
 */

// ---------------------------------------------------------------------------
// matchRange helper (spec §9, subexport.cpp:64-113)
// pattern forms: N | A-B | !N | !A-B | N- | N+   where N is decimal int
// Multiple alternatives may be '|' or ',' separated.  Any alternative that
// matches (accounting for '!') makes the whole expression match.

function singleRangeMatch(num: number, token: string): boolean {
  const t = token.trim();
  if (t.length === 0) return false;
  let neg = false;
  let body = t;
  if (body.startsWith('!')) {
    neg = true;
    body = body.slice(1).trim();
    if (body.length === 0) return false;
  }
  let matched = false;
  if (body.endsWith('+') && body.length > 1) {
    // N+  => >= N
    const n = parseInt(body.slice(0, -1), 10);
    if (!Number.isNaN(n)) matched = num >= n;
  } else if (body.includes('-')) {
    const idx = body.indexOf('-');
    const left = body.slice(0, idx).trim();
    const right = body.slice(idx + 1).trim();
    const a = parseInt(left, 10);
    if (Number.isNaN(a)) {
      matched = false;
    } else if (right === '') {
      // N-  => >= N
      matched = num >= a;
    } else {
      const b = parseInt(right, 10);
      if (Number.isNaN(b)) matched = false;
      else matched = num >= a && num <= b;
    }
  } else {
    const n = parseInt(body, 10);
    if (!Number.isNaN(n)) matched = num === n;
  }
  return neg ? !matched : matched;
}

function matchRange(num: number, expr: string): boolean {
  try {
    if (typeof expr !== 'string') return false;
    const trimmed = expr.trim();
    if (trimmed.length === 0) return false;
    // Split on '|' or ',' — both appear in the wild
    const parts = trimmed.split(/[|,]/);
    // If single part (no separator), evaluate directly
    // For multiple parts, any part matching => true (OR semantics)
    // This mirrors the C++ loop that checks each range token.
    for (const p of parts) {
      if (singleRangeMatch(num, p)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// applyMatcher — dispatch by !! prefix else remark regex
// Spec §9: !!GROUP=, !!GROUPID=, !!INSERT=, !!TYPE=, !!PORT=, !!SERVER=

export function applyMatcher(node: Proxy, pattern: string): boolean {
  try {
    if (!node || typeof pattern !== 'string') return false;
    const pat = pattern.trim();
    if (pat.length === 0) return false;

    // !!GROUP=  -> regFind on Group
    if (pat.startsWith('!!GROUP=')) {
      const expr = pat.slice('!!GROUP='.length);
      if (expr.length === 0) return false;
      const group = node.group ?? '';
      return regFind(expr, group);
    }

    // !!GROUPID= -> matchRange on GroupId (int)
    if (pat.startsWith('!!GROUPID=')) {
      const expr = pat.slice('!!GROUPID='.length);
      const gid = typeof node.groupId === 'number' ? node.groupId : 0;
      // Allow empty expr to mean "no match" rather than throw
      if (expr.trim().length === 0) return false;
      return matchRange(gid, expr);
    }

    // !!INSERT= -> GroupId < 0  (insert group)
    // Spec: !!INSERT= matches insert groups.  Expression may be
    // "true"/"false" or empty; treat empty/true/1 as "<0", false/0 as ">=0".
    if (pat.startsWith('!!INSERT=')) {
      const expr = pat.slice('!!INSERT='.length).trim().toLowerCase();
      const isInsert = (node.groupId ?? 0) < 0;
      if (expr === '' || expr === 'true' || expr === '1') return isInsert;
      if (expr === 'false' || expr === '0') return !isInsert;
      // If custom expression, interpret as boolean via regFind on "true"/"false" ?
      // Fallback: regFind expr against "true" string representation
      // but keep simple: treat non-empty unknown as check for insert
      return isInsert && regFind(expr, String(isInsert));
    }

    // !!TYPE= -> regFind on ProxyType string
    if (pat.startsWith('!!TYPE=')) {
      const expr = pat.slice('!!TYPE='.length);
      if (expr.length === 0) return false;
      const typeStr = node.type ?? '';
      return regFind(expr, typeStr);
    }

    // !!PORT= -> matchRange on Port
    if (pat.startsWith('!!PORT=')) {
      const expr = pat.slice('!!PORT='.length);
      const port = typeof node.port === 'number' ? node.port : 0;
      if (expr.trim().length === 0) return false;
      return matchRange(port, expr);
    }

    // !!SERVER= -> regFind on Hostname/Server
    if (pat.startsWith('!!SERVER=')) {
      const expr = pat.slice('!!SERVER='.length);
      if (expr.length === 0) return false;
      const server = node.hostname ?? '';
      return regFind(expr, server);
    }

    // Default: regFind on Remark
    return regFind(pat, node.remark ?? '');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// groupGenerate — expand proxy-group rule into list of remarks
// Spec §9: []NAME literal, script: skip, otherwise filter+dedup by remark

export function groupGenerate(groupName: string, rule: string, nodes: Proxy[]): string[] {
  try {
    if (typeof rule !== 'string') return [];
    const trimmed = rule.trim();
    if (trimmed.length === 0) return [];
    // []NAME literal — e.g. []DIRECT, []REJECT, []PROXY
    if (trimmed.startsWith('[]')) {
      const literal = trimmed.slice(2).trim();
      // C++ returns single element without "[]", even if empty keep "" ?
      // If literal empty (bare "[]"), return empty to avoid phantom entry
      if (literal.length === 0) return [];
      return [literal];
    }
    // script: prefix — requires authorized runtime, skip in pipeline
    if (trimmed.startsWith('script:')) {
      return [];
    }

    const safeNodes = Array.isArray(nodes) ? nodes : [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const node of safeNodes) {
      if (!node || typeof node.remark !== 'string') continue;
      let matched = false;
      try {
        matched = applyMatcher(node, trimmed);
      } catch {
        matched = false;
      }
      if (matched) {
        // Dedupe by remark (spec §9: filtered_nodelist dedup)
        if (!seen.has(node.remark)) {
          seen.add(node.remark);
          out.push(node.remark);
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// nodeRename — sequential rename rules, empty result reverts

export function nodeRename(node: Proxy, renameArray: RegexMatchConfig[]): void {
  try {
    if (!node || !Array.isArray(renameArray) || renameArray.length === 0) return;
    for (const entry of renameArray) {
      if (!entry || typeof entry.match !== 'string' || typeof entry.replace !== 'string') continue;
      const pat = entry.match;
      if (pat.length === 0) continue;
      try {
        if (regFind(pat, node.remark ?? '')) {
          const original = node.remark;
          const replaced = regReplace(pat, entry.replace, node.remark ?? '');
          // C++ :403-407 : empty result reverts to original
          if (replaced.length === 0) {
            node.remark = original;
          } else {
            node.remark = replaced;
          }
        }
      } catch {
        continue;
      }
    }
  } catch {
    // Never throw
  }
}

// ---------------------------------------------------------------------------
// addEmoji — first matching entry prefixes emoji

export function addEmoji(node: Proxy, emojiArray: RegexMatchConfig[]): void {
  try {
    if (!node || !Array.isArray(emojiArray) || emojiArray.length === 0) return;
    for (const entry of emojiArray) {
      if (!entry || typeof entry.match !== 'string' || typeof entry.replace !== 'string') continue;
      const pat = entry.match;
      if (pat.length === 0) continue;
      try {
        if (regFind(pat, node.remark ?? '')) {
          // entry.replace holds the emoji string
          const emoji = entry.replace;
          // Avoid double-prefix if already starts with emoji? Keep simple.
          node.remark = `${emoji} ${node.remark}`;
          break; // first match only
        }
      } catch {
        continue;
      }
    }
  } catch {
    // never throw
  }
}

// ---------------------------------------------------------------------------
// removeEmoji — strip leading emoji / non-alphanumeric prefix
// Spec task: "strip leading emoji via regex /^[^\w\s]+\s*/ maybe simple"
// Also spec §7 pipeline: remove_emoji → trim
// Implement unicode-aware leading symbol strip.

export function removeEmoji(str: string): string {
  try {
    if (typeof str !== 'string') return '';
    if (str.length === 0) return str;
    // Remove leading characters that are not word chars, not spaces, not CJK
    // Keep letters/numbers (including unicode) and spaces.
    // The C++ version strips leading emoji chars (non-alphanumeric run).
    // We use: leading sequence of chars where each char is not \p{L}, \p{N}, nor whitespace
    // followed by optional whitespace.  Fallback to simple ascii if unicode property fails.
    try {
      // Unicode property escapes require 'u' flag
      const re = /^[^\p{L}\p{N}\s]+[\s]*/u;
      const m = str.match(re);
      if (m) return str.slice(m[0].length);
      return str;
    } catch {
      // Fallback ascii
      return str.replace(/^[^\w\s]+\s*/, '');
    }
  } catch {
    return typeof str === 'string' ? str : '';
  }
}

// ---------------------------------------------------------------------------
// preprocessNodes — per-node pipeline + optional sort

export interface PreprocessSettings {
  renameArray: RegexMatchConfig[];
  emojiArray: RegexMatchConfig[];
  addEmoji: boolean;
  removeEmoji: boolean;
  sortFlag: boolean;
  sortScript?: string;
}

export function preprocessNodes(nodes: Proxy[], settings: PreprocessSettings): void {
  try {
    if (!Array.isArray(nodes) || nodes.length === 0) return;
    const safe = settings ?? ({} as PreprocessSettings);
    const renameArray = Array.isArray(safe.renameArray) ? safe.renameArray : [];
    const emojiArray = Array.isArray(safe.emojiArray) ? safe.emojiArray : [];
    const doAddEmoji = Boolean(safe.addEmoji);
    const doRemoveEmoji = Boolean(safe.removeEmoji);
    const doSort = Boolean(safe.sortFlag);
    const sortScript = typeof safe.sortScript === 'string' ? safe.sortScript.trim() : '';

    // Per-node transforms in spec order: remove_emoji → trim → nodeRename → addEmoji
    for (const node of nodes) {
      if (!node) continue;
      try {
        if (doRemoveEmoji) {
          node.remark = removeEmoji(node.remark ?? '');
        }
        // Trim step (spec :470-471)
        if (typeof node.remark === 'string') {
          node.remark = node.remark.trim();
        } else {
          node.remark = String(node.remark ?? '').trim();
        }
        nodeRename(node, renameArray);
        if (doAddEmoji) {
          addEmoji(node, emojiArray);
        }
      } catch {
        continue;
      }
    }

    if (!doSort) return;

    // Sort by remark — stable sort (JS sort is stable since ES2019)
    // If sortScript provided, try to use it as comparator body via new Function
    // Fallback to localeCompare on failure.
    if (sortScript.length > 0) {
      let comparator: ((a: Proxy, b: Proxy) => number) | null = null;
      try {
        // Try interpret sortScript as function body with params (a,b).
        // Common patterns in C++ configs:
        //  - "a.remark.localeCompare(b.remark)"
        //  - "return a.remark.localeCompare(b.remark)"
        // We attempt two forms: direct expression or full body.
        const body = sortScript.includes('return') ? sortScript : `return (${sortScript});`;
        // Create function. Using new Function is allowed in Workers for sortScript.
        const fn = new Function('a', 'b', body) as unknown as (a: Proxy, b: Proxy) => number;
        // Probe: test comparator returns number for first two nodes
        if (nodes.length >= 2) {
          const probe = fn(nodes[0] as Proxy, nodes[1] as Proxy);
          if (typeof probe === 'number' && !Number.isNaN(probe)) {
            comparator = fn;
          } else if (nodes.length >= 1) {
            // Single element or probe not number — still treat as comparator if it doesn't throw
            comparator = fn;
          }
        } else {
          comparator = fn;
        }
      } catch {
        comparator = null;
      }
      if (comparator) {
        try {
          nodes.sort((a, b) => {
            try {
              const r = comparator!(a, b);
              if (typeof r === 'number' && !Number.isNaN(r)) return r;
              return String(a.remark ?? '').localeCompare(String(b.remark ?? ''));
            } catch {
              return String(a.remark ?? '').localeCompare(String(b.remark ?? ''));
            }
          });
          return;
        } catch {
          // fallthrough to localeCompare
        }
      }
    }

    // Default lexicographic sort by remark
    try {
      nodes.sort((a, b) => {
        const ra = String(a?.remark ?? '');
        const rb = String(b?.remark ?? '');
        return ra.localeCompare(rb);
      });
    } catch {
      // never throw
    }
  } catch {
    // never throw
  }
}

// ---------------------------------------------------------------------------
// processRemark — export-time name sanitization + dedup
// Spec §7: '=' => '-', comma quoting placeholder, dedup with ' N' suffix

export function processRemark(remark: string, seen: Set<string>): string {
  try {
    const safeSeen = seen instanceof Set ? seen : new Set<string>();
    let r = typeof remark === 'string' ? remark : String(remark ?? '');
    // '=' => '-' (subexport.cpp:186)
    r = r.replace(/=/g, '-');
    // Comma quoting placeholder: Surge proc_comma=true adds quotes if contains comma.
    // For Clash/SingBox proc_comma=false and for pipeline placeholder we return as-is.
    // (No quoting transformation here.)
    if (!safeSeen.has(r)) {
      safeSeen.add(r);
      return r;
    }
    let n = 2;
    // C++ adds " N" suffix incrementing until unique
    // Guard against infinite loop with cap 10000
    while (n < 10000) {
      const cand = `${r} ${n}`;
      if (!safeSeen.has(cand)) {
        safeSeen.add(cand);
        return cand;
      }
      n++;
    }
    // Fallback if cap hit: add random suffix
    const fallback = `${r} ${n}`;
    safeSeen.add(fallback);
    return fallback;
  } catch {
    return typeof remark === 'string' ? remark : String(remark ?? '');
  }
}
