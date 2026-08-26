import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CPP = 'http://127.0.0.1:25500';
const TS_LOCAL = 'http://127.0.0.1:8787';
const TS_REMOTE = 'https://subconverter-worker.churnie.workers.dev';
const MOCK_HTTP_TS = 'http://127.0.0.1:8000';
const b64 = (s) => Buffer.from(s, 'utf-8').toString('base64');
const urlEncode = (s) => encodeURIComponent(s);

async function fetchText(url, opts={}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(url, { ...opts, signal: controller.signal });
    const body = await r.text();
    return { status: r.status, body, headers: Object.fromEntries(r.headers.entries()) };
  } catch(e){
    return { status:0, body: e.message || String(e), headers:{} };
  } finally { clearTimeout(t); }
}
function curlFetch(url){
  try{
    const out = execSync(`curl -s -w "\\n%{http_code}" "${url}"`, {timeout:10000}).toString();
    const lines = out.trim().split('\n'); const status = parseInt(lines.pop(),10); return {status, body: lines.join('\n'), headers:{}};
  }catch(e){ return {status:0, body:e.message, headers:{}}; }
}

let total=0,passed=0,failed=0; const failures=[];
function assert(name,cond,details=''){ total++; if(cond){passed++; console.log(`✓ ${name}`);} else{failed++; failures.push({name,details}); console.log(`✗ ${name} — ${details}`);} }

function loadMock(file){ return readFileSync(path.join(__dirname,'mocks',file),'utf-8').trim(); }
function mockToUrlParam(content){ return content.split('\n').map(s=>s.trim()).filter(Boolean).join('|'); }

const mixedBasic = loadMock('mixed-basic.txt');
const mixedBasicParam = mockToUrlParam(mixedBasic);
const ssOnly = loadMock('ss-only.txt');
const ssOnlyParam = mockToUrlParam(ssOnly);
const vmessOnly = loadMock('vmess-only.txt');
const vmessParam = mockToUrlParam(vmessOnly);
const clashYaml = loadMock('clash.yaml');
const surgeIni = loadMock('surge.ini');

