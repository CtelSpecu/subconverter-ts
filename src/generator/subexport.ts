import type { Proxy, ExtraSettings, ProxyGroupConfig } from '../types.js';
import yaml from 'js-yaml';
import { base64Encode } from '../utils/base64.js';
import { groupGenerate } from '../pipeline/nodemanip.js';

function processRemark(remark: string, seen: Map<string, number>, isSurge: boolean): string {
  let name = typeof remark === 'string' ? remark.trim() : '';
  if (!name) name = 'Proxy';
  name = name.replace(/=/g, '-');
  const hasComma = name.includes(',');
  if (isSurge && hasComma) {
    if (!(name.startsWith('"') && name.endsWith('"'))) {
      name = `"${name}"`;
    }
  }
  const base = name;
  const count = seen.get(base);
  if (count === undefined) {
    seen.set(base, 1);
    return name;
  }
  let suffix = count;
  let candidate = `${base} ${suffix}`;
  while (seen.has(candidate)) {
    suffix++;
    candidate = `${base} ${suffix}`;
    if (suffix > 5000) break;
  }
  seen.set(base, suffix + 1);
  seen.set(candidate, 1);
  return candidate;
}

function getSettings(s?: ExtraSettings): ExtraSettings {
  if (s && typeof s === 'object') return s as ExtraSettings;
  return {
    enableRuleGenerator: false,
    overwriteOriginalRules: false,
    renameArray: [],
    emojiArray: [],
    addEmoji: false,
    removeEmoji: false,
    appendProxyType: false,
    nodelist: false,
    sortFlag: false,
    filterDeprecated: false,
    clashNewFieldName: false,
    clashScript: false,
    clashClassicalRuleset: false,
    clashProxiesStyle: 'flow',
    clashProxyGroupsStyle: 'block',
    singboxAddClashModes: false,
    managedConfigPrefix: '',
    authorized: false,
  } as ExtraSettings;
}

