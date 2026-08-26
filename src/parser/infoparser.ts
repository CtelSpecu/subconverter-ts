/**
 * infoparser.ts — port of src/parser/infoparser.cpp
 *
 * Implements §6 spec: streamToInt, dateStringToTimestamp,
 * getSubInfoFromHeader, getSubInfoFromNodes, getSubInfoFromSSD
 */

import type { Proxy, RegexMatchConfig } from '../types.js';
import { regMatch, regReplace } from '../utils/regexp.js';

// ---------------------------------------------------------------------------
// streamToInt — units B/KB/MB/GB/TB/PB/EB ×1024
// ---------------------------------------------------------------------------
export function streamToInt(str: string): number {
  if (!str || typeof str !== 'string') return 0;
  const s = str.trim();
  if (!s) return 0;
  // Match numeric part + optional unit
  // Accept forms: "10", "10B", "10 KB", "1.5GB", "2.3 TB"
  const m = s.match(/^\s*([0-9]*\.?[0-9]+)\s*([KMGTPE]?B)?\s*$/i);
  if (!m) {
    // Try plain integer fallback
    const n = parseFloat(s);
    return isNaN(n) ? 0 : Math.floor(n);
  }
  const num = parseFloat(m[1]);
  if (isNaN(num)) return 0;
  const unit = (m[2] || 'B').toUpperCase();
  const units: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
    PB: 1024 ** 5,
    EB: 1024 ** 6,
  };
  const mul = units[unit] ?? 1;
  // Use Math.floor to match C++ integer truncation
  return Math.floor(num * mul);
}

