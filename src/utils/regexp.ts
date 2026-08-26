/**
 * regexp.ts — jpcre2 semantics → JS RegExp compatibility layer
 *
 * Port of src/utils/regexp.cpp (jpcre2 wrapper) to Cloudflare Workers.
 *
 * C++ original uses jpcre2 (PCRE2) with two distinct match modes:
 *  - regFind  : partial / unanchored search (PCRE2 not anchored)
 *  - regMatch : anchored full-string match (PCRE2 ANCHORED | ENDANCHORED)
 *
 * JS RegExp `test()` is unanchored by default, so:
 *  - regFind  maps to plain `new RegExp(pattern).test(text)` (partial).
 *  - regMatch must be emulated by wrapping the pattern as `^(?:pattern)$`.
 *
 * Additional jpcre2 → RegExp gaps (see spec.md §22 risk 1) that are NOT
 * emulated here and must be covered by golden-file regression:
 *  - PCRE2 verbs (*SKIP, *FAIL, \K), recursion, ALT_BSUX, UTF/MULTILINE
 *    flag combinations, and `gEx` (= expression-evaluated) replacement.
 *  - Callers that relied on those features will see different behaviour in
 *    Workers; filter/rename/emoji corpora should be regression-tested.
 *
 * All functions are deliberately forgiving: an invalid pattern never throws.
 * This mirrors the C++ guard that checks `regValid` / catches jpcre2
 * compile errors before use, and keeps the conversion pipeline from aborting
 * on a single bad user-supplied regex (e.g. include/exclude params).
 */

/**
 * Partial (unanchored) match — equivalent to C++ `regFind`.
 *
 * Returns true if `pattern` matches anywhere inside `text`.
 * Invalid patterns return false instead of throwing.
 */
export function regFind(pattern: string, text: string): boolean {
  try {
    const re = new RegExp(pattern);
    return re.test(text);
  } catch {
    return false;
  }
}

/**
 * Anchored (full-string) match — equivalent to C++ `regMatch`.
 *
 * C++ uses PCRE2 `ANCHORED | ENDANCHORED`, i.e. the pattern must match the
 * entire input. Emulated as `^(?:pattern)$` without the multiline flag so
 * `^`/`$` bind to string boundaries, not line boundaries. The `u` (unicode)
 * flag is added to match jpcre2 UTF mode.
 *
 * Invalid patterns return false instead of throwing.
 */
export function regMatch(pattern: string, text: string): boolean {
  try {
    // Wrap in non-capturing group to preserve alternation precedence:
    // e.g. pattern "a|b" → "^(?:a|b)$" not "^a|b$".
    const re = new RegExp(`^(?:${pattern})$`, 'u');
    return re.test(text);
  } catch {
    return false;
  }
}

/**
 * Global replace — equivalent to C++ `regReplace`.
 *
 * Replaces all occurrences of `pattern` in `text` with `replacement`.
 * Uses the `g` flag for global replacement. Replacement string follows JS
 * semantics (`$1`, `$&`, `$``, `$'`, `$$`), which aligns with jpcre2's
 * `$1`-style back-references for the common cases. `gEx` (expression
 * evaluation) is not supported.
 *
 * Invalid patterns return `text` unchanged instead of throwing.
 */
export function regReplace(pattern: string, replacement: string, text: string): string {
  try {
    const re = new RegExp(pattern, 'g');
    return text.replace(re, replacement);
  } catch {
    return text;
  }
}

/**
 * Validate whether `pattern` is a compilable RegExp.
 *
 * Returns true if `new RegExp(pattern)` does not throw, false otherwise.
 * Mirrors C++ `regValid` which checks jpcre2 compile success.
 */
export function regValid(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}
