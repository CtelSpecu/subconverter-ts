import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CPP_BASE = 'http://127.0.0.1:25500';
const TS_LOCAL = 'http://127.0.0.1:8787';
const TS_REMOTE = 'https://subconverter-worker.churnie.workers.dev';

// For C++ container, host's HTTP mocks are at 172.17.0.1:8000
// For TS (host), they are at 127.0.0.1:8000
const MOCK_HOST_CPP = 'http://172.17.0.1:8000';
const MOCK_HOST_TS = 'http://127.0.0.1:8000';

const b64 = (s) => Buffer.from(s, 'utf-8').toString('base64');
const urlEncode = (s) => encodeURIComponent(s);

async function fetchText(url, opts = {}) {
  try {
    const res = await fetch(url, opts);
    const body = await res.text();
    return { status: res.status, body, headers: Object.fromEntries(res.headers.entries()) };
  } catch (e) {
    return { status: 0, body: `fetch error: ${e.message}`, headers: {} };
  }
}

let total = 0, passed = 0, failed = 0;
const failures = [];
function assert(name, cond, details = '') {
  total++;
  if (cond) { passed++; console.log(`✓ ${name}`); } else { failed++; failures.push({ name, details }); console.log(`✗ ${name} — ${details}`); }
}

console.log('=== Mock Files Check ===');
for (const f of ['mixed-basic.txt','ss-only.txt','vmess-only.txt','clash.yaml','surge.ini']) {
  try {
    const c = readFileSync(path.join(__dirname, 'mocks', f), 'utf-8');
    console.log(`mock ${f}: ${c.length} chars, ${c.split('\n').length} lines`);
  } catch (e) { console.log(`mock ${f} missing: ${e.message}`); }
}

console.log('\n=== C++ Tests via HTTP mocks (172.17.0.1:8000) ===');
{
  const url = `${MOCK_HOST_CPP}/mixed-basic.txt`;
  const r = await fetchText(`${CPP_BASE}/sub?target=clash&url=${urlEncode(url)}`);
  assert('C++ clash mixed-basic via http 200', r.status === 200 && r.body.includes('SS-SIP002'), `status=${r.status} len=${r.body.length} body=${r.body.slice(0,80)}`);
  const r2 = await fetchText(`${CPP_BASE}/sub?target=surge&ver=4&url=${urlEncode(url)}`);
  assert('C++ surge mixed-basic 200', r2.status === 200 && r2.body.includes('DIRECT'), `status=${r2.status}`);
  const r3 = await fetchText(`${CPP_BASE}/sub?target=ss&url=${urlEncode(`${MOCK_HOST_CPP}/ss-only.txt`)}`);
  assert('C++ ss ss-only 200', r3.status === 200 && r3.body.includes('ss://'), `status=${r3.status} body=${r3.body.slice(0,60)}`);
  const r4 = await fetchText(`${CPP_BASE}/sub?target=v2ray&url=${urlEncode(`${MOCK_HOST_CPP}/vmess-only.txt`)}`);
  assert('C++ v2ray vmess-only 200', r4.status === 200 && r4.body.includes('vmess://'), `status=${r4.status} len=${r4.body.length}`);
  const r5 = await fetchText(`${CPP_BASE}/sub?target=clash&url=${urlEncode(`${MOCK_HOST_CPP}/clash.yaml`)}`);
  assert('C++ clash from clash.yaml 200', r5.status === 200 && r.body.includes('Clash-SS'), `status=${r5.status}`);
  const r6 = await fetchText(`${CPP_BASE}/sub?target=clash&url=${urlEncode(`${MOCK_HOST_CPP}/surge.ini`)}`);
  assert('C++ clash from surge.ini 200', r6.status === 200 && r6.body.includes('Surge-SS'), `status=${r6.status} len=${r6.body.length}`);
  // Multiple URLs via |
  const multiUrl = `${MOCK_HOST_CPP}/ss-only.txt|${MOCK_HOST_CPP}/vmess-only.txt`;
  const r7 = await fetchText(`${CPP_BASE}/sub?target=clash&url=${urlEncode(multiUrl)}`);
  assert('C++ multiple urls via |', r7.status === 200 && r7.body.includes('SS-') && r7.body.includes('VMess'), `status=${r7.status}`);
  // Tag prefix
  const tagUrl = `tag:MyGroup,${MOCK_HOST_CPP}/ss-only.txt`;
  const r8 = await fetchText(`${CPP_BASE}/sub?target=clash&url=${urlEncode(tagUrl)}`);
  assert('C++ tag prefix', r8.status === 200, `status=${r8.status}`);
  // Include/exclude
  const rInc = await fetchText(`${CPP_BASE}/sub?target=clash&url=${urlEncode(url)}&include=${urlEncode('SS-SIP002')}`);
  assert('C++ include filter', rInc.body.includes('SS-SIP002') && !rInc.body.includes('VMess-WS-TLS'), `include failed`);
  const rExc = await fetchText(`${CPP_BASE}/sub?target=clash&url=${urlEncode(url)}&exclude=${urlEncode('SS-SIP002')}`);
  assert('C++ exclude filter', !rExc.body.includes('SS-SIP002'), `exclude failed`);
  // Empty and invalid
  const rEmpty = await fetchText(`${CPP_BASE}/sub?target=clash&url=${urlEncode(`${MOCK_HOST_CPP}/empty.txt`)}`);
  assert('C++ empty 400 or empty', rEmpty.status === 400 || rEmpty.body.length < 50, `status=${rEmpty.status} len=${rEmpty.body.length}`);
  const rInvalid = await fetchText(`${CPP_BASE}/sub?target=clash&url=${urlEncode(`${MOCK_HOST_CPP}/invalid.txt`)}`);
  assert('C++ invalid handled 200 or 400', rInvalid.status === 200 || rInvalid.status === 400, `status=${rInvalid.status}`);
  // All 15 targets with mixed-basic
  const targets = ['clash','clashr','surge','surfboard','mellow','ss','ssr','v2ray','trojan','mixed','quan','quanx','loon','ssd','singbox'];
  for (const t of targets) {
    const r = await fetchText(`${CPP_BASE}/sub?target=${t}&url=${urlEncode(url)}`);
    assert(`C++ target ${t}`, r.status === 200, `status=${r.status} len=${r.body.length}`);
  }
  // Base64 subscription (mixed-basic.b64 content served as http, but content is base64 text)
  const rB64 = await fetchText(`${CPP_BASE}/sub?target=clash&url=${urlEncode(`${MOCK_HOST_CPP}/mixed-basic.b64`)}`);
  // C++ may treat .b64 as base64 subscription and decode; check if it returns nodes
  assert('C++ base64 subscription', rB64.status === 200, `status=${rB64.status} len=${rB64.body.length}`);
}

