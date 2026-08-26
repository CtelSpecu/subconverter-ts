import SparkMD5 from 'spark-md5';

export interface WebGetResult {
  body: string;
  headers: Record<string, string>;
}

interface CacheEntry {
  body: string;
  headers: Record<string, string>;
  ts: number;
}

const cache = new Map<string, CacheEntry>();

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = {};
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      h[k] = v;
    }
  }
  // Add required headers if missing (case-sensitive check per spec; use exact keys)
  if (!('SubConverter-Request' in h) && !('subconverter-request' in h)) {
    h['SubConverter-Request'] = '1';
  }
  if (!('SubConverter-Version' in h) && !('subconverter-version' in h)) {
    h['SubConverter-Version'] = 'v0.9.0';
  }
  if (!('User-Agent' in h) && !('user-agent' in h) && !('User-agent' in h)) {
    h['User-Agent'] = 'subconverter/v0.9.0';
  }
  if (!('Content-Type' in h) && !('content-type' in h)) {
    h['Content-Type'] = 'application/json';
  }
  return h;
}

function parseDataUri(url: string): WebGetResult | null {
  // data:[<mediatype>][;base64],<data>
  const comma = url.indexOf(',');
  if (comma === -1) return { body: '', headers: {} };
  const meta = url.substring(5, comma); // after 'data:'
  const dataPart = url.substring(comma + 1);
  try {
    if (meta.includes(';base64')) {
      // atob may throw; handle gracefully
      const decoded = atob(dataPart);
      return { body: decoded, headers: {} };
    } else {
      // percent-encoded
      const decoded = decodeURIComponent(dataPart);
      return { body: decoded, headers: {} };
    }
  } catch {
    return { body: '', headers: {} };
  }
}

export async function webGet(
  url: string,
  ttl: number,
  headers?: Record<string, string>,
): Promise<WebGetResult> {
  if (!url || typeof url !== 'string') {
    return { body: '', headers: {} };
  }

  // data: URI — no cache, no fetch
  if (url.startsWith('data:')) {
    const r = parseDataUri(url);
    return r ?? { body: '', headers: {} };
  }

  const key = SparkMD5.hash(url);

  if (ttl > 0) {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.ts <= ttl * 1000) {
      return { body: entry.body, headers: { ...entry.headers } };
    }
  }

  const reqHeaders = buildHeaders(headers);

  try {
    const resp = await fetch(url, {
      headers: reqHeaders,
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    // On non-200 and !keepRespOnFail return empty (keepRespOnFail not exposed; default false)
    if (resp.status !== 200) {
      return { body: '', headers: {} };
    }

    const body = await resp.text();
    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => {
      respHeaders[k] = v;
    });

    if (ttl > 0) {
      cache.set(key, { body, headers: { ...respHeaders }, ts: Date.now() });
    }

    return { body, headers: respHeaders };
  } catch {
    // Network error — no stale-on-fail for MVP (serveCacheOnFail handled at higher layer if needed)
    return { body: '', headers: {} };
  }
}

export function flushCache(): void {
  cache.clear();
}