export function buildClashProxy(node: Proxy, style?: ExtraSettings): Record<string, unknown> {
  const settings = getSettings(style);
  try {
    const name = typeof node.remark === 'string' ? node.remark : 'Proxy';
    const server = typeof node.hostname === 'string' ? node.hostname : '127.0.0.1';
    const portRaw = Number(node.port);
    const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 443;
    const base: Record<string, unknown> = { name, server, port };
    if (node.udp === true && node.type !== 'Snell') base['udp'] = true;
    if (typeof node.tfo === 'boolean') base['tfo'] = node.tfo;
    const scv = node.scv;
    if (typeof scv === 'boolean' && scv !== undefined) base['skip-cert-verify'] = scv;
    else if (typeof settings.scv === 'boolean') base['skip-cert-verify'] = settings.scv;
    switch (node.type) {
      case 'SS': {
        const method = node.method ?? node.cipher ?? 'aes-256-gcm';
        if (settings.filterDeprecated && (method === 'chacha20' || method === 'xchacha20' || method === 'chacha20-ietf')) base['cipher'] = 'aes-256-gcm';
        else base['cipher'] = method;
        base['type'] = 'ss';
        base['password'] = node.password ?? '';
        if (node.plugin) {
          base['plugin'] = node.plugin;
          if (node.pluginOpts) base['plugin-opts'] = parsePluginOpts(node.pluginOpts);
        }
        break;
      }
      case 'SSR': {
        base['type'] = 'ssr';
        base['cipher'] = node.method ?? 'aes-256-cfb';
        base['password'] = node.password ?? '';
        base['protocol'] = node.protocol ?? 'origin';
        base['obfs'] = node.obfs ?? 'plain';
        if (node.protocolParam) base['protocol-param'] = node.protocolParam;
        if (node.obfsParam) base['obfs-param'] = node.obfsParam;
        break;
      }
      case 'VMess': {
        base['type'] = 'vmess';
        base['uuid'] = node.uuid ?? '00000000-0000-0000-0000-000000000000';
        const aid = node.alterId ?? '0';
        base['alterId'] = aid;
        base['cipher'] = node.cipher ?? 'auto';
        const tlsVal = node.tls ?? '';
        base['tls'] = tlsVal === 'tls' || tlsVal === 'true' || !!node.sni;
        if (node.sni) base['servername'] = node.sni;
        if (node.alpn) base['alpn'] = node.alpn;
        const net = node.net ?? 'tcp';
        base['network'] = net;
        if (net === 'ws') {
          if (settings.clashNewFieldName) {
            base['ws-opts'] = { path: node.path ?? '/', headers: node.host ? { Host: node.host } : {} };
          } else {
            base['ws-path'] = node.path ?? '/';
            if (node.host) base['ws-headers'] = { Host: node.host };
          }
        } else if (net === 'h2' || net === 'http') {
          base['http-opts'] = { path: [node.path ?? '/'] };
        } else if (net === 'grpc') {
          base['grpc-opts'] = { 'grpc-service-name': node.path ?? '' };
        }
        break;
      }
      case 'Trojan': {
        base['type'] = 'trojan';
        base['password'] = node.password ?? '';
        if (node.sni) base['sni'] = node.sni;
        else if (node.host) base['sni'] = node.host;
        if (node.alpn) base['alpn'] = [node.alpn];
        break;
      }
      case 'Socks5': {
        base['type'] = 'socks5';
        if (node.password) { base['username'] = node.method ?? ''; base['password'] = node.password; }
        break;
      }
      case 'Http':
      case 'Https': {
        base['type'] = 'http';
        if (node.password) { base['username'] = node.method ?? ''; base['password'] = node.password; }
        base['tls'] = node.type === 'Https';
        break;
      }
      case 'Snell': {
        base['type'] = 'snell';
        base['psk'] = node.psk ?? node.password ?? '';
        if (node.obfsSnell) base['obfs-opts'] = { mode: node.obfsSnell };
        if (node.version) base['version'] = node.version;
        break;
      }
      case 'WireGuard': {
        base['type'] = 'wireguard';
        if (node.privateKey) base['private-key'] = node.privateKey;
        if (node.publicKey) base['public-key'] = node.publicKey;
        if (node.presharedKey) base['pre-shared-key'] = node.presharedKey;
        if (node.ip) base['ip'] = node.ip;
        if (node.ipv6) base['ipv6'] = node.ipv6;
        if (node.dns) base['dns'] = node.dns;
        if (node.mtu) base['mtu'] = Number(node.mtu) || 1420;
        break;
      }
      case 'Hysteria2':
      case 'Hysteria': {
        base['type'] = node.type === 'Hysteria2' ? 'hysteria2' : 'hysteria';
        base['password'] = node.password ?? node.ports ?? '';
        if (node.up) base['up'] = node.up;
        if (node.down) base['down'] = node.down;
        if (node.obfsParam2) base['obfs'] = node.obfsParam2;
        if (node.fingerprint) base['fingerprint'] = node.fingerprint;
        if (node.sni) base['sni'] = node.sni;
        break;
      }
      case 'AnyTLS': {
        base['type'] = 'anytls';
        base['password'] = node.password ?? '';
        if (node.sni) base['sni'] = node.sni;
        break;
      }
      default: {
        base['type'] = (node.type ?? 'ss').toLowerCase();
        if (node.password) base['password'] = node.password;
        if (node.method) base['cipher'] = node.method;
        if (node.uuid) base['uuid'] = node.uuid;
        break;
      }
    }
    if (settings.appendProxyType) {
      const prefix = `[${node.type}] `;
      const cur = base['name'] as string;
      if (!cur.startsWith(prefix)) base['name'] = prefix + cur;
    }
    return base;
  } catch {
    return { name: node.remark ?? 'Proxy', type: 'ss', server: node.hostname ?? '127.0.0.1', port: Number(node.port) || 443, cipher: 'aes-256-gcm', password: node.password ?? 'password' };
  }
}

