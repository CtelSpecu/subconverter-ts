import type { Settings } from '../types.js';
import { IniReader } from '../utils/ini_reader.js';
import { writeLog } from '../utils/logger.js';
import type { webGet } from './webget.js';

export interface Env {
  API_MODE?: string;
  API_TOKEN?: string;
  MANAGED_PREFIX?: string;
  DEFAULT_URL?: string;
  // allow any other env vars; wrangler passes vars as strings
  [key: string]: string | undefined;
}

function defaultSettings(): Settings {
  return {
    apiMode: true,
    apiAccessToken: '',
    defaultUrls: '',
    enableInsert: true,
    insertUrls: '',
    prependInsert: true,
    excludeRemarks: [],
    includeRemarks: [],
    enableFilter: false,
    filterScript: '',
    defaultExtConfig: '',
    basePath: 'base',
    clashBase: 'base/all_base.tpl',
    surgeBase: 'base/all_base.tpl',
    surfboardBase: 'base/all_base.tpl',
    mellowBase: 'base/all_base.tpl',
    quanBase: 'base/all_base.tpl',
    quanxBase: 'base/all_base.tpl',
    loonBase: 'base/all_base.tpl',
    sssubBase: 'base/all_base.tpl',
    singboxBase: 'base/all_base.tpl',
    appendProxyType: false,
    tfoFlag: undefined,
    udpFlag: undefined,
    skipCertVerify: undefined,
    tls13Flag: undefined,
    enableSort: false,
    sortScript: '',
    filterDeprecated: false,
    appendUserinfo: true,
    clashUseNewField: true,
    clashProxiesStyle: 'flow',
    clashProxyGroupsStyle: 'block',
    singboxAddClashModes: true,
    renameArray: [],
    writeManagedConfig: true,
    managedConfigPrefix: 'http://127.0.0.1:25500',
    configUpdateInterval: 86400,
    configUpdateStrict: false,
    quanxDevId: '',
    surgeSsrPath: '',
    resolveHostname: true,
    addEmoji: false,
    removeOldEmoji: false,
    emojiRules: [],
    enableRuleGen: true,
    overwriteOriginalRules: false,
    updateRulesetOnRequest: false,
    customProxyGroups: [],
    customRulesets: [],
    templateVars: {},
    aliases: {},
    maxAllowedRulesets: 64,
    maxAllowedRules: 32768,
    maxAllowedDownloadSize: 1048576,
    enableCache: false,
    cacheSubscription: 60,
    cacheConfig: 300,
    cacheRuleset: 21600,
    serveCacheOnFail: false,
    skipFailedLinks: false,
    streamRules: [],
    timeRules: [],
  };
}

export function buildSettings(env: Env): Settings {
  const s = defaultSettings();

  if (env.API_MODE !== undefined) {
    const v = env.API_MODE.trim().toLowerCase();
    if (v === 'false' || v === '0') s.apiMode = false;
    else if (v === 'true' || v === '1') s.apiMode = true;
    // else keep default true
  }

  if (env.API_TOKEN !== undefined) {
    s.apiAccessToken = env.API_TOKEN;
  }

  if (env.MANAGED_PREFIX !== undefined) {
    s.managedConfigPrefix = env.MANAGED_PREFIX;
  }

  if (env.DEFAULT_URL !== undefined) {
    s.defaultUrls = env.DEFAULT_URL;
  }

  return s;
}

export function parseIniPref(content: string): Settings {
  const s = defaultSettings();
  if (!content || typeof content !== 'string') return s;
  try {
    const reader = new IniReader();
    reader.parse(content);
    // [common] section per spec — only handle MVP keys
    const apiModeRaw = reader.get('common', 'api_mode', '');
    if (apiModeRaw !== '') {
      const v = apiModeRaw.trim().toLowerCase();
      if (v === 'false' || v === '0' || v === 'no' || v === 'off') s.apiMode = false;
      else if (v === 'true' || v === '1' || v === 'yes' || v === 'on') s.apiMode = true;
    }
    const token = reader.get('common', 'api_access_token', '');
    if (token !== '') s.apiAccessToken = token;
    const du = reader.get('common', 'default_url', '');
    if (du !== '') s.defaultUrls = du;
    // managed_config section
    const mcp = reader.get('managed_config', 'managed_config_prefix', '');
    if (mcp !== '') s.managedConfigPrefix = mcp;
    const wmc = reader.get('managed_config', 'write_managed_config', '');
    if (wmc !== '') {
      const v = wmc.trim().toLowerCase();
      if (v === 'false' || v === '0') s.writeManagedConfig = false;
      else if (v === 'true' || v === '1') s.writeManagedConfig = true;
    }
  } catch {
    // never throw
  }
  return s;
}

export async function loadExternalConfig(
  url: string,
  fetchFn: typeof webGet,
): Promise<Partial<Settings>> {
  if (!url || typeof url !== 'string') return {};
  try {
    const res = await fetchFn(url, 300);
    const body = res.body;
    if (!body) return {};
    // Try INI parse; for MVP only extract custom_proxy_group/ruleset etc. as stub
    // Full implementation would detect YAML/TOML and handle prefix bindings.
    // Here we just attempt INI parse and swallow errors.
    try {
      const reader = new IniReader();
      reader.parse(body);
      // MVP: return empty partial but log if needed
      // Future: extract [custom] keys
      // For now, indicate parsed but no overrides
      const out: Partial<Settings> = {};
      // Example: if [custom] has clash_rule_base override, handle
      // Not implemented for MVP
      void reader;
      void out;
    } catch {
      // not INI, try YAML etc. fallback
    }
    return {};
  } catch (e) {
    try {
      writeLog(0, `loadExternalConfig failed for ${url}: ${String(e)}`);
    } catch {}
    return {};
  }
}
