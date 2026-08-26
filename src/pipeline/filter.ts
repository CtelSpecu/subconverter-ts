import type { Proxy } from '../types.js';
import { regFind } from '../utils/regexp.js';

/**
 * filter.ts — pipeline filter stage (spec §7)
 *
 * C++ origin: generator/config/nodemanip.cpp chkIgnore + filterNodes
 *   called from addNodes per-subscription (nodemanip.cpp:183,215)
 *
 * Semantics (chkIgnore):
 *  - exclude: any pattern that regFind-hits => skip (true)
 *  - include: non-empty => at least one must hit, otherwise skip
 *  - otherwise keep (false)
 *
 * Invalid regex never throws: regFind returns false.
 */

/**
 * Returns true if the node should be skipped (ignored).
 *
 * @param remark - node remark to test
 * @param exclude - patterns that exclude on hit
 * @param include - patterns that require at least one hit when non-empty
 */
export function chkIgnore(remark: string, exclude: string[], include: string[]): boolean {
  try {
    const safeRemark = remark ?? '';
    const safeExclude = Array.isArray(exclude) ? exclude : [];
    const safeInclude = Array.isArray(include) ? include : [];

    // Exclude: any hit => ignore
    for (const pat of safeExclude) {
      if (typeof pat !== 'string' || pat.length === 0) continue;
      try {
        if (regFind(pat, safeRemark)) return true;
      } catch {
        // regFind already swallows, but keep outer guard
        continue;
      }
    }

    // Include: non-empty => must have at least one hit
    if (safeInclude.length > 0) {
      let hit = false;
      for (const pat of safeInclude) {
        if (typeof pat !== 'string' || pat.length === 0) continue;
        try {
          if (regFind(pat, safeRemark)) {
            hit = true;
            break;
          }
        } catch {
          continue;
        }
      }
      if (!hit) return true;
    }

    return false;
  } catch {
    // Never throw uncaught — on unexpected error, do not ignore
    return false;
  }
}

/**
 * Filter nodes by remark against exclude/include lists.
 * Preserves original order, returns new array (no mutation).
 */
export function filterNodes(nodes: Proxy[], exclude: string[], include: string[]): Proxy[] {
  try {
    if (!Array.isArray(nodes)) return [];
    const safeExclude = Array.isArray(exclude) ? exclude : [];
    const safeInclude = Array.isArray(include) ? include : [];
    const out: Proxy[] = [];
    for (const node of nodes) {
      if (!node || typeof node.remark !== 'string') {
        // Nodes without remark are treated as empty string remark
        const remark = (node as Proxy | null)?.remark ?? '';
        if (!chkIgnore(String(remark), safeExclude, safeInclude)) out.push(node as Proxy);
        continue;
      }
      if (!chkIgnore(node.remark, safeExclude, safeInclude)) out.push(node);
    }
    return out;
  } catch {
    return Array.isArray(nodes) ? [...nodes] : [];
  }
}