function parsePluginOpts(opts: string): Record<string, string> {
  try {
    const out: Record<string, string> = {};
    const parts = opts.split(';');
    for (const p of parts) {
      const kv = p.split('=');
      if (kv.length === 2) out[kv[0].trim()] = kv[1].trim();
      else if (kv[0]) out[kv[0].trim()] = '';
    }
    return out;
  } catch {
    return { raw: opts };
  }
}

function ensureBaseClash(baseTemplate: string): Record<string, unknown> {
  const def: Record<string, unknown> = { proxies: [], 'proxy-groups': [], rules: [] };
  if (typeof baseTemplate !== 'string' || !baseTemplate.trim()) return def;
  try {
    const parsed = yaml.load(baseTemplate) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      if (!Array.isArray(obj['proxies'])) obj['proxies'] = [];
      if (!Array.isArray(obj['proxy-groups'])) obj['proxy-groups'] = [];
      if (!Array.isArray(obj['rules'])) obj['rules'] = [];
      return obj;
    }
    return def;
  } catch {
    return def;
  }
}

export function proxyToClash(nodes: Proxy[], baseTemplate: string, isClashR: boolean, settings?: ExtraSettings): string {
  try {
    if (!Array.isArray(nodes)) nodes = [];
    const s = getSettings(settings);
    const base = ensureBaseClash(baseTemplate);
    const seen = new Map<string, number>();
    const proxies: Record<string, unknown>[] = [];
    for (const n of nodes) {
      if (!n || typeof n.hostname !== 'string' || !n.hostname) continue;
      const dedupName = processRemark(n.remark, seen, false);
      const copy: Proxy = { ...n, remark: dedupName };
      if (s.filterDeprecated && n.type === 'SS') {
        const m = (n.method ?? n.cipher ?? '').toLowerCase();
        if (m === 'chacha20' || m === 'xchacha20' || m === 'chacha20-ietf') continue;
      }
      const p = buildClashProxy(copy, s);
      void isClashR;
      proxies.push(p);
    }
    base['proxies'] = proxies;
    if (s.nodelist) {
      try {
        return yaml.dump({ proxies } as unknown as Record<string, unknown>, { lineWidth: -1, noRefs: true, sortKeys: false });
      } catch {
        return yaml.dump({ proxies } as unknown as object);
      }
    }
    let groups = base['proxy-groups'] as unknown as ProxyGroupConfig[];
    if (!Array.isArray(groups) || groups.length === 0) {
      const proxyNames = proxies.map(p => p['name'] as string);
      if (proxyNames.length > 0) {
        groups = [{ name: 'PROXY', type: 'select' as const, proxies: proxyNames } as unknown as ProxyGroupConfig];
      } else groups = [];
    } else {
      const enriched: unknown[] = [];
      for (const g of groups) {
        const gg = g as unknown as Record<string, unknown>;
        const name = (gg['name'] as string) ?? 'PROXY';
        const typeRaw = (gg['type'] as string) ?? 'select';
        const type = typeRaw === 'smart' ? 'url-test' : typeRaw;
        let proxyList: string[] = [];
        const rawProxies = gg['proxies'] as unknown;
        if (Array.isArray(rawProxies) && rawProxies.length > 0) {
          // Expand each rule via pipeline groupGenerate(groupName, rule, nodes)
          const expandedAll: string[] = [];
          const seenExp = new Set<string>();
          for (const rule of rawProxies as string[]) {
            if (!rule || typeof rule !== 'string') continue;
            if (rule.startsWith('[]')) {
              const lit = rule.slice(2).trim();
              if (lit && !seenExp.has(lit)) { seenExp.add(lit); expandedAll.push(lit); }
              continue;
            }
            try {
              const expanded = groupGenerate(name, rule, nodes);
              for (const e of expanded) if (!seenExp.has(e)) { seenExp.add(e); expandedAll.push(e); }
            } catch {
              // fallback keep rule literal if it matches a proxy name
              const match = proxies.find(p => p['name'] === rule);
              if (match && !seenExp.has(rule)) { seenExp.add(rule); expandedAll.push(rule); }
            }
          }
          if (expandedAll.length > 0) proxyList = expandedAll;
          else proxyList = rawProxies as string[];
        }
        if (proxyList.length === 0) {
          const allNames = proxies.map(p => p['name'] as string);
          if (allNames.length) proxyList = allNames.slice(0, 5);
          else proxyList = ['DIRECT'];
        }
        const outGroup: Record<string, unknown> = { name, type, proxies: proxyList };
        if (gg['url']) outGroup['url'] = gg['url'];
        if (gg['interval']) outGroup['interval'] = gg['interval'];
        if (typeof gg['tolerance'] === 'number') outGroup['tolerance'] = gg['tolerance'];
        if (gg['strategy']) outGroup['strategy'] = gg['strategy'];
        enriched.push(outGroup);
      }
      groups = enriched as unknown as ProxyGroupConfig[];
    }
    base['proxy-groups'] = groups as unknown;
    try {
      return yaml.dump(base as Record<string, unknown>, { lineWidth: -1, noRefs: true, sortKeys: false });
    } catch {
      return yaml.dump(base as Record<string, unknown>);
    }
  } catch {
    try { return yaml.dump({ proxies: [] }); } catch { return 'proxies: []\n'; }
  }
}

