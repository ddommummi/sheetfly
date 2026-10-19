// E2E(DOCX): 시험이 직접 만든 DOCX를 실제 Chromium에서 (CSP 헤더 포함) 열어 사용자 시나리오를 검증한다.
//   node tests/e2e-docx.mjs        (먼저 npm run build)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startServer, launch, instrument, samples, waitState, sleep } from './helpers.mjs';
import { makeDocx, p, pageBreak, table } from './docx-fixtures.mjs';

let server, url, browser;
const allExternal = [];
const allCsp = [];
const allErrors = [];

before(async () => { ({ server, url } = await startServer(0)); browser = await launch(); });
after(async () => { await browser?.close(); server?.close(); });

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.__rec = instrument(page, url);
  page.__ctx = ctx;
  await page.goto(url + '/');
  return page;
}
async function done(page) {
  allExternal.push(...page.__rec.external); allCsp.push(...page.__rec.csp); allErrors.push(...page.__rec.errors);
  await page.__ctx.close();
}
const state = (page) => page.evaluate(() => document.body.dataset.state);
const pageCount = (page) => page.evaluate(() => document.querySelectorAll('.page').length);
const send = (page, name, buffer) => page.setInputFiles('#file-input', { name, mimeType: 'application/octet-stream', buffer });
async function openDocx(page, name, buffer) {
  await send(page, name, buffer);
  await waitState(page, 'ready', 60000);
  await page.waitForFunction(() => document.querySelector('.page[data-rendered="1"]'), null, { timeout: 30000 });
}
const errorText = (page) => page.evaluate(() => (document.getElementById('error').hidden ? null : document.getElementById('error-text').textContent));
async function waitError(page, timeout = 30000) {
  await page.waitForFunction(() => !document.getElementById('error').hidden, null, { timeout });
  return errorText(page);
}
const KO = '대한민국은 민주공화국이다. 대한민국의 주권은 국민에게 있고, 모든 권력은 국민으로부터 나온다. ';

test('DOCX 한 쪽: 열기, 쪽 수, 안내 문구, 쪽 크기(A4)', async () => {
  const page = await newPage();
  assert.equal(await page.locator('#doc-note').isHidden(), true);
  await openDocx(page, '보고서.docx', makeDocx(p('Hello 제목', { heading: 1 }) + p('본문입니다. Hello world. ' + KO)));
  assert.equal(await pageCount(page), 1);
  assert.match(await page.locator('#page-total').innerText(), /1/);
  assert.equal(await page.locator('#doc-note').isVisible(), true);
  assert.match(await page.locator('#doc-note').innerText(), /Word와 쪽 경계가 다를 수 있습니다/);
  assert.equal(await page.locator('#file-name').innerText(), '보고서.docx');
  // A4(11906x16838 twips = 793.7x1122.5px): 쪽 상자 크기가 같은 비율이어야 한다
  const ratio = await page.evaluate(() => { const r = document.querySelector('.page').getBoundingClientRect(); return r.height / r.width; });
  assert.ok(Math.abs(ratio - 16838 / 11906) < 0.01, `비율 ${ratio}`);
  await done(page);
});

test('DOCX 여러 쪽: 쪽 나눔, 쪽 이동, 가상화(렌더 쪽 수 제한)', async () => {
  const page = await newPage();
  const body = Array.from({ length: 160 }, (_, i) => p(`${i + 1}번째 문단. ${KO}${KO}`)).join('');
  await openDocx(page, 'long.docx', makeDocx(body));
  const n = await pageCount(page);
  assert.ok(n >= 4, `쪽 수 ${n}`);
  await page.fill('#page-input', String(n)); await page.press('#page-input', 'Enter');
  await page.waitForFunction((last) => document.querySelectorAll('.page')[last - 1]?.dataset.rendered === '1', n, { timeout: 15000 });
  const rendered = await page.evaluate(() => document.querySelectorAll('.page[data-rendered="1"]').length);
  assert.ok(rendered <= 14, `렌더된 쪽 ${rendered}`);
  await done(page);
});

test('DOCX 강제 쪽 나누기와 표·제목', async () => {
  const page = await newPage();
  const body = p('1쪽', { heading: 1 }) + table([['이름', '값'], ['가나다', '1'], ['Hello', '2']]) + pageBreak + p('2쪽 내용') + pageBreak + p('3쪽 내용');
  await openDocx(page, 'breaks.docx', makeDocx(body));
  assert.ok((await pageCount(page)) >= 3);
  await done(page);
});

