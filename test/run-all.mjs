import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mocksDir = path.join(__dirname, 'mocks');

const CPP_BASE = 'http://127.0.0.1:25500';
const TS_LOCAL = 'http://127.0.0.1:8787';
const TS_REMOTE = 'https://subconverter-worker.churnie.workers.dev';

const b64 = (s) => Buffer.from(s, 'utf-8').toString('base64');
const urlEncode = (s) => encodeURIComponent(s);

function makeDataUrl(content, isB64 = false) {
  if (isB64) return `data:text/plain;base64,${content.trim()}`;
  return `data:text/plain;base64,${b64(content)}`;
}

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

function assert(name, condition, details = '') {
  total++;
  if (condition) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failed++;
    failures.push({ name, details });
    console.log(`✗ ${name} — ${details}`);
  }
}

// Load mocks
const mocks = {};
for (const file of ['mixed-basic.txt','ss-only.txt','vmess-only.txt','trojan-only.txt','hy2-only.txt','clash.yaml','surge.ini','empty.txt','invalid.txt','mixed-large.txt']) {
  try {
    mocks[file] = readFileSync(path.join(mocksDir, file), 'utf-8');
  } catch { mocks[file] = ''; }
}
const mixedBasicData = makeDataUrl(mocks['mixed-basic.txt']);
const clashData = makeDataUrl(mocks['clash.yaml']);
const surgeData = makeDataUrl(mocks['surge.ini']);
const emptyData = makeDataUrl(mocks['empty.txt']);
const vmessData = makeDataUrl(mocks['vmess-only.txt']);
const ssData = makeDataUrl(mocks['ss-only.txt']);

console.log('=== C++ Environment Tests (http://127.0.0.1:25500) ===');
{
  // Test 1: version
  const r = await fetchText(`${CPP_BASE}/version`);
  assert('C++ GET /version 200', r.status === 200 && r.body.includes('subconverter'), `status=${r.status} body=${r.body.slice(0,50)}`);
  // Test 2: invalid target
  const r2 = await fetchText(`${CPP_BASE}/sub?target=invalid&url=${urlEncode(mixedBasicData)}`);
  assert('C++ invalid target 400', r2.status === 400, `status=${r2.status}`);
  // Test 3: missing url
  const r3 = await fetchText(`${CPP_BASE}/sub?target=clash`);
  assert('C++ missing url 400', r3.status === 400, `status=${r3.status} body=${r3.body.slice(0,30)}`);
  // Test 4: loop header
  const r4 = await fetchText(`${CPP_BASE}/sub?target=clash&url=${urlEncode(mixedBasicData)}`, { headers: { 'SubConverter-Request': '1' } });
  assert('C++ loop header 500', r4.status === 500, `status=${r4.status}`);
  // Test 5: HEAD
  const r5 = await fetchText(`${CPP_BASE}/sub?target=clash&url=${urlEncode(mixedBasicData)}`, { method: 'HEAD' });
  assert('C++ HEAD 200', r5.status === 200, `status=${r5.status}`);
  // Test 6: OPTIONS
  const r6 = await fetchText(`${CPP_BASE}/sub`, { method: 'OPTIONS' });
  assert('C++ OPTIONS 200', r6.status === 200, `status=${r6.status}`);
}

const cppTargets = ['clash','clashr','surge','surfboard','mellow','ss','ssr','v2ray','trojan','mixed','quan','quanx','loon','ssd','singbox'];
for (const target of cppTargets) {
  const r = await fetchText(`${CPP_BASE}/sub?target=${target}&url=${urlEncode(mixedBasicData)}`);
  const ok = r.status === 200;
  // For ss/v2ray/trojan/mixed, they filter by type, so with mixed-basic (ss+vmess+trojan+hy2+socks+http) they should have some output for ss/v2ray/trojan but mixed should have all
  // We check that 200 and body not empty for those that should have content, but allow empty for type-filtered edge
  let shouldHaveBody = true;
  if (['ss','ssr','v2ray','trojan'].includes(target)) shouldHaveBody = r.body.length > 0 || target === 'ssr'; // ssr may be empty if no ssr nodes in mixed-basic
  assert(`C++ target ${target} 200`, ok && (shouldHaveBody ? r.body.length > 0 : true), `status=${r.status} len=${r.body.length}`);
}

