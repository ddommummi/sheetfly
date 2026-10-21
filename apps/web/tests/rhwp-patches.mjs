// rhwp 패치(tools/rhwp-patches/) 회귀 시험: 패치가 실제로 빌드에 들어갔는지, 그리고 패치가 고치기로 한 모양이 나오는지 본다.
//   0001 저장된 줄 높이보다 큰 "글자처럼 취급" 그림 — issue5169_viewtext_changetracking.hwp(rhwp 샘플) 3쪽에서
//        로고 그림이 아래 제목 글자("1. 연구의 필요성 및 목적")와 겹치면 안 된다(패치 없으면 로고 바닥이 제목 기준선보다 아래).
// 샘플이 없으면(RHWP_SAMPLES=1이 아닌 체크아웃) 건너뛴다. 사전: npm run build:wasm && npm run build
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { startServer, launch, instrument, samples, web } from './helpers.mjs';

const info = JSON.parse(readFileSync(join(web, 'src/wasm/BUILD_INFO.json'), 'utf8'));
assert.ok(Array.isArray(info.rhwpPatches) && info.rhwpPatches.length >= 1, 'BUILD_INFO에 적용된 rhwp 패치가 없다 — RHWP_PATCHES=0으로 빌드했거나 build-wasm.sh가 패치를 얹지 않았다');
console.log('패치:', info.rhwpPatches.map((p) => p.name).join(', '));

const file = join(samples, 'issue5169_viewtext_changetracking.hwp');
if (!existsSync(file)) { console.log('샘플 없음 — 건너뜀 (RHWP_SAMPLES=1 scripts/fetch-rhwp.sh)'); process.exit(0); }

const { server, url } = await startServer(0);
const browser = await launch();
const page = await browser.newPage();
const rec = instrument(page, url);
await page.goto(url + '/');
let buf = readFileSync(file);
await page.route(`${url}/__doc`, (route) => route.fulfill({ status: 200, contentType: 'application/octet-stream', body: buf }));
// 앱과 같은 Worker 코드를 직접 구동해 3쪽 SVG 글을 받는다(화면 이미지는 CSP 때문에 내용을 읽을 수 없다).
const m = await page.evaluate(async () => {
  const w = new Worker(document.querySelector('meta[name="sheetfly-worker"]').content, { type: 'module' });
  let id = 1; const pending = new Map();
  w.onmessage = (e) => { const r = e.data; const p = pending.get(r.id); if (p) { pending.delete(r.id); p(r); } };
  const req = (type, payload = {}, transfer = []) => new Promise((res) => { const i = id++; pending.set(i, res); w.postMessage({ type, id: i, ...payload }, transfer); });
  try {
    let r = await req('init', { wasmUrl: document.querySelector('meta[name="sheetfly-wasm"]').content });
    if (!r.ok) throw new Error(r.error.message);
    const ab = await (await fetch('/__doc')).arrayBuffer();
    r = await req('open', { buffer: ab }, [ab]);
    if (!r.ok) throw new Error(r.error.message);
    r = await req('render', { page: 2 });
    if (!r.ok) throw new Error(r.error.message);
    const svg = new DOMParser().parseFromString(new TextDecoder().decode(r.svg), 'image/svg+xml');
    const imgs = [...svg.querySelectorAll('image')].map((e) => +e.getAttribute('y') + +e.getAttribute('height'));
    const heading = [...svg.querySelectorAll('text')].find((t) => t.textContent.trim());
    return { logoBottom: Math.max(...imgs), headingBaseline: +heading.getAttribute('y') };
  } finally { w.terminate(); }
});
console.log(`로고 바닥 ${m.logoBottom.toFixed(1)}px, 제목 기준선 ${m.headingBaseline.toFixed(1)}px`);
assert.ok(m.headingBaseline >= m.logoBottom + 15, `로고가 제목과 겹친다 (바닥 ${m.logoBottom}, 기준선 ${m.headingBaseline})`);
assert.deepEqual(rec.errors, []);
await browser.close(); server.close();
console.log('ok');
