/**
 * string.ts — port of src/utils/string.cpp helpers for subconverter
 *
 * Mirrors the C++ string utilities used throughout the conversion pipeline.
 * All helpers are forgiving: invalid / unexpected input never throws,
 * matching the C++ behaviour of returning safe defaults.
 */

/**
 * Trim leading and trailing whitespace (space, tab, newline, etc.).
 * Equivalent to C++ `trim()`.
 */
export function trim(str: string): string {
  if (typeof str !== 'string') return '';
  try {
    return str.trim();
  } catch {
    return str;
  }
}

/**
 * Split `str` by `delim` delimiter.
 * Equivalent to C++ `split(str, delim)`.
 * If `delim` is empty, returns `[str]` (avoids character-wise split).
 */
export function split(str: string, delim: string): string[] {
  if (typeof str !== 'string') return [];
  if (typeof delim !== 'string') return [str];
  if (delim === '') return [str];
  try {
    return str.split(delim);
  } catch {
    return [];
  }
}

/**
 * Join array elements with `delim`.
 * Equivalent to C++ `join(arr, delim)`.
 */
export function join(arr: string[], delim: string): string {
  if (!Array.isArray(arr)) return '';
  if (typeof delim !== 'string') delim = '';
  try {
    return arr.join(delim);
  } catch {
    return '';
  }
}

/**
 * Test whether `str` starts with `prefix`.
 * Equivalent to C++ `startsWith`.
 */
export function startsWith(str: string, prefix: string): boolean {
  if (typeof str !== 'string' || typeof prefix !== 'string') return false;
  try {
    return str.startsWith(prefix);
  } catch {
    return false;
  }
}

/**
 * Test whether `str` ends with `suffix`.
 * Equivalent to C++ `endsWith`.
 */
export function endsWith(str: string, suffix: string): boolean {
  if (typeof str !== 'string' || typeof suffix !== 'string') return false;
  try {
    return str.endsWith(suffix);
  } catch {
    return false;
  }
}

/**
 * Replace all occurrences of `search` with `replacement`.
 * Equivalent to C++ `replaceAll` / `stringReplace`.
 * If `search` is empty, returns `str` unchanged to avoid infinite loops.
 */
export function replaceAll(str: string, search: string, replacement: string): string {
  if (typeof str !== 'string') return '';
  if (typeof search !== 'string' || search === '') return str;
  if (typeof replacement !== 'string') replacement = '';
  try {
    // Use split/join to avoid RegExp escaping issues and to support
    // literal string replacement (C++ replaces literal substrings, not regex).
    return str.split(search).join(replacement);
  } catch {
    return str;
  }
}

/**
 * Parse `str` as an integer, returning `def` if the result is NaN.
 * Equivalent to C++ `to_int(str, def)` which wraps `std::stoi` with fallback.
 */
export function toInt(str: string, def: number): number {
  if (typeof def !== 'number' || Number.isNaN(def)) def = 0;
  if (typeof str !== 'string') return def;
  try {
    const n = parseInt(str, 10);
    return Number.isNaN(n) ? def : n;
  } catch {
    return def;
  }
}

/**
 * URL-encode a string.
 * Mirrors C++ `urlencode` — for now simple `encodeURIComponent`.
 * The C++ variant keeps `+` as space semantics; Workers side uses
 * RFC3986 via `encodeURIComponent`.
 */
export function urlEncode(str: string): string {
  if (typeof str !== 'string') return '';
  try {
    return encodeURIComponent(str);
  } catch {
    return '';
  }
}

/**
 * URL-decode a string.
 * Tries `decodeURIComponent`; on failure returns the original string.
 * Never throws.
 */
export function urlDecode(str: string): string {
  if (typeof str !== 'string') return '';
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

/**
 * Extract the first value for `name` from a query container.
 *
 * `query` may be:
 *  - a raw query string (e.g. `"a=1&b=2"` or `"?a=1&b=2"`)
 *  - a `URLSearchParams` instance
 *  - a plain `Record<string, string>` map
 *
 * Equivalent to C++ `getUrlArg(argument, name)` which fetches the first
 * value for `name` from `Request.argument` (string_multimap).
 * Returns `""` if not found or on invalid input.
 */
export function getUrlArg(
  query: string | URLSearchParams | Record<string, string>,
  name: string,
): string {
  if (typeof name !== 'string' || name === '') return '';
  try {
    if (typeof query === 'string') {
      // Strip leading '?' if present; also handle full URL by taking
      // substring after the last '?' (query component).
      let q = query;
      // If it looks like a full URL with '?', extract query part
      const qIdx = q.indexOf('?');
      // Only extract after '?' if there is a '?' and query doesn't start with '?'
      // and contains '://' — to avoid stripping literal '?' values.
      // Simpler: if string contains '?' and not just a query string, URLSearchParams
      // would mis-parse '?a=1'. So always handle leading '?'.
      if (q.startsWith('?')) {
        q = q.slice(1);
      } else if (q.includes('://') && qIdx !== -1) {
        q = q.slice(qIdx + 1);
      }
      const params = new URLSearchParams(q);
      return params.get(name) ?? '';
    }
    if (query instanceof URLSearchParams) {
      return query.get(name) ?? '';
    }
    if (query !== null && typeof query === 'object') {
      const v = (query as Record<string, string>)[name];
      return typeof v === 'string' ? v : v != null ? String(v) : '';
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Return true if `str` looks like a link that should be treated as an
 * external resource (http/https/data URI).
 * Equivalent to C++ `isLink` check: `startsWith(http://|https://|data:)`.
 */
export function isLink(str: string): boolean {
  if (typeof str !== 'string') return false;
  try {
    return str.startsWith('http://') || str.startsWith('https://') || str.startsWith('data:');
  } catch {
    return false;
  }
}

const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Generate a random alphanumeric string of length `len`.
 * Equivalent to C++ `randomStr(len)`.
 * Returns `""` for non-positive or invalid lengths.
 */
export function randomStr(len: number): string {
  if (typeof len !== 'number' || !Number.isFinite(len) || len <= 0) return '';
  const n = Math.floor(len);
  if (n <= 0) return '';
  try {
    let out = '';
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * ALPHANUM.length);
      out += ALPHANUM.charAt(idx);
    }
    return out;
  } catch {
    return '';
  }
}
