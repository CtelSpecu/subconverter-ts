import { describe, it, expect } from 'vitest';
import { base64Encode, base64Decode, urlSafeBase64Encode, urlSafeBase64Decode } from '../src/utils/base64.js';
import { regFind, regMatch, regReplace, regValid } from '../src/utils/regexp.js';
import { parseTribool, triboolGet } from '../src/utils/tribool.js';
import { explode, explodeSub, explodeSS, explodeSSR, explodeVMess } from '../src/parser/subparser.js';
import { getSubInfoFromNodes } from '../src/parser/infoparser.js';
import { filterNodes } from '../src/pipeline/filter.js';
import { proxyToClash, proxyToSurge, proxyToSingle } from '../src/generator/subexport.js';
import { parseIni } from '../src/utils/ini_reader.js';

describe('utils/base64', () => {
  it('roundtrip', () => {
    expect(base64Decode(base64Encode('hello:world'))).toBe('hello:world');
  });
  it('url safe', () => {
    const s = 'test+data/==';
    expect(urlSafeBase64Decode(urlSafeBase64Encode(s))).toBe(s);
  });
});

describe('utils/regexp', () => {
  it('regFind partial', () => expect(regFind('SS', 'SS-SIP002')).toBe(true));
  it('regMatch anchored', () => expect(regMatch('SS.*', 'SS-SIP002')).toBe(true));
  it('regMatch fails partial', () => expect(regMatch('SS', 'SS-SIP002')).toBe(false));
  it('regValid', () => expect(regValid('[invalid')).toBe(false));
});

describe('utils/tribool', () => {
  it('parse true', () => expect(parseTribool('true')).toBe(true));
  it('parse false', () => expect(parseTribool('false')).toBe(false));
  it('parse undef', () => expect(parseTribool('')).toBeUndefined());
  it('get', () => expect(triboolGet(undefined, true)).toBe(true));
});

describe('parser/subparser', () => {
  it('explodeSS SIP002', () => {
    const p = explodeSS('ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@1.2.3.4:443#Test', '');
    expect(p?.hostname).toBe('1.2.3.4');
    expect(p?.port).toBe(443);
  });
  it('explodeSSR', () => {
    // Use a SSR link where obfs != plain to avoid SS fallback heuristic
    const host = '3.3.3.3';
    const port = '8388';
    const protocol = 'auth_sha1';
    const method = 'aes-256-cfb';
    const obfs = 'tls1.2_ticket_auth';
    const passB64 = Buffer.from('123456').toString('base64');
    const base = `${host}:${port}:${protocol}:${method}:${obfs}:${passB64}`;
    const params = `obfsparam=${Buffer.from('').toString('base64')}&protoparam=${Buffer.from('').toString('base64')}&remarks=${Buffer.from('SSR-Test').toString('base64')}&group=${Buffer.from('TestGroup').toString('base64')}`;
    const ssr = `ssr://${Buffer.from(`${base}/?${params}`).toString('base64')}`;
    const p = explodeSSR(ssr, '');
    expect(p?.type).toBe('SSR');
  });
  it('explodeVMess', () => {
    const json = { v: "2", ps: "Test", add: "1.1.1.1", port: "443", id: "b831381d-6324-4d53-ad4f-8cda48b3080a", aid: "0", net: "tcp", type: "none", host: "", path: "", tls: "" };
    const b64 = Buffer.from(JSON.stringify(json)).toString('base64');
    const p = explodeVMess(`vmess://${b64}`, '');
    expect(p?.hostname).toBe('1.1.1.1');
  });
  it('explodeSub mixed', () => {
    const content = 'ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@1.2.3.4:443#SS\nvmess://eyJ2IjoiMiIsInBzIjoiVCIsImFkZCI6IjEuMS4xLjEiLCJwb3J0IjoiNDQzIiwiaWQiOiJiODMxMzgxZC02MzI0LTRkNTMtYWQ0Zi04Y2RhNDhiMzA4MGEiLCJhaWQiOiIwIiwibmV0IjoidGNwIiwidHlwZSI6Im5vbmUiLCJob3N0IjoiIiwicGF0aCI6IiIsInRscyI6IiJ9';
    const nodes = explodeSub(content);
    expect(nodes.length).toBe(2);
  });
});

describe('pipeline/filter', () => {
  it('include', () => {
    const nodes: any[] = [{ remark: 'SS-SIP002' }, { remark: 'VMess' }];
    const filtered = filterNodes(nodes as any, [], ['SS-SIP002']);
    expect(filtered.length).toBe(1);
    expect(filtered[0].remark).toBe('SS-SIP002');
  });
  it('exclude', () => {
    const nodes: any[] = [{ remark: 'SS-SIP002' }, { remark: 'VMess' }];
    const filtered = filterNodes(nodes as any, ['SS-SIP002'], []);
    expect(filtered.length).toBe(1);
    expect(filtered[0].remark).toBe('VMess');
  });
});

describe('generator/subexport', () => {
  it('proxyToClash generates yaml', () => {
    const nodes: any[] = [{ type: 'SS', remark: 'Test', hostname: '1.2.3.4', port: 443, method: 'aes-256-gcm', password: 'pass', group: 'Test', groupId: 0, id: 0 }];
    const out = proxyToClash(nodes as any, '', false, { clashProxiesStyle: 'flow', clashProxyGroupsStyle: 'block' } as any);
    expect(out).toContain('Test');
    expect(out).toContain('proxies:');
  });
  it('proxyToSurge generates ini', () => {
    const nodes: any[] = [{ type: 'SS', remark: 'Test', hostname: '1.2.3.4', port: 443, method: 'aes-256-gcm', password: 'pass', group: 'Test', groupId: 0, id: 0 }];
    const out = proxyToSurge(nodes as any, '', 3, {} as any);
    expect(out).toContain('[Proxy]');
  });
  it('proxyToSingle', () => {
    const nodes: any[] = [{ type: 'SS', remark: 'Test', hostname: '1.2.3.4', port: 443, method: 'aes-256-gcm', password: 'pass', group: 'Test', groupId: 0, id: 0 }];
    const out = proxyToSingle(nodes as any, 1);
    expect(out).toContain('ss://');
  });
});

describe('utils/ini_reader', () => {
  it('parses sections', () => {
    const ini = parseIni('[common]\napi_mode=true\n[test]\nkey=value\n');
    expect(ini.get('common', 'api_mode')).toBe('true');
    expect(ini.get('test', 'key')).toBe('value');
  });
});
