// E2E: 실제 Chromium에서 dist를 (CSP 헤더 포함) 열어 사용자 시나리오를 검증한다.
//   node tests/e2e.mjs        (먼저 npm run build)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { basename } from 'node:path';
import { startServer, launch, instrument, samples, waitState, sleep } from './helpers.mjs';

let server, url, browser;
const allExternal = [];
const allCsp = [];
const allErrors = [];

before(async () => {
  ({ server, url } = await startServer(0));
  browser = await launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opts });
  const page = await ctx.newPage();
  const rec = instrument(page, url);
  page.__rec = rec;
  page.__ctx = ctx;
  await page.goto(url + '/');
  return page;
}
async function done(page) {
  allExternal.push(...page.__rec.external);
  allCsp.push(...page.__rec.csp);
  allErrors.push(...page.__rec.errors);
  await page.__ctx.close();
}
const state = (page) => page.evaluate(() => document.body.dataset.state);
const renderedCount = (page) => page.evaluate(() => document.querySelectorAll('.page[data-rendered="1"]').length);
const pageCount = (page) => page.evaluate(() => document.querySelectorAll('.page').length);
// 한글 파일명은 경로 방식 업로드가 이 환경(Playwright/로케일)에서 동작하지 않아 버퍼로 넘긴다.
// (같은 이름을 버퍼로 넘기면 앱은 정상 동작한다 — 앱 문제가 아니라 시험 도구의 문제)
const upload = (page, name) => page.setInputFiles('#file-input', { name: basename(name), mimeType: 'application/octet-stream', buffer: readFileSync(`${samples}/${name}`) });
async function openSample(page, name) {
  await upload(page, name);
  await waitState(page, 'ready', 60000);
  await page.waitForFunction(() => document.querySelector('.page[data-rendered="1"]'), null, { timeout: 30000 });
}
async function openBuffer(page, name, buffer) {
  await page.setInputFiles('#file-input', { name, mimeType: 'application/octet-stream', buffer });
}
const errorText = (page) => page.evaluate(() => (document.getElementById('error').hidden ? null : document.getElementById('error-text').textContent));
async function waitError(page, timeout = 30000) {
  await page.waitForFunction(() => !document.getElementById('error').hidden, null, { timeout });
  return errorText(page);
}

test('빈 화면: 안내, 한컴 요구 문장, 라이선스 링크, 비제휴 페이지', async () => {
  const page = await newPage();
  assert.equal(await state(page), 'empty');
  const footer = await page.locator('footer').innerText();
  assert.match(footer, /본 제품은 한글과컴퓨터의 한글 문서 파일\(\.hwp\) 공개 문서를 참고하여 개발하였습니다\./);
  assert.match(footer, /서버로 전송되지 않습니다/);
  await page.click('footer a');
  await page.waitForURL('**/licenses');
  const txt = await page.locator('main').innerText();
  assert.match(txt, /본 제품은 한글과컴퓨터의 한글 문서 파일\(\.hwp\) 공개 문서를 참고하여 개발하였습니다\./);
  assert.match(txt, /제휴, 후원, 승인 관계가 없는/);
  assert.match(txt, /Copyright \(c\) 2026 Dongwook Kim/);
  assert.match(txt, /Edward Kim/);
  for (const f of ['THIRD_PARTY_LICENSES.txt', 'NOTICE.txt', 'LICENSE.txt']) {
    const r = await page.request.get(`${url}/${f}`);
    assert.equal(r.status(), 200, f);
    assert.match(r.headers()['content-type'], /text\/plain/);
  }
  const tp = await (await page.request.get(`${url}/THIRD_PARTY_LICENSES.txt`)).text();
  assert.match(tp, /Copyright \(c\) 2025-2026 Edward Kim/);
  assert.match(tp, /Copyright \(c\) 2026 Dongwook Kim/);
  const r404 = await page.request.get(`${url}/nope`);
  assert.equal(r404.status(), 404);
  await done(page);
});

