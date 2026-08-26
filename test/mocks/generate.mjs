import { writeFileSync } from 'fs';

// Helper: base64 encode
const b64 = (s) => Buffer.from(s, 'utf-8').toString('base64');
const b64urlSafe = (s) => b64(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// SS SIP002: ss://base64(method:password)@host:port#remark
const ss1 = `ss://${b64('aes-256-gcm:password')}@1.2.3.4:443#SS-SIP002`;
const ss2 = `ss://YWVzLTI1Ni1nY206dGVzdA==@2.2.2.2:8388#SS-Test2`; // already b64 userinfo

// SSR: ssr:// b64(host:port:protocol:method:obfs:b64(pass)/?params)
function makeSSR() {
  const host = '3.3.3.3';
  const port = '8388';
  const protocol = 'origin';
  const method = 'aes-256-cfb';
  const obfs = 'plain';
  const passB64 = b64('123456');
  const base = `${host}:${port}:${protocol}:${method}:${obfs}:${passB64}`;
  const params = `obfsparam=${b64('')}&protoparam=${b64('')}&remarks=${b64('SSR-Test')}&group=${b64('TestGroup')}`;
  return `ssr://${b64(`${base}/?${params}`)}`;
}
const ssr1 = makeSSR();

// VMess: standard JSON base64
const vmessJson = {
  v: "2", ps: "VMess-WS-TLS", add: "5.6.7.8", port: "443",
  id: "b831381d-6324-4d53-ad4f-8cda48b3080a", aid: "0",
  net: "ws", type: "none", host: "example.com", path: "/ws", tls: "tls"
};
const vmess1 = `vmess://${b64(JSON.stringify(vmessJson))}`;

// VMess without TLS
const vmessJson2 = { v: "2", ps: "VMess-TCP", add: "6.6.6.6", port: "80", id: "b831381d-6324-4d53-ad4f-8cda48b3080b", aid: "0", net: "tcp", type: "none", host: "", path: "", tls: "" };
const vmess2 = `vmess://${b64(JSON.stringify(vmessJson2))}`;

// Trojan
const trojan1 = `trojan://password@7.7.7.7:443#Trojan-Test`;
const trojanWs = `trojan://password@7.7.7.8:443?security=tls&type=ws&path=%2Fws&host=example.com#Trojan-WS`;

// Hysteria2
const hy2_1 = `hy2://password@8.8.8.8:443#Hy2-Test?insecure=1&sni=example.com`;
const hysteria2_1 = `hysteria2://password@8.8.8.9:443#Hysteria2-Test?insecure=1&up=10Mbps&down=20Mbps`;

// AnyTLS
const anytls1 = `anytls://password@9.9.9.9:443#AnyTLS-Test?sni=example.com&insecure=1`;

// Socks5
const socks1 = `socks://9.9.9.10:1080#Socks-Test`;
const socksUser = `socks://${b64('user:pass')}@9.9.9.11:1080#Socks-User`;

// HTTP (use tg://http format so C++ treats as node, not subscription)
const http1 = `tg://http?server=10.0.0.1&port=8080&remark=Http-Test`;
const https1 = `https://t.me/http?server=10.0.0.2&port=8443&remark=Https-Test`;

// Mixed basic: 5 links (avoid plain http:// which C++ treats as subscription fetch)
const mixedBasic = [ss1, vmess1, trojan1, hy2_1, socks1].join('\n');

// Clash YAML input
const clashYaml = `proxies:
  - name: Clash-SS
    type: ss
    server: 11.11.11.11
    port: 443
    cipher: aes-256-gcm
    password: clashpass
  - name: Clash-VMess
    type: vmess
    server: 12.12.12.12
    port: 443
    uuid: b831381d-6324-4d53-ad4f-8cda48b3080a
    alterId: 0
    cipher: auto
    tls: true
    network: ws
    ws-opts:
      path: /ws
      headers:
        Host: example.com
  - name: Clash-Trojan
    type: trojan
    server: 13.13.13.13
    port: 443
    password: trojanpass
    sni: example.com
`;

// Surge INI input
const surgeIni = `[Proxy]
Surge-SS = ss, 14.14.14.14, 443, encrypt-method=aes-256-gcm, password=surgepass
Surge-VMess = vmess, 15.15.15.15, 443, username=b831381d-6324-4d53-ad4f-8cda48b3080a, ws=true, tls=true, ws-path=/ws, sni=example.com
Surge-Trojan = trojan, 16.16.16.16, 443, password=trojanpass, sni=example.com
[Proxy Group]
Direct = select, auto, DIRECT
`;

// Write files
writeFileSync('test/mocks/mixed-basic.txt', mixedBasic);
writeFileSync('test/mocks/ss-only.txt', [ss1, ss2].join('\n'));
writeFileSync('test/mocks/ssr-only.txt', ssr1);
writeFileSync('test/mocks/vmess-only.txt', [vmess1, vmess2].join('\n'));
writeFileSync('test/mocks/trojan-only.txt', [trojan1, trojanWs].join('\n'));
writeFileSync('test/mocks/hy2-only.txt', [hy2_1, hysteria2_1].join('\n'));
writeFileSync('test/mocks/anytls-only.txt', anytls1);
writeFileSync('test/mocks/socks-http-only.txt', [socks1, socksUser, http1, https1].join('\n'));
writeFileSync('test/mocks/clash.yaml', clashYaml);
writeFileSync('test/mocks/surge.ini', surgeIni);
writeFileSync('test/mocks/empty.txt', '');
writeFileSync('test/mocks/invalid.txt', 'not-a-valid-link\n:::invalid:::\nss://@@@\n');
writeFileSync('test/mocks/mixed-large.txt', Array.from({length: 20}, (_,i)=>`ss://${b64(`aes-256-gcm:pass${i}`)}@10.0.0.${(i%250)+1}:443#Node-${i}`).join('\n'));

// Also create base64-encoded subscription variants
writeFileSync('test/mocks/mixed-basic.b64', b64(mixedBasic));
writeFileSync('test/mocks/clash.b64', b64(clashYaml));

console.log('Mocks generated');
console.log('mixed-basic count:', mixedBasic.split('\n').length);
