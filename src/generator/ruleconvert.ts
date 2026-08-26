import type { RulesetConfig } from '../types.js';

const MAX_ALLOWED_RULES = 32768;

const CLASH_RULE_TYPES: Record<string, true> = {
  'DOMAIN': true,
  'DOMAIN-SUFFIX': true,
  'DOMAIN-KEYWORD': true,
  'IP-CIDR': true,
  'IP-CIDR6': true,
  'GEOIP': true,
  'MATCH': true,
  'FINAL': true,
  'SRC-PORT': true,
  'DST-PORT': true,
  'SRC-IP-CIDR': true,
  'PROCESS-NAME': true,
  'IP-ASN': true,
  'RULE-SET': true,
};

function trimStr(s: string): string {
  if (typeof s !== 'string') return '';
  return s.trim();
}

/**
 * convertRuleset - minimal per spec §10
 * SURGE passthrough, clash payload handling (strip 'payload:' / '- '), quanx host->DOMAIN etc.
 * For MVP, passthrough if unknown.
 */
export function convertRuleset(content: string, type: string): string {
  if (typeof content !== 'string' || !content) return '';
  if (typeof type !== 'string' || !type) return content;
  const lower = type.toLowerCase().trim();
  try {
    // QuanX / Quan family: host -> DOMAIN, host-wildcard/host-suffix -> DOMAIN-SUFFIX, ip6-cidr -> IP-CIDR6
    if (lower.includes('quanx') || lower === 'quan' || lower.includes('quan')) {
      let out = content;
      // host, -> DOMAIN,
      out = out.replace(/^host,/gim, 'DOMAIN,');
      out = out.replace(/\nhost,/gi, '\nDOMAIN,');
      out = out.replace(/^host-wildcard,/gim, 'DOMAIN-SUFFIX,');
      out = out.replace(/\nhost-wildcard,/gi, '\nDOMAIN-SUFFIX,');
      out = out.replace(/^host-suffix,/gim, 'DOMAIN-SUFFIX,');
      out = out.replace(/\nhost-suffix,/gi, '\nDOMAIN-SUFFIX,');
      // ip6-cidr variants
      out = out.replace(/ip6-cidr/gi, 'IP-CIDR6');
      // keep no-resolve flag as is
      return out;
    }
    // Clash family: payload YAML stripping
    if (lower.includes('clash')) {
      if (content.includes('payload:')) {
        const lines: string[] = [];
        const rawLines = content.split(/\r?\n/);
        let inPayload = false;
        for (const l of rawLines) {
          const t = l.trim();
          if (!inPayload) {
            if (t.toLowerCase().startsWith('payload:')) {
              inPayload = true;
            }
            continue;
          }
          if (!t || t.startsWith('#')) continue;
          if (t.startsWith('- ')) {
            lines.push(t.slice(2).trim());
          } else if (t.startsWith('-')) {
            lines.push(t.slice(1).trim());
          } else if (t.includes(',')) {
            lines.push(t);
          }
        }
        if (lines.length > 0) return lines.join('\n');
        // fallthrough to generic stripping if payload parsing produced nothing
      }
      // generic '- ' stripping for clash lists that may not have payload header
      const hasDash = content.split('\n').some(l => l.trim().startsWith('-'));
      if (hasDash) {
        const stripped = content
          .split(/\r?\n/)
          .map(l => {
            const t = l.trim();
            if (t.startsWith('- ')) return t.slice(2).trim();
            if (t.startsWith('-')) return t.slice(1).trim();
            return l;
          })
          .filter(l => {
            const t = l.trim();
            if (!t) return false;
            if (t.toLowerCase().startsWith('payload:')) return false;
            if (t.startsWith('#')) return false;
            return true;
          })
          .join('\n');
        // only use stripped if it changed
        if (stripped !== content) return stripped;
      }
      return content;
    }
    // SURGE and others: passthrough
    return content;
  } catch {
    return content;
  }
}

