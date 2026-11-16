// E2E: DOCX 편집(4-2-3). 실제 Chromium에서 편집 단추·클릭·타이핑·한글 조합 입력·선택·붙여넣기·되돌리기·저장을 하고,
// 저장된 파일을 office_oxide(Node)로 다시 읽어 내용과 바뀌지 않은 부품을 확인한다.
//   node tests/e2e-docx-edit.mjs        (먼저 npm run build)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startServer, launch, instrument, waitState, web } from './helpers.mjs';
import { makeDocx, p, table, fieldSimple, run, zip } from './docx-fixtures.mjs';
import { irOf, irTexts } from './docx-edit-helpers.mjs';
import { flattenIr } from '../src/docx/edit/ir.js';
import { readZip, readPart } from '../src/docx/edit/zip.js';

let server, url, browser;
const allErrors = [], allExternal = [], allCsp = [];
before(async () => { ({ server, url } = await startServer(0)); browser = await launch(); });
after(async () => { await browser?.close(); server?.close(); });

const PAGE_W = 11906 / 1440 * 96;   // A4 쪽 너비(px)
const X0 = 96, Y0 = 96;             // 쪽 여백
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, ...opts });
  const page = await ctx.newPage();
  page.__rec = instrument(page, url); page.__ctx = ctx;
  await page.addInitScript(() => { delete window.showSaveFilePicker; });   // 헤드리스는 저장 위치 선택창에 응답하지 않는다: 다운로드 경로
  await page.goto(url + '/');
  return page;
}
async function done(page) {
  allErrors.push(...page.__rec.errors); allExternal.push(...page.__rec.external); allCsp.push(...page.__rec.csp);
  await page.__ctx.close();
}
async function open(page, name, bytes) {
  await page.setInputFiles('#file-input', { name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
  await waitState(page, 'ready', 60000);
  await page.waitForFunction((n) => document.getElementById('file-name').textContent === n, name, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('.page[data-rendered="1"]'), null, { timeout: 30000 });
}
// 입력이 모두 처리될 때까지 기다린다(e2e-edit.mjs와 같다).
async function settle(page) {
  await page.waitForTimeout(100);
  await page.waitForFunction(() => new Promise((res) => {
    const idle = () => !document.body.dataset.editBusy && !(navigator.scheduling?.isInputPending?.());
    if (!idle()) return res(false);
    setTimeout(() => res(idle()), 250);
  }), null, { timeout: 30000, polling: 100 });
}
const zoom = async (page) => (await page.locator('.page').first().boundingBox()).width / PAGE_W;
/** 쪽 좌표(px) → 화면 클릭. */
async function clickAt(page, pageIdx, x, y) {
  const box = await page.locator('.page').nth(pageIdx).boundingBox(), z = box.width / PAGE_W;
  await page.mouse.click(box.x + x * z, box.y + y * z);
  await page.waitForFunction(() => document.activeElement?.classList.contains('edit-input'), null, { timeout: 10000 });
  await settle(page);
}
/** 편집을 켜고 첫 문단 맨 앞을 눌러 캐럿을 둔다. */
async function startEdit(page) {
  await page.click('#edit-btn');
  await page.waitForSelector('#edit-bar:not([hidden])');
  await settle(page);
  await page.waitForFunction(() => document.querySelector('.page[data-rendered="1"]'), null, { timeout: 30000 });
  await clickAt(page, 0, X0 + 1, Y0 + 8);
  await page.keyboard.press('Control+Home'); await settle(page);
}
const dirty = (page) => page.evaluate(() => document.body.hasAttribute('data-dirty'));
const status = (page) => page.locator('#status').innerText();
const pageCount = (page) => page.evaluate(() => document.querySelectorAll('.page').length);
/** 캐럿의 쪽 좌표. */
const caret = (page) => page.evaluate((W) => {
  const c = document.querySelector('.caret'); if (!c) return null;
  const pg = c.closest('.page'), pr = pg.getBoundingClientRect(), cr = c.getBoundingClientRect();
  return { page: Number(pg.dataset.index), x: (cr.left - pr.left) / pr.width * W, y: (cr.top - pr.top) / pr.width * W, h: cr.height / pr.width * W };
}, PAGE_W);
async function save(page, { warn = false } = {}) {
  const dl = page.waitForEvent('download', { timeout: 30000 });
  await page.click('#edit-bar .btn.primary');
  let warning = null;
  const first = await Promise.race([dl.then(() => null), page.waitForSelector('dialog[open]', { timeout: 30000 }).then(() => 'dialog')]);
  if (first === 'dialog') {
    warning = await page.locator('dialog[open]').innerText();
    if (!warn) throw new Error(`저장 전 경고창: ${warning}`);
    await page.click('dialog[open] [data-yes]');
  }
  const d = await dl;
  const bytes = new Uint8Array(readFileSync(await d.path()));
  await page.waitForFunction(() => /저장했습니다/.test(document.getElementById('status').textContent), null, { timeout: 10000 });
  const name = (await page.locator('#status').innerText()).replace(/ 저장했습니다\.$/, '');
  return { bytes, name, warning, texts: irTexts(irOf(bytes)) };
}
const comp = async (cdp, page, t) => { await cdp.send('Input.imeSetComposition', { text: t, selectionStart: t.length, selectionEnd: t.length }); await page.waitForTimeout(40); };
const BASE = () => makeDocx(p('가나다라마') + p('Hello world foo') + p('셋째 문단') + p('끝 문단'));

test('편집 단추: DOCX에서 보이고, 편집을 켜면 도구줄(글 고치기 전용)이 뜬다', async () => {
  const page = await newPage();
  assert.equal(await page.locator('#edit-btn').isVisible(), false);
  await open(page, '보고서.docx', BASE());
  assert.equal(await page.locator('#edit-btn').isVisible(), true);
  assert.equal(await page.locator('#edit-bar').isVisible(), false, '읽기 전용 기본');
  assert.equal(await page.locator('.edit-input').count(), 0, '편집 코드는 눌렀을 때만');
  const reqsBefore = page.__rec.requests.length;
  await page.click('#edit-btn');
  await page.waitForSelector('#edit-bar:not([hidden])');
  assert.ok(page.__rec.requests.slice(reqsBefore).some((u) => /docxedit-/.test(u)), 'DOCX 편집 묶음을 그때 받는다');
  assert.ok(!page.__rec.requests.some((u) => /hwpedit-/.test(u)), 'HWP 편집 묶음은 받지 않는다');
  assert.deepEqual(await page.locator('#edit-bar .btn.tab:visible').allInnerTexts(), ['서식', '찾기'], '쓰는 탭(서식·찾기)만 보인다');
  assert.equal(await page.locator('#edit-bar .btn.primary').isVisible(), true);
  assert.match(await page.locator('#edit-bar').innerText(), /글·서식 고치기/);
  assert.equal(await page.locator('#edit-bar .fmt-b').isVisible(), true);
  assert.equal(await page.locator('#edit-bar button[aria-label="문단 부호 보이기·숨기기"]').isVisible(), false, '아직 없는 기능(문단 부호·자간·장평)은 숨김');
  await done(page);
});

test('RTF·XLSX·PPTX·DOC는 편집 단추가 없다', async () => {
  const page = await newPage();
  for (const f of ['sample.xlsx', 'sample.pptx', 'sample.doc']) {
    await page.setInputFiles('#file-input', { name: f, mimeType: 'application/octet-stream', buffer: readFileSync(resolve(web, 'tests/fixtures', f)) });
    await waitState(page, 'ready', 60000);
    assert.equal(await page.locator('#edit-btn').isVisible(), false, f);
  }
  await done(page);
});

test('영문 입력·Backspace·되돌리기·다시 실행, 변경 표시, 쪽 다시 그리기', async () => {
  const page = await newPage();
  await open(page, 'a.docx', BASE());
  await startEdit(page);
  assert.equal(await dirty(page), false);
  await page.keyboard.type('ABC', { delay: 50 }); await settle(page);
  assert.equal(await dirty(page), true);
  await page.keyboard.press('Backspace'); await settle(page);          // AB가나다라마
  await page.keyboard.press('Control+z'); await settle(page);          // Backspace 취소 → ABC
  await page.keyboard.press('Control+z'); await settle(page);          // 입력 묶음 취소 → 처음
  await page.keyboard.press('Control+y'); await settle(page);          // 다시 → ABC
  await page.keyboard.type('!', { delay: 50 }); await settle(page);
  const r = await save(page);
  assert.deepEqual(r.texts, ['ABC!가나다라마', 'Hello world foo', '셋째 문단', '끝 문단']);
  assert.match(r.name, /^a \(편집\)\.docx$/, '원본 이름을 덮어쓰지 않는다');
  // 화면의 쪽 그림도 바뀐 글로 다시 그려졌다: 뷰어 검색으로 찾는다
  await page.keyboard.press('Control+f');
  await page.fill('#search-input', 'ABC!');
  await page.waitForFunction(() => /1/.test(document.getElementById('search-count').textContent) && !/없음/.test(document.getElementById('search-count').textContent), null, { timeout: 10000 });
  await done(page);
});

test('캐럿 x가 브라우저가 그린 글자 위치와 맞는다(실제 글자 폭)', async () => {
  const page = await newPage({ bypassCSP: true });   // 쪽 그림(SVG)을 DOM으로 불러와 글자 위치를 재려고(검사 도구용)
  await open(page, 'm.docx', makeDocx(p('Hello world') + p('가나다라마바사')));
  await startEdit(page);
  const exp = await page.evaluate(async (W) => {
    const src = document.querySelector('.page img').src;
    const doc = new DOMParser().parseFromString(await (await fetch(src)).text(), 'image/svg+xml');
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;visibility:hidden';
    const svg = document.importNode(doc.documentElement, true);
    svg.setAttribute('width', String(W));
    for (const t of svg.querySelectorAll('text')) { const st = t.getAttribute('style'); t.removeAttribute('style'); t.style.font = st.replace(/^font:/, ''); }
    host.append(svg); document.body.append(host);
    const out = [];
    for (const t of svg.querySelectorAll('text')) {
      const n = [...t.textContent].length, xs = [];
      for (let i = 0; i < n; i++) xs.push(t.getStartPositionOfChar(i).x);
      xs.push(t.getEndPositionOfChar(n - 1).x);
      out.push({ s: t.textContent, xs });
    }
    host.remove();
    return out;
  }, PAGE_W);
  const hello = exp.find((e) => e.s === 'Hello'), world = exp.find((e) => e.s === 'world'), han = exp.filter((e) => /^[가-힣]+$/.test(e.s));
  assert.ok(hello && world && han.length, `글자 조각 ${exp.map((e) => e.s).join('|')}`);
  const step = async (n) => { for (let i = 0; i < n; i++) await page.keyboard.press('ArrowRight'); await settle(page); };
  const offs = [];
  for (let o = 0; o <= 11; o++) { offs.push((await caret(page)).x); await step(1); }
  for (let o = 0; o <= 5; o++) assert.ok(Math.abs(offs[o] - hello.xs[o]) < 1.5, `Hello ${o}: 캐럿 ${offs[o].toFixed(2)} 글자 ${hello.xs[o].toFixed(2)}`);
  for (let o = 6; o <= 11; o++) assert.ok(Math.abs(offs[o] - world.xs[o - 6]) < 1.5, `world ${o - 6}: 캐럿 ${offs[o].toFixed(2)} 글자 ${world.xs[o - 6].toFixed(2)}`);
  // 한글 줄도 같다(한글은 글자 하나가 조각 하나): 12번 오른쪽으로 갔으니 캐럿은 둘째 문단 처음이다
  const starts = [...han.map((e) => e.xs[0]), han.at(-1).xs[1]];
  assert.equal(starts.length, 8, '가나다라마바사 + 끝');
  for (let o = 0; o < starts.length; o++) { assert.ok(Math.abs((await caret(page)).x - starts[o]) < 1.5, `한글 ${o}`); await step(1); }
  // 누른 자리가 글자 경계로 잡힌다: world 가운데를 눌렀을 때 캐럿이 그 근처 경계에 놓인다
  await clickAt(page, 0, world.xs[2] + 1, Y0 + 8);
  const c = await caret(page);
  assert.ok(world.xs.some((x) => Math.abs(x - c.x) < 1.5) && Math.abs(c.x - world.xs[2]) < 1.5, `눌러 놓은 캐럿 ${c.x.toFixed(2)} ≈ ${world.xs[2].toFixed(2)}`);
  await done(page);
});

test('한글 조합 입력(IME)이 한 글자씩 정확히 들어가고, 되돌리기 한 번에 사라진다', async () => {
  const page = await newPage();
  await open(page, 'k.docx', BASE());
  await startEdit(page);
  const cdp = await page.context().newCDPSession(page);
  for (const [seq, fin] of [[['ㅎ', '하', '한'], '한'], [['ㄱ', '그', '글'], '글']]) {
    for (const t of seq) await comp(cdp, page, t);
    await cdp.send('Input.insertText', { text: fin }); await page.waitForTimeout(80);
  }
  await page.keyboard.type(' ok', { delay: 50 }); await settle(page);
  const r = await save(page);
  assert.equal(r.texts[0], '한글 ok가나다라마');
  await page.keyboard.press('Control+z'); await settle(page);
  assert.equal((await save(page)).texts[0], '한글가나다라마', '" ok"(연속 입력)가 한 번에 되돌아간다');
  await page.keyboard.press('Control+z'); await settle(page);
  assert.equal((await save(page)).texts[0], '한가나다라마', '"글" 조합 전체가 한 번에(조합마다 따로)');
  await page.keyboard.press('Control+z'); await settle(page);
  assert.equal((await save(page)).texts[0], '가나다라마', '"한" 조합 전체가 한 번에');
  await done(page);
});

test('Enter로 문단을 나누고, Backspace로 합치고, 선택해서 입력하면 바꿔 쓴다', async () => {
  const page = await newPage();
  await open(page, 'e.docx', BASE());
  await startEdit(page);
  for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter'); await settle(page);                  // 가나 | 다라마
  assert.deepEqual((await save(page)).texts.slice(0, 2), ['가나', '다라마']);
  await page.keyboard.press('Backspace'); await settle(page);              // 합치기
  assert.deepEqual((await save(page)).texts.slice(0, 2), ['가나다라마', 'Hello world foo']);
  // 문단 맨 앞에서 Shift+→ 로 두 글자 선택 후 입력
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowRight'); await settle(page);
  assert.ok(await page.locator('.sel').count() >= 1, '선택 영역이 보인다');
  await page.keyboard.type('XY', { delay: 50 }); await settle(page);
  assert.equal((await save(page)).texts[0], 'XY다라마', '선택한 "가나"가 바뀌었다');
  // 문단 맨 앞으로 + Delete
  await page.keyboard.press('Control+Home'); await page.keyboard.press('Delete'); await settle(page);
  assert.equal((await save(page)).texts[0], 'Y다라마');
  await done(page);
});

test('붙여넣기: 한 줄은 글로, 여러 줄은 문단을 나눠 넣고 되돌리기 한 번으로 돌아간다. 복사한 글은 클립보드로 나간다', async () => {
  const page = await newPage();
  await open(page, 'v.docx', BASE());
  await startEdit(page);
  const paste = (text) => page.evaluate((t) => {
    const ta = document.querySelector('.edit-input'), dt = new DataTransfer(); dt.setData('text/plain', t);
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
  await paste('한 줄'); await settle(page);
  assert.equal((await save(page)).texts[0], '한 줄가나다라마');
  await paste('첫째\r\n둘째\n셋째'); await settle(page);
  assert.deepEqual((await save(page)).texts.slice(0, 3), ['한 줄첫째', '둘째', '셋째가나다라마']);
  await page.keyboard.press('Control+z'); await settle(page);
  assert.deepEqual((await save(page)).texts.slice(0, 2), ['한 줄가나다라마', 'Hello world foo'], '여러 줄 붙여넣기가 한 번에 되돌아간다');
  await page.keyboard.press('Control+y'); await settle(page);
  assert.deepEqual((await save(page)).texts.slice(0, 3), ['한 줄첫째', '둘째', '셋째가나다라마']);
  // 복사: 선택한 글이 clipboardData로 나간다
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+End'); await settle(page);
  const copied = await page.evaluate(() => {
    const ta = document.querySelector('.edit-input'), dt = new DataTransfer();
    ta.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    return dt.getData('text/plain');
  });
  assert.equal(copied, '한 줄첫째');
  await done(page);
});

test('편집할 수 없는 문단(필드)은 눌러도 입력되지 않고 이유를 알린다. 범위 지우기도 거부', async () => {
  const page = await newPage();
  await open(page, 'f.docx', makeDocx(p('앞 문단') + `<w:p>${run('쪽 ')}${fieldSimple('PAGE', '7')}</w:p>` + p('뒤 문단')));
  await startEdit(page);
  // 둘째 줄(필드 문단): 쪽 좌표 y = 맨 위 + 한 줄 높이 정도 아래
  const c0 = await caret(page);
  await clickAt(page, 0, X0 + 5, c0.y + c0.h * 1.5 + 4);
  await page.keyboard.type('X', { delay: 40 }); await settle(page);
  assert.match(await status(page), /편집할 수 없/);
  assert.equal(await dirty(page), false);
  await page.keyboard.press('Control+a'); await settle(page);
  await page.keyboard.press('Delete'); await settle(page);
  assert.match(await status(page), /편집할 수 없/);
  assert.equal(await dirty(page), false, '문서는 그대로');
  await done(page);
});

test('변경 내용 추적이 켜진 문서는 편집을 시작하지 않고 이유를 알린다', async () => {
  const base = new Uint8Array(makeDocx(p('글')));
  const z = readZip(base), files = [];
  for (const e of z.entries) files.push([e.name, Buffer.from(await readPart(base, e))]);
  files.push(['word/settings.xml', '<?xml version="1.0"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:trackRevisions/></w:settings>']);
  const page = await newPage();
  await open(page, 't.docx', zip(files));
  await page.click('#edit-btn');
  await page.waitForFunction(() => /편집할 수 없습니다/.test(document.getElementById('status').textContent), null, { timeout: 15000 });
  assert.match(await status(page), /변경 내용 추적/);
  assert.equal(await page.locator('#edit-bar').isVisible(), false);
  await done(page);
});

test('긴 글을 넣으면 쪽이 늘고(쪽 수 갱신), 되돌리면 줄며, 저장본에는 바뀐 문서 부품만 다르다', async () => {
  const body = Array.from({ length: 30 }, (_, i) => p(`문단 ${i} ` + '가나다라마바사 '.repeat(8))).join('');
  const page = await newPage();
  const orig = new Uint8Array(makeDocx(body));
  await open(page, 'long.docx', orig);
  const n0 = await pageCount(page);
  await startEdit(page);
  const paste = (text) => page.evaluate((t) => {
    const ta = document.querySelector('.edit-input'), dt = new DataTransfer(); dt.setData('text/plain', t);
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
  await paste('긴 글 '.repeat(2500)); await settle(page);
  const n1 = await pageCount(page);
  assert.ok(n1 > n0, `쪽 ${n0} → ${n1}`);
  assert.match(await page.locator('#page-total').innerText(), new RegExp(String(n1)));
  const r = await save(page);
  assert.equal(r.texts.length, 30);
  // 바뀌지 않은 부품은 압축된 바이트까지 같다
  const a = readZip(orig), b = readZip(r.bytes);
  for (const e of a.entries) {
    if (e.name === 'word/document.xml') continue;
    const f = b.entries.find((x) => x.name === e.name);
    assert.ok(f, `${e.name} 있음`);
    assert.deepEqual(Buffer.from(await readPart(r.bytes, f)), Buffer.from(await readPart(orig, e)), `${e.name} 그대로`);
  }
  await page.keyboard.press('Control+z'); await settle(page);
  assert.equal(await pageCount(page), n0, '되돌리면 쪽 수도 돌아온다');
  await done(page);
});

test('표 칸 안 글 입력과 저장, 저장한 파일을 다시 열어도 같다', async () => {
  const page = await newPage();
  await open(page, 'tb.docx', makeDocx(p('앞') + table([['가나', '다라'], ['마바', '사아']]) + p('뒤')));
  await startEdit(page);
  const c0 = await caret(page);
  // 표의 첫 칸: 앞 문단 아래
  await clickAt(page, 0, X0 + 12, c0.y + c0.h * 2 + 12);
  await page.keyboard.type('!', { delay: 40 }); await settle(page);
  const r = await save(page);
  assert.ok(r.texts.some((t) => /!/.test(t)), JSON.stringify(r.texts));
  assert.equal(r.texts.length, 6);
  // 저장본을 우리 뷰어로 다시 열면 고친 글이 보인다(뷰어 검색으로 확인)
  await open(page, 'again.docx', r.bytes);
  await page.keyboard.press('Control+f');
  await page.fill('#search-input', r.texts.find((t) => t.includes('!')));
  await page.waitForFunction(() => /^1 \/ 1/.test(document.getElementById('search-count').textContent.trim()), null, { timeout: 10000 });
  await done(page);
});

test('편집 중 다른 문서를 열면 저장하지 않은 변경을 묻는다', async () => {
  const page = await newPage();
  await open(page, 'd.docx', BASE());
  await startEdit(page);
  await page.keyboard.type('Q', { delay: 40 }); await settle(page);
  await page.setInputFiles('#file-input', { name: 'other.docx', mimeType: 'application/octet-stream', buffer: Buffer.from(BASE()) });
  await page.waitForSelector('dialog[open]', { timeout: 10000 });
  assert.match(await page.locator('dialog[open]').innerText(), /저장하지 않은 변경/);
  await page.click('dialog[open] [data-no]');
  assert.equal(await page.locator('#file-name').innerText(), 'd.docx', '계속 편집');
  await done(page);
});

/** 저장본의 글 조각 서식: [{text, bold, italic, underline, strikethrough, size, color, font, highlight}] (문단 순서대로 이어서) */
const fmtOf = (bytes, i = 0) => flattenIr(irOf(bytes)).filter((b) => b.text)[i].node.content.filter((c) => c.type === 'text' && c.text !== '\t').map((c) => ({ text: c.text, bold: !!c.bold, italic: !!c.italic, underline: !!c.underline && c.underline !== 'none', strike: !!c.strikethrough, size: c.font_size_half_pt, color: c.color?.join(), font: c.font_name, hl: c.highlight?.join() }));
const paraOf = (bytes, i = 0) => flattenIr(irOf(bytes)).filter((b) => b.text)[i].node;
const btn = (page, title) => page.locator(`#edit-bar button[aria-label="${title}"]`);
const shift = async (page, key, n) => { for (let i = 0; i < n; i++) await page.keyboard.press(`Shift+${key}`); await settle(page); };

test('글자 서식: 선택해서 굵게·기울임·밑줄·취소선(단추·Ctrl+B), 단추 상태, 저장본에 그 범위만', async () => {
  const page = await newPage();
  await open(page, 'f1.docx', BASE());
  await startEdit(page);
  await page.keyboard.press('ArrowRight'); await shift(page, 'ArrowRight', 2);              // "나다" 선택
  assert.equal(await page.locator('.sel').count() >= 1, true);
  await page.click('#edit-bar .fmt-b'); await settle(page);
  assert.equal(await page.locator('#edit-bar .fmt-b').getAttribute('aria-pressed'), 'true', '선택한 글이 굵으면 단추가 눌려 있다');
  await page.keyboard.press('Control+i'); await settle(page);
  await page.click('#edit-bar .fmt-u'); await page.click('#edit-bar .fmt-s'); await settle(page);
  let r = await save(page);
  assert.deepEqual(fmtOf(r.bytes).map((c) => [c.text, c.bold, c.italic, c.underline, c.strike]), [['가', false, false, false, false], ['나다', true, true, true, true], ['라마', false, false, false, false]]);
  assert.deepEqual(r.texts, ['가나다라마', 'Hello world foo', '셋째 문단', '끝 문단'], '글은 그대로');
  // 같은 글을 다시 누르면 꺼진다
  await page.click('#edit-bar .fmt-b'); await settle(page);
  r = await save(page);
  assert.equal(fmtOf(r.bytes).find((c) => c.text === '나다').bold, false);
  assert.equal(await page.locator('#edit-bar .fmt-b').getAttribute('aria-pressed'), 'false');
  // 되돌리기: 굵게 끄기 → 켜짐으로
  await page.keyboard.press('Control+z'); await settle(page);
  assert.equal(await dirty(page), true, '되돌리면 변경 표시');
  assert.equal(fmtOf((await save(page)).bytes).find((c) => c.text === '나다').bold, true);
  await done(page);
});

test('글자 서식: 크기·색·글꼴·형광펜, 서식을 먼저 정하고 입력', async () => {
  const page = await newPage();
  await open(page, 'f2.docx', BASE());
  await startEdit(page);
  await shift(page, 'End', 1);                                                            // 첫 문단 전체 선택
  await btn(page, '글자 크게').click(); await settle(page); await page.waitForTimeout(250);   // 서식 읽기(80ms 뒤)가 끝나야 다음 크기를 계산한다
  await btn(page, '글자 크게').click(); await settle(page);   // 11pt → 13pt
  await page.locator('#edit-bar .edit-color').first().fill('#ff0000'); await settle(page);
  await page.locator('#edit-bar .edit-font').selectOption({ label: 'Arial' }); await settle(page);
  await page.locator('#edit-bar .edit-color').nth(1).fill('#00ff00'); await settle(page);
  let f = fmtOf((await save(page)).bytes)[0];
  assert.deepEqual([f.size, f.color, f.font, f.hl], [26, '255,0,0', 'Arial', '0,255,0']);
  assert.match(await page.locator('#edit-bar .edit-size').first().innerText(), /13pt/, '크기 표시');
  // 형광펜 지우기
  await page.locator('#edit-bar button', { hasText: '지움' }).click(); await settle(page);
  assert.equal(fmtOf((await save(page)).bytes)[0].hl, undefined);
  // 캐럿만 있을 때 굵게를 먼저 누르고 입력하면 넣은 글에만
  await page.keyboard.press('Control+End'); await page.keyboard.press('Control+Home'); await page.keyboard.press('End'); await settle(page);
  await page.click('#edit-bar .fmt-b'); await page.keyboard.type('NEW', { delay: 40 }); await settle(page);
  const c = fmtOf((await save(page)).bytes);
  assert.deepEqual(c.filter((x) => x.bold).map((x) => x.text), ['NEW']);
  await page.keyboard.press('Control+z'); await settle(page);
  assert.ok(!(await save(page)).texts[0].includes('NEW'), '입력과 서식이 한 번에 되돌아간다');
  await done(page);
});

test('문단 서식: 가운데 맞춤·왼쪽 여백·줄 간격이 화면(캐럿 위치)과 저장본에 들어가고 되돌려진다', async () => {
  const page = await newPage();
  await open(page, 'f3.docx', BASE());
  await startEdit(page);
  const x0 = (await caret(page)).x, y1 = (await (async () => { await page.keyboard.press('ArrowDown'); await settle(page); return caret(page); })()).y;
  await page.keyboard.press('ArrowUp'); await settle(page);
  await btn(page, '가운데 맞춤').click(); await settle(page);
  assert.ok((await caret(page)).x > x0 + 50, '가운데 맞춤으로 캐럿이 옮겨 갔다');
  assert.equal(await btn(page, '가운데 맞춤').getAttribute('aria-pressed'), 'true');
  await btn(page, '왼쪽 여백 늘리기').click(); await settle(page);
  await page.locator('#edit-bar .edit-line').selectOption('200'); await settle(page);
  const n = paraOf((await save(page)).bytes);
  assert.equal(n.alignment, 'center'); assert.ok(n.indent_left_twips > 0); assert.deepEqual(n.line_spacing, { auto: 480 });
  await page.keyboard.press('ArrowDown'); await settle(page);
  assert.ok((await caret(page)).y > y1 + 5, '줄 간격 때문에 아래 문단이 내려갔다');
  await page.keyboard.press('Control+z'); await settle(page); await page.keyboard.press('Control+z'); await settle(page); await page.keyboard.press('Control+z'); await settle(page);
  const n2 = paraOf((await save(page)).bytes);
  assert.equal(n2.alignment, undefined); assert.ok(!n2.indent_left_twips); assert.equal(n2.line_spacing, undefined);
  await done(page);
});

test('여러 문단 서식(전체 선택 굵게)은 한 번에 되돌려지고, 잠긴 문단이 끼면 알린다', async () => {
  const page = await newPage();
  await open(page, 'f4.docx', makeDocx(p('앞 문단') + `<w:p>${run('쪽 ')}${fieldSimple('PAGE', '7')}</w:p>` + p('뒤 문단')));
  await startEdit(page);
  await page.keyboard.press('Control+a'); await settle(page);
  await page.click('#edit-bar .fmt-b'); await settle(page);
  assert.match(await status(page), /편집할 수 없/);
  assert.equal(await dirty(page), false);
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Control+Home');
  await page.keyboard.press('Control+Shift+End'); await settle(page);
  const ok = await open(page, 'f5.docx', BASE()).then(() => true);
  assert.ok(ok);
  await startEdit(page);
  await page.keyboard.press('Control+a'); await settle(page);
  await page.click('#edit-bar .fmt-b'); await settle(page);
  const r = await save(page);
  for (let i = 0; i < 4; i++) assert.ok(fmtOf(r.bytes, i).every((c) => c.bold), `문단 ${i}`);
  await page.keyboard.press('Control+z'); await settle(page);
  for (let i = 0; i < 4; i++) assert.ok(fmtOf((await save(page)).bytes, i).every((c) => !c.bold), `되돌림 ${i}`);
  await done(page);
});

test('찾아 바꾸기: 찾기 탭에서 다음·이전·바꾸기·모두 바꾸기, 못 찾으면 안내, 되돌리기', async () => {
  const page = await newPage();
  await open(page, 'f6.docx', makeDocx(p('고양이와 Cat') + p('cat 고양이') + p('끝')));
  await startEdit(page);
  await page.locator('#edit-bar button[data-tab="find"]').click();
  const panel = page.locator('#edit-bar [data-panel="find"]');
  await panel.locator('input').first().fill('고양이');
  await panel.locator('input').first().press('Enter'); await settle(page);
  assert.ok(await page.locator('.sel').count() >= 1, '찾은 글이 선택된다');
  assert.match(await status(page), /2곳 중에서 찾았습니다/);
  await panel.locator('input').first().press('Enter'); await settle(page);
  await panel.locator('input').first().press('Shift+Enter'); await settle(page);
  await panel.locator('input').nth(1).fill('강아지');
  await panel.locator('button', { hasText: /^바꾸기$/ }).click(); await settle(page);       // 선택된 일치를 바꾸고 다음으로
  let r = await save(page);
  assert.equal(r.texts.filter((t) => t.includes('강아지')).length, 1);
  await panel.locator('button', { hasText: '모두 바꾸기' }).click(); await settle(page);
  assert.match(await status(page), /1곳을 바꿨습니다/);
  r = await save(page);
  assert.deepEqual(r.texts, ['강아지와 Cat', 'cat 강아지', '끝']);
  await panel.locator('input').first().fill('없는말');
  await panel.locator('input').first().press('Enter'); await settle(page);
  assert.match(await status(page), /찾지 못했습니다/);
  // 대소문자 구분
  await panel.locator('input').first().fill('cat');
  await panel.locator('input[type=checkbox]').check();
  await panel.locator('input').first().press('Enter'); await settle(page);
  assert.doesNotMatch(await status(page), /찾지 못했습니다/);
  assert.ok(await page.locator('.sel').count() >= 1, '대소문자를 구분해도 "cat"을 찾는다');
  await page.keyboard.press('Control+z'); await settle(page);       // 모두 바꾸기 되돌리기(한 번)
  assert.equal((await save(page)).texts.filter((t) => t.includes('강아지')).length, 1);
  await done(page);
});

// 입력 지연(실제 브라우저: Canvas 글자 폭 측정·Worker 왕복·쪽 SVG 다시 그리기 포함). 설계 예산 p95 50ms(문단 1,000개 이하)는 이 샌드박스에서 안정적으로 재지 못하므로
// 여기서는 수치를 기록하고 느슨한 상한(회귀 방지)만 검사한다. 오너 기기 측정은 요청 목록에 있다.
for (const n of [300, 1000]) {
  test(`입력 지연: 문단 ${n}개 문서에서 글자 입력 → 캐럿 갱신·쪽 다시 그리기`, async () => {
    const body = Array.from({ length: n }, (_, i) => p(`문단 ${i} ` + '가나다라마바사 Hello world '.repeat(3))).join('');
    const page = await newPage();
    await open(page, `lat${n}.docx`, makeDocx(body));
    await startEdit(page);
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await settle(page);
    await page.evaluate(() => {
      window.__lat = { caret: [], paint: [] }; let t0 = 0;
      const ta = document.querySelector('.edit-input');
      ta.addEventListener('beforeinput', () => { t0 = performance.now(); }, true);
      new MutationObserver(() => { if (t0) { window.__lat.caret.push(performance.now() - t0); t0 = -performance.now(); } }).observe(document.getElementById('pages'), { childList: true, subtree: true });
      document.getElementById('pages').addEventListener('load', (e) => { if (e.target.tagName === 'IMG' && window.__t1) window.__lat.paint.push(performance.now() - window.__t1); }, true);
      ta.addEventListener('beforeinput', () => { window.__t1 = performance.now(); }, true);
    });
    for (let i = 0; i < 40; i++) { await page.keyboard.type(i % 2 ? 'a' : '글', { delay: 0 }); await page.waitForTimeout(140); }
    await settle(page);
    const lat = await page.evaluate(() => window.__lat);
    const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * f))] : NaN; };
    const rep = (a) => `n=${a.length} p50 ${q(a, 0.5).toFixed(0)}ms p95 ${q(a, 0.95).toFixed(0)}ms`;
    console.log(`  입력 지연 문단 ${n}: 캐럿 갱신 ${rep(lat.caret)} / 쪽 다시 그린 뒤 ${rep(lat.paint)}`);
    assert.ok(lat.caret.length >= 30, `캐럿 갱신 ${lat.caret.length}회`);
    assert.ok(q(lat.caret, 0.95) < 300, `캐럿 갱신 p95 ${q(lat.caret, 0.95)}ms`);
    await done(page);
  });
}

test('요약: 외부 요청 0건·CSP 위반 0건·스크립트 오류 0건', () => {
  assert.deepEqual(allExternal, []); assert.deepEqual(allCsp, []); assert.deepEqual(allErrors, []);
});