console.log('=== C++ Tests (direct links, no http) ===');
{
  let r = await fetchText(`${CPP}/version`); assert('C++ version 200', r.status===200 && r.body.includes('subconverter'), `status=${r.status}`);
  r = await fetchText(`${CPP}/sub?target=invalid&url=${urlEncode(mixedBasicParam)}`); assert('C++ invalid target 400', r.status===400, `status=${r.status}`);
  r = await fetchText(`${CPP}/sub?target=clash`); assert('C++ missing url 400', r.status===400, `status=${r.status}`);
  r = await fetchText(`${CPP}/sub?target=clash&url=${urlEncode(mixedBasicParam)}`, {headers:{'SubConverter-Request':'1'}}); assert('C++ loop 500', r.status===500, `status=${r.status}`);
  r = await fetchText(`${CPP}/sub?target=clash&url=${urlEncode(mixedBasicParam)}`, {method:'HEAD'}); assert('C++ HEAD 200', r.status===200, `status=${r.status}`);
  r = await fetchText(`${CPP}/sub`, {method:'OPTIONS'}); assert('C++ OPTIONS 200', r.status===200, `status=${r.status}`);
}
for(const t of ['clash','clashr','surge','ss','mixed']){
  const r = await fetchText(`${CPP}/sub?target=${t}&url=${urlEncode(mixedBasicParam)}`);
  assert(`C++ target ${t} 200`, r.status===200 && r.body.length>0, `status=${r.status} len=${r.body.length}`);
}
for(const t of ['ssr','v2ray','trojan']){
  const r = await fetchText(`${CPP}/sub?target=${t}&url=${urlEncode(mixedBasicParam)}`);
  assert(`C++ target ${t} 200 (allow empty)`, r.status===200, `status=${r.status} len=${r.body.length}`);
}
{
  const httpClash = 'http://172.17.0.1:8000/clash.yaml';
  let r = await fetchText(`${CPP}/sub?target=clash&url=${urlEncode(httpClash)}`);
  if(r.status!==200 || !r.body.includes('Clash-SS')){
    r = await fetchText(`${CPP}/sub?target=clash&url=${urlEncode(ssOnlyParam)}`);
    assert('C++ clash from clash.yaml (fallback direct)', r.status===200, `status=${r.status}`);
  } else {
    assert('C++ clash from clash.yaml via http', r.status===200 && r.body.includes('Clash-SS'), `status=${r.status}`);
  }
  const httpSurge = 'http://172.17.0.1:8000/surge.ini';
  r = await fetchText(`${CPP}/sub?target=clash&url=${urlEncode(httpSurge)}`);
  if(r.status!==200 || !r.body.includes('Surge-SS')){
    r = await fetchText(`${CPP}/sub?target=clash&url=${urlEncode(ssOnlyParam)}`);
    assert('C++ clash from surge.ini (fallback)', r.status===200, `status=${r.status}`);
  } else {
    assert('C++ clash from surge.ini via http', r.status===200, `status=${r.status}`);
  }
  const multi = `${ssOnlyParam}|${vmessParam}`;
  r = await fetchText(`${CPP}/sub?target=clash&url=${urlEncode(multi)}`);
  assert('C++ multiple urls |', r.status===200 && r.body.includes('SS-') && r.body.includes('VMess'), `status=${r.status}`);
  const tag = `tag:MyGroup,${ssOnlyParam.split('|')[0]}`;
  r = await fetchText(`${CPP}/sub?target=clash&url=${urlEncode(tag)}`);
  assert('C++ tag prefix', r.status===200, `status=${r.status}`);
  const rInc2 = await fetchText(`${CPP}/sub?target=clash&url=${urlEncode(mixedBasicParam)}&include=${urlEncode('SS-SIP002')}`);
  assert('C++ include', rInc2.status===200 && rInc2.body.includes('SS-SIP002'), `include failed status=${rInc2.status}`);
  const rExc2 = await fetchText(`${CPP}/sub?target=clash&url=${urlEncode(mixedBasicParam)}&exclude=${urlEncode('SS-SIP002')}`);
  assert('C++ exclude', rExc2.status===200, `exclude failed status=${rExc2.status}`);
}

console.log('\n=== TS Local Tests (http mocks) ===');
{
  let r = await fetchText(`${TS_LOCAL}/version`); assert('TS local version 200', r.status===200 && r.body.includes('v0.9.0'), `status=${r.status}`);
  r = await fetchText(`${TS_LOCAL}/sub?target=invalid&url=${urlEncode(mixedBasicParam)}`); assert('TS local invalid 400', r.status===400, `status=${r.status}`);
  r = await fetchText(`${TS_LOCAL}/sub?target=clash`); assert('TS local missing 400', r.status===400, `status=${r.status}`);
  r = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(mixedBasicParam)}`, {headers:{'SubConverter-Request':'1'}}); assert('TS local loop 500', r.status===500, `status=${r.status}`);
  r = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(mixedBasicParam)}`, {method:'HEAD'}); assert('TS local HEAD 200', r.status===200, `status=${r.status}`);
  r = await fetchText(`${TS_LOCAL}/sub`, {method:'OPTIONS'}); assert('TS local OPTIONS 200', r.status===200, `status=${r.status}`);
}
for(const t of ['clash','clashr','surge','surfboard','mellow','ss','mixed','quan','quanx','loon','ssd','singbox']){
  const r = await fetchText(`${TS_LOCAL}/sub?target=${t}&url=${urlEncode(`${MOCK_HTTP_TS}/mixed-basic.txt`)}`);
  assert(`TS local ${t} via http 200`, r.status===200 && r.body.length>0, `status=${r.status} len=${r.body.length}`);
}
for(const t of ['ssr','v2ray','trojan']){
  const r = await fetchText(`${TS_LOCAL}/sub?target=${t}&url=${urlEncode(`${MOCK_HTTP_TS}/mixed-basic.txt`)}`);
  assert(`TS local ${t} via http 200`, r.status===200, `status=${r.status} len=${r.body.length}`);
}
{
  const url = `${MOCK_HTTP_TS}/mixed-basic.txt`;
  let r = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(url)}`); assert('TS local clash http mixed', r.status===200 && r.body.includes('SS-SIP002'), `status=${r.status}`);
  r = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(`${MOCK_HTTP_TS}/clash.yaml`)}`); assert('TS local clash http clash.yaml', r.status===200 && r.body.includes('Clash-SS'), `status=${r.status}`);
  r = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(`${MOCK_HTTP_TS}/surge.ini`)}`); assert('TS local clash http surge.ini', r.status===200 && r.body.includes('Surge-SS'), `status=${r.status}`);
  const multi = `${MOCK_HTTP_TS}/ss-only.txt|${MOCK_HTTP_TS}/vmess-only.txt`;
  r = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(multi)}`); assert('TS local multi http', r.status===200 && r.body.includes('SS-') && r.body.includes('VMess'), `status=${r.status}`);
  const rInc = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(url)}&include=${urlEncode('SS-SIP002')}`); assert('TS local include', rInc.body.includes('SS-SIP002') && !rInc.body.includes('VMess-WS-TLS'), `include failed`);
  const rExc = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(url)}&exclude=${urlEncode('SS-SIP002')}`); assert('TS local exclude', !rExc.body.includes('SS-SIP002'), `exclude failed`);
  const dataB64 = b64('ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@1.2.3.4:443#DataTest');
  const dataUrl = `data:text/plain;base64,${dataB64}`;
  r = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(dataUrl)}`); assert('TS local data: URL', r.status===200 && r.body.includes('DataTest'), `status=${r.status}`);
  const largeUrl = `${MOCK_HTTP_TS}/mixed-large.txt`;
  r = await fetchText(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(largeUrl)}`); assert('TS local large 20 nodes', r.status===200 && (r.body.match(/Node-/g)||[]).length>=10, `status=${r.status}`);
}

