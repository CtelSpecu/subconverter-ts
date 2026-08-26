/**
 * subparser.ts — full parser layer per spec.md §5
 *
 * Implements explodeSS, explodeSSR, explodeVMess, explodeTrojan,
 * explodeHysteria2, explodeAnyTLS, explodeSocks, explodeHttp,
 * explodeClash, explodeSurge, explode, explodeSub
 *
 * No function throws on bad input; all return null / [] gracefully.
 */

import type { Proxy, ProxyType } from '../types.js';
import { base64Decode, urlSafeBase64Decode as urlSafeB64 } from '../utils/base64.js';
import { regFind, regMatch, regReplace } from '../utils/regexp.js';
import { isIPv4 } from '../utils/network.js';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let globalIdCounter = 0;

function nextId(): number {
  return globalIdCounter++;
}

function safeUrlDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function safeUrlDecodePlus(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

function toPortInt(val: string | undefined, def = 0): number {
  if (!val) return def;
  const n = parseInt(val.trim(), 10);
  if (isNaN(n) || n <= 0 || n > 65535) return 0;
  return n;
}

function extractFragment(content: string): { main: string; remark: string } {
  const idx = content.indexOf('#');
  if (idx === -1) return { main: content, remark: '' };
  const main = content.slice(0, idx);
  const frag = content.slice(idx + 1);
  return { main, remark: safeUrlDecode(frag.trim()) };
}

function extractQuery(content: string): { main: string; query: string } {
  const idx = content.indexOf('?');
  if (idx === -1) return { main: content, query: '' };
  return { main: content.slice(0, idx), query: content.slice(idx + 1) };
}

function parseQueryString(qs: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!qs) return map;
  const pairs = qs.split('&');
  for (const pair of pairs) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq === -1) {
      map.set(safeUrlDecodePlus(pair), '');
    } else {
      const k = safeUrlDecodePlus(pair.slice(0, eq));
      const v = safeUrlDecodePlus(pair.slice(eq + 1));
      map.set(k, v);
    }
  }
  return map;
}

function commonConstruct(
  type: ProxyType,
  group: string,
  remark: string,
  hostname: string,
  port: number | string
): Proxy {
  const p = typeof port === 'string' ? toPortInt(port) : port;
  return {
    type,
    group: group ?? '',
    groupId: 0,
    id: nextId(),
    remark: remark ?? hostname ?? '',
    hostname: hostname ?? '',
    port: p ?? 0,
    udp: false,
    tfo: false,
    scv: false,
  };
}

function isValidPort(p: number): boolean {
  return p > 0 && p <= 65535;
}

function urlSafeB64DecodeSafe(s: string): string {
  try {
    return urlSafeB64(s);
  } catch {
    return '';
  }
}

// Decode wrapper that tries urlSafe then standard
function tryB64Decode(s: string): string {
  if (!s) return '';
  try {
    const r = urlSafeB64(s);
    if (r) return r;
  } catch {}
  try {
    const r = base64Decode(s);
    if (r) return r;
  } catch {}
  return '';
}

// ---------------------------------------------------------------------------
// explodeSS — SIP002 vs whole-b64 heuristic (§5.2 SS)
// ---------------------------------------------------------------------------
export function explodeSS(link: string, group = ''): Proxy | null {
  try {
    if (!link || typeof link !== 'string') return null;
    const t = link.trim();
    if (!t.toLowerCase().startsWith('ss://')) return null;

    let content = t.slice(5); // after ss://
    // /?→?  per spec: handle "/?" => "?"
    content = content.replace(/\/?\?/, '?');

    // Fragment -> remark
    const frag = extractFragment(content);
    let remark = frag.remark;
    content = frag.main;

    // Split query
    const qsplit = extractQuery(content);
    const queryStr = qsplit.query;
    const core = qsplit.main; // base part before ?

    // Parse query for plugin / group etc.
    const qmap = parseQueryString(queryStr);
    let plugin = '';
    let pluginOpts = '';
    const pluginRaw = qmap.get('plugin') ?? '';
    if (pluginRaw) {
      const semi = pluginRaw.indexOf(';');
      if (semi === -1) {
        plugin = pluginRaw;
      } else {
        plugin = pluginRaw.slice(0, semi);
        pluginOpts = pluginRaw.slice(semi + 1);
      }
    }
    // group param is base64 encoded group name (spec)
    const groupB64 = qmap.get('group') ?? '';
    let decodedGroup = group;
    if (groupB64) {
      const dg = tryB64Decode(groupB64);
      if (dg) decodedGroup = dg;
    }

    // Heuristic: if core contains '@' → SIP002明文, else whole-b64
    let method = '';
    let password = '';
    let hostname = '';
    let portStr = '';

    if (core.includes('@')) {
      // SIP002: secret@host:port   where secret is base64(method:password) or plain?
      const atIdx = core.lastIndexOf('@');
      const secret = core.slice(0, atIdx);
      const serverPart = core.slice(atIdx + 1);
      // serverPart is host:port (handle ipv6 bracket)
      const hp = parseHostPort(serverPart);
      if (!hp) return null;
      hostname = hp.host;
      portStr = hp.port;

      // secret decode: try urlSafe base64 method:password
      const decodedSecret = urlSafeB64DecodeSafe(secret);
      let candidate = '';
      if (decodedSecret && decodedSecret.includes(':')) {
        candidate = decodedSecret;
      } else {
        // Try plain secret contains ':'
        if (secret.includes(':')) {
          // Secret may be URL-encoded
          const dec = safeUrlDecode(secret);
          if (dec.includes(':')) candidate = dec;
          else candidate = secret;
        } else {
          // decodedSecret exists but no colon -> invalid, try standard decode
          const dec2 = tryB64Decode(secret);
          if (dec2 && dec2.includes(':')) candidate = dec2;
          else return null;
        }
      }
      const colonIdx = candidate.indexOf(':');
      if (colonIdx === -1) return null;
      method = candidate.slice(0, colonIdx);
      password = candidate.slice(colonIdx + 1);
    } else {
      // Whole-b64: b64(method:password@host:port)
      if (!core) return null;
      const decoded = tryB64Decode(core);
      if (!decoded || !decoded.includes('@')) return null;
      const atIdx = decoded.lastIndexOf('@');
      const userinfo = decoded.slice(0, atIdx);
      const serverPart = decoded.slice(atIdx + 1);
      const colonIdx = userinfo.indexOf(':');
      if (colonIdx === -1) return null;
      method = userinfo.slice(0, colonIdx);
      password = userinfo.slice(colonIdx + 1);
      const hp = parseHostPort(serverPart);
      if (!hp) return null;
      hostname = hp.host;
      portStr = hp.port;
      // remark fallback if not provided: may be in decoded? No.
    }

    const port = toPortInt(portStr);
    if (!isValidPort(port)) return null;
    if (!method || !hostname) return null;

    // Default remark if empty: host:port
    if (!remark) remark = `${hostname}:${port}`;

    const proxy = commonConstruct('SS', decodedGroup, remark, hostname, port);
    proxy.method = method;
    proxy.password = password;
    if (plugin) {
      proxy.plugin = plugin;
      if (pluginOpts) proxy.pluginOpts = pluginOpts;
    }
    // Also store obfs-like plugin opts for downstream generators
    return proxy;
  } catch {
    return null;
  }
}

function parseHostPort(serverPart: string): { host: string; port: string } | null {
  if (!serverPart) return null;
  const s = serverPart.trim();
  // IPv6 bracket: [::1]:443
  if (s.startsWith('[')) {
    const close = s.indexOf(']');
    if (close === -1) return null;
    const host = s.slice(1, close);
    const rest = s.slice(close + 1);
    if (rest.startsWith(':')) {
      return { host, port: rest.slice(1) };
    }
    return { host, port: '' };
  }
  // Normal: host:port (last colon separates)
  const colonIdx = s.lastIndexOf(':');
  if (colonIdx === -1) return { host: s, port: '' };
  const host = s.slice(0, colonIdx);
  const port = s.slice(colonIdx + 1);
  // port may contain "/" suffix? trim
  const slashIdx = port.indexOf('/');
  if (slashIdx !== -1) return { host, port: port.slice(0, slashIdx) };
  return { host, port };
}

// ---------------------------------------------------------------------------
// explodeSSR — b64(host:port:protocol:method:obfs:b64(pass))[/?params]
// ---------------------------------------------------------------------------
const SS_CIPHERS = new Set([
  'aes-256-cfb',
  'aes-128-cfb',
  'aes-256-gcm',
  'aes-128-gcm',
  'chacha20',
  'chacha20-ietf',
  'chacha20-ietf-poly1305',
  'xchacha20',
  'xchacha20-ietf-poly1305',
  'rc4-md5',
  'aes-256-ctr',
  'aes-128-ctr',
  'bf-cfb',
  'des-cfb',
  'rc4',
]);