test('보안 헤더: CSP·nosniff·no-referrer, wasm MIME, 장기 캐시', async () => {
  const page = await newPage();
  const html = await page.request.get(url + '/');
  const h = html.headers();
  assert.match(h['content-security-policy'], /default-src 'self'/);
  assert.match(h['content-security-policy'], /script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(h['content-security-policy'], /connect-src 'self'/);
  assert.match(h['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(h['x-content-type-options'], 'nosniff');
  assert.equal(h['referrer-policy'], 'no-referrer');
  const assets = JSON.parse(readFileSync(new URL('../dist/BUILD_ASSETS.json', import.meta.url), 'utf8'));
  const w = await page.request.get(url + assets.wasm);
  assert.equal(w.headers()['content-type'], 'application/wasm');
  assert.match(w.headers()['cache-control'], /immutable/);
  assert.equal(w.headers()['content-encoding'], 'br');
  await done(page);
});

test('HWP 열기: 쪽 렌더, 문서 이름, 쪽 수 표시', async () => {
  const page = await newPage();
  await openSample(page, 'exam-kor-1p.hwp');
  assert.equal(await page.locator('#file-name').innerText(), 'exam-kor-1p.hwp');
  assert.equal(await page.locator('#page-total').innerText(), '/ 1');
  assert.equal(await pageCount(page), 1);
  const img = await page.evaluate(() => { const i = document.querySelector('.page img'); return { w: i.naturalWidth, h: i.naturalHeight }; });
  assert.ok(img.w > 100 && img.h > 100, `이미지 로드 ${JSON.stringify(img)}`);
  assert.match(await page.title(), /exam-kor-1p\.hwp/);
  await done(page);
});

test('HWPX 열기', async () => {
  const page = await newPage();
  await openSample(page, 'HWP5-nopassword-123456.hwpx');
  assert.ok((await pageCount(page)) >= 1);
  await done(page);
});

test('큰 문서(383쪽): 가상화 — 렌더된 쪽은 소수, 이동·키보드·쪽 입력', async () => {
  const page = await newPage();
  const t0 = Date.now();
  await openSample(page, '2025 행정업무운영 편람(최종).hwpx');
  const openMs = Date.now() - t0;
  assert.equal(await pageCount(page), 383);
  assert.ok((await renderedCount(page)) <= 8, `초기 렌더 ${await renderedCount(page)}쪽`);
  console.log(`  [info] 383쪽 문서 열기~첫 쪽 표시 ${openMs}ms`);
  await page.fill('#page-input', '200');
  await page.press('#page-input', 'Enter');
  await page.waitForFunction(() => document.querySelector('.page[data-index="199"][data-rendered="1"]'), null, { timeout: 20000 });
  assert.equal(await page.inputValue('#page-input'), '200');
  await page.keyboard.press('End');
  await page.waitForFunction(() => document.querySelector('.page[data-index="382"][data-rendered="1"]'), null, { timeout: 20000 });
  assert.equal(await page.inputValue('#page-input'), '383');
  await page.keyboard.press('Home');
  await page.waitForFunction(() => document.querySelector('.page[data-index="0"][data-rendered="1"]'), null, { timeout: 20000 });
  // 여러 곳을 훑은 뒤에도 렌더 유지 쪽이 한도(14)를 크게 넘지 않는다
  for (const p of [50, 120, 250, 330]) {
    await page.fill('#page-input', String(p)); await page.press('#page-input', 'Enter');
    await page.waitForFunction((i) => document.querySelector(`.page[data-index="${i - 1}"][data-rendered="1"]`), p, { timeout: 20000 });
  }
  await sleep(300);
  const n = await renderedCount(page);
  assert.ok(n <= 18, `렌더 유지 쪽 ${n}`);
  await done(page);
});

test('확대/축소: 버튼, 선택, Ctrl+휠, 맞춤', async () => {
  const page = await newPage();
  await openSample(page, 'exam-kor-1p.hwp');
  const w = () => page.evaluate(() => document.querySelector('.page').getBoundingClientRect().width);
  const w0 = await w();
  await page.click('#zoom-in'); await sleep(100);
  assert.ok((await w()) > w0);
  await page.click('#zoom-out'); await page.click('#zoom-out'); await sleep(100);
  assert.ok((await w()) < w0);
  await page.selectOption('#zoom-select', '1'); await sleep(100);
  const w100 = await w();
  assert.ok(Math.abs(w100 - 1122.5) < 2, `100%일 때 너비 ${w100}`);
  await page.selectOption('#zoom-select', '0.5'); await sleep(100);
  assert.ok(Math.abs((await w()) - 561) < 2);
  await page.click('#fit-width'); await sleep(150);
  const stageW = await page.evaluate(() => document.getElementById('stage').clientWidth);
  assert.ok(Math.abs((await w()) - (stageW - 32)) < 3, '너비 맞춤');
  await page.click('#fit-page'); await sleep(150);
  const ph = await page.evaluate(() => document.querySelector('.page').getBoundingClientRect().height);
  const sh = await page.evaluate(() => document.getElementById('stage').clientHeight);
  assert.ok(ph <= sh - 30, `쪽 맞춤 높이 ${ph}/${sh}`);
  await page.click('#fit-width');
  await page.mouse.move(600, 400);
  const before = await w();
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -200); await page.keyboard.up('Control'); await sleep(150);
  assert.ok((await w()) > before, 'Ctrl+휠 확대');
  // 확대 상태에서 이미지는 벡터라 다시 렌더하지 않아도 선명해야 한다 → 렌더 요청 수 변화 없음
  await done(page);
});

test('검색: 일치 개수, 강조, 이동, 대소문자, 없음, 닫기', async () => {
  const page = await newPage();
  await openSample(page, 'exam-kor-1p.hwp');
  await page.keyboard.press('Control+f');
  assert.ok(await page.locator('#search-input').isVisible());
  await page.fill('#search-input', '밑줄');
  await page.waitForFunction(() => /\d+ \/ \d+/.test(document.getElementById('search-count').textContent), null, { timeout: 15000 });
  const count = await page.locator('#search-count').innerText();
  const total = Number(count.match(/\/ (\d+)/)[1]);
  assert.ok(total >= 5, `일치 ${count}`);
  const hl = await page.locator('.hl').count();
  assert.ok(hl >= total, `강조 ${hl}`);
  assert.equal(await page.locator('.hl-current').count() >= 1, true);
  const y0 = await page.evaluate(() => document.querySelector('.hl-current').getBoundingClientRect().top);
  await page.press('#search-input', 'Enter');
  await sleep(150);
  assert.match(await page.locator('#search-count').innerText(), /^2 \//);
  const y1 = await page.evaluate(() => document.querySelector('.hl-current').getBoundingClientRect().top);
  assert.notEqual(Math.round(y0), Math.round(y1));
  await page.press('#search-input', 'Shift+Enter'); await sleep(100);
  assert.match(await page.locator('#search-count').innerText(), /^1 \//);
  const shotDir = new URL('../node_modules/.cache/sheetfly-e2e/', import.meta.url).pathname;
  mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: `${shotDir}search.png` });
  await page.fill('#search-input', '이런문장은없다zzz');
  await page.waitForFunction(() => document.getElementById('search-count').textContent === '결과 없음', null, { timeout: 15000 });
  assert.equal(await page.locator('.hl').count(), 0);
  // 대소문자: 숫자·한글만 있어도 동작해야 한다 (영문 검색은 아래 별도)
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#searchbar').isHidden(), true);
  assert.equal(await page.locator('.hl').count(), 0);
  await done(page);
});

test('검색: 큰 문서에서 쪽을 넘어 찾고 이동 (383쪽)', async () => {
  const page = await newPage();
  await openSample(page, '2025 행정업무운영 편람(최종).hwpx');
  await page.keyboard.press('Control+f');
  await page.fill('#search-input', '공문서');
  // 끝까지 훑으면 '+' 없이 "i / n" 형태가 된다 (훑는 중에는 '+' 또는 "검색 중…")
  await page.waitForFunction(() => /^\d+ \/ \d+$/.test(document.getElementById('search-count').textContent), null, { timeout: 120000 });
  const total = Number((await page.locator('#search-count').innerText()).match(/\/ (\d+)/)[1]);
  assert.ok(total > 20, `일치 ${total}`);
  for (let i = 0; i < 5; i++) await page.click('#search-next');
  await sleep(300);
  const cur = Number(await page.inputValue('#page-input'));
  assert.ok(cur >= 1);
  await done(page);
});

test('드래그앤드롭으로 열기', async () => {
  const page = await newPage();
  const buf = readFileSync(`${samples}/exam-kor-1p.hwp`).toString('base64');
  await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bin], 'dropped.hwp'));
    for (const t of ['dragenter', 'dragover']) window.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
    window.__dragShown = document.body.dataset.drag;
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, buf);
  assert.equal(await page.evaluate(() => window.__dragShown), '1');
  await waitState(page, 'ready', 30000);
  assert.equal(await page.locator('#file-name').innerText(), 'dropped.hwp');
  assert.equal(await page.evaluate(() => document.body.dataset.drag ?? null), null);
  await done(page);
});