export function proxyToSurge(nodes: Proxy[], base: string, ver: number, settings?: ExtraSettings): string {
  try {
    if (!Array.isArray(nodes)) nodes = [];
    const s = getSettings(settings);
    const version = typeof ver === 'number' ? ver : 3;
    const seen = new Map<string, number>();
    const lines: string[] = [];
    lines.push('# Surge configuration generated by subconverter-ts');
    if (version === -3) lines.push('# Surfboard compatible');
    lines.push('');
    lines.push('[Proxy]');
    lines.push('DIRECT = direct');
    for (const n of nodes) {
      if (!n || !n.hostname) continue;
      const remark = processRemark(n.remark, seen, true);
      const host = n.hostname;
      const port = Number(n.port) || 443;
      let proxyLine = '';
      const method = n.method ?? n.cipher ?? 'aes-256-gcm';
      const password = n.password ?? '';
      if (n.type === 'SS') {
        proxyLine = `${remark} = ss, ${host}, ${port}, encrypt-method=${method}, password=${password}`;
        if (n.plugin) proxyLine += `, plugin=${n.plugin}`;
      } else if (n.type === 'VMess') {
        const uuid = n.uuid ?? '00000000-0000-0000-0000-000000000000';
        const tlsStr = n.tls === 'tls' || n.sni ? 'true' : 'false';
        const net = n.net ?? 'tcp';
        if (net === 'ws') proxyLine = `${remark} = vmess, ${host}, ${port}, username=${uuid}, ws=true, ws-path=${n.path ?? '/'}, tls=${tlsStr}`;
        else proxyLine = `${remark} = vmess, ${host}, ${port}, username=${uuid}, tls=${tlsStr}`;
        if (n.sni) proxyLine += `, sni=${n.sni}`;
        if (n.host) proxyLine += `, ws-headers=Host:${n.host}`;
      } else if (n.type === 'Trojan') {
        proxyLine = `${remark} = trojan, ${host}, ${port}, password=${password}`;
        if (n.sni) proxyLine += `, sni=${n.sni}`;
        else if (n.host) proxyLine += `, sni=${n.host}`;
      } else if (n.type === 'SSR') {
        proxyLine = `${remark} = ssr, ${host}, ${port}, encrypt-method=${method}, password=${password}, protocol=${n.protocol ?? 'origin'}, obfs=${n.obfs ?? 'plain'}`;
      } else if (n.type === 'Socks5') {
        proxyLine = `${remark} = socks5, ${host}, ${port}`;
        if (password) proxyLine += `, username=${method}, password=${password}`;
      } else if (n.type === 'Http' || n.type === 'Https') {
        proxyLine = `${remark} = http, ${host}, ${port}`;
        if (password) proxyLine += `, username=${method}, password=${password}`;
      } else {
        proxyLine = `${remark} = ${n.type.toLowerCase()}, ${host}, ${port}`;
        if (password) proxyLine += `, password=${password}`;
      }
      if (s.tfo) proxyLine += ', tfo=true';
      if (s.udp) proxyLine += ', udp-relay=true';
      if (s.scv === false) proxyLine += ', skip-cert-verify=true';
      lines.push(proxyLine);
    }
    if (s.nodelist) return lines.join('\n') + '\n';
    lines.push('');
    lines.push('[Proxy Group]');
    const allNames = nodes.map(n => n.remark).filter(Boolean) as string[];
    const groupSeen = new Set<string>();
    const proxyNamesForGroup: string[] = [];
    for (const a of allNames) {
      const clean = a.replace(/=/g, '-').trim();
      if (!groupSeen.has(clean)) { groupSeen.add(clean); proxyNamesForGroup.push(clean); }
    }
    if (proxyNamesForGroup.length > 0) lines.push(`PROXY = select, ${proxyNamesForGroup.join(', ')}, DIRECT`);
    else lines.push('PROXY = select, DIRECT');
    void base;
    lines.push('');
    lines.push('[Rule]');
    lines.push('DOMAIN-SUFFIX,google.com,PROXY');
    lines.push('MATCH,DIRECT');
    lines.push('');
    return lines.join('\n');
  } catch {
    return '[Proxy]\nDIRECT = direct\n';
  }
}