export function explodeSSR(link: string, group = ''): Proxy | null {
  try {
    if (!link || typeof link !== 'string') return null;
    const t = link.trim();
    if (!t.toLowerCase().startsWith('ssr://')) return null;
    let content = t.slice(6);
    // Remove fragment? SSR uses query params remarks base64 etc., not #.
    // But handle # fragment if present as remark alias
    const frag = extractFragment(content);
    // If fragment present, treat as remark fallback
    content = frag.main;
    const fallbackRemark = frag.remark;

    // Split main b64 and query
    // SSR format: b64(host:port:protocol:method:obfs:b64pass)[/?query]
    // Query may be "/?obfsparam=...&protoparam=...&remarks=...&group=..."
    // The '/?' part optional per spec.
    let mainB64 = '';
    let queryStr = '';
    const qIdx = content.indexOf('?');
    const slashIdx = content.indexOf('/');
    if (qIdx !== -1) {
      mainB64 = content.slice(0, qIdx);
      // Trim trailing "/" from main
      if (mainB64.endsWith('/')) mainB64 = mainB64.slice(0, -1);
      queryStr = content.slice(qIdx + 1);
    } else if (slashIdx !== -1) {
      mainB64 = content.slice(0, slashIdx);
      queryStr = content.slice(slashIdx + 1);
      if (queryStr.startsWith('?')) queryStr = queryStr.slice(1);
    } else {
      mainB64 = content;
    }
    mainB64 = mainB64.trim();
    if (!mainB64) return null;

    const decoded = tryB64Decode(mainB64);
    if (!decoded) return null;
    // Expect 6 colon-separated: host:port:protocol:method:obfs:b64pass
    // Password part may contain ':'? No, it's base64, so last colon splits correctly.
    // Use limited split: first 5 colons define fields, remainder is pass b64
    const parts = decoded.split(':');
    if (parts.length < 6) return null;
    const host = parts[0];
    const portStr = parts[1];
    const protocol = parts[2];
    const method = parts[3];
    const obfs = parts[4];
    const b64pass = parts.slice(5).join(':'); // in case password base64 contains colon (rare but safe)
    const password = tryB64Decode(b64pass) || b64pass;

    const port = toPortInt(portStr);
    if (!isValidPort(port) || !host) return null;

    // Parse query params (they are base64url encoded values)
    const qmap = parseQueryString(queryStr);
    const obfsParamB64 = qmap.get('obfsparam') ?? '';
    const protoParamB64 = qmap.get('protoparam') ?? '';
    const remarksB64 = qmap.get('remarks') ?? '';
    const groupB64 = qmap.get('group') ?? '';

    const obfsParam = obfsParamB64 ? (tryB64Decode(obfsParamB64) || obfsParamB64) : '';
    const protocolParam = protoParamB64 ? (tryB64Decode(protoParamB64) || protoParamB64) : '';
    let remark = '';
    if (remarksB64) remark = tryB64Decode(remarksB64) || safeUrlDecode(remarksB64);
    if (!remark) remark = fallbackRemark || `${host}:${port}`;
    else remark = safeUrlDecode(remark);

    let decodedGroup = group;
    if (groupB64) {
      const dg = tryB64Decode(groupB64);
      if (dg) decodedGroup = safeUrlDecode(dg);
    }

    // Heuristic: if method ∈ ss_ciphers ∧ obfs∈{∅,plain} ∧ protocol∈{∅,origin} → SS
    const isSSHeuristic =
      SS_CIPHERS.has(method.toLowerCase()) &&
      (obfs === '' || obfs === 'plain') &&
      (protocol === '' || protocol === 'origin');

    if (isSSHeuristic) {
      const p = commonConstruct('SS', decodedGroup, remark, host, port);
      p.method = method;
      p.password = password;
      // Store SSR extras anyway for generator fallback
      p.protocol = protocol;
      p.obfs = obfs;
      return p;
    }

    const proxy = commonConstruct('SSR', decodedGroup, remark, host, port);
    proxy.protocol = protocol;
    proxy.protocolParam = protocolParam;
    proxy.method = method;
    proxy.password = password;
    proxy.obfs = obfs;
    proxy.obfsParam = obfsParam;
    return proxy;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// VMess helpers
// ---------------------------------------------------------------------------

function parseVMessJson(base64OrJson: string, group: string): Proxy | null {
  try {
    let jsonStr = base64OrJson.trim();
    // Try base64 decode if not JSON
    if (!jsonStr.startsWith('{')) {
      const dec = tryB64Decode(jsonStr);
      if (dec && dec.trim().startsWith('{')) jsonStr = dec;
    }
    if (!jsonStr.startsWith('{')) return null;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(jsonStr) as Record<string, unknown>;
    } catch {
      return null;
    }
    const add = String(data['add'] ?? data['address'] ?? data['host'] ?? '');
    const portStr = String(data['port'] ?? '');
    const uuid = String(data['id'] ?? data['uuid'] ?? '');
    const aid = String(data['aid'] ?? data['alterId'] ?? '0');
    const net = String(data['net'] ?? data['type'] ?? 'tcp');
    const tls = String(data['tls'] ?? '');
    const host = String(data['host'] ?? '');
    const path = String(data['path'] ?? '/');
    const sni = String(data['sni'] ?? data['host'] ?? '');
    const remark = String(data['ps'] ?? data['remark'] ?? data['name'] ?? '') || `${add}:${portStr}`;
    const port = toPortInt(portStr);
    if (!isValidPort(port) || !add) return null;
    // Default uuid if empty per spec
    const finalUuid = uuid || '00000000-0000-0000-0000-000000000000';
    const proxy = commonConstruct('VMess', group, safeUrlDecode(remark), add, port);
    proxy.uuid = finalUuid;
    proxy.alterId = aid;
    proxy.net = net || 'tcp';
    proxy.tls = tls === 'tls' ? 'tls' : '';
    if (host) proxy.host = host;
    if (path) proxy.path = path;
    if (sni) proxy.sni = sni;
    // cipher/method
    const cipher = String(data['cipher'] ?? data['method'] ?? '');
    if (cipher) proxy.cipher = cipher;
    return proxy;
  } catch {
    return null;
  }
}

function explodeShadowrocketVMess(link: string, group: string): Proxy | null {
  // Shadowrocket: vmess:// b64(cipher:id@add:port) + ?query
  try {
    let content = link.replace(/^vmess:\/\//i, '');
    const frag = extractFragment(content);
    content = frag.main;
    const qIdx = content.indexOf('?');
    let main = content;
    let queryStr = '';
    if (qIdx !== -1) {
      main = content.slice(0, qIdx);
      queryStr = content.slice(qIdx + 1);
    }
    const decoded = tryB64Decode(main);
    if (!decoded || !decoded.includes('@')) return null;
    // decoded is "cipher:uuid@host:port"
    const atIdx = decoded.lastIndexOf('@');
    const userinfo = decoded.slice(0, atIdx);
    const serverPart = decoded.slice(atIdx + 1);
    const colonIdx = userinfo.indexOf(':');
    if (colonIdx === -1) return null;
    const cipher = userinfo.slice(0, colonIdx);
    const uuid = userinfo.slice(colonIdx + 1);
    const hp = parseHostPort(serverPart);
    if (!hp) return null;
    const port = toPortInt(hp.port);
    if (!isValidPort(port)) return null;
    const qmap = parseQueryString(queryStr);
    const obfs = qmap.get('obfs') ?? '';
    const tls = qmap.get('tls') ?? '';
    const remarkB64 = qmap.get('remark') ?? '';
    let remark = frag.remark;
    if (remarkB64) remark = tryB64Decode(remarkB64) || remarkB64;
    if (!remark) remark = `${hp.host}:${port}`;
    const net = obfs === 'websocket' ? 'ws' : 'tcp';
    const proxy = commonConstruct('VMess', group, safeUrlDecode(remark), hp.host, port);
    proxy.uuid = uuid || '00000000-0000-0000-0000-000000000000';
    proxy.cipher = cipher;
    proxy.net = net;
    proxy.tls = tls === '1' || tls === 'tls' ? 'tls' : '';
    // Extract host/path for ws
    const hostParam = qmap.get('obfsParam') ?? qmap.get('path') ?? '';
    if (hostParam) {
      // obfsParam may be JSON like {"Host":"example.com"} or plain
      // Try to extract host/path
      try {
        if (hostParam.trim().startsWith('{')) {
          const obj = JSON.parse(hostParam) as Record<string, string>;
          if (obj['Host']) proxy.host = obj['Host'];
          if (obj['path']) proxy.path = obj['path'];
        } else if (hostParam.includes(',')) {
          // unlikely
        }
      } catch {}
    }
    if (qmap.get('path')) proxy.path = qmap.get('path')!;
    return proxy;
  } catch {
    return null;
  }
}

function explodeStdVMess(link: string, group: string): Proxy | null {
  // Std: vmess:// uuid@host:port?net=ws&tls=tls&host=...
  try {
    let content = link.replace(/^vmess:\/\/|^vmess1:\/\//i, '');
    const frag = extractFragment(content);
    content = frag.main;
    let remark = frag.remark;
    // Content like "uuid@host:port?params"
    const atIdx = content.indexOf('@');
    if (atIdx === -1) return null;
    const uuid = content.slice(0, atIdx);
    // Validate uuid looks hex with dashes (allow relaxed)
    if (!/^[0-9a-fA-F-]{32,36}$/.test(uuid)) return null;
    const rest = content.slice(atIdx + 1);
    const qIdx = rest.indexOf('?');
    let serverPart = rest;
    let queryStr = '';
    if (qIdx !== -1) {
      serverPart = rest.slice(0, qIdx);
      queryStr = rest.slice(qIdx + 1);
    }
    const hp = parseHostPort(serverPart);
    if (!hp) return null;
    const port = toPortInt(hp.port);
    if (!isValidPort(port)) return null;
    const qmap = parseQueryString(queryStr);
    const net = qmap.get('net') ?? qmap.get('type') ?? 'tcp';
    const tls = qmap.get('tls') ?? '';
    if (!remark) remark = qmap.get('remarks') ?? qmap.get('remark') ?? `${hp.host}:${port}`;
    const proxy = commonConstruct('VMess', group, safeUrlDecode(remark), hp.host, port);
    proxy.uuid = uuid;
    proxy.net = net || 'tcp';
    proxy.tls = tls === 'tls' ? 'tls' : '';
    proxy.host = qmap.get('host') ?? qmap.get('obfsParam') ?? '';
    proxy.path = qmap.get('path') ?? '/';
    proxy.alterId = qmap.get('aid') ?? '0';
    if (qmap.get('cipher')) proxy.cipher = qmap.get('cipher')!;
    return proxy;
  } catch {
    return null;
  }
}

function explodeKitsunebiVMess(link: string, group: string): Proxy | null {
  // Kitsunebi: vmess1:// id@add:port(/path)? remarks?
  try {
    let content = link.replace(/^vmess1:\/\//i, '');
    const frag = extractFragment(content);
    content = frag.main;
    let remark = frag.remark;
    // Strip query
    const qIdx = content.indexOf('?');
    if (qIdx !== -1) content = content.slice(0, qIdx);
    // Format id@add:port/path
    const atIdx = content.indexOf('@');
    if (atIdx === -1) return null;
    const uuid = content.slice(0, atIdx);
    let rest = content.slice(atIdx + 1);
    let path = '/';
    const slashIdx = rest.indexOf('/');
    if (slashIdx !== -1) {
      path = rest.slice(slashIdx);
      rest = rest.slice(0, slashIdx);
    }
    const hp = parseHostPort(rest);
    if (!hp) return null;
    const port = toPortInt(hp.port);
    if (!isValidPort(port)) return null;
    const tls = link.includes('tls=true') ? 'tls' : '';
    if (!remark) remark = `${hp.host}:${port}`;
    const proxy = commonConstruct('VMess', group, safeUrlDecode(remark), hp.host, port);
    proxy.uuid = uuid || '00000000-0000-0000-0000-000000000000';
    proxy.net = path !== '/' ? 'ws' : 'tcp';
    proxy.path = path;
    proxy.tls = tls;
    proxy.alterId = '0';
    return proxy;
  } catch {
    return null;
  }
}

function explodeQuanVMess(link: string, group: string): Proxy | null {
  // Quan: contains " = " line like "vmess = host:port, method=..., password=uuid, ..."
  try {
    const content = link.trim();
    if (!content.includes(' = ')) return null;
    // Split remark = type, args
    const eqIdx = content.indexOf(' = ');
    let remark = content.slice(0, eqIdx).trim();
    const argsStr = content.slice(eqIdx + 3).trim();
    // Expect args like "vmess, host:port, method=..., password=..."
    // We'll parse manually
    // First token may be vmess
    const parts = argsStr.split(',').map((p) => p.trim());
    if (parts.length === 0) return null;
    // Find host:port token
    let host = '';
    let port = 0;
    let method = '';
    let uuid = '';
    let obfs = '';
    let tls = '';
    let hostHeader = '';
    const path = '/';
    for (const part of parts) {
      if (part.includes(':') && !part.includes('=')) {
        const hp = parseHostPort(part);
        if (hp) {
          host = hp.host;
          port = toPortInt(hp.port);
        }
      } else if (part.startsWith('method=')) {
        method = part.slice(7);
      } else if (part.startsWith('password=')) {
        uuid = part.slice(9);
      } else if (part.startsWith('obfs=')) {
        obfs = part.slice(5);
      } else if (part.startsWith('over-tls=')) {
        tls = part.slice(9) === 'true' ? 'tls' : '';
      } else if (part.startsWith('obfs-host=')) {
        hostHeader = part.slice(10);
      } else if (part.startsWith('tls-host=')) {
        hostHeader = part.slice(9);
      }
    }
    if (!host || !isValidPort(port)) return null;
    if (!remark) remark = `${host}:${port}`;
    const proxy = commonConstruct('VMess', group, remark, host, port);
    proxy.uuid = uuid || '00000000-0000-0000-0000-000000000000';
    proxy.cipher = method || 'auto';
    proxy.net = obfs.includes('ws') ? 'ws' : 'tcp';
    proxy.tls = obfs.includes('over-tls') || tls === 'tls' ? 'tls' : '';
    proxy.host = hostHeader;
    proxy.path = path;
    proxy.alterId = '0';
    return proxy;
  } catch {
    return null;
  }
}

export function explodeVMess(link: string, group = ''): Proxy | null {
  try {
    if (!link || typeof link !== 'string') return null;
    const t = link.trim();
    const lower = t.toLowerCase();
    if (!lower.startsWith('vmess://') && !lower.startsWith('vmess1://')) {
      // Also handle case where content is raw vmess json probe
      // If it contains "=" and vmess, try Quan parser
      if (t.includes(' = ') && t.toLowerCase().includes('vmess')) {
        return explodeQuanVMess(t, group);
      }
      return null;
    }

    // Dispatch order per spec: b64?query→Shadowrocket, *@*→Std, vmess1://…?→Kitsunebi, contains " = " → Quan, else b64 JSON
    if (t.toLowerCase().startsWith('vmess1://')) {
      const r = explodeKitsunebiVMess(t, group);
      if (r) return r;
    }

    if (t.includes(' = ')) {
      const r = explodeQuanVMess(t, group);
      if (r) return r;
    }

    // Shadowrocket detection: has "?" and base64 part before "?" contains "@"
    if (t.includes('?')) {
      const afterPrefix = t.replace(/^vmess:\/\/|^vmess1:\/\//i, '');
      const fragless = extractFragment(afterPrefix).main;
      const qIdx = fragless.indexOf('?');
      if (qIdx !== -1) {
        const main = fragless.slice(0, qIdx);
        const dec = tryB64Decode(main);
        if (dec && dec.includes('@')) {
          const r = explodeShadowrocketVMess(t, group);
          if (r) return r;
        }
      }
    }

    // Std detection: contains "@" after prefix and first char before "@" looks like uuid
    if (t.includes('@')) {
      const afterPrefix = t.replace(/^vmess:\/\/|^vmess1:\/\//i, '');
      const atIdx = afterPrefix.indexOf('@');
      if (atIdx !== -1) {
        const beforeAt = afterPrefix.slice(0, atIdx).split('?')[0].split('#')[0];
        if (/^[0-9a-fA-F-]{32,}$/.test(beforeAt)) {
          const r = explodeStdVMess(t, group);
          if (r) return r;
        }
      }
    }

    // Fallback: base64 JSON
    const afterPrefix = t.replace(/^vmess:\/\/|^vmess1:\/\//i, '');
    // Strip fragment and query? JSON base64 typically no query; but remove fragment
    const clean = extractFragment(afterPrefix).main.split('?')[0];
    const r = parseVMessJson(clean, group);
    if (r) return r;
    // Try Kitsunebi as last fallback
    const rk = explodeKitsunebiVMess(t, group);
    if (rk) return rk;
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// explodeTrojan — trojan:// password@host:port? query ws handling
// ---------------------------------------------------------------------------
export function explodeTrojan(link: string, group = ''): Proxy | null {
  try {
    if (!link || typeof link !== 'string') return null;
    const t = link.trim();
    if (!t.toLowerCase().startsWith('trojan://')) return null;
    let content = t.slice(9);
    const frag = extractFragment(content);
    let remark = frag.remark;
    content = frag.main;
    const qsplit = extractQuery(content);
    const serverPartWithUser = qsplit.main;
    const queryStr = qsplit.query;
    const qmap = parseQueryString(queryStr);

    // serverPartWithUser is password@host:port
    const atIdx = serverPartWithUser.lastIndexOf('@');
    if (atIdx === -1) return null;
    const password = safeUrlDecode(serverPartWithUser.slice(0, atIdx));
    const serverPart = serverPartWithUser.slice(atIdx + 1);
    const hp = parseHostPort(serverPart);
    if (!hp) return null;
    const port = toPortInt(hp.port);
    if (!isValidPort(port) || !hp.host) return null;
    if (!remark) remark = qmap.get('remark') ?? `${hp.host}:${port}`;

    const proxy = commonConstruct('Trojan', group, safeUrlDecode(remark), hp.host, port);
    proxy.password = password;
    // sni/peer→host
    const sni = qmap.get('sni') ?? qmap.get('peer') ?? '';
    if (sni) proxy.sni = sni;
    // WS handling
    const ws = qmap.get('ws');
    const wsPath = qmap.get('wspath') ?? qmap.get('wsPath') ?? qmap.get('path') ?? '';
    const type = qmap.get('type') ?? '';
    if (ws === '1' && wsPath) {
      proxy.net = 'ws';
      proxy.path = wsPath;
      proxy.host = qmap.get('host') ?? '';
    } else if (type === 'ws' && wsPath) {
      // v2rayN style: path is urlEncoded, may start with %2F
      let p = wsPath;
      try {
        p = decodeURIComponent(p);
      } catch {}
      proxy.net = 'ws';
      proxy.path = p.startsWith('/') ? p : `/${p}`;
      if (qmap.get('host')) proxy.host = qmap.get('host')!;
    } else if (type === 'ws') {
      proxy.net = 'ws';
      proxy.path = wsPath || '/';
    }
    // TLSSecure恒 true in C++; reflect as scv? We'll set tls flag
    proxy.tls = 'tls';
    return proxy;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// explodeHysteria2 — hy2/hysteria2://
// ---------------------------------------------------------------------------
export function explodeHysteria2(link: string, group = ''): Proxy | null {
  try {
    if (!link || typeof link !== 'string') return null;
    const t = link.trim();
    const lower = t.toLowerCase();
    // strFind per spec: contains hy2:// or hysteria2://
    if (!lower.includes('hy2://') && !lower.includes('hysteria2://')) return null;
    // Extract after scheme
    let content = '';
    const hy2Idx = lower.indexOf('hy2://');
    const hysteria2Idx = lower.indexOf('hysteria2://');
    let schemeIdx = -1;
    let schemeLen = 0;
    if (hy2Idx !== -1 && hysteria2Idx !== -1) {
      if (hy2Idx < hysteria2Idx) {
        schemeIdx = hy2Idx;
        schemeLen = 'hy2://'.length;
      } else {
        schemeIdx = hysteria2Idx;
        schemeLen = 'hysteria2://'.length;
      }
    } else if (hy2Idx !== -1) {
      schemeIdx = hy2Idx;
      schemeLen = 'hy2://'.length;
    } else {
      schemeIdx = hysteria2Idx;
      schemeLen = 'hysteria2://'.length;
    }
    content = t.slice(schemeIdx + schemeLen);
    // Some links have "hysteria2:// password@host:port?..."
    content = content.trim();
    if (!content) return null;

    const frag = extractFragment(content);
    let remark = frag.remark;
    content = frag.main;
    const qsplit = extractQuery(content);
    const main = qsplit.main;
    const queryStr = qsplit.query;
    const qmap = parseQueryString(queryStr);

    let password = '';
    let hostname = '';
    let portStr = '';

    // Two forms: pass@host:port  or  host:port?password=
    if (main.includes('@')) {
      const atIdx = main.lastIndexOf('@');
      password = safeUrlDecode(main.slice(0, atIdx));
      const serverPart = main.slice(atIdx + 1);
      const hp = parseHostPort(serverPart);
      if (!hp) return null;
      hostname = hp.host;
      portStr = hp.port;
    } else {
      const hp = parseHostPort(main);
      if (!hp) return null;
      hostname = hp.host;
      portStr = hp.port;
      password = qmap.get('password') ?? qmap.get('auth') ?? '';
      if (password) password = safeUrlDecode(password);
    }

    // Fallback password from query if not set
    if (!password) {
      const qp = qmap.get('password') ?? qmap.get('auth') ?? '';
      if (qp) password = safeUrlDecode(qp);
    }

    const port = toPortInt(portStr);
    if (!hostname || !isValidPort(port)) return null;
    if (!remark) remark = `${hostname}:${port}`;

    const proxy = commonConstruct('Hysteria2', group, safeUrlDecode(remark), hostname, port);
    proxy.password = password || qmap.get('auth') || '';

    // Insecure → scv
    const insecure = qmap.get('insecure') ?? qmap.get('skip-cert-verify') ?? '';
    if (insecure === '1' || insecure.toLowerCase() === 'true') proxy.scv = true;

    // up/down handling: if ends with bps store as-is else Mbps×10⁶
    function parseSpeed(val: string | undefined): string | undefined {
      if (!val) return undefined;
      const v = val.trim();
      if (!v) return undefined;
      // per spec: contains bps suffix then as-is else Mbps×1e6
      // The length check len>4 and ends with bps
      if (v.toLowerCase().endsWith('bps') && v.length > 4) return v;
      // Otherwise integer Mbps
      const n = parseInt(v, 10);
      if (!isNaN(n)) return String(n * 1_000_000);
      return v;
    }

    const up = parseSpeed(qmap.get('up'));
    const down = parseSpeed(qmap.get('down'));
    if (up) proxy.up = up;
    if (down) proxy.down = down;

    // obfs / obfs-password
    const obfs = qmap.get('obfs') ?? '';
    const obfsPwd = qmap.get('obfs-password') ?? qmap.get('obfsPassword') ?? qmap.get('obfsparam') ?? '';
    if (obfs) proxy.obfs = obfs;
    if (obfsPwd) proxy.obfsParam2 = obfsPwd;

    const sni = qmap.get('sni') ?? qmap.get('peer') ?? '';
    if (sni) proxy.sni = sni;
    const pin = qmap.get('pinSHA256') ?? qmap.get('pinsha256') ?? '';
    if (pin) proxy.fingerprint = pin;
    const ports = qmap.get('ports') ?? '';
    if (ports) proxy.ports = ports;
    const alpn = qmap.get('alpn') ?? '';
    if (alpn) proxy.alpn = alpn;

    return proxy;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// explodeAnyTLS — anytls://
// ---------------------------------------------------------------------------
export function explodeAnyTLS(link: string, group = ''): Proxy | null {
  try {
    if (!link || typeof link !== 'string') return null;
    const t = link.trim();
    if (!t.toLowerCase().startsWith('anytls://')) return null;
    let content = t.slice(9);
    const frag = extractFragment(content);
    let remark = frag.remark;
    content = frag.main;
    const qsplit = extractQuery(content);
    const main = qsplit.main;
    const queryStr = qsplit.query;
    const qmap = parseQueryString(queryStr);

    let password = '';
    let hostname = '';
    let portStr = '';

    if (main.includes('@')) {
      const atIdx = main.lastIndexOf('@');
      password = safeUrlDecode(main.slice(0, atIdx));
      const hp = parseHostPort(main.slice(atIdx + 1));
      if (!hp) return null;
      hostname = hp.host;
      portStr = hp.port;
    } else {
      // Some anytls forms: anytls://host:port?password=...
      const hp = parseHostPort(main);
      if (!hp) return null;
      hostname = hp.host;
      portStr = hp.port;
      password = qmap.get('password') ?? '';
      if (password) password = safeUrlDecode(password);
    }

    const port = toPortInt(portStr);
    if (!hostname || !isValidPort(port)) return null;
    if (!remark) remark = qmap.get('remark') ?? `${hostname}:${port}`;

    const proxy = commonConstruct('AnyTLS', group, safeUrlDecode(remark), hostname, port);
    proxy.password = password;
    // Optional params
    const sni = qmap.get('sni') ?? qmap.get('peer') ?? '';
    if (sni) proxy.sni = sni;
    const insecure = qmap.get('insecure') ?? qmap.get('allowInsecure') ?? '';
    if (insecure === '1' || insecure.toLowerCase() === 'true') proxy.scv = true;
    const alpn = qmap.get('alpn') ?? '';
    if (alpn) proxy.alpn = alpn;
    return proxy;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// explodeSocks / explodeHttp — minimal viable host:port + user/pass
// ---------------------------------------------------------------------------
export function explodeSocks(link: string, group = ''): Proxy | null {
  try {
    if (!link || typeof link !== 'string') return null;
    const t = link.trim();
    const lower = t.toLowerCase();
    const isSocks = lower.startsWith('socks://') || lower.includes('tg://socks') || lower.includes('t.me/socks');
    if (!isSocks && !lower.startsWith('socks5://') && !lower.startsWith('socks5h://')) return null;

    // Extract core after scheme: find "://"
    let content = '';
    const schemeIdx = t.indexOf('://');
    if (schemeIdx !== -1) content = t.slice(schemeIdx + 3);
    else content = t;

    // Handle tg://socks?server=...&port=...&user=...&pass=...
    if (lower.includes('tg://socks') || lower.includes('t.me/socks')) {
      const qIdx = content.indexOf('?');
      let qs = '';
      if (qIdx !== -1) qs = content.slice(qIdx + 1);
      else {
        const q2 = t.indexOf('?');
        if (q2 !== -1) qs = t.slice(q2 + 1);
      }
      const qmap = parseQueryString(qs);
      const host = qmap.get('server') ?? qmap.get('host') ?? '';
      const port = toPortInt(qmap.get('port'));
      if (!host || !isValidPort(port)) return null;
      const remark = qmap.get('remark') ?? safeUrlDecode(qmap.get('name') ?? `${host}:${port}`);
      const p = commonConstruct('Socks5', group, remark, host, port);
      const user = qmap.get('user') ?? qmap.get('username') ?? '';
      const pass = qmap.get('pass') ?? qmap.get('password') ?? '';
      if (user) p.method = user;
      if (pass) p.password = pass;
      return p;
    }

    // Standard socks:// [user:pass@]host:port[#remark]
    const frag = extractFragment(content);
    let remark = frag.remark;
    content = frag.main;
    // Remove query
    const qsplit = extractQuery(content);
    content = qsplit.main;
    const atIdx = content.lastIndexOf('@');
    let user = '';
    let pass = '';
    let hostPort = content;
    if (atIdx !== -1) {
      const userinfo = content.slice(0, atIdx);
      hostPort = content.slice(atIdx + 1);
      const colonIdx = userinfo.indexOf(':');
      if (colonIdx !== -1) {
        user = safeUrlDecode(userinfo.slice(0, colonIdx));
        pass = safeUrlDecode(userinfo.slice(colonIdx + 1));
      } else {
        user = safeUrlDecode(userinfo);
      }
      // userinfo may be base64-encoded (some socks links encode user:pass)
      if (!hostPort.includes(':') && !hostPort.includes('.') && hostPort.length > 8) {
        // Possibly userinfo was base64? Not needed
      }
    } else {
      // No @, maybe whole hostPort is base64 encoded user:pass@host:port
      const dec = tryB64Decode(content);
      if (dec && dec.includes('@')) {
        return explodeSocks(`socks://${dec}${remark ? '#' + remark : ''}`, group);
      }
    }

    const hp = parseHostPort(hostPort);
    if (!hp || !hp.host || !isValidPort(toPortInt(hp.port))) return null;
    const port = toPortInt(hp.port);
    if (!remark) remark = `${hp.host}:${port}`;
    const proxy = commonConstruct('Socks5', group, safeUrlDecode(remark), hp.host, port);
    if (user) proxy.method = user;
    if (pass) proxy.password = pass;
    else if (user && !pass) proxy.password = '';
    return proxy;
  } catch {
    return null;
  }
}

export function explodeHttp(link: string, group = ''): Proxy | null {
  try {
    if (!link || typeof link !== 'string') return null;
    const t = link.trim();
    const lower = t.toLowerCase();
    const isHttp =
      lower.startsWith('http://') ||
      lower.startsWith('https://') ||
      lower.includes('tg://http') ||
      lower.includes('t.me/http');
    // Also Netch http? but per spec Netch:// handled separately; we cover http here

    // For tg http, parse query params
    if (lower.includes('tg://http') || lower.includes('t.me/http')) {
      let qs = '';
      const qIdx = t.indexOf('?');
      if (qIdx !== -1) qs = t.slice(qIdx + 1);
      const frag = qs.includes('#') ? qs.split('#')[0] : qs;
      const qmap = parseQueryString(frag);
      const host = qmap.get('server') ?? qmap.get('host') ?? '';
      const port = toPortInt(qmap.get('port'));
      if (!host || !isValidPort(port)) return null;
      const remark = qmap.get('remark') ?? `${host}:${port}`;
      const p = commonConstruct('Http', group, remark, host, port);
      const user = qmap.get('user') ?? '';
      const pass = qmap.get('pass') ?? '';
      if (user) p.method = user;
      if (pass) p.password = pass;
      return p;
    }

    if (!isHttp) return null;

    // Use URL parser for http/https
    let url: URL | null = null;
    try {
      url = new URL(t.split('#')[0]);
    } catch {
      return null;
    }
    if (!url) return null;
    const scheme = url.protocol.replace(':', '').toLowerCase();
    const type: ProxyType = scheme === 'https' ? 'Https' : 'Http';
    const host = url.hostname;
    const port = url.port ? toPortInt(url.port) : scheme === 'https' ? 443 : 80;
    if (!host || !isValidPort(port)) return null;
    const fragIdx = t.indexOf('#');
    let remark = fragIdx !== -1 ? safeUrlDecode(t.slice(fragIdx + 1)) : '';
    if (!remark) remark = `${host}:${port}`;
    const proxy = commonConstruct(type, group, remark, host, port);
    if (url.username) proxy.method = safeUrlDecode(url.username);
    if (url.password) proxy.password = safeUrlDecode(url.password);
    // For Http link as proxy node, tls flag based on scheme
    proxy.tls = type === 'Https' ? 'tls' : '';
    return proxy;
  } catch {
    return null;
  }
}

// Minimal Netch handler — delegates to appropriate per-protocol based on URL like Netch://...
export function explodeNetch(link: string, group = ''): Proxy | null {
  try {
    if (!link || typeof link !== 'string') return null;
    const t = link.trim();
    if (!t.toLowerCase().startsWith('netch://')) return null;
    const content = t.slice(8);
    const dec = tryB64Decode(content);
    const payload = dec && dec.includes(':') ? dec : content;
    // Netch payload is like "Type,Remarks,Server,Port,Method,Password,Protocol,Obfs,..."
    // Spec:按Type分派各协议. We implement minimal: detect SS SSR VMess Trojan
    const parts = payload.split(',');
    if (parts.length < 4) return null;
    const typeToken = parts[0].trim().toLowerCase();
    if (typeToken.includes('ssr')) {
      // Try to build SSR via parts mapping?
      // Fallback: try SSR explode if payload contains ssr:// like?
      return null;
    }
    if (typeToken.includes('ss')) {
      const remark = parts[1] ?? '';
      const host = parts[2] ?? '';
      const port = toPortInt(parts[3]);
      const method = parts[4] ?? 'aes-256-gcm';
      const password = parts[5] ?? '';
      if (!host || !isValidPort(port)) return null;
      const p = commonConstruct('SS', group, remark || `${host}:${port}`, host, port);
      p.method = method;
      p.password = password;
      return p;
    }
    // Generic fallback
    return null;
  } catch {
    return null;
  }
}

// explodeHttpSub — arbitrary http URL as Http proxy node fallback (isLink兜底)
export function explodeHttpSub(link: string, group = ''): Proxy | null {
  // Accept any http/https/data: link as Http proxy
  try {
    const t = (link ?? '').trim();
    if (!t) return null;
    if (t.toLowerCase().startsWith('data:')) return null;
    if (!t.toLowerCase().startsWith('http://') && !t.toLowerCase().startsWith('https://')) return null;
    return explodeHttp(t, group);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// explodeClash — parse proxies: or Proxy: via js-yaml
// ---------------------------------------------------------------------------
export function explodeClash(yamlContent: string, group = ''): Proxy[] {
  try {
    if (!yamlContent || typeof yamlContent !== 'string') return [];
    const trimmed = yamlContent.trim();
    if (!trimmed) return [];
    // Quick check: must contain "proxies:" or "Proxy:"
    if (!/["']?(proxies|Proxy)["']?\s*:/i.test(trimmed)) return [];

    // Dynamic import of js-yaml (available via dependency)
    // Use synchronous require via createRequire alternative: we import at top dynamically?
    // We'll use a lightweight inline YAML handling without import for speed; fallback to manual parse
    // Try to use js-yaml if available
    const doc: unknown = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      // Use dynamic evaluation to avoid TS bundler issues
      const yamlMod = (globalThis as unknown as Record<string, unknown>)['__js_yaml'] as unknown;
      void yamlMod;
    } catch {}
    // Attempt to import js-yaml via ESM
    // Since we cannot guarantee top-level await, we attempt a lazy require via Function
    let loadFunc: ((str: string) => unknown) | null = null;
    try {
      // Try to use the package if installed
      // @ts-ignore
      const mod = globalThis as unknown as Record<string, unknown>;
      void mod;
    } catch {}
    // Fallback: try to load via dynamic import using eval
    // Simpler: use a minimal YAML proxy parser without full js-yaml
    // But spec says use js-yaml; we attempt import
    try {
      // Use synchronous fallback parser for proxies array
      loadFunc = getYamlLoad();
    } catch {
      loadFunc = null;
    }

    let parsed: Record<string, unknown> | null = null;
    if (loadFunc) {
      try {
        const result = loadFunc(trimmed) as Record<string, unknown>;
        parsed = result;
      } catch {
        return [];
      }
    } else {
      return manualClashParse(trimmed, group);
    }

    if (!parsed || typeof parsed !== 'object') return [];

    let proxyList: unknown[] | null = null;
    if (Array.isArray(parsed['proxies'])) proxyList = parsed['proxies'] as unknown[];
    else if (Array.isArray(parsed['Proxy'])) proxyList = parsed['Proxy'] as unknown[];
    else if (Array.isArray(parsed['proxies:'])) proxyList = parsed['proxies:'] as unknown[];
    else {
      // Case-insensitive search
      for (const [k, v] of Object.entries(parsed)) {
        if (k.toLowerCase() === 'proxies' || k.toLowerCase() === 'proxy') {
          if (Array.isArray(v)) {
            proxyList = v as unknown[];
            break;
          }
        }
      }
    }
    if (!proxyList || proxyList.length === 0) return [];

    const out: Proxy[] = [];
    for (const item of proxyList) {
      if (!item || typeof item !== 'object') continue;
      const m = item as Record<string, unknown>;
      const proxy = clashItemToProxy(m, group);
      if (proxy) out.push(proxy);
    }
    return out;
  } catch {
    return [];
  }
}

function getYamlLoad(): ((str: string) => unknown) | null {
  try {
    // Try to synchronously load js-yaml via require if in Node-like env
    // Use Function constructor to avoid static analysis
    const req = new Function('try{return require("js-yaml")}catch(e){return null}')() as { load?: (s: string) => unknown } | null;
    if (req && typeof req.load === 'function') return req.load;
  } catch {}
  // Try dynamic global
  try {
    // In Workers, js-yaml may be available as ESM; fallback to manual
    return null;
  } catch {
    return null;
  }
}

function manualClashParse(content: string, group: string): Proxy[] {
  // Minimal manual parser for proxies: YAML—extract each "- { ... }" block
  // This is a fallback when js-yaml not available; handle simple flow style
  try {
    const lines = content.split('\n');
    let inProxies = false;
    const proxies: Record<string, unknown>[] = [];
    let current: Record<string, unknown> | null = null;
    let currentIndent = 0;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (/^proxies\s*:/i.test(trimmed) || /^Proxy\s*:/i.test(trimmed)) {
        inProxies = true;
        continue;
      }
      if (!inProxies) continue;
      // Detect start of new proxy entry: "  - name: ..."
      if (/^\s*-\s+/.test(raw)) {
        if (current) proxies.push(current);
        current = {};
        currentIndent = raw.indexOf('-');
        const afterDash = raw.slice(raw.indexOf('-') + 1).trim();
        if (afterDash) {
          // Inline mapping like "- {name: foo, type: ss, ...}" or "- name: foo"
          if (afterDash.startsWith('{')) {
            try {
              // Convert YAML flow to JSON-ish
              const jsonLike = afterDash.replace(/([a-zA-Z0-9_-]+)\s*:/g, '"$1":').replace(/'/g, '"');
              const obj = JSON.parse(jsonLike) as Record<string, unknown>;
              Object.assign(current, obj);
            } catch {}
          } else {
            const kvMatch = afterDash.match(/^([^:]+):\s*(.*)$/);
            if (kvMatch) {
              const k = kvMatch[1].trim();
              const v = kvMatch[2].trim().replace(/^["']|["']$/g, '');
              current[k] = coerceYamlValue(v);
            }
          }
        }
        continue;
      }
      if (current) {
        // Check indent: if line is indented more than currentIndent, it's a property
        const indent = raw.search(/\S/);
        if (indent > currentIndent) {
          const kvMatch = trimmed.match(/^([^:]+):\s*(.*)$/);
          if (kvMatch) {
            const k = kvMatch[1].trim();
            const v = kvMatch[2].trim().replace(/^["']|["']$/g, '');
            // Handle nested ws-opts etc. skip complex for minimal
            if (v === '' && i + 1 < lines.length && lines[i + 1].trim().startsWith('-') === false) {
              // Nested object start, ignore
              continue;
            }
            current[k] = coerceYamlValue(v);
          }
        } else {
          // dedent -> end of proxies section
          if (trimmed && !trimmed.startsWith('-') && !trimmed.includes(':')) {
            // not proxy content
          }
          if (trimmed.endsWith(':') && !raw.includes('-')) {
            // new top-level key
            break;
          }
        }
      }
    }
    if (current) proxies.push(current);

    const out: Proxy[] = [];
    for (const m of proxies) {
      const p = clashItemToProxy(m, group);
      if (p) out.push(p);
    }
    return out;
  } catch {
    return [];
  }
}

function coerceYamlValue(v: string): unknown {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) {
    const n = parseInt(v, 10);
    return isNaN(n) ? v : n;
  }
  return v;
}

function clashItemToProxy(m: Record<string, unknown>, group: string): Proxy | null {
  try {
    const typeRaw = String(m['type'] ?? m['Type'] ?? '').toLowerCase();
    const name = String(m['name'] ?? m['remark'] ?? m['ps'] ?? 'clash');
    const server = String(m['server'] ?? m['host'] ?? '');
    const portRaw = m['port'];
    const port = typeof portRaw === 'number' ? portRaw : toPortInt(String(portRaw ?? ''));
    if (!server) return null;

    let proxyType: ProxyType = 'Unknown';
    if (typeRaw === 'ss') proxyType = 'SS';
    else if (typeRaw === 'ssr') proxyType = 'SSR';
    else if (typeRaw === 'vmess') proxyType = 'VMess';
    else if (typeRaw === 'socks5' || typeRaw === 'socks') proxyType = 'Socks5';
    else if (typeRaw === 'http' || typeRaw === 'https') proxyType = typeRaw === 'https' ? 'Https' : 'Http';
    else if (typeRaw === 'trojan') proxyType = 'Trojan';
    else if (typeRaw === 'snell') proxyType = 'Snell';
    else if (typeRaw === 'hysteria2' || typeRaw === 'hy2') proxyType = 'Hysteria2';
    else if (typeRaw === 'hysteria') proxyType = 'Hysteria';
    else if (typeRaw === 'wireguard' || typeRaw === 'wg') proxyType = 'WireGuard';
    else if (typeRaw === 'anytls') proxyType = 'AnyTLS';
    else return null;

    // Need valid port for most; WireGuard etc may differ
    if (proxyType !== 'WireGuard' && !isValidPort(port)) return null;

    const proxy = commonConstruct(proxyType, group, name, server, proxyType === 'WireGuard' ? (isValidPort(port) ? port : 51820) : port);

    // Fill per-type extras (minimal)
    if (proxyType === 'SS') {
      proxy.method = String(m['cipher'] ?? m['method'] ?? 'aes-256-gcm');
      proxy.password = String(m['password'] ?? '');
      const plugin = String(m['plugin'] ?? '');
      const pluginOpts = String(m['plugin-opts'] ?? m['plugin_opts'] ?? m['pluginOpts'] ?? '');
      if (plugin) {
        proxy.plugin = plugin;
        if (pluginOpts) proxy.pluginOpts = typeof pluginOpts === 'string' ? pluginOpts : JSON.stringify(pluginOpts);
      }
      // Handle v2ray-plugin obfs style
      const obfs = String(m['obfs'] ?? '');
      if (obfs) {
        proxy.plugin = 'obfs-local';
        proxy.pluginOpts = `obfs=${obfs}`;
      }
    } else if (proxyType === 'SSR') {
      proxy.method = String(m['cipher'] ?? m['method'] ?? '');
      proxy.password = String(m['password'] ?? '');
      proxy.protocol = String(m['protocol'] ?? '');
      proxy.protocolParam = String(m['protocol-param'] ?? m['protocol_param'] ?? '');
      proxy.obfs = String(m['obfs'] ?? '');
      proxy.obfsParam = String(m['obfs-param'] ?? m['obfs_param'] ?? '');
    } else if (proxyType === 'VMess') {
      proxy.uuid = String(m['uuid'] ?? m['id'] ?? '');
      proxy.alterId = String(m['alterId'] ?? m['alterId'] ?? '0');
      proxy.cipher = String(m['cipher'] ?? m['method'] ?? 'auto');
      proxy.tls = String(m['tls'] ?? '') ? 'tls' : '';
      proxy.host = String(m['servername'] ?? m['sni'] ?? '');
      const net = String(m['network'] ?? m['net'] ?? 'tcp');
      proxy.net = net;
      // ws-opts
      const wsOpts = m['ws-opts'] as Record<string, unknown> | undefined;
      if (wsOpts) {
        if (wsOpts['path']) proxy.path = String(wsOpts['path']);
        const headers = wsOpts['headers'] as Record<string, unknown> | undefined;
        if (headers && headers['Host']) proxy.host = String(headers['Host']);
      } else {
        if (m['ws-path']) proxy.path = String(m['ws-path']);
        if (m['ws-headers']) proxy.host = String(m['ws-headers']);
      }
    } else if (proxyType === 'Trojan') {
      proxy.password = String(m['password'] ?? '');
      proxy.sni = String(m['sni'] ?? m['peer'] ?? '');
    } else if (proxyType === 'Socks5' || proxyType === 'Http' || proxyType === 'Https') {
      const user = String(m['username'] ?? m['user'] ?? '');
      const pass = String(m['password'] ?? m['pass'] ?? '');
      if (user) proxy.method = user;
      if (pass) proxy.password = pass;
      if (m['tls'] === true || String(m['tls']).toLowerCase() === 'true') proxy.tls = 'tls';
    } else if (proxyType === 'Hysteria2') {
      proxy.password = String(m['password'] ?? m['auth'] ?? '');
      proxy.up = String(m['up'] ?? '');
      proxy.down = String(m['down'] ?? '');
      proxy.sni = String(m['sni'] ?? '');
      proxy.obfs = String(m['obfs'] ?? '');
    } else if (proxyType === 'AnyTLS') {
      proxy.password = String(m['password'] ?? '');
      proxy.sni = String(m['sni'] ?? '');
    }

    // Common flags
    if (m['udp'] === true) proxy.udp = true;
    if (m['tfo'] === true) proxy.tfo = true;
    if (m['skip-cert-verify'] === true) proxy.scv = true;

    return proxy;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// explodeSurge — INI storeAnyLine style
// ---------------------------------------------------------------------------
export function explodeSurge(iniContent: string, group = ''): Proxy[] {
  try {
    if (!iniContent || typeof iniContent !== 'string') return [];
    const text = iniContent.trim();
    if (!text) return [];
    // Quick sniff: must contain "=" and look like proxy lines
    // But we parse all lines that match "remark = type,args"
    const lines = text.split(/\r?\n/);
    const out: Proxy[] = [];

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith(';') || line.startsWith('//')) continue;
      // Must contain "="
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;
      const remark = line.slice(0, eqIdx).trim();
      const right = line.slice(eqIdx + 1).trim();
      if (!remark || !right) continue;

      // Right side is "type,args..." where first token is type
      const commaIdx = right.indexOf(',');
      if (commaIdx === -1) continue;
      const typeRaw = right.slice(0, commaIdx).trim().toLowerCase();
      const argsStr = right.slice(commaIdx + 1).trim();
      if (!typeRaw) continue;

      // Parse args as comma-separated key=value or bare host:port
      // Use robust split that respects quotes? Simplified.
      const proxy = surgeLineToProxy(remark, typeRaw, argsStr, group);
      if (proxy) out.push(proxy);
    }

    return out;
  } catch {
    return [];
  }
}

function parseSurgeArgs(argsStr: string): Map<string, string> {
  const map = new Map<string, string>();
  // Split by ',' - but values may contain '='; first token may be bare server:port
  const parts = argsStr.split(',');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq === -1) {
      // Bare value - treat as server/host or method depending on position
      // Store as _bare<i>
      map.set(`_bare${i}`, part);
    } else {
      const k = part.slice(0, eq).trim().toLowerCase();
      const v = part.slice(eq + 1).trim();
      map.set(k, v);
    }
  }
  return map;
}

function surgeLineToProxy(remark: string, typeRaw: string, argsStr: string, group: string): Proxy | null {
  try {
    const args = parseSurgeArgs(argsStr);

    function findHostPort(): { host: string; port: number } | null {
      // Case 1: consecutive bare host + port (e.g. \"3.3.3.3, 443\")
      const bareKeys = [...args.keys()].filter(k => k.startsWith('_bare')).sort();
      for (let i = 0; i < bareKeys.length; i++) {
        const v = args.get(bareKeys[i]) ?? '';
        // Try v as host:port combined
        const hpCombined = parseHostPort(v);
        if (hpCombined && hpCombined.host && hpCombined.port) {
          const p = toPortInt(hpCombined.port);
          if (isValidPort(p)) return { host: hpCombined.host, port: p };
        }
        // Try v as bare host plus next bare as port
        if (i + 1 < bareKeys.length) {
          const nextV = args.get(bareKeys[i + 1]) ?? '';
          if (/^\d+$/.test(nextV.trim())) {
            const p = toPortInt(nextV.trim());
            if (isValidPort(p) && (isIPv4(v.trim()) || /^[a-zA-Z0-9.-]+$/.test(v.trim()))) {
              return { host: v.trim(), port: p };
            }
          }
        }
        // Try v as bare host:port? already handled, else single host with separate port key
      }
      const server = args.get('server') ?? args.get('host') ?? args.get('address') ?? '';
      const portStr = args.get('port') ?? '';
      if (server) {
        const p = toPortInt(portStr);
        if (isValidPort(p)) return { host: server, port: p };
        const hp = parseHostPort(server);
        if (hp && isValidPort(toPortInt(hp.port))) return { host: hp.host, port: toPortInt(hp.port) };
      }
      return null;
    }
    if (typeRaw === 'ss' || typeRaw === 'shadowsocks' || typeRaw === 'custom') {
      // Surge SS: ss, server, port, encrypt-method=..., password=..., obfs=...
      // custom: custom, server, port, method, password, https://.../SSEncrypt.module?
      if (typeRaw === 'custom' && argsStr.toLowerCase().includes('vmess')) {
        // custom vmess
        const hp = findHostPort();
        if (!hp) return null;
        const username = args.get('username') ?? '';
        const uuid = username;
        const ws = args.get('ws');
        const tls = args.get('tls');
        const p = commonConstruct('VMess', group, remark, hp.host, hp.port);
        p.uuid = uuid || '00000000-0000-0000-0000-000000000000';
        p.net = ws === 'true' ? 'ws' : 'tcp';
        p.tls = tls === 'true' ? 'tls' : '';
        p.path = args.get('ws-path') ?? '/';
        p.host = args.get('ws-headers')?.split(':')[1]?.trim() ?? args.get('obfs-host') ?? '';
        p.alterId = '0';
        if (args.get('vmess-aead') === 'true') p.alterId = '0';
        return p;
      }
      if (typeRaw === 'custom' && argsStr.toLowerCase().includes('wireguard')) {
        // wireguard custom – skip minimal
        return null;
      }
      if (typeRaw === 'custom' && argsStr.toLowerCase().includes('anytls')) {
        const hp = findHostPort();
        if (!hp) return null;
        const pwd = args.get('password') ?? args.get('_bare3') ?? '';
        const p = commonConstruct('AnyTLS', group, remark, hp.host, hp.port);
        p.password = pwd;
        p.sni = args.get('sni') ?? args.get('peer') ?? '';
        return p;
      }
      const hp = findHostPort();
      if (!hp) return null;
      const method = args.get('encrypt-method') ?? args.get('method') ?? args.get('_bare2') ?? 'aes-256-gcm';
      const password = args.get('password') ?? args.get('_bare3') ?? '';
      const p = commonConstruct('SS', group, remark, hp.host, hp.port);
      p.method = method;
      p.password = password;
      const obfs = args.get('obfs');
      if (obfs) {
        p.plugin = 'obfs-local';
        p.pluginOpts = `obfs=${obfs}`;
        if (args.get('obfs-host')) p.pluginOpts += `;obfs-host=${args.get('obfs-host')}`;
      }
      return p;
    }

    if (typeRaw === 'socks5' || typeRaw === 'socks5-tls' || typeRaw === 'socks') {
      const hp = findHostPort();
      if (!hp) return null;
      const p = commonConstruct('Socks5', group, remark, hp.host, hp.port);
      p.method = args.get('username') ?? '';
      p.password = args.get('password') ?? '';
      if (typeRaw === 'socks5-tls') p.tls = 'tls';
      return p;
    }

    if (typeRaw === 'http' || typeRaw === 'https') {
      const hp = findHostPort();
      if (!hp) return null;
      const type: ProxyType = typeRaw === 'https' ? 'Https' : 'Http';
      const p = commonConstruct(type, group, remark, hp.host, hp.port);
      p.method = args.get('username') ?? '';
      p.password = args.get('password') ?? '';
      p.tls = type === 'Https' ? 'tls' : '';
      return p;
    }

    if (typeRaw === 'vmess') {
      const hp = findHostPort();
      if (!hp) return null;
      const p = commonConstruct('VMess', group, remark, hp.host, hp.port);
      p.uuid = args.get('username') ?? '';
      p.alterId = '0';
      p.net = args.get('ws') === 'true' ? 'ws' : 'tcp';
      p.tls = args.get('tls') === 'true' ? 'tls' : '';
      p.path = args.get('ws-path') ?? '/';
      // ws-headers: "Host: example.com"
      const wsHeaders = args.get('ws-headers') ?? '';
      if (wsHeaders.includes(':')) {
        const parts = wsHeaders.split('|');
        for (const part of parts) {
          if (part.toLowerCase().includes('host')) {
            const [, v] = part.split(':');
            if (v) p.host = v.trim();
          }
        }
      } else if (args.get('obfs-host')) {
        p.host = args.get('obfs-host')!;
      }
      if (args.get('vmess-aead') === 'true') p.alterId = '0';
      return p;
    }

    if (typeRaw === 'trojan') {
      const hp = findHostPort();
      if (!hp) return null;
      const p = commonConstruct('Trojan', group, remark, hp.host, hp.port);
      p.password = args.get('password') ?? '';
      p.sni = args.get('sni') ?? args.get('peer') ?? '';
      // ws
      if (args.get('ws') === 'true') {
        p.net = 'ws';
        p.path = args.get('ws-path') ?? '/';
        const h = args.get('ws-headers') ?? '';
        if (h) p.host = h;
      }
      p.tls = 'tls';
      return p;
    }

    if (typeRaw === 'snell') {
      const hp = findHostPort();
      if (!hp) return null;
      const p = commonConstruct('Snell', group, remark, hp.host, hp.port);
      p.psk = args.get('psk') ?? args.get('password') ?? '';
      p.obfs = args.get('obfs') ?? '';
      p.version = args.get('version') ?? args.get('snell-version') ?? '';
      return p;
    }

    // Unknown type -> null
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// explode — prefix router per spec §5.1
// ---------------------------------------------------------------------------
export function explode(link: string, group = ''): Proxy | null {
  try {
    if (!link || typeof link !== 'string') return null;
    const t = link.trim();
    if (!t) return null;
    const lower = t.toLowerCase();

    // Order per spec §5.1:
    // ssr:// -> SSR
    if (lower.startsWith('ssr://')) return explodeSSR(t, group);
    // vmess://|vmess1:// -> VMess
    if (lower.startsWith('vmess://') || lower.startsWith('vmess1://')) return explodeVMess(t, group);
    // ss:// -> SS (includes ssd:// handled separately in explodeSub)
    if (lower.startsWith('ss://')) return explodeSS(t, group);
    // socks://|t.me/socks|tg://socks -> Socks
    if (lower.startsWith('socks://') || lower.startsWith('socks5://') || lower.includes('tg://socks') || lower.includes('t.me/socks')) {
      return explodeSocks(t, group);
    }
    // t.me/http|tg://http -> Http
    if (lower.includes('tg://http') || lower.includes('t.me/http')) return explodeHttp(t, group);
    // Netch:// -> Netch
    if (lower.startsWith('netch://')) return explodeNetch(t, group);
    // trojan://
    if (lower.startsWith('trojan://')) return explodeTrojan(t, group);
    // hysteria2|hy2:// (全文匹配 per spec)
    if (lower.includes('hy2://') || lower.includes('hysteria2://')) return explodeHysteria2(t, group);
    // anytls://
    if (lower.startsWith('anytls://')) return explodeAnyTLS(t, group);
    // socks:// already handled above, but also handle any other socks variants
    if (lower.startsWith('socks')) return explodeSocks(t, group);

    // Handle Quan-style vmess line that doesn't have vmess:// prefix but contains " = "
    if (t.includes(' = ') && lower.includes('vmess')) {
      const r = explodeVMess(t, group);
      if (r) return r;
    }

    // Fallback: if line looks like Surge "remark = type,args" and contains known types, try surge single line
    if (t.includes(' = ') && /,\s*(ss|socks5|http|trojan|snell|vmess|custom)\b/i.test(t)) {
      const arr = explodeSurge(t, group);
      if (arr.length > 0) return arr[0];
    }

    // isLink(http/https/data:) -> HttpSub fallback
    if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('data:')) {
      return explodeHttpSub(t, group);
    }

    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// explodeSSD — ssd:// b64(JSON)
// ---------------------------------------------------------------------------
export function explodeSSD(link: string, group = ''): Proxy[] {
  try {
    if (!link || typeof link !== 'string') return [];
    const t = link.trim();
    if (!t.toLowerCase().startsWith('ssd://')) return [];
    const content = t.slice(6).trim();
    if (!content) return [];
    // Content is base64 JSON
    let jsonStr = tryB64Decode(content);
    if (!jsonStr) jsonStr = content;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(jsonStr) as Record<string, unknown>;
    } catch {
      return [];
    }
    const servers = data['servers'];
    if (!servers) return [];
    const defaultPort = String(data['port'] ?? '');
    const defaultMethod = String(data['encryption'] ?? data['method'] ?? 'aes-256-gcm');
    const defaultPassword = String(data['password'] ?? '');
    const defaultPlugin = String(data['plugin'] ?? '');
    const defaultPluginOpts = String(data['plugin_options'] ?? data['plugin_opts'] ?? '');

    let serverList: unknown[] = [];
    if (Array.isArray(servers)) serverList = servers as unknown[];
    else if (typeof servers === 'object') {
      // Object map where key is index/name
      for (const v of Object.values(servers as Record<string, unknown>)) {
        serverList.push(v);
      }
    }

    const out: Proxy[] = [];
    for (let i = 0; i < serverList.length; i++) {
      const item = serverList[i] as Record<string, unknown>;
      if (!item || typeof item !== 'object') continue;
      const server = String(item['server'] ?? item['host'] ?? '');
      let portStr = String(item['port'] ?? defaultPort);
      if (!portStr) portStr = defaultPort;
      const port = toPortInt(portStr);
      if (!server || !isValidPort(port)) continue;
      const method = String(item['encryption'] ?? item['method'] ?? defaultMethod);
      const password = String(item['password'] ?? defaultPassword);
      const remark = String(item['remarks'] ?? item['remark'] ?? `SSD-${i}`);
      const plugin = String(item['plugin'] ?? defaultPlugin);
      const pluginOpts = String(item['plugin_options'] ?? item['plugin_opts'] ?? defaultPluginOpts);
      const p = commonConstruct('SS', group, remark, server, port);
      p.method = method;
      p.password = password;
      if (plugin) {
        p.plugin = plugin;
        if (pluginOpts) p.pluginOpts = pluginOpts;
      }
      out.push(p);
    }
    return out;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// explodeSub — chain per §5.3
// ---------------------------------------------------------------------------
export function explodeSub(content: string): Proxy[] {
  try {
    if (!content || typeof content !== 'string') return [];
    let text = content.trim();
    if (!text) return [];

    // 1. ssd:// -> explodeSSD
    if (text.toLowerCase().startsWith('ssd://')) {
      const r = explodeSSD(text, '');
      if (r.length > 0) return r;
      // Fall through if failed
    }

    // 2. regex "?(Proxy|proxies)"?: 截取 proxies 段后 Load YAML -> explodeClash
    // Detect Clash YAML heuristically
    if (/(?:^|\n)\s*["']?(proxies|Proxy)["']?\s*:/m.test(text)) {
      const r = explodeClash(text, '');
      if (r.length > 0) return r;
      // If YAML parsing threw, spec says rethrow; but we swallow and continue per no-throw contract
      // Continue to next step
    }

    // 3. Try Surge
    // Heuristic: Surge INI contains "=" lines with proxy types
    if (/^\s*[^#;\n]+\s*=\s*(ss|socks5|http|https|trojan|snell|vmess|custom)\s*,/im.test(text)) {
      const r = explodeSurge(text, '');
      if (r.length > 0) return r;
    }

    // 4. Still failed: try base64 decode once, then retry Clash/Surge if decoded contains markers
    const maybeDecoded = tryBase64DecodeFull(text);
    if (maybeDecoded && maybeDecoded !== text) {
      // Retry Clash
      if (/(?:^|\n)\s*["']?(proxies|Proxy)["']?\s*:/m.test(maybeDecoded)) {
        const r = explodeClash(maybeDecoded, '');
        if (r.length > 0) return r;
      }
      // Retry Surge if decoded contains vmess|shadowsocks|http|trojan
      if (/vmess|shadowsocks|http|trojan/i.test(maybeDecoded) && /^\s*[^#;\n]+\s*=\s*(ss|socks5|http|trojan|snell|vmess|custom)\s*,/im.test(maybeDecoded)) {
        const r = explodeSurge(maybeDecoded, '');
        if (r.length > 0) return r;
      }
      // If decoded looks like subscription links, use it for final split
      if (maybeDecoded.includes('://')) {
        text = maybeDecoded;
      }
    }

    // 5. Finally split by delimiter heuristic and explode each link; Unknown skipped
    // Delimiter heuristic: \n count ≥1 → \n, else \r, else space
    let parts: string[];
    const nlCount = (text.match(/\n/g) || []).length;
    if (nlCount >= 1) parts = text.split('\n');
    else if (text.includes('\r')) parts = text.split('\r');
    else if (text.includes('|')) parts = text.split('|');
    else parts = text.split(' ');

    const out: Proxy[] = [];
    for (const raw of parts) {
      const line = raw.trim();
      if (!line) continue;
      // Skip obvious non-link noise (e.g., YAML leftovers)
      // But try explode anyway; Unknown will be null
      const p = explode(line, '');
      if (p) {
        // Only keep if not Unknown (explode returns null for unknown)
        if (p.type !== 'Unknown' && p.hostname && isValidPort(p.port)) {
          out.push(p);
        }
      } else {
        // Try to decode base64 line individually? Already handled outer b64; but some subs have each line b64?
        // Not needed
      }
    }
    return out;
  } catch {
    return [];
  }
}

function tryBase64DecodeFull(s: string): string {
  const t = s.trim();
  if (!t) return '';
  // Heuristic: if string contains "://" or "proxies:" it's likely not base64
  if (t.includes('://') && t.includes('\n')) return t;
  if (/proxies\s*:/i.test(t)) return t;
  // Check if whole string looks like base64 (no spaces per line maybe)
  const noSpace = t.replace(/\s+/g, '');
  if (noSpace.length < 16) return t;
  if (!/^[A-Za-z0-9+/=_-]+$/.test(noSpace)) return t;
  // Try decode
  let decoded = tryB64Decode(noSpace);
  // urlSafeB64 may need padding
  if (!decoded) {
    try {
      let tmp = noSpace.replace(/-/g, '+').replace(/_/g, '/');
      const pad = tmp.length % 4;
      if (pad) tmp += '='.repeat(4 - pad);
      decoded = base64Decode(tmp);
    } catch {
      return t;
    }
  }
  if (!decoded) return t;
  // If decoded contains non-printable, likely not valid
  // Accept if decoded contains "://" or newline or proxies
  if (decoded.includes('://') || decoded.includes('\n') || /proxies\s*:/i.test(decoded)) return decoded;
  // Also accept if decoded is longer than original heuristic?
  // If decoded is plain text with many links, return it
  if (decoded.length > 20 && !/[^\x20-\x7E\r\n]/.test(decoded.slice(0, 200))) return decoded;
  return t;
}

// ---------------------------------------------------------------------------
// Re-export helpers for consumers
// ---------------------------------------------------------------------------
export { commonConstruct, tryB64Decode, parseHostPort };