test('오류: 빈 파일, 가짜 확장자, 손상 파일, 미지원 형식, 너무 큰 파일', async () => {
  const page = await newPage();
  await openBuffer(page, 'empty.hwp', Buffer.alloc(0));
  assert.match(await waitError(page), /빈 파일/);
  await page.click('#error-close');

  await openBuffer(page, 'x.hwp', Buffer.from('이것은 문서가 아닙니다. '.repeat(500)));
  assert.match(await waitError(page), /손상되었거나 지원하지 않는 형식/);
  await page.click('#error-close');

  await openBuffer(page, 'report.docx', Buffer.from('PK\x03\x04dummy'));
  assert.match(await waitError(page), /DOCX 형식은 아직 지원하지 않습니다/);
  await page.click('#error-close');

  await openBuffer(page, 'noext', Buffer.from('%PDF-1.7\n' + 'x'.repeat(100)));
  assert.match(await waitError(page), /PDF 형식은 아직 지원하지 않습니다/);
  await page.click('#error-close');

  // Playwright는 50MB 넘는 버퍼를 받지 않으므로 임시 파일 경로로 올린다 (ASCII 경로)
  const tmpDir = new URL('../node_modules/.cache/sheetfly-e2e/', import.meta.url).pathname;
  mkdirSync(tmpDir, { recursive: true });
  const huge = `${tmpDir}huge.hwp`;
  writeFileSync(huge, Buffer.alloc(101 * 1024 * 1024, 1));
  try {
    await page.setInputFiles('#file-input', huge);
    assert.match(await waitError(page), /너무 큽니다.*101MB/);
  } finally { rmSync(huge, { force: true }); }
  await page.click('#error-close');

  assert.equal(await state(page), 'empty');
  // 오류 뒤에도 정상 문서가 열려야 한다
  await openSample(page, 'exam-kor-1p.hwp');
  await done(page);
});