export function proxyToSingle(nodes: Proxy[], typeMask: number): string {
  try {
    if (!Array.isArray(nodes) || nodes.length === 0) return '';
    const mask = typeof typeMask === 'number' ? typeMask : 15;
    const filtered = nodes.filter(n => {
      if (!n || !n.type) return false;
      const typeToMask: Record<string, number> = { 'SS': 1, 'SSR': 2, 'VMess': 4, 'Trojan': 8 };
      const m = typeToMask[n.type] ?? 0;
      if (m === 0) return false;
      return (mask & m) !== 0;
    });
    const links: string[] = [];
    for (const n of filtered) {
      const remarkEnc = encodeURIComponent(n.remark ?? 'Proxy');
      const host = n.hostname ?? '127.0.0.1';
      const port = Number(n.port) || 443;
      if (n.type === 'SS') {
        const method = n.method ?? n.cipher ?? 'aes-256-gcm';
        const password = n.password ?? 'password';
        const userInfo = `${method}:${password}@${host}:${port}`;
        const b64 = base64Encode(userInfo);
        links.push(`ss://${b64}#${remarkEnc}`);
      } else if (n.type === 'VMess') {
        const vmessJson = { v: '2', ps: n.remark ?? 'vmess', add: host, port: String(port), id: n.uuid ?? '00000000-0000-0000-0000-000000000000', aid: n.alterId ?? '0', net: n.net ?? 'tcp', type: 'none', host: n.host ?? '', path: n.path ?? '/', tls: n.tls ?? '' };
        const b64 = base64Encode(JSON.stringify(vmessJson));
        links.push(`vmess://${b64}`);
      } else if (n.type === 'Trojan') {
        const password = n.password ?? 'password';
        const sniParam = n.sni ? `?sni=${encodeURIComponent(n.sni)}` : '';
        links.push(`trojan://${encodeURIComponent(password)}@${host}:${port}${sniParam}#${remarkEnc}`);
      } else if (n.type === 'SSR') {
        const method = n.method ?? 'aes-256-cfb';
        const protocol = n.protocol ?? 'origin';
        const obfs = n.obfs ?? 'plain';
        const password = n.password ?? 'password';
        const passB64 = base64Encode(password);
        const remarksB64 = base64Encode(n.remark ?? 'ssr');
        const groupB64 = base64Encode(n.group ?? '');
        const base = `${host}:${port}:${protocol}:${method}:${obfs}:${passB64}`;
        const query = `obfsparam=&protoparam=&remarks=${remarksB64}&group=${groupB64}`;
        const full = `${base}/?${query}`;
        const b64full = base64Encode(full);
        links.push(`ssr://${b64full}`);
      }
    }
    if (links.length === 0 && nodes.length > 0 && mask === 15) {
      for (const n of nodes) {
        const remarkEnc = encodeURIComponent(n.remark ?? 'Proxy');
        const host = n.hostname ?? '127.0.0.1';
        const port = Number(n.port) || 443;
        links.push(`ss://${base64Encode(`aes-256-gcm:password@${host}:${port}`)}#${remarkEnc}`);
        break;
      }
    }
    const joined = links.join('\n');
    if (!joined) return '';
    if (mask === 15) {
      const b64 = base64Encode(joined);
      return b64 || joined;
    }
    return joined;
  } catch {
    return '';
  }
}

