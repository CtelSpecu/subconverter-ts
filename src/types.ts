export type ProxyType =
  | 'SS'
  | 'SSR'
  | 'VMess'
  | 'Socks5'
  | 'Http'
  | 'Https'
  | 'Trojan'
  | 'Snell'
  | 'WireGuard'
  | 'Hysteria'
  | 'Hysteria2'
  | 'AnyTLS'
  | 'Unknown';

export interface Proxy {
  type: ProxyType;
  group: string;
  groupId: number;
  id: number;
  remark: string;
  hostname: string;
  port: number;
  udp?: boolean;
  tfo?: boolean;
  scv?: boolean;
  tls13?: boolean;
  // SS
  method?: string;
  password?: string;
  plugin?: string;
  pluginOpts?: string;
  // SSR
  protocol?: string;
  protocolParam?: string;
  obfs?: string;
  obfsParam?: string;
  // VMess
  uuid?: string;
  alterId?: string;
  cipher?: string;
  tls?: string;
  sni?: string;
  alpn?: string;
  host?: string;
  path?: string;
  net?: string;
  // Trojan
  sni2?: string;
  // Hysteria2
  up?: string;
  down?: string;
  obfsParam2?: string;
  fingerprint?: string;
  ports?: string;
  // Snell
  psk?: string;
  obfsSnell?: string;
  version?: string;
  // WireGuard
  publicKey?: string;
  privateKey?: string;
  presharedKey?: string;
  ip?: string;
  ipv6?: string;
  dns?: string;
  mtu?: string;
  // Common extras
  underlyingProxy?: string;
}

export type ProxyGroupType = 'Select' | 'URLTest' | 'Fallback' | 'LoadBalance' | 'Relay' | 'SSID' | 'Smart';

export interface ProxyGroupConfig {
  name: string;
  type: ProxyGroupType;
  proxies: string[];
  usingProvider?: string[];
  url?: string;
  interval?: number;
  timeout?: number;
  tolerance?: number;
  strategy?: string;
  lazy?: boolean;
  disableUdp?: boolean;
  persistent?: boolean;
  evaluateBeforeUse?: boolean;
}

export interface RulesetConfig {
  group: string;
  url: string;
  interval: number;
  type?: string;
}

export interface RegexMatchConfig {
  match: string;
  replace: string;
  script?: string;
}

export interface ExtraSettings {
  enableRuleGenerator: boolean;
  overwriteOriginalRules: boolean;
  renameArray: RegexMatchConfig[];
  emojiArray: RegexMatchConfig[];
  addEmoji: boolean;
  removeEmoji: boolean;
  appendProxyType: boolean;
  nodelist: boolean;
  sortFlag: boolean;
  filterDeprecated: boolean;
  clashNewFieldName: boolean;
  clashScript: boolean;
  clashClassicalRuleset: boolean;
  mellowBase?: string;
  quanBase?: string;
  quanxBase?: string;
  loonBase?: string;
  surgeBase?: string;
  clashBase?: string;
  surfboardBase?: string;
  sssubBase?: string;
  singboxBase?: string;
  surgeSsrPath?: string;
  quanxDevId?: string;
  tfo?: boolean;
  udp?: boolean;
  scv?: boolean;
  tls13?: boolean;
  sortScript?: string;
  clashProxiesStyle: string;
  clashProxyGroupsStyle: string;
  singboxAddClashModes: boolean;
  managedConfigPrefix: string;
  authorized: boolean;
}

export interface Settings {
  apiMode: boolean;
  apiAccessToken: string;
  defaultUrls: string;
  enableInsert: boolean;
  insertUrls: string;
  prependInsert: boolean;
  excludeRemarks: string[];
  includeRemarks: string[];
  enableFilter: boolean;
  filterScript: string;
  defaultExtConfig: string;
  basePath: string;
  clashBase: string;
  surgeBase: string;
  surfboardBase: string;
  mellowBase: string;
  quanBase: string;
  quanxBase: string;
  loonBase: string;
  sssubBase: string;
  singboxBase: string;
  appendProxyType: boolean;
  tfoFlag?: boolean;
  udpFlag?: boolean;
  skipCertVerify?: boolean;
  tls13Flag?: boolean;
  enableSort: boolean;
  sortScript: string;
  filterDeprecated: boolean;
  appendUserinfo: boolean;
  clashUseNewField: boolean;
  clashProxiesStyle: string;
  clashProxyGroupsStyle: string;
  singboxAddClashModes: boolean;
  renameArray: RegexMatchConfig[];
  writeManagedConfig: boolean;
  managedConfigPrefix: string;
  configUpdateInterval: number;
  configUpdateStrict: boolean;
  quanxDevId: string;
  surgeSsrPath: string;
  resolveHostname: boolean;
  addEmoji: boolean;
  removeOldEmoji: boolean;
  emojiRules: RegexMatchConfig[];
  enableRuleGen: boolean;
  overwriteOriginalRules: boolean;
  updateRulesetOnRequest: boolean;
  customProxyGroups: ProxyGroupConfig[];
  customRulesets: RulesetConfig[];
  templateVars: Record<string, string>;
  aliases: Record<string, string>;
  maxAllowedRulesets: number;
  maxAllowedRules: number;
  maxAllowedDownloadSize: number;
  enableCache: boolean;
  cacheSubscription: number;
  cacheConfig: number;
  cacheRuleset: number;
  serveCacheOnFail: boolean;
  skipFailedLinks: boolean;
  streamRules: RegexMatchConfig[];
  timeRules: RegexMatchConfig[];
}