for (const [file, desc] of [['mixed-basic.txt','mixed'],['clash.yaml','clash'],['surge.ini','surge'],['empty.txt','empty'],['invalid.txt','invalid']]) {
  const data = makeDataUrl(mocks[file]);
  const r = await fetchText(`${CPP_BASE}/sub?target=clash&url=${urlEncode(data)}`);
  if (file === 'empty.txt') {
    assert(`C++ clash with ${desc} empty 400 or 200 empty`, r.status === 400 || r.body.length === 0, `status=${r.status} len=${r.body.length}`);
  } else if (file === 'invalid.txt') {
    // C++ should handle invalid gracefully, may return 200 with empty proxies or 400
    assert(`C++ clash with ${desc} handled`, r.status === 200 || r.status === 400, `status=${r.status}`);
  } else {
    assert(`C++ clash with ${desc} 200`, r.status === 200 && r.body.length > 0, `status=${r.status} len=${r.body.length}`);
  }
}

// Feature: include/exclude
{
  const rInc = await fetchText(`${CPP_BASE}/sub?target=clash&url=${urlEncode(mixedBasicData)}&include=${urlEncode('SS-SIP002')}`);
  assert('C++ include filter keeps SS-SIP002', rInc.body.includes('SS-SIP002'), `body missing SS-SIP002`);
  const rExc = await fetchText(`${CPP_BASE}/sub?target=clash&url=${urlEncode(mixedBasicData)}&exclude=${urlEncode('SS-SIP002')}`);
  assert('C++ exclude filter removes SS-SIP002', !rExc.body.includes('SS-SIP002'), `body still has SS-SIP002`);
}

console.log('\n=== TypeScript Worker Local Tests (http://127.0.0.1:8787) ===');
{
  const r = await fetchText(`${TS_LOCAL}/version`);
  assert('TS local GET /version 200', r.status === 200 && r.body.includes('v0.9.0'), `status=${r.status} body=${r.body.slice(0,30)}`);
  const r2 = await fetchText(`${TS_LOCAL}/sub?target=invalid&url=${urlEncode(mixedBasicData)}`);
  assert('TS local invalid target 400', r2.status === 400, `status=${r2.status}`);
  const r3 = await fetchText(`${TS_LOCAL}/sub?target=clash`);
  assert('TS local missing url 400', r3.status === 400, `status=${r3.status}`);
  const r4 = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(mixedBasicData)}`, { headers: { 'SubConverter-Request': '1' } });
  assert('TS local loop header 500', r4.status === 500, `status=${r4.status}`);
  const r5 = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(mixedBasicData)}`, { method: 'HEAD' });
  assert('TS local HEAD 200', r5.status === 200, `status=${r5.status}`);
  const r6 = await fetchText(`${TS_LOCAL}/sub`, { method: 'OPTIONS' });
  assert('TS local OPTIONS 200', r6.status === 200, `status=${r6.status}`);
}

const tsTargets = ['clash','clashr','surge','surfboard','mellow','ss','ssr','v2ray','trojan','mixed','quan','quanx','loon','ssd','singbox'];
for (const target of tsTargets) {
  const r = await fetchText(`${TS_LOCAL}/sub?target=${target}&url=${urlEncode(mixedBasicData)}`);
  assert(`TS local target ${target} 200`, r.status === 200 && r.body.length > 0, `status=${r.status} len=${r.body.length}`);
}