export function proxyToQuan(nodes: Proxy[], base?: string, settings?: ExtraSettings): string {
  try {
    const s = getSettings(settings);
    const inner = proxyToSurge(nodes, base ?? '', -2, s);
    return '# Quan configuration generated by subconverter-ts\n# target=quan\n' + inner;
  } catch {
    return '# Quan configuration\n';
  }
}

export function proxyToQuanX(nodes: Proxy[], base?: string, settings?: ExtraSettings): string {
  try {
    const s = getSettings(settings);
    const inner = proxyToSurge(nodes, base ?? '', -1, s);
    return '# Quantumult X configuration generated by subconverter-ts\n# target=quanx\n' + inner;
  } catch {
    return '# Quantumult X configuration\n';
  }
}

export function proxyToLoon(nodes: Proxy[], base?: string, settings?: ExtraSettings): string {
  try {
    const s = getSettings(settings);
    const inner = proxyToSurge(nodes, base ?? '', -4, s);
    return '# Loon configuration generated by subconverter-ts\n# target=loon\n' + inner;
  } catch {
    return '# Loon configuration\n';
  }
}

export function proxyToMellow(nodes: Proxy[], base?: string, settings?: ExtraSettings): string {
  try {
    const s = getSettings(settings);
    const inner = proxyToSurge(nodes, base ?? '', 0, s);
    return '# Mellow configuration generated by subconverter-ts\n# target=mellow\n' + inner;
  } catch {
    return '# Mellow configuration\n';
  }
}

export function proxyToSSSub(nodes: Proxy[], base?: string, settings?: ExtraSettings): string {
  try {
    if (!Array.isArray(nodes) || nodes.length === 0) return JSON.stringify({ version: 1, servers: [] }, null, 2);
    const s = getSettings(settings);
    void s; void base;
    const seen = new Map<string, number>();
    const servers = nodes.filter(n => n.hostname && n.port).map(n => {
      const remark = processRemark(n.remark, seen, false);
      return { id: String(n.id ?? Math.random().toString(36).slice(2)), remarks: remark, server: n.hostname, server_port: Number(n.port), password: n.password ?? 'password', method: n.method ?? n.cipher ?? 'aes-256-gcm', plugin: n.plugin ?? '', plugin_opts: n.pluginOpts ?? '' };
    });
    const out = { version: 1, servers };
    const header = '# SSSub SIP008 JSON generated by subconverter-ts\n# target=sssub\n';
    return header + JSON.stringify(out, null, 2);
  } catch {
    return '# SSSub configuration\n[]';
  }
}

export function proxyToSSD(nodes: Proxy[], _baseOrSettings?: string | ExtraSettings, maybeSettings?: ExtraSettings): string {
  try {
    let settings: ExtraSettings | undefined;
    if (typeof _baseOrSettings === 'object' && _baseOrSettings !== null) settings = _baseOrSettings as ExtraSettings;
    else if (maybeSettings) settings = maybeSettings;
    const s = getSettings(settings);
    void s;
    if (!Array.isArray(nodes) || nodes.length === 0) {
      const empty = { airport: 'subconverter-ts', port: 443, encryption: 'aes-256-gcm', password: 'password', expiry: Math.floor(Date.now() / 1000) + 86400, traffic_used: 0, traffic_total: 107374182400, servers: [] };
      return `ssd://${base64Encode(JSON.stringify(empty))}`;
    }
    const seen = new Map<string, number>();
    const servers = nodes.filter(n => n.hostname && n.port).map(n => {
      const remark = processRemark(n.remark, seen, false);
      return { id: n.id ?? 1, remarks: remark, server: n.hostname, port: Number(n.port), encryption: n.method ?? n.cipher ?? 'aes-256-gcm', password: n.password ?? 'password', plugin: n.plugin ?? '', plugin_options: n.pluginOpts ?? '' };
    });
    const payload = { airport: 'subconverter-ts SSD', port: 443, encryption: 'aes-256-gcm', password: 'password', traffic_used: 0, traffic_total: 107374182400, expiry: Math.floor(Date.now() / 1000) + 86400, servers };
    return `ssd://${base64Encode(JSON.stringify(payload))}`;
  } catch {
    return 'ssd://';
  }
}