// ---------------------------------------------------------------------------
// dateStringToTimestamp — left=Nd => now+ N*86400, else Y:M:D:h:m:s → mktime
// ---------------------------------------------------------------------------
export function dateStringToTimestamp(str: string): number {
  if (!str || typeof str !== 'string') return 0;
  const s = str.trim();
  if (!s) return 0;

  // "left=Nd" form — extract N before 'd'
  // Accept "left=30d", "30d", "left= 30 d", or any string containing "<number>d"
  // Spec says left=Nd => now+ N*86400
  // Detect presence of 'd' suffix indicating days left
  // Try left=Nd pattern first
  const leftMatch = s.match(/(\d+)\s*d/i);
  if (leftMatch && /d/i.test(s)) {
    // Heuristic: if string looks like left-days form (contains 'd' and is short),
    // treat as days-left. C++ checks startsWith "left=" ? but spec says left=Nd
    // We treat: if string matches /^\s*(left\s*=\s*)?\d+\s*d\s*$/i then it's days-left
    if (/^\s*(left\s*=\s*)?\d+\s*d\s*$/i.test(s)) {
      const days = parseInt(leftMatch[1], 10);
      if (!isNaN(days)) {
        return Math.floor(Date.now() / 1000) + days * 86400;
      }
    }
  }

  // Otherwise try "Y:M:D:h:m:s" split by ':'
  const parts = s.split(':');
  if (parts.length !== 6) return 0;
  const nums = parts.map((p) => parseInt(p.trim(), 10));
  if (nums.some((n) => isNaN(n))) return 0;
  const [year, month, day, hour, minute, second] = nums;
  // Use local time like C++ mktime (not UTC). JS Date constructor is local.
  try {
    const d = new Date(year, month - 1, day, hour, minute, second);
    if (isNaN(d.getTime())) return 0;
    return Math.floor(d.getTime() / 1000);
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// getSubInfoFromHeader — raw match of /(?i:Subscription-UserInfo): (.*?)\s*$/
// ---------------------------------------------------------------------------
export function getSubInfoFromHeader(headerValue: string): string {
  if (!headerValue || typeof headerValue !== 'string') return '';
  try {
    // Case-insensitive, capture until trailing whitespace trimmed
    const re = /Subscription-UserInfo:\s*(.*?)\s*$/im;
    const m = headerValue.match(re);
    if (m && m[1] !== undefined) return m[1].trim();
    return '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Helpers for getSubInfoFromNodes
// ---------------------------------------------------------------------------

function getQueryParam(text: string, key: string): string | null {
  try {
    // Try URLSearchParams if text looks like query string
    // Extract substring that contains key=
    // Use regex to be tolerant of non-URL forms
    const re = new RegExp(`(?:[?&;]|^)\\s*${key}\\s*[=:]\\s*([^\\s&;]+)`, 'i');
    const m = text.match(re);
    if (m && m[1] !== undefined) {
      // URL-decode the value
      try {
        return decodeURIComponent(m[1]);
      } catch {
        return m[1];
      }
    }
    return null;
  } catch {
    return null;
  }
}

function parsePercentOrBytes(val: string): { isPercent: boolean; value: number } | null {
  if (!val) return null;
  const t = val.trim();
  if (t.endsWith('%')) {
    const pct = parseFloat(t.slice(0, -1));
    if (isNaN(pct)) return null;
    return { isPercent: true, value: pct };
  }
  const bytes = streamToInt(t);
  return { isPercent: false, value: bytes };
}

// ---------------------------------------------------------------------------
// getSubInfoFromNodes — first-hit stream/time rules
// ---------------------------------------------------------------------------
export function getSubInfoFromNodes(
  proxies: Proxy[],
  streamRules: RegexMatchConfig[],
  timeRules: RegexMatchConfig[]
): string {
  try {
    if (!Array.isArray(proxies) || proxies.length === 0) return '';

    let streamInfo = '';
    let timeInfo = '';

    // Helper: find first hit among proxies using given rules
    function findFirstHit(rules: RegexMatchConfig[]): string {
      if (!Array.isArray(rules) || rules.length === 0) return '';
      for (const proxy of proxies) {
        const remark = proxy?.remark ?? '';
        const host = proxy?.hostname ?? '';
        // C++ applies rules against concatenated remark? Spec says against node remark
        // We'll try remark first, then fallback to host
        const candidates = [remark, host, `${remark} ${host}`.trim()];
        for (const candidate of candidates) {
          for (const rule of rules) {
            if (!rule || typeof rule.match !== 'string' || typeof rule.replace !== 'string') continue;
            // First check regMatch (anchored full match) — spec says regMatch+regReplace
            // But also need to consider that rule.match may be intended as partial pattern.
            // We'll try regMatch first; if false, skip. This matches C++ ANCHORED semantics.
            let matched = false;
            try {
              matched = regMatch(rule.match, candidate);
            } catch {
              matched = false;
            }
            // If anchored match fails, also try partial find? Spec says regMatch, so strict.
            // However some rules use partial patterns — fallback to regFind semantics? Keep strict per spec.
            if (!matched) continue;
            let replaced: string;
            try {
              replaced = regReplace(rule.match, rule.replace, candidate);
            } catch {
              continue;
            }
            if (replaced !== candidate) {
              return replaced;
            }
          }
        }
      }
      return '';
    }

    const streamHit = findFirstHit(streamRules);
    const timeHit = findFirstHit(timeRules);

    // Parse streamHit for total/used/left
    let total = 0;
    let used = 0;
    let leftVal: number | null = null;
    let leftIsPercent = false;

    if (streamHit) {
      streamInfo = streamHit;
      // Extract params from hit string
      const totalStr = getQueryParam(streamInfo, 'total');
      const usedStr = getQueryParam(streamInfo, 'upload') ?? getQueryParam(streamInfo, 'used') ?? getQueryParam(streamInfo, 'download');
      const leftStr = getQueryParam(streamInfo, 'left') ?? getQueryParam(streamInfo, 'remain') ?? getQueryParam(streamInfo, 'remaining');

      // More tolerant: also try to extract totalStr etc via generic pattern if not found
      // Try additional keys like "total", "upload", "download", "available"
      let tStr = totalStr;
      let uStr = usedStr;
      let lStr = leftStr;

      // Fallback: if hit contains bytes-like tokens, try to parse them directly
      // For example hit might be "Used: 2GB Total: 10GB"
      if (!tStr) {
        const m = streamInfo.match(/total\s*[:=]\s*([0-9.]+\s*[KMGTPE]?B)/i);
        if (m) tStr = m[1];
      }
      if (!uStr) {
        const m = streamInfo.match(/(?:used|download|upload)\s*[:=]\s*([0-9.]+\s*[KMGTPE]?B)/i);
        if (m) uStr = m[1];
      }
      if (!lStr) {
        const m = streamInfo.match(/(?:left|remain)\s*[:=]\s*([0-9.]+\s*[KMGTPE]?B|[\d.]+%)/i);
        if (m) lStr = m[1];
      }

      if (tStr) total = streamToInt(tStr);
      if (uStr) {
        // upload is merged into download per spec; treat as used/download
        // If both upload and download present, sum? For now take single value as download
        used = streamToInt(uStr);
        // Spec notes upload 合并进 download — if we found upload+download separately, sum them.
        // Check if both exist separately in hit
        const upStr = getQueryParam(streamInfo, 'upload');
        const downStr = getQueryParam(streamInfo, 'download');
        if (upStr && downStr) {
          used = streamToInt(upStr) + streamToInt(downStr);
        } else if (upStr && !downStr && uStr === upStr) {
          // already handled
        }
      }

      if (lStr) {
        const parsed = parsePercentOrBytes(lStr);
        if (parsed) {
          if (parsed.isPercent) {
            leftIsPercent = true;
            if (total > 0) {
              leftVal = Math.floor(total * parsed.value / 100);
            } else {
              leftVal = null;
            }
          } else {
            leftVal = parsed.value;
            if (total > 0 && leftVal > total) leftVal = 0;
          }
        }
      }

      // Derive missing values: left>total→0 already handled; infer used/total if one missing
      if (total > 0 && leftVal !== null && used === 0) {
        used = total - leftVal;
        if (used < 0) used = 0;
      } else if (total > 0 && leftVal === null && used > 0) {
        // left not needed for output but computed for consistency
        leftVal = total - used;
      } else if (total === 0 && used > 0 && leftVal !== null && leftVal > 0) {
        total = used + leftVal;
      }

      // If still total 0 but we have some bytes, try to infer total from left+used
      if (total === 0 && used > 0 && leftVal !== null && leftVal > 0) {
        total = used + leftVal;
      }

      // If no valid total, return empty (no info to report)
      if (total <= 0 && used <= 0) {
        // No meaningful traffic info
        streamInfo = '';
      }
    }

    // Parse timeHit for expire
    let expireTs = 0;
    if (timeHit) {
      timeInfo = timeHit;
      // Time hit may be a timestamp like "2025:12:31:23:59:59" or "left=30d" or numeric
      // Try to extract expire param
      const expireStrRaw = getQueryParam(timeInfo, 'expire') ?? getQueryParam(timeInfo, 'expiry') ?? timeInfo;
      // The extracted string may be URL decoded; try to parse timestamp
      // If it's numeric string treat as timestamp
      const trimmed = expireStrRaw.trim();
      if (/^\d+$/.test(trimmed)) {
        const n = parseInt(trimmed, 10);
        // If small number maybe days left? But treat as timestamp if large
        if (n > 100000) expireTs = n;
        else expireTs = dateStringToTimestamp(trimmed);
      } else {
        expireTs = dateStringToTimestamp(trimmed);
        // Fallback: try plain numeric
        if (expireTs === 0 && /^\d+$/.test(trimmed)) {
          expireTs = parseInt(trimmed, 10);
        }
      }
    }

    // Build output string per spec: upload=0; download=...; total=...; [expire=...;]
    if (streamInfo === '' && timeInfo === '') return '';
    // If streamInfo empty but timeInfo exists, we still need total? Spec says output includes total/download only if stream found.
    // Return minimal info
    let out = '';
    if (total > 0 || used > 0) {
      // Ensure total at least used if missing
      if (total === 0 && used > 0) total = used;
      out = `upload=0; download=${used}; total=${total};`;
      if (expireTs > 0) out += ` expire=${expireTs};`;
    } else if (expireTs > 0) {
      // Only expire info
      out = `upload=0; download=0; total=0; expire=${expireTs};`;
    } else {
      return '';
    }
    return out;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// getSubInfoFromSSD — parse ssd b64 JSON's traffic fields
// ---------------------------------------------------------------------------
export function getSubInfoFromSSD(jsonStr: string): string {
  if (!jsonStr || typeof jsonStr !== 'string') return '';
  try {
    let content = jsonStr.trim();
    if (!content) return '';

    // Try base64 decode if content looks like base64 and not JSON
    if (!content.startsWith('{') && !content.startsWith('[')) {
      try {
        // Attempt urlSafe base64 decode
        let tmp = content.replace(/-/g, '+').replace(/_/g, '/');
        const pad = tmp.length % 4;
        if (pad) tmp += '='.repeat(4 - pad);
        const decoded = (() => {
          try {
            return decodeURIComponent(escape(atob(tmp)));
          } catch {
            try {
              return atob(tmp);
            } catch {
              return '';
            }
          }
        })();
        if (decoded && (decoded.trim().startsWith('{') || decoded.trim().startsWith('['))) {
          content = decoded;
        }
      } catch {
        // keep original
      }
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(content) as Record<string, unknown>;
    } catch {
      return '';
    }

    let total = 0;
    let used = 0;
    let expireTs = 0;

    // traffic_total / traffic_used — spec says GB ×1024^? Actually GB × 1024^3
    const totalVal = data['traffic_total'];
    const usedVal = data['traffic_used'];

    if (typeof totalVal === 'number') {
      total = Math.floor(totalVal * 1024 ** 3);
    } else if (typeof totalVal === 'string') {
      const n = parseFloat(totalVal);
      if (!isNaN(n)) total = Math.floor(n * 1024 ** 3);
    }

    if (typeof usedVal === 'number') {
      used = Math.floor(usedVal * 1024 ** 3);
    } else if (typeof usedVal === 'string') {
      const n = parseFloat(usedVal);
      if (!isNaN(n)) used = Math.floor(n * 1024 ** 3);
    }

    const expiryRaw = data['expiry'] ?? data['expire'] ?? data['expiration'];
    if (typeof expiryRaw === 'string' && expiryRaw.trim()) {
      const expiryStr = expiryRaw.trim();
      // Transform "YYYY-MM-DD HH:MM:SS" → "YYYY:MM:DD:HH:MM:SS" per spec
      // Spec: "(\\d+)-(\\d+)-(\\d+) (.*)" → "$1:$2:$3:$4"
      const m = expiryStr.match(/(\d+)-(\d+)-(\d+)\s+(.*)/);
      let converted = expiryStr;
      if (m) {
        // m[4] contains time part like "23:59:59"
        converted = `${m[1]}:${m[2]}:${m[3]}:${m[4]}`;
      } else {
        // Try already colon separated?
        converted = expiryStr.replace(/-/g, ':').replace(/\s+/, ':');
      }
      expireTs = dateStringToTimestamp(converted);
      // If still 0, try parsing expiry as timestamp number
      if (expireTs === 0) {
        const n = parseInt(expiryStr, 10);
        if (!isNaN(n) && n > 100000) expireTs = n;
      }
    } else if (typeof expiryRaw === 'number') {
      expireTs = expiryRaw > 100000 ? expiryRaw : 0;
    }

    if (total === 0 && used === 0 && expireTs === 0) return '';

    // Ensure total at least used
    if (total === 0 && used > 0) total = used;

    let out = `upload=0; download=${used}; total=${total};`;
    if (expireTs > 0) out += ` expire=${expireTs};`;
    return out;
  } catch {
    return '';
  }
}