console.log('\n=== TS Local Tests via HTTP mocks (127.0.0.1:8000) ===');
{
  const url = `${MOCK_HOST_TS}/mixed-basic.txt`;
  const r = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(url)}`);
  assert('TS local clash mixed-basic 200', r.status === 200 && r.body.includes('SS-SIP002'), `status=${r.status} len=${r.body.length}`);
  const r2 = await fetchText(`${TS_LOCAL}/sub?target=surge&ver=4&url=${urlEncode(url)}`);
  assert('TS local surge mixed-basic 200', r2.status === 200 && r2.body.includes('DIRECT'), `status=${r2.status}`);
  const r3 = await fetchText(`${TS_LOCAL}/sub?target=ss&url=${urlEncode(`${MOCK_HOST_TS}/ss-only.txt`)}`);
  assert('TS local ss ss-only 200', r3.status === 200 && r3.body.includes('ss://'), `status=${r3.status}`);
  const r4 = await fetchText(`${TS_LOCAL}/sub?target=v2ray&url=${urlEncode(`${MOCK_HOST_TS}/vmess-only.txt`)}`);
  assert('TS local v2ray vmess-only 200', r4.status === 200 && r4.body.includes('vmess://'), `status=${r4.status}`);
  const r5 = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(`${MOCK_HOST_TS}/clash.yaml`)}`);
  assert('TS local clash from clash.yaml', r5.status === 200 && r5.body.includes('Clash-SS'), `status=${r5.status}`);
  const r6 = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(`${MOCK_HOST_TS}/surge.ini`)}`);
  assert('TS local clash from surge.ini', r6.status === 200 && r6.body.includes('Surge-SS'), `status=${r6.status}`);
  const multiUrl = `${MOCK_HOST_TS}/ss-only.txt|${MOCK_HOST_TS}/vmess-only.txt`;
  const r7 = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(multiUrl)}`);
  assert('TS local multiple urls', r7.status === 200 && r7.body.includes('SS-') && r7.body.includes('VMess'), `status=${r7.status}`);
  const rInc = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(url)}&include=${urlEncode('SS-SIP002')}`);
  assert('TS local include', rInc.body.includes('SS-SIP002') && !rInc.body.includes('VMess-WS-TLS'), `include failed`);
  const rExc = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(url)}&exclude=${urlEncode('SS-SIP002')}`);
  assert('TS local exclude', !rExc.body.includes('SS-SIP002'), `exclude failed`);
  const rEmpty = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(`${MOCK_HOST_TS}/empty.txt`)}`);
  assert('TS local empty 400 or empty', rEmpty.status === 400 || rEmpty.body.length < 100, `status=${rEmpty.status} len=${rEmpty.body.length}`);
  const rInvalid = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(`${MOCK_HOST_TS}/invalid.txt`)}`);
  assert('TS local invalid handled', rInvalid.status === 200 || rInvalid.status === 400, `status=${rInvalid.status}`);
  const targets = ['clash','clashr','surge','surfboard','mellow','ss','ssr','v2ray','trojan','mixed','quan','quanx','loon','ssd','singbox'];
  for (const t of targets) {
    const r = await fetchText(`${TS_LOCAL}/sub?target=${t}&url=${urlEncode(url)}`);
    assert(`TS local target ${t}`, r.status === 200 && r.body.length > 0, `status=${r.status} len=${r.body.length}`);
  }
  // Data URL test (TS should handle, C++ not)
  const dataContent = b64('ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@1.2.3.4:443#DataTest');
  const dataUrl = `data:text/plain;base64,${dataContent}`;
  const rData = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(dataUrl)}`);
  assert('TS local data: URL', rData.status === 200 && rData.body.includes('DataTest'), `status=${rData.status} len=${rData.body.length}`);
  // Large subscription
  const rLarge = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(`${MOCK_HOST_TS}/mixed-large.txt`)}`);
  assert('TS local large 20 nodes', rLarge.status === 200 && (rLarge.body.match(/Node-/g) || []).length >= 10, `status=${rLarge.status} len=${rLarge.body.length}`);
}