export function proxyToSingBox(nodes: Proxy[], base?: string, settings?: ExtraSettings): string {
  try {
    if (!Array.isArray(nodes)) nodes = [];
    const s = getSettings(settings);
    const seen = new Map<string, number>();
    const outbounds: Record<string, unknown>[] = [];
    for (const n of nodes) {
      if (!n || !n.hostname) continue;
      const remark = processRemark(n.remark, seen, false);
      const host = n.hostname;
      const port = Number(n.port) || 443;
      const common = { tag: remark, server: host, server_port: port };
      let ob: Record<string, unknown> = { ...common };
      if (n.type === 'SS') ob = { ...common, type: 'shadowsocks', method: n.method ?? n.cipher ?? 'aes-256-gcm', password: n.password ?? 'password' };
      else if (n.type === 'VMess') ob = { ...common, type: 'vmess', uuid: n.uuid ?? '00000000-0000-0000-0000-000000000000', alterId: Number(n.alterId ?? 0), security: n.cipher ?? 'auto', tls: n.tls === 'tls' ? { enabled: true, server_name: n.sni ?? host } : { enabled: false } };
      else if (n.type === 'Trojan') ob = { ...common, type: 'trojan', password: n.password ?? 'password', tls: { enabled: true, server_name: n.sni ?? host } };
      else if (n.type === 'Socks5') ob = { ...common, type: 'socks', version: '5' };
      else if (n.type === 'WireGuard') ob = { ...common, type: 'wireguard', private_key: n.privateKey ?? '', peer_public_key: n.publicKey ?? '' };
      else if (n.type === 'Hysteria2') ob = { ...common, type: 'hysteria2', password: n.password ?? '' };
      else ob = { ...common, type: (n.type ?? 'shadowsocks').toLowerCase(), password: n.password ?? 'password' };
      outbounds.push(ob);
    }
    outbounds.push({ tag: 'direct', type: 'direct' } as Record<string, unknown>);
    outbounds.push({ tag: 'block', type: 'block' } as Record<string, unknown>);
    outbounds.push({ tag: 'dns-out', type: 'dns' } as Record<string, unknown>);
    void base;
    if (s.singboxAddClashModes) {
      outbounds.unshift({ tag: 'GLOBAL', type: 'selector', outbounds: outbounds.filter(o => typeof o['tag'] === 'string' && !['direct','block','dns-out','GLOBAL'].includes(o['tag'] as string)).map(o => o['tag'] as string).slice(0, 10) } as Record<string, unknown>);
    }
    const config: Record<string, unknown> = { _comment: 'SingBox configuration generated by subconverter-ts # target=singbox', outbounds, route: { rules: [{ geosite: 'category-ads-all', action: 'reject' }], final: 'direct' } };
    const header = '// SingBox configuration generated by subconverter-ts\n// target=singbox\n';
    return header + JSON.stringify(config, null, 2);
  } catch {
    return '// SingBox configuration\n{"outbounds":[]}';
  }
}

export const proxyToClashR = (nodes: Proxy[], baseTemplate: string, settings?: ExtraSettings): string => proxyToClash(nodes, baseTemplate, true, settings);
export const proxyToSurfboard = (nodes: Proxy[], baseTemplate: string, settings?: ExtraSettings): string => proxyToSurge(nodes, baseTemplate, -3, settings);