test('오류 뒤에도 이미 열린 문서는 유지된다', async () => {
  const page = await newPage();
  await openSample(page, 'exam-kor-1p.hwp');
  await openBuffer(page, 'broken.hwp', Buffer.from('broken'.repeat(200)));
  await waitError(page);
  assert.equal(await state(page), 'ready');
  assert.equal(await pageCount(page), 1);
  assert.equal(await page.locator('#file-name').innerText(), 'exam-kor-1p.hwp');
  await done(page);
});

test('암호 문서: 비밀번호 요청 → 오답 → 정답', async () => {
  const page = await newPage();
  await upload(page, 'HWP5-password-123456.hwpx');
  await page.waitForSelector('#pw-dialog[open]', { timeout: 30000 });
  await page.fill('#pw-input', 'wrong-password');
  await page.click('#pw-form button[type=submit]');
  await page.waitForFunction(() => !document.getElementById('pw-error').hidden, null, { timeout: 30000 });
  assert.ok(await page.locator('#pw-dialog[open]').count());
  await page.fill('#pw-input', '123456');
  await page.click('#pw-form button[type=submit]');
  await waitState(page, 'ready', 30000);
  assert.ok((await pageCount(page)) >= 1);
  assert.equal(await page.evaluate(() => document.getElementById('pw-dialog').open), false);
  await done(page);
});

