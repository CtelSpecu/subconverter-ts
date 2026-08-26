/**
 * Network utilities — minimal Workers-compatible subset of src/utils/network.cpp
 *
 * Ported for Cloudflare Workers: no Node `net` / `dns` / `os` APIs.
 * Behaviour is kept compatible with the C++ originals where relevant
 * (see spec.md §14, §5, §17).
 */

// Pre-compiled patterns — kept at module scope to avoid per-call allocation.

/**
 * IPv4 strict pattern — mirrors C++ network.cpp `isIPv4`.
 * Each octet 0-255, exactly 4 dot-separated groups, anchored.
 */
const IPV4_RE =
  /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;

/**
 * IPv6 pattern covering full, compressed and mixed forms.
 * Allows:
 *  - 8 hextets: 1:2:3:4:5:6:7:8
 *  - compressed `::` (only once) e.g. ::1, 2001:db8::1, ::, fe80::
 *  - zone identifiers are NOT accepted (Workers never produce them)
 *
 * This is intentionally stricter than "contains colon + hex" but still
 * lenient enough for subscription hostnames. It does NOT match IPv4 or
 * bracketed literals like `[::1]` — callers should strip brackets first
 * (URL.hostname already does).
 */
const IPV6_RE =
  /^((?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,6}|:(?::[0-9a-fA-F]{1,4}){1,7}|::)$/;

/**
 * Return true if `str` is a valid dotted-decimal IPv4 address.
 * Regex is anchored and validates 0-255 per octet.
 */
export function isIPv4(str: string): boolean {
  return IPV4_RE.test(str);
}

/**
 * Return true if `str` is a valid IPv6 address.
 * Simple check: must contain a colon and match the IPv6 hextet pattern.
 * Hex groups are 1-4 hex digits; `::` compression is allowed once.
 */
export function isIPv6(str: string): boolean {
  // Fast-path reject: no colon cannot be IPv6 (and avoids matching empty).
  if (!str.includes(":")) return false;
  return IPV6_RE.test(str);
}

/**
 * Return true if `str` looks like a fetchable link.
 * Mirrors `isLink` in C++ string helpers but also accepts `data:` URIs
 * used for inline subscriptions (`data:` prefix).
 */
export function isLink(str: string): boolean {
  return (
    str.startsWith("http://") ||
    str.startsWith("https://") ||
    str.startsWith("data:")
  );
}

export interface UrlParseResult {
  host: string;
  port: string;
  path: string;
}

/**
 * Parse `url` using the WHATWG URL parser available in Workers.
 * On success returns `{ host, port, path }` where:
 *  - `host` is `URL.hostname` (IPv6 without brackets, lower-cased per spec)
 *  - `port` is `URL.port` (empty string when default / absent)
 *  - `path` is `URL.pathname + URL.search` (query preserved, hash excluded)
 * On failure (relative URL, malformed) returns `null`.
 */
export function urlParse(url: string): UrlParseResult | null {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
    };
  } catch {
    return null;
  }
}

// NOTE: hostnameToIPAddr is intentionally not implemented.
// In Workers there is no synchronous getaddrinfo; a future DoH
// (fetch to dns.google / cloudflare-dns.com) would be async and
// is out of scope for this minimal subset. Callers should treat
// the hostname as-is (placeholder behaviour).