function transformRuleToCommon(line: string, group: string): string | null {
  const trimmed = trimStr(line);
  if (!trimmed) return null;
  if (trimmed.startsWith('#') || trimmed.startsWith(';') || trimmed.startsWith('//')) return null;
  // strip leading '- ' that may remain
  let clean = trimmed;
  if (clean.startsWith('- ')) clean = clean.slice(2).trim();
  else if (clean.startsWith('-')) clean = clean.slice(1).trim();
  if (!clean) return null;

  const parts = clean.split(',').map(p => p.trim());
  if (parts.length === 0) return null;
  const rawType = parts[0].toUpperCase();
  if (!rawType) return null;

  // FINAL and MATCH are special: they map to MATCH,group
  if (rawType === 'FINAL') {
    return `MATCH,${group}`;
  }
  if (rawType === 'MATCH') {
    // MATCH may already have a group as second part; normalize to supplied group
    return `MATCH,${group}`;
  }
  // need at least type and value
  if (parts.length < 2) return null;
  const value = parts[1];
  if (!value) return null;

  // handle extra flags (e.g., no-resolve)
  let flags = '';
  if (parts.length > 2) {
    // parts[2] could be group or flag
    const third = parts[2];
    const lowerThird = third.toLowerCase();
    if (lowerThird === 'no-resolve') {
      flags = `,${third}`;
      if (parts.length > 3) flags += `,${parts.slice(3).join(',')}`;
    } else if (parts.length === 3) {
      // third is presumed original group – ignore, we use supplied group
      // no flags
    } else {
      // more than 3 parts: third is group, rest are flags
      const rest = parts.slice(3).join(',');
      if (rest) flags = `,${rest}`;
    }
  }

  return `${rawType},${value},${group}${flags}`;
}

function isClashRuleAllowed(type: string): boolean {
  const upper = type.toUpperCase();
  return !!CLASH_RULE_TYPES[upper];
}

/**
 * rulesetToClash - iterate rulesets, fetch contentMap, filter by whitelist,
 * transformRuleToCommon => `type,value,group` and return joined lines.
 * Respect maxAllowedRules 32768 break.
 */
export function rulesetToClash(
  rulesets: RulesetConfig[],
  contentMap: Map<string, string>,
  _overwrite: boolean,
): string {
  if (!Array.isArray(rulesets) || rulesets.length === 0) return '';
  if (!(contentMap instanceof Map)) return '';
  const out: string[] = [];
  let count = 0;
  try {
    for (const rs of rulesets) {
      if (!rs || typeof rs.group !== 'string' || typeof rs.url !== 'string') continue;
      let raw: string | undefined;
      if (rs.url.startsWith('[]')) {
        raw = rs.url.slice(2);
      } else {
        raw = contentMap.get(rs.url);
        if (raw === undefined) raw = contentMap.get(rs.group + ':' + rs.url);
        // also try without type prefix stripping?
        if (raw === undefined) {
          // try to find by suffix match (typed url)
          for (const [k, v] of contentMap.entries()) {
            if (k.endsWith(rs.url) || rs.url.endsWith(k)) {
              raw = v;
              break;
            }
          }
        }
      }
      if (typeof raw !== 'string' || !raw) continue;
      // apply convertRuleset if content looks like clash payload? For MVP, handle inline via convert
      // but we already handle payload in transform loop; still run convert for clash types
      const converted = convertRuleset(raw, rs.type ?? '');
      const source = converted || raw;
      const lines = source.split(/\r?\n/);
      for (let line of lines) {
        line = trimStr(line);
        if (!line) continue;
        if (line.toLowerCase().startsWith('payload:')) continue;
        if (line.startsWith('#') || line.startsWith(';') || line.startsWith('//')) continue;
        const transformed = transformRuleToCommon(line, rs.group);
        if (!transformed) continue;
        const type = transformed.split(',')[0];
        if (!isClashRuleAllowed(type)) continue;
        out.push(transformed);
        count++;
        if (count >= MAX_ALLOWED_RULES) break;
      }
      if (count >= MAX_ALLOWED_RULES) break;
    }
  } catch {
    // never throw
  }
  return out.join('\n');
}

/**
 * rulesetToSurge - similar for Surge, handle -1/-2/-4 mapping.
 * For MVP return `RULE-SET,url,group` for remote and inline rules for [] prefix.
 * surgeVer: 0=Mellow, -1=QuanX filter_local, -2=Quan TCP, -4=Loon Remote Rule, else normal Surge Rule
 */