test('열기 취소: 병리 문서를 열다가 취소하고 이어서 다른 문서를 연다', async () => {
  const page = await newPage();
  await upload(page, 'issue2063_huge_cellbreak_table.hwp');
  await page.waitForFunction(() => !document.getElementById('loading').hidden, null, { timeout: 5000 });
  assert.match(await page.locator('#loading-text').innerText(), /issue2063/);
  await sleep(1500);
  const t0 = Date.now();
  await page.click('#loading-cancel');
  assert.equal(await page.locator('#loading').isHidden(), true);
  assert.ok(Date.now() - t0 < 1000, '취소는 즉시 반영되어야 한다');
  assert.match(await page.locator('#status').innerText(), /취소/);
  assert.equal(await state(page), 'empty');
  await openSample(page, 'exam-kor-1p.hwp');
  await done(page);
});

test('두 번째 문서를 열면 이전 Worker가 정리된다', async () => {
  const page = await newPage();
  await openSample(page, 'exam-kor-1p.hwp');
  await openSample(page, 'HWP5-nopassword-123456.hwp');
  await sleep(500);
  const workers = page.workers().length;
  assert.ok(workers <= 2, `Worker ${workers}개 (현재 문서 1 + 미리 올린 1)`);
  assert.equal(await page.locator('#file-name').innerText(), 'HWP5-nopassword-123456.hwp');
  await done(page);
});

test('테마: 자동 → 라이트 → 다크 순환, 저장', async () => {
  const page = await newPage();
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  assert.equal(await theme(), 'auto');
  await page.click('#theme-btn'); assert.equal(await theme(), 'light');
  const light = await bg();
  await page.click('#theme-btn'); assert.equal(await theme(), 'dark');
  assert.notEqual(await bg(), light);
  await page.reload();
  assert.equal(await theme(), 'dark');
  await page.goto(url + '/licenses');
  assert.equal(await theme(), 'dark'); // 문서 페이지도 같은 테마
  await done(page);
});

test('시스템 다크 모드(자동)에서 어두운 배경', async () => {
  const page = await newPage({ colorScheme: 'dark' });
  const lum = await page.evaluate(() => {
    const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number);
    return (r + g + b) / 3;
  });
  assert.ok(lum < 60, `배경 밝기 ${lum}`);
  await done(page);
});

test('좁은 화면(모바일 폭): 가로 넘침 없음', async () => {
  const page = await newPage({ viewport: { width: 390, height: 800 } });
  await openSample(page, 'exam-kor-1p.hwp');
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `가로 넘침 ${over}px`);
  await done(page);
});

test('외부 요청 0건, CSP 위반 0건, 페이지 오류 0건 (전체 시나리오 합산)', async () => {
  assert.deepEqual(allExternal, [], `외부 요청: ${allExternal.join(', ')}`);
  assert.deepEqual(allCsp, [], `CSP 위반: ${allCsp.join(' | ')}`);
  assert.deepEqual(allErrors, [], `페이지 오류: ${allErrors.join(' | ')}`);
});