for (const [file, desc] of [['mixed-basic.txt','mixed'],['clash.yaml','clash'],['surge.ini','surge']]) {
  const data = makeDataUrl(mocks[file]);
  const r = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(data)}`);
  assert(`TS local clash with ${desc} 200`, r.status === 200 && r.body.length > 0, `status=${r.status} len=${r.body.length}`);
}

{
  const rInc = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(mixedBasicData)}&include=${urlEncode('SS-SIP002')}`);
  assert('TS local include keeps SS-SIP002', rInc.body.includes('SS-SIP002'), `missing`);
  const rExc = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(mixedBasicData)}&exclude=${urlEncode('SS-SIP002')}`);
  assert('TS local exclude removes SS-SIP002', !rExc.body.includes('SS-SIP002'), `still present`);
}

// Test base64 subscription (mixed-basic.b64 content without data: prefix, but via data: still)
{
  const b64content = readFileSync(path.join(mocksDir, 'mixed-basic.b64'), 'utf-8').trim();
  const dataUrlB64 = `data:text/plain;base64,${b64content}`;
  const r = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(dataUrlB64)}`);
  assert('TS local base64 subscription via data: 200', r.status === 200 && r.body.includes('SS-SIP002'), `status=${r.status}`);
  const rCpp = await fetchText(`${CPP_BASE}/sub?target=clash&url=${urlEncode(dataUrlB64)}`);
  assert('C++ base64 subscription via data: 200', rCpp.status === 200 && rCpp.body.includes('SS-SIP002'), `status=${rCpp.status}`);
}

console.log('\n=== TypeScript Worker Remote Tests (https://subconverter-worker.churnie.workers.dev) ===');
{
  const r = await fetchText(`${TS_REMOTE}/version`);
  assert('TS remote GET /version 200', r.status === 200 && r.body.includes('v0.9.0'), `status=${r.status} body=${r.body.slice(0,30)}`);
  const r2 = await fetchText(`${TS_REMOTE}/sub?target=clash&url=${urlEncode(mixedBasicData)}`);
  assert('TS remote clash mixed-basic 200', r2.status === 200 && r.body.includes('SS-SIP002'), `status=${r2.status}`);
  const r3 = await fetchText(`${TS_REMOTE}/sub?target=surge&ver=4&url=${urlEncode(mixedBasicData)}`);
  assert('TS remote surge 200', r3.status === 200 && r3.body.includes('DIRECT'), `status=${r3.status}`);
  for (const t of ['clash','surge','ss','v2ray']) {
    const r = await fetchText(`${TS_REMOTE}/sub?target=${t}&url=${urlEncode(ssData)}`);
    assert(`TS remote target ${t} 200`, r.status === 200, `status=${r.status}`);
  }
}

console.log('\n=== Parity Check (C++ vs TS local for mixed-basic clash) ===');
{
  const cpp = await fetchText(`${CPP_BASE}/sub?target=clash&url=${urlEncode(mixedBasicData)}`);
  const ts = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(mixedBasicData)}`);
  const cppHas = cpp.body.includes('SS-SIP002') && cpp.body.includes('VMess-WS-TLS');
  const tsHas = ts.body.includes('SS-SIP002') && ts.body.includes('VMess-WS-TLS');
  assert('Parity: both have SS and VMess nodes', cppHas && tsHas, `cppHas=${cppHas} tsHas=${tsHas} cppLen=${cpp.body.length} tsLen=${ts.body.length}`);
  // Check CORS headers present on both
  assert('Parity: CORS header present', cpp.headers['access-control-allow-origin'] === '*' && ts.headers['access-control-allow-origin'] === '*', `cpp=${cpp.headers['access-control-allow-origin']} ts=${ts.headers['access-control-allow-origin']}`);
}

console.log(`\n=== Summary: ${passed}/${total} passed, ${failed} failed ===`);
if (failures.length) {
  console.log('Failures:');
  for (const f of failures) console.log(` - ${f.name}: ${f.details}`);
  process.exit(1);
} else {
  console.log('All tests passed!');
}