console.log('\n=== TS Remote Tests (deployed) - curl fallback for proxy ===');
import { execSync } from 'child_process';
function curlFetch(url) {
  try {
    const out = execSync(`curl -s -w "\\n%{http_code}" "${url}"`, { timeout: 10000 }).toString();
    const lines = out.trim().split('\n');
    const status = parseInt(lines.pop(), 10);
    const body = lines.join('\n');
    return { status, body, headers: {} };
  } catch (e) {
    return { status: 0, body: e.message, headers: {} };
  }
}
{
  // Use HTTP mocks that are publicly reachable? For remote, 127.0.0.1:8000 is not reachable from Cloudflare.
  // Use data: URLs for remote instead, which don't require fetch.
  const ssData = `data:text/plain;base64,${b64('ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@1.2.3.4:443#RemoteTest')}`;
  // Actually need to base64 the link list, not the link? For data: we need base64 of content which is ss link
  const singleB64 = b64('ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@1.2.3.4:443#RemoteTest');
  const dataUrl = `data:text/plain;base64,${singleB64}`;
  const r = curlFetch(`${TS_REMOTE}/sub?target=clash&url=${urlEncode(dataUrl)}`);
  assert('TS remote clash data: 200', r.status === 200 && r.body.includes('RemoteTest'), `status=${r.status} len=${r.body.length}`);
  const r2 = curlFetch(`${TS_REMOTE}/version`);
  assert('TS remote version 200', r2.status === 200 && r2.body.includes('v0.9.0'), `status=${r2.status} body=${r2.body.slice(0,30)}`);
  const r3 = curlFetch(`${TS_REMOTE}/sub?target=surge&ver=4&url=${urlEncode(dataUrl)}`);
  assert('TS remote surge 200', r3.status === 200 && r3.body.includes('DIRECT'), `status=${r3.status}`);
}

console.log('\n=== Parity C++ vs TS (mixed-basic via http) ===');
{
  const urlCpp = `${MOCK_HOST_CPP}/mixed-basic.txt`;
  const urlTs = `${MOCK_HOST_TS}/mixed-basic.txt`;
  const cpp = await fetchText(`${CPP_BASE}/sub?target=clash&url=${urlEncode(urlCpp)}`);
  const ts = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(urlTs)}`);
  const cppNodes = (cpp.body.match(/SS-SIP002|VMess-WS-TLS|Trojan-Test/g) || []).length;
  const tsNodes = (ts.body.match(/SS-SIP002|VMess-WS-TLS|Trojan-Test/g) || []).length;
  assert('Parity node count', cppNodes === tsNodes && cppNodes >= 3, `cppNodes=${cppNodes} tsNodes=${tsNodes} cppLen=${cpp.body.length} tsLen=${ts.body.length}`);
  // Check CORS
  assert('C++ CORS', cpp.headers['access-control-allow-origin'] === '*', `cpp CORS ${cpp.headers['access-control-allow-origin']}`);
  assert('TS CORS', ts.headers['access-control-allow-origin'] === '*', `ts CORS ${ts.headers['access-control-allow-origin']}`);
}

console.log(`\n=== Summary: ${passed}/${total} passed, ${failed} failed ===`);
if (failures.length) {
  console.log('Failures:');
  for (const f of failures) console.log(` - ${f.name}: ${f.details}`);
  process.exit(1);
} else {
  console.log('All tests passed!');
}