export function rulesetToSurge(
  rulesets: RulesetConfig[],
  contentMap: Map<string, string>,
  _overwrite: boolean,
  surgeVer?: number,
): string {
  if (!Array.isArray(rulesets) || rulesets.length === 0) return '';
  if (!(contentMap instanceof Map)) {
    // still handle inline [] without map
    const inlineOnly: string[] = [];
    for (const rs of rulesets) {
      if (!rs || typeof rs.url !== 'string' || typeof rs.group !== 'string') continue;
      if (rs.url.startsWith('[]')) {
        const inner = rs.url.slice(2).trim();
        if (!inner) continue;
        const lines = inner.split(/\r?\n/);
        for (let l of lines) {
          l = trimStr(l);
          if (!l || l.startsWith('#')) continue;
          const t = transformRuleToCommon(l, rs.group);
          if (t) inlineOnly.push(t);
          else inlineOnly.push(`${l},${rs.group}`);
        }
      }
    }
    if (inlineOnly.length) return inlineOnly.join('\n');
    return '';
  }
  const out: string[] = [];
  let count = 0;
  try {
    for (const rs of rulesets) {
      if (!rs || typeof rs.group !== 'string' || typeof rs.url !== 'string') continue;
      if (rs.url.startsWith('[]')) {
        const inner = rs.url.slice(2).trim();
        if (!inner) continue;
        const lines = inner.split(/\r?\n/);
        for (let l of lines) {
          l = trimStr(l);
          if (!l || l.startsWith('#')) continue;
          // inline already a rule like "DOMAIN-SUFFIX,google.com"
          const transformed = transformRuleToCommon(l, rs.group);
          if (transformed) {
            // Map FINAL->MATCH already done
            out.push(transformed);
          } else {
            // fallback: if line already contains group, keep, else append
            if (l.includes(',')) {
              const parts = l.split(',');
              if (parts.length >= 3) out.push(l);
              else out.push(`${l},${rs.group}`);
            } else {
              out.push(`${l},${rs.group}`);
            }
          }
          count++;
          if (count >= MAX_ALLOWED_RULES) break;
        }
      } else {
        // remote
        const ver = typeof surgeVer === 'number' ? surgeVer : 3;
        if (ver === -1) {
          // QuanX filter_local style - for MVP keep RULE-SET but distinct keyword
          out.push(`RULE-SET,${rs.url},${rs.group}`);
        } else if (ver === -2) {
          out.push(`RULE-SET,${rs.url},${rs.group}`);
        } else if (ver === -4) {
          out.push(`RULE-SET,${rs.url},${rs.group}`);
        } else if (ver === 0) {
          out.push(`RULE-SET,${rs.url},${rs.group}`);
        } else {
          out.push(`RULE-SET,${rs.url},${rs.group}`);
        }
        count++;
      }
      if (count >= MAX_ALLOWED_RULES) break;
    }
  } catch {
    // never throw
  }
  return out.join('\n');
}

/**
 * rulesetToSingBox - return JSON array string for MVP.
 */
export function rulesetToSingBox(
  rulesets: RulesetConfig[],
  contentMap: Map<string, string>,
  _overwrite: boolean,
): string {
  if (!Array.isArray(rulesets) || rulesets.length === 0) return '[]';
  try {
    const arr: Array<Record<string, unknown>> = [];
    // Always include dns-out placeholder per spec
    // For MVP, produce simple array of rule_sets or rules
    for (const rs of rulesets) {
      if (!rs || typeof rs.group !== 'string' || typeof rs.url !== 'string') continue;
      let content: string | undefined;
      if (rs.url.startsWith('[]')) {
        content = rs.url.slice(2);
      } else if (contentMap instanceof Map) {
        content = contentMap.get(rs.url) ?? contentMap.get(rs.group + ':' + rs.url);
      }
      // Build entry
      const entry: Record<string, unknown> = {
        group: rs.group,
        url: rs.url,
        interval: rs.interval ?? 86400,
        type: rs.type ?? 'surge',
      };
      if (content && typeof content === 'string') {
        // truncate content for size
        entry['content'] = content.slice(0, 2000);
        // try to parse inline rules count
        const lines = content.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'));
        entry['ruleCount'] = lines.length;
      }
      arr.push(entry);
      if (arr.length >= 64) break; // maxAllowedRulesets
    }
    // If no valid entries, return empty array string
    if (arr.length === 0) return '[]';
    return JSON.stringify(arr, null, 2);
  } catch {
    return '[]';
  }
}