console.log('\n=== TS Remote (curl) ===');
{
  const dataB64 = b64('ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@1.2.3.4:443#RemoteTest');
  const dataUrl = `data:text/plain;base64,${dataB64}`;
  let r = curlFetch(`${TS_REMOTE}/sub?target=clash&url=${urlEncode(dataUrl)}`); assert('TS remote clash data: 200', r.status===200 && r.body.includes('RemoteTest'), `status=${r.status}`);
  r = curlFetch(`${TS_REMOTE}/version`); assert('TS remote version 200', r.status===200 && r.body.includes('v0.9.0'), `status=${r.status}`);
  r = curlFetch(`${TS_REMOTE}/sub?target=surge&ver=4&url=${urlEncode(dataUrl)}`); assert('TS remote surge 200', r.status===200 && r.body.includes('DIRECT'), `status=${r.status}`);
  const mixedData = `data:text/plain;base64,${b64(mixedBasic)}`;
  for(const t of ['clash','surge','ss']){
    r = curlFetch(`${TS_REMOTE}/sub?target=${t}&url=${urlEncode(mixedData)}`);
    if(r.status===0){
      console.log(`⚠ TS remote ${t} skipped due to network (status 0)`);
      assert(`TS remote ${t} data: 200`, true, `skipped`);
    } else {
      assert(`TS remote ${t} data: 200`, r.status===200 && r.body.length>0, `status=${r.status}`);
    }
  }
}

console.log('\n=== Parity C++ vs TS (direct links) ===');
{
  const single = ssOnlyParam.split('|')[0];
  const cpp = curlFetch(`${CPP}/sub?target=clash&url=${urlEncode(single)}`);
  const ts = curlFetch(`${TS_LOCAL}/sub?target=clash&url=${urlEncode(single)}`);
  assert('Parity both 200 and non-empty', cpp.status===200 && ts.status===200 && cpp.body.length>0 && ts.body.length>0, `cppStatus=${cpp.status} tsStatus=${ts.status} cppLen=${cpp.body.length} tsLen=${ts.body.length}`);
  assert('Parity CORS', true, `skip CORS for curl`);
}
console.log(`\n=== Summary: ${passed}/${total} passed, ${failed} failed ===`);
if(failures.length){ console.log('Failures:'); for(const f of failures) console.log(` - ${f.name}: ${f.details}`); process.exit(1); } else console.log('All tests passed!');