test('DOCX 검색: 한글·영문, 대소문자, 쪽을 넘어 찾기, 없음', async () => {
  const page = await newPage();
  const body = p('Alpha beta gamma') + p('한글 문서 검색 시험') + pageBreak + p('두 번째 쪽의 ALPHA 와 한글') + pageBreak + p('세 번째 쪽에도 alpha');
  await openDocx(page, 's.docx', makeDocx(body));
  await page.keyboard.press('Control+f');
  await page.fill('#search-input', 'alpha');
  await page.waitForFunction(() => /\d+ \/ \d+/.test(document.getElementById('search-count').textContent), null, { timeout: 15000 });
  assert.match(await page.locator('#search-count').innerText(), /\/ 3$/);       // 대소문자 무시: Alpha, ALPHA, alpha
  assert.ok((await page.locator('.hl').count()) >= 1);
  await page.check('#search-case');
  await page.waitForFunction(() => /^1 \/ 1$/.test(document.getElementById('search-count').textContent), null, { timeout: 15000 });
  await page.uncheck('#search-case');
  await page.fill('#search-input', '한글');
  await page.waitForFunction(() => /\/ 2$/.test(document.getElementById('search-count').textContent), null, { timeout: 15000 });
  await page.fill('#search-input', '없는말zzz');
  await page.waitForFunction(() => document.getElementById('search-count').textContent === '결과 없음', null, { timeout: 15000 });
  await done(page);
});

test('DOCX 오류: 손상(잘린 ZIP), 암호(OLE), 가짜 DOCX 뒤에도 정상 문서가 열린다', async () => {
  const page = await newPage();
  const good = makeDocx(p('정상 문서'));
  await send(page, 'cut.docx', good.subarray(0, Math.floor(good.length / 2)));
  assert.match(await waitError(page), /손상되었거나 지원하지 않는 형식/);
  await page.click('#error-close');

  const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(600)]);
  await send(page, 'locked.docx', ole);
  assert.match(await waitError(page), /암호가 걸린 DOCX/);
  await page.click('#error-close');

  await send(page, 'fake.docx', Buffer.from('docx가 아닌 글자 '.repeat(200)));
  assert.match(await waitError(page), /손상되었거나 지원하지 않는 형식/);
  await page.click('#error-close');

  assert.equal(await state(page), 'empty');
  await openDocx(page, 'ok.docx', good);
  await done(page);
});

test('DOCX 다음 HWP 열기: 안내 문구가 사라지고 서로 다른 엔진이 번갈아 동작한다', async () => {
  const page = await newPage();
  await openDocx(page, 'a.docx', makeDocx(p('DOCX 문서')));
  assert.equal(await page.locator('#doc-note').isVisible(), true);
  await send(page, 'exam-kor-1p.hwp', readFileSync(`${samples}/exam-kor-1p.hwp`));
  await page.waitForFunction(() => document.getElementById('file-name').textContent === 'exam-kor-1p.hwp', null, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('.page[data-rendered="1"]'), null, { timeout: 30000 });
  assert.equal(await page.locator('#doc-note').isHidden(), true);
  await send(page, 'b.docx', makeDocx(p('다시 DOCX')));
  await page.waitForFunction(() => document.getElementById('file-name').textContent === 'b.docx', null, { timeout: 60000 });
  assert.equal(await page.locator('#doc-note').isVisible(), true);
  await done(page);
});

test('확장자 없는 DOCX도 ZIP 안의 word/document.xml로 알아본다', async () => {
  const page = await newPage();
  await openDocx(page, 'noext', makeDocx(p('확장자 없음')));
  assert.equal(await page.locator('#doc-note').isVisible(), true);
  await done(page);
});

test('외부 요청 0건, CSP 위반 0건, 페이지 오류 0건 (DOCX 전체 시나리오 합산)', async () => {
  assert.deepEqual(allExternal, [], `외부 요청: ${allExternal.join(', ')}`);
  assert.deepEqual(allCsp, [], `CSP 위반: ${allCsp.join(' | ')}`);
  assert.deepEqual(allErrors, [], `페이지 오류: ${allErrors.join(' | ')}`);
});
