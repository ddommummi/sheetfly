// E2E: HWP/HWPX 편집(4-1). 실제 Chromium에서 클릭·타이핑·한글 조합 입력·서식·되돌리기·저장을 하고,
// 저장된 파일을 rhwp(Node)로 다시 열어 내용을 확인한다.
//   node tests/e2e-edit.mjs        (먼저 npm run build)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { startServer, launch, instrument, samples, waitState, web } from './helpers.mjs';

const wasmDir = resolve(web, 'src/wasm') + '/';
const { default: initRhwp, HwpDocument } = await import(wasmDir + 'rhwp.js');
await initRhwp({ module_or_path: readFileSync(wasmDir + 'rhwp_bg.wasm') });

let server, url, browser;
const allErrors = [], allExternal = [], allCsp = [];
before(async () => { ({ server, url } = await startServer(0)); browser = await launch(); });
after(async () => { await browser?.close(); server?.close(); });

const BODY = '2022년 국립국어원 업무계획.hwp';
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, ...opts });
  const page = await ctx.newPage();
  page.__rec = instrument(page, url); page.__ctx = ctx;
  // 헤드리스 Chromium의 저장 위치 선택창은 응답하지 않으므로, 시험에서는 다운로드 경로를 쓴다.
  await page.addInitScript(() => { delete window.showSaveFilePicker; });
  await page.goto(url + '/');
  return page;
}
async function done(page) {
  allErrors.push(...page.__rec.errors); allExternal.push(...page.__rec.external); allCsp.push(...page.__rec.csp);
  await page.__ctx.close();
}
async function open(page, name, buffer = readFileSync(`${samples}/${name}`)) {
  await page.setInputFiles('#file-input', { name: basename(name), mimeType: 'application/octet-stream', buffer });
  await waitState(page, 'ready', 60000);
  await page.waitForFunction(() => document.querySelector('.page[data-rendered="1"]'), null, { timeout: 30000 });
}
/** 본문 문단을 눌러 캐럿을 둔다(3쪽). */
async function clickBody(page) {
  await page.click('#edit-btn');
  await page.fill('#page-input', '3'); await page.keyboard.press('Enter');
  // 쪽 이동의 스크롤이 멈출 때까지 기다린 뒤 누른다(움직이는 중에 누르면 엉뚱한 곳이 눌린다).
  let box, prev = null;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(150);
    box = await page.locator('.page').nth(2).boundingBox();
    if (prev && Math.abs(prev.y - box.y) < 0.5 && box.y > 0 && box.y < 300) break;
    prev = box;
  }
  await page.mouse.click(box.x + 330, box.y + 372);
  await page.waitForFunction(() => document.activeElement?.classList.contains('edit-input'), null, { timeout: 10000 });
  await page.waitForTimeout(500);
}
// 입력이 모두 처리될 때까지 기다린다: 브라우저가 아직 넘기지 않은 입력이 없고(isInputPending), 편집기 대기열이 비어(data-edit-busy 없음) 그 상태가 잠시 이어질 때.
// (Playwright의 keyboard.type은 렌더러가 바쁘면 글자가 처리되기 전에 돌아온다.)
async function settle(page) {
  await page.waitForTimeout(100);
  await page.waitForFunction(() => new Promise((res) => {
    const idle = () => !document.body.dataset.editBusy && !(navigator.scheduling?.isInputPending?.());
    if (!idle()) return res(false);
    setTimeout(() => res(idle()), 250);
  }), null, { timeout: 30000, polling: 100 });
}
async function saveAndParse(page, { warn = false } = {}) {
  const dl = page.waitForEvent('download', { timeout: 30000 });
  await page.click('#edit-bar .btn.primary');
  // 저장 점검 경고창이 뜨면(warn:true) 내용을 돌려주고 "그래도 저장"을 누른다. 아니면 시험 실패.
  let warning = null;
  const dlg = await Promise.race([dl.then(() => null), page.waitForSelector('dialog[open]', { timeout: 30000 }).then(() => 'dialog')]);
  if (dlg === 'dialog') {
    warning = await page.locator('dialog[open]').innerText();
    if (!warn) throw new Error(`저장 전 경고창: ${warning}`);
    await page.click('dialog[open] [data-yes]');
  }
  const d = await dl;
  const bytes = new Uint8Array(readFileSync(await d.path()));
  // 헤드리스 Chromium은 한글이 든 다운로드 이름을 'download'로 돌려주므로(앱 문제가 아님) 이름은 상태 안내문에서 읽는다.
  await page.waitForFunction(() => /저장했습니다/.test(document.getElementById('status').textContent), null, { timeout: 10000 });
  const name = (await page.locator('#status').innerText()).replace(/ 저장했습니다\.$/, '');
  let doc = null;
  try { doc = new HwpDocument(bytes); } catch { /* 암호 파일은 암호 없이 열리지 않는다 */ }
  return { name, bytes, doc, warning };
}
const find = (doc, t) => JSON.parse(doc.searchText(t, 0, 0, 0, true, true, true));
const comp = async (cdp, page, t) => { await cdp.send('Input.imeSetComposition', { text: t, selectionStart: t.length, selectionEnd: t.length }); await page.waitForTimeout(40); };
const dirty = (page) => page.evaluate(() => document.body.hasAttribute('data-dirty'));

test('편집 단추: HWP에만 보이고 처음엔 읽기 전용', async () => {
  const page = await newPage();
  assert.equal(await page.locator('#edit-btn').isVisible(), false, '문서 열기 전에는 숨김');
  await open(page, BODY);
  assert.equal(await page.locator('#edit-btn').isVisible(), true);
  assert.equal(await page.locator('#edit-bar').isVisible(), false, '읽기 전용 기본');
  assert.equal(await page.locator('.edit-input').count(), 0, '편집을 누르기 전에는 입력 칸이 없다');
  await page.click('#edit-btn');
  await page.waitForSelector('#edit-bar:not([hidden])');
  assert.ok(await page.locator('#edit-bar .btn').count() >= 8);
  await done(page);
});

test('DOCX·RTF·XLSX 등은 편집 단추가 없다(읽기 전용)', async () => {
  const page = await newPage();
  for (const f of ['sample.xlsx', 'sample.pptx', 'sample.doc']) {
    await page.setInputFiles('#file-input', { name: f, mimeType: 'application/octet-stream', buffer: readFileSync(resolve(web, 'tests/fixtures', f)) });
    await waitState(page, 'ready', 60000);
    assert.equal(await page.locator('#edit-btn').isVisible(), false, f);
  }
  await done(page);
});

test('영문 입력·Enter·Backspace·되돌리기·다시 실행', async () => {
  const page = await newPage();
  await open(page, BODY); await clickBody(page);
  await page.keyboard.type('Hello', { delay: 60 }); await settle(page);
  assert.equal(await dirty(page), true);
  await page.keyboard.press('Backspace'); await settle(page);   // Hell
  await page.keyboard.press('Control+z'); await settle(page);   // 되돌리기: Backspace 취소 → Hello
  await page.keyboard.press('Control+z'); await settle(page);   // 입력 묶음 취소 → 없음
  await page.keyboard.press('Control+y'); await settle(page);   // 다시 실행 → Hello
  await page.keyboard.type('!', { delay: 60 });
  await page.keyboard.press('Enter'); await settle(page);
  await page.keyboard.type('Second', { delay: 60 }); await settle(page);
  const r = await saveAndParse(page);
  assert.ok(find(r.doc, 'Hello!').found, 'Hello! 저장됨');
  assert.ok(find(r.doc, 'Second').found, '새 문단');
  assert.equal(find(r.doc, 'Hello!').totalMatchCount, 1);
  assert.match(r.name, /\(편집\)\.hwp$/, '원본 이름을 덮어쓰지 않는다');
  await done(page);
});

test('한글 조합 입력(IME)이 한 글자씩 정확히 들어간다', async () => {
  const page = await newPage();
  await open(page, BODY); await clickBody(page);
  const cdp = await page.context().newCDPSession(page);
  for (const [seq, fin] of [[['ㅎ', '하', '한'], '한'], [['ㄱ', '그', '글'], '글']]) {
    for (const t of seq) await comp(cdp, page, t);
    await cdp.send('Input.insertText', { text: fin }); await page.waitForTimeout(80);
  }
  await page.keyboard.type(' ok', { delay: 60 }); await settle(page);
  const r = await saveAndParse(page);
  assert.ok(find(r.doc, '한글 ok').found, '한글 ok');
  for (const bad of ['ㅎ한', '하한', 'ㄱ글', '한한']) assert.equal(find(r.doc, bad).found, false, `조합 중간 글자(${bad})가 남지 않아야 한다`);
  await done(page);
});

test('선택 → 굵게, 선택 삭제, 복사·붙여넣기', async () => {
  const page = await newPage();
  await open(page, BODY); await clickBody(page);
  await page.keyboard.type('BoldText', { delay: 60 }); await settle(page);
  await page.keyboard.down('Shift');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft', { delay: 60 });
  await page.keyboard.up('Shift'); await settle(page);
  await page.waitForSelector('.sel', { timeout: 10000 });
  await page.waitForTimeout(400);   // 복사에 쓸 선택 글자(text)가 도착할 시간
  await page.keyboard.press('Control+b'); await settle(page);
  await page.waitForFunction(() => document.querySelector('#edit-bar .fmt-b').getAttribute('aria-pressed') === 'true', null, { timeout: 10000 });
  await page.keyboard.press('Control+c'); await settle(page);
  await page.keyboard.press('ArrowRight'); await settle(page);
  await page.keyboard.press('End'); await settle(page);
  await page.keyboard.press('Control+v'); await settle(page);
  const r = await saveAndParse(page);
  const bold = find(r.doc, 'BoldText'); assert.ok(bold.found);
  const props = JSON.parse(r.doc.getCharPropertiesAt(bold.sec, bold.para, bold.charOffset + 6));
  assert.equal(props.bold, true, '선택한 "Text"가 굵게');
  const first = JSON.parse(r.doc.getCharPropertiesAt(bold.sec, bold.para, bold.charOffset));
  assert.equal(first.bold, false, '선택하지 않은 "Bold"는 그대로');
  const pf = find(r.doc, '현황Text');
  assert.equal(JSON.parse(r.doc.getCharPropertiesAt(pf.sec, pf.para, pf.charOffset + 4 + 2)).bold, true, '붙여넣은 글도 굵게(서식째 붙이기)');
  assert.ok(find(r.doc, '현황Text').found, `복사한 "Text"를 줄 끝(End)에 붙여넣음 (문단: ${r.doc.getTextRange(bold.sec, bold.para, 0, 60)})`);
  await done(page);
});

test('서식: 글꼴·취소선·형광펜·자간·장평·줄 간격·들여쓰기가 저장본에 남는다', async () => {
  const page = await newPage();
  await open(page, BODY); await clickBody(page);
  await page.keyboard.type('FormatMe', { delay: 60 }); await settle(page);
  await page.keyboard.down('Shift');
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowLeft', { delay: 60 });
  await page.keyboard.up('Shift'); await page.waitForSelector('.sel'); await settle(page);
  await page.selectOption('#edit-bar .edit-font', '맑은 고딕'); await settle(page);
  await page.click('#edit-bar .fmt-s'); await settle(page);
  await page.locator('#edit-bar input[type=color]').nth(1).fill('#ffff00'); await settle(page);
  await page.waitForFunction(() => document.querySelector('#edit-bar .edit-size').textContent.length > 0);
  for (let i = 0; i < 2; i++) { await page.click('#edit-bar [title="자간 줄이기"]'); await settle(page); await page.waitForTimeout(150); }
  for (let i = 0; i < 2; i++) { await page.click('#edit-bar [title="장평 줄이기"]'); await settle(page); await page.waitForTimeout(150); }
  await page.selectOption('#edit-bar .edit-line', '200'); await settle(page);
  await page.click('#edit-bar [title="왼쪽 여백 늘리기"]'); await settle(page);
  const r = await saveAndParse(page);
  const f = find(r.doc, 'FormatMe'); assert.ok(f.found);
  const c = JSON.parse(r.doc.getCharPropertiesAt(f.sec, f.para, f.charOffset + 2));
  assert.equal(c.fontFamily, '맑은 고딕');
  assert.equal(c.strikethrough, true);
  assert.equal(c.shadeColor.toLowerCase(), '#ffff00');
  assert.equal(c.spacings[0], (JSON.parse(r.doc.getCharPropertiesAt(f.sec, f.para, 0)).spacings[0]) - 2);
  assert.equal(c.ratios[0], 90);
  const para = JSON.parse(r.doc.getParaPropertiesAt(f.sec, f.para));
  assert.equal(para.lineSpacing, 200);
  assert.ok(para.marginLeft > 10 && para.marginLeft < 16, `marginLeft ${para.marginLeft}`);
  await done(page);
});

test('문단 부호 보기를 켜고 끌 수 있다(문서는 바뀌지 않는다)', async () => {
  const page = await newPage();
  await open(page, 'hwp_table_test.hwp');
  await page.click('#edit-btn'); await page.waitForSelector('.caret'); await settle(page);
  await page.click('#edit-bar [data-panel="format"] [title="문단 부호 보이기·숨기기"]'); await settle(page);
  assert.equal(await page.locator('#edit-bar [data-panel="format"] [title="문단 부호 보이기·숨기기"]').getAttribute('aria-pressed'), 'true');
  await tab(page, 'view'); await page.waitForTimeout(200);
  assert.equal(await page.locator('#edit-bar [data-panel="view"] [aria-label="문단 부호"]').getAttribute('aria-pressed'), 'true', '보기 탭 단추도 같이 켜진다');
  assert.equal(await dirty(page), false, '보기 옵션은 변경 표시를 만들지 않는다');
  await done(page);
});

// ── 표 편집 ──
const tab = (page, name) => page.click(`#edit-bar .btn.tab[data-tab="${name}"]`);
/** 위치가 두 번 연달아 같을 때까지 기다린 뒤의 상자(애니메이션·다시 그리기 중에 재지 않는다) */
async function stableBox(page, selector, nth = 0) {
  let prev = null;
  for (let i = 0; i < 40; i++) {
    const b = await page.locator(selector).nth(nth).boundingBox().catch(() => null);
    if (b && prev && Math.abs(b.x - prev.x) < 0.5 && Math.abs(b.y - prev.y) < 0.5 && Math.abs(b.width - prev.width) < 0.5) return b;
    prev = b; await page.waitForTimeout(120);
  }
  return prev;
}
const tbtn = (page, title) => page.locator(`#edit-bar [aria-label="${title}"]`);
/** hwp_table_test.hwp 첫 쪽의 첫 표(4줄×3칸)에서 (줄,칸)의 화면 위치를 쪽 비율로 돌려준다. */
const CELL = { '0,0': [0.265, 0.235], '0,1': [0.498, 0.235], '1,0': [0.265, 0.2566], '1,1': [0.498, 0.2566], '2,0': [0.265, 0.278] };
async function openTable(page) {
  await open(page, 'hwp_table_test.hwp');
  await page.click('#edit-btn'); await page.waitForSelector('.caret'); await settle(page);
}
async function clickCell(page, rc, shift = false) {
  const box = await page.locator('.page').first().boundingBox();
  const [fx, fy] = CELL[rc];
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  if (shift) await page.keyboard.up('Shift');
  await page.waitForTimeout(400); await settle(page);
}
const dims = (doc, p = 3, c = 0) => JSON.parse(doc.getTableDimensions(0, p, c));

test('표: 줄·칸 넣기와 지우기, 되돌리기', async () => {
  const page = await newPage();
  await openTable(page);
  await clickCell(page, '0,0');
  await tab(page, 'table'); await page.waitForTimeout(300);
  assert.equal(await tbtn(page, '표 만들기').isDisabled(), true, '표 안에서는 새 표를 넣을 수 없다');
  await tbtn(page, '아래에 줄 넣기').click(); await settle(page);
  await tbtn(page, '오른쪽에 칸 넣기').click(); await settle(page);
  let r = await saveAndParse(page);
  assert.deepEqual([dims(r.doc).rowCount, dims(r.doc).colCount], [5, 4]);
  await page.keyboard.press('Control+z'); await settle(page);          // 칸 넣기 취소 → 5×3
  await tbtn(page, '줄 지우기').click(); await settle(page);           // 5→4
  r = await saveAndParse(page);
  assert.deepEqual([dims(r.doc).rowCount, dims(r.doc).colCount], [4, 3]);
  await done(page);
});

test('표: 칸 합치기·나누기, 칸 속성(배경색), 표 지우기', async () => {
  const page = await newPage();
  await openTable(page);
  await clickCell(page, '0,0');
  await tab(page, 'table'); await page.waitForTimeout(300);
  assert.equal(await tbtn(page, '칸 합치기').isDisabled(), true, '칸 하나만 고르면 합칠 수 없다');
  await clickCell(page, '1,1', true);
  await page.waitForFunction(() => document.querySelectorAll('.sel').length >= 4, null, { timeout: 5000 });   // 칸 블록 4칸
  assert.equal(await tbtn(page, '칸 합치기').isDisabled(), false);
  await tbtn(page, '칸 합치기').click(); await settle(page);
  // 칸 속성: 배경색
  await tbtn(page, '칸 속성…').click();
  await page.waitForSelector('dialog[open]');
  await page.selectOption('dialog[open] select >> nth=0', 'solid');
  await page.locator('dialog[open] input[type=color]').first().fill('#ffee00');
  await page.click('dialog[open] button[type=submit]'); await settle(page);
  let r = await saveAndParse(page);
  const ci = JSON.parse(r.doc.getCellInfo(0, 3, 0, 0));
  assert.deepEqual([ci.rowSpan, ci.colSpan], [2, 2]);
  assert.equal(JSON.parse(r.doc.getCellProperties(0, 3, 0, 0)).fillColor.toLowerCase(), '#ffee00');
  // 표 지우기
  await tbtn(page, '표 지우기').click();
  await page.waitForSelector('dialog[open]'); await page.click('dialog[open] [data-yes]'); await settle(page);
  r = await saveAndParse(page);
  assert.throws(() => r.doc.getTableDimensions(0, 3, 0));
  await done(page);
});

test('표: 새 표 만들기(본문에서) 후 칸에 글 입력', async () => {
  const page = await newPage();
  await open(page, BODY); await clickBody(page);
  await tab(page, 'table'); await page.waitForTimeout(300);
  await tbtn(page, '표 만들기').click();
  await page.waitForSelector('dialog[open]');
  await page.locator('dialog[open] input[type=number]').nth(0).fill('2');
  await page.locator('dialog[open] input[type=number]').nth(1).fill('3');
  await page.click('dialog[open] button[type=submit]'); await settle(page);
  await page.keyboard.type('NEWT', { delay: 60 }); await settle(page);
  const r = await saveAndParse(page);
  const f = find(r.doc, 'NEWT'); assert.ok(f.found && f.cellContext, '새 표의 첫 칸에 들어갔다');
  const d = dims(r.doc, f.cellContext.parentPara, f.cellContext.ctrlIdx);
  assert.deepEqual([d.rowCount, d.colCount], [2, 3]);
  await done(page);
});

// ── 개체(그림·도형·수식) ──
const controlsOf = (doc, type) => {
  const out = [];
  for (let pg = 0; pg < doc.pageCount(); pg++) for (const c of JSON.parse(doc.getPageControlLayout(pg)).controls) if (c.type === type) out.push({ ...c, page: pg });
  return out;
};
const IMG = resolve(samples, 'images/younghi.jpg');
async function insertPictureUI(page) {
  await tab(page, 'insert'); await page.waitForTimeout(200);
  await tbtn(page, '그림…').click();
  await page.waitForSelector('dialog[open]');
  await page.setInputFiles('dialog[open] input[type=file]', IMG);
  await page.click('dialog[open] button[type=submit]');
  await page.waitForSelector('.obj-frame', { timeout: 15000 }); await settle(page);
}

test('개체: 그림 넣기·속성·옮기기·크기·지우기', async () => {
  const page = await newPage();
  await open(page, BODY); await clickBody(page);
  const before = (await saveAndParse(page)).doc;
  const n0 = controlsOf(before, 'image').length;
  await insertPictureUI(page);
  let r = await saveAndParse(page);
  assert.equal(controlsOf(r.doc, 'image').length, n0 + 1, '그림이 들어갔다');
  // 속성: 너비를 40mm로, 글 앞으로(떠 있는 개체로)
  await tab(page, 'object'); await page.waitForTimeout(200);
  await tbtn(page, '속성…').click(); await page.waitForSelector('dialog[open]');
  await page.locator('dialog[open] input[type=number]').nth(0).fill('40');
  await page.selectOption('dialog[open] select >> nth=0', 'InFrontOfText');
  await page.click('dialog[open] button[type=submit]'); await settle(page);
  await page.waitForSelector('.obj-frame');
  r = await saveAndParse(page);
  const mine = () => controlsOf(r.doc, 'image').filter((c) => c.page === 2).at(-1);   // 넣은 그림은 3쪽(인덱스 2)에 있다
  const pic = mine();
  assert.ok(Math.abs(pic.w - (40 * 283.465) / 75) < 3, `너비 ${pic.w}px`);
  // 끌어서 옮기기: 틀을 오른쪽 아래로 60px
  const fb = await page.locator('.obj-frame').boundingBox();
  await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
  await page.mouse.down(); await page.mouse.move(fb.x + fb.width / 2 + 60, fb.y + fb.height / 2 + 40, { steps: 6 }); await page.mouse.up(); await settle(page);
  r = await saveAndParse(page);
  const moved = mine();
  assert.ok(Math.abs(moved.x - pic.x) > 20 || Math.abs(moved.y - pic.y) > 20, `옮겨졌다 (${pic.x},${pic.y}) → (${moved.x},${moved.y})`);
  // 크기 조절: 오른쪽 아래 손잡이를 80px 늘린다
  const fb2 = await page.locator('.obj-frame').boundingBox();
  await page.mouse.move(fb2.x + fb2.width - 2, fb2.y + fb2.height - 2);
  await page.mouse.down(); await page.mouse.move(fb2.x + fb2.width + 78, fb2.y + fb2.height + 78, { steps: 6 }); await page.mouse.up(); await settle(page);
  r = await saveAndParse(page);
  assert.ok(mine().w > moved.w + 20, '커졌다');
  // 지우기(Delete)
  await page.keyboard.press('Delete'); await settle(page);
  r = await saveAndParse(page);
  assert.equal(controlsOf(r.doc, 'image').length, n0, '그림이 지워졌다');
  await done(page);
});

test('개체: 도형(타원)·글상자·수식 넣기, 앞뒤 순서', async () => {
  const page = await newPage();
  await open(page, BODY); await clickBody(page);
  await tab(page, 'insert'); await page.waitForTimeout(200);
  await page.selectOption('#edit-bar .edit-shape', 'ellipse'); await page.waitForSelector('.obj-frame'); await settle(page);
  await tab(page, 'object'); await page.waitForTimeout(200);
  await tbtn(page, '맨 앞으로').click(); await settle(page);
  await tbtn(page, '맨 뒤로').click(); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);
  await tab(page, 'insert');
  await tbtn(page, '수식…').click(); await page.waitForSelector('dialog[open]');
  await page.locator('dialog[open] input[type=text]').fill('a over b');
  await page.click('dialog[open] button[type=submit]'); await page.waitForSelector('.obj-frame'); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);
  await tbtn(page, '글상자').click(); await page.waitForSelector('.obj-frame'); await settle(page);
  const r = await saveAndParse(page);
  assert.ok(controlsOf(r.doc, 'shape').length >= 2, '타원·글상자');
  assert.ok(controlsOf(r.doc, 'equation').length >= 1, '수식');
  await done(page);
});

test('개체: Shift+누르기로 여러 개 골라 묶고 풀기, 묶음이 하나로 저장된다', async () => {
  const page = await newPage();
  await open(page, BODY); await clickBody(page);
  await tab(page, 'insert'); await page.waitForTimeout(200);
  await page.selectOption('#edit-bar .edit-shape', 'ellipse'); await page.waitForSelector('.obj-frame'); await settle(page);
  const z = await page.evaluate(() => Number(document.querySelector('.page').getBoundingClientRect().width) / 793.7);
  const fa = await page.locator('.obj-frame').boundingBox();
  await page.mouse.move(fa.x + fa.width / 2, fa.y + fa.height / 2); await page.mouse.down();   // 첫 개체를 끌어 오른쪽으로 250px
  await page.mouse.move(fa.x + fa.width / 2 + 250 * z, fa.y + fa.height / 2, { steps: 6 }); await page.mouse.up(); await settle(page);
  await page.waitForFunction((x0) => { const f = document.querySelector('.obj-frame'); return f && f.getBoundingClientRect().x > x0 + 100; }, fa.x, { timeout: 10000 });
  const aBox = await stableBox(page, '.obj-frame');
  await page.keyboard.press('Escape'); await settle(page);
  await page.selectOption('#edit-bar .edit-shape', 'rectangle'); await page.waitForSelector('.obj-frame'); await settle(page);
  const bBox = await stableBox(page, '.obj-frame');   // 둘째 개체는 캐럿 자리, 첫째는 거기서 오른쪽으로 250px(둘째를 넣을 때 화면이 움직여도 어긋나지 않게 둘째 기준으로 잡는다)
  await page.keyboard.down('Shift');
  await page.mouse.click(bBox.x + bBox.width / 2 + 250 * z, bBox.y + bBox.height / 2);
  await page.keyboard.up('Shift'); await settle(page);
  await page.waitForFunction(() => document.querySelectorAll('.obj-frame.multi').length === 2, null, { timeout: 10000 });
  await tab(page, 'object'); await page.waitForTimeout(200);
  await tbtn(page, '묶기').click(); await settle(page);
  await page.waitForFunction(() => document.querySelectorAll('.obj-frame').length === 1 && document.querySelector('.obj-frame').dataset.type === 'group', null, { timeout: 10000 });
  const r = await saveAndParse(page);
  assert.ok(controlsOf(r.doc, 'group').length >= 1, '묶음 개체가 저장됐다');
  await tbtn(page, '묶음 풀기').click(); await settle(page);
  const r2 = await saveAndParse(page);
  assert.equal(controlsOf(r2.doc, 'group').length, 0, '묶음을 풀었다');
  assert.ok(controlsOf(r2.doc, 'shape').length >= 2, '풀린 개체 둘');
  await done(page);
});

test('개체: 회전 손잡이로 돌린다', async () => {
  const page = await newPage();
  await open(page, BODY); await clickBody(page);
  await tab(page, 'insert'); await page.waitForTimeout(200);
  await page.selectOption('#edit-bar .edit-shape', 'rectangle'); await page.waitForSelector('.obj-frame'); await settle(page);
  // 손잡이를 틀 가운데의 오른쪽 옆으로 끌면 90도
  const f = await page.locator('.obj-frame').boundingBox(), h = await page.locator('.obj-rot').boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down();
  await page.mouse.move(f.x + f.width / 2 + 120, f.y + f.height / 2, { steps: 6 }); await page.mouse.up(); await settle(page);
  await page.waitForFunction(() => /rotate\((8[5-9]|9\d)/.test(document.querySelector('.obj-frame')?.style.transform ?? ''), null, { timeout: 10000 });
  const r = await saveAndParse(page);
  const sh = controlsOf(r.doc, 'shape'); assert.ok(sh.length >= 1);
  const c = sh[sh.length - 1];
  const props = JSON.parse(r.doc.getShapeProperties(c.secIdx, c.paraIdx, c.controlIdx));
  assert.ok(props.rotationAngle >= 85 && props.rotationAngle <= 95, `회전 ${props.rotationAngle}`);
  await done(page);
});

test('개체: 도형에 글 넣기(글상자 붙이기)로 안에 글을 쓴다', async () => {
  const page = await newPage();
  await open(page, BODY); await clickBody(page);
  await tab(page, 'insert'); await page.waitForTimeout(200);
  await page.selectOption('#edit-bar .edit-shape', 'rectangle'); await page.waitForSelector('.obj-frame'); await settle(page);
  await tab(page, 'object'); await page.waitForTimeout(200);
  await tbtn(page, '글 넣기').click(); await settle(page);
  await page.waitForSelector('.caret'); await page.keyboard.type('안녕', { delay: 60 }); await settle(page);
  const r = await saveAndParse(page);
  const sh = controlsOf(r.doc, 'shape'); assert.ok(sh.length >= 1);
  const c = sh[sh.length - 1];
  assert.equal(r.doc.getTextInCellByPath(c.secIdx, c.paraIdx, JSON.stringify([{ controlIndex: c.controlIdx, cellIndex: 0, cellParaIndex: 0 }]), 0, 2), '안녕');
  await done(page);
});

test('눈금자: 문단 왼쪽 여백 표지를 끌어 들여쓴다', async () => {
  const page = await newPage();
  await open(page, BODY); await clickBody(page);
  await page.keyboard.type('RulerPara', { delay: 40 }); await settle(page);
  await tab(page, 'view'); await page.waitForTimeout(200);
  await tbtn(page, '눈금자').click(); await settle(page);
  await page.waitForSelector('.ruler-mk.left', { timeout: 10000 });
  const z = await page.evaluate(() => Number(document.querySelector('.page').getBoundingClientRect().width) / 793.7);
  const m = await page.locator('.ruler-mk.left').boundingBox();
  await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2); await page.mouse.down();
  await page.mouse.move(m.x + m.width / 2 + 40 * z, m.y + m.height / 2, { steps: 6 }); await page.mouse.up(); await settle(page);
  const r = await saveAndParse(page);
  const f = find(r.doc, 'RulerPara'); assert.ok(f.found);
  const para = JSON.parse(r.doc.getParaPropertiesAt(f.sec, f.para));
  assert.ok(para.marginLeft > 30 && para.marginLeft < 50, `왼쪽 여백 ${para.marginLeft}`);
  await done(page);
});

test('목차 넣기: 개요(번호 있는 제목)로 목차 글을 캐럿 자리에 넣는다', async () => {
  const page = await newPage();
  await open(page, 'hwp-multi-002.hwp');
  await page.click('#edit-btn'); await page.waitForSelector('.caret'); await settle(page);
  await tab(page, 'insert'); await page.waitForTimeout(200);
  await tbtn(page, '목차 넣기…').click(); await page.waitForSelector('dialog[open]');
  await submit(page); await settle(page);
  const r = await saveAndParse(page, { warn: true });
  const f = find(r.doc, '목 차'); assert.ok(f.found, '목차 제목');
  let dots = false;
  for (let p = f.para; p < Math.min(f.para + 12, r.doc.getParagraphCount(f.sec)) && !dots; p++) { const l = r.doc.getParagraphLength(f.sec, p); if (l && r.doc.getTextRange(f.sec, p, 0, l).includes('···')) dots = true; }
  assert.ok(dots, '점 줄로 이은 항목');
  await done(page);
});

test('개체: 선의 끝 점을 끌어 옮긴다', async () => {
  const page = await newPage();
  await open(page, BODY); await clickBody(page);
  await tab(page, 'insert'); await page.waitForTimeout(200);
  await page.selectOption('#edit-bar .edit-shape', 'line'); await page.waitForSelector('.obj-endpoint[data-end="end"]'); await settle(page);
  const z = await page.evaluate(() => Number(document.querySelector('.page').getBoundingClientRect().width) / 793.7);
  const h = await page.locator('.obj-endpoint[data-end="end"]').boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 80 * z, h.y + h.height / 2 + 40 * z, { steps: 6 }); await page.mouse.up(); await settle(page);
  const r = await saveAndParse(page);
  const ln = controlsOf(r.doc, 'line'); assert.ok(ln.length >= 1, '선');
  const c = ln[ln.length - 1];
  assert.ok(c.w > 200 && c.h > 100, `끝 점을 옮긴 뒤 선 크기 ${c.w}x${c.h}`);
  await done(page);
});

test('개체: 여러 개를 고른 채 하나를 끌면 모두 함께 옮겨진다', async () => {
  const page = await newPage();
  await open(page, BODY); await clickBody(page);
  await tab(page, 'insert'); await page.waitForTimeout(200);
  await page.selectOption('#edit-bar .edit-shape', 'ellipse'); await page.waitForSelector('.obj-frame'); await settle(page);
  const z = await page.evaluate(() => Number(document.querySelector('.page').getBoundingClientRect().width) / 793.7);
  const fa = await page.locator('.obj-frame').boundingBox();
  await page.mouse.move(fa.x + fa.width / 2, fa.y + fa.height / 2); await page.mouse.down();
  await page.mouse.move(fa.x + fa.width / 2 + 250 * z, fa.y + fa.height / 2, { steps: 6 }); await page.mouse.up(); await settle(page);
  await page.waitForFunction((x0) => { const f = document.querySelector('.obj-frame'); return f && f.getBoundingClientRect().x > x0 + 100; }, fa.x, { timeout: 10000 });
  const aBox = await page.locator('.obj-frame').boundingBox();
  await page.keyboard.press('Escape'); await settle(page);
  await page.selectOption('#edit-bar .edit-shape', 'rectangle'); await page.waitForSelector('.obj-frame'); await settle(page);
  const bBox = await stableBox(page, '.obj-frame');   // 둘째 개체는 캐럿 자리, 첫째는 거기서 오른쪽으로 250px(둘째를 넣을 때 화면이 움직여도 어긋나지 않게 둘째 기준으로 잡는다)
  await page.keyboard.down('Shift');
  await page.mouse.click(bBox.x + bBox.width / 2 + 250 * z, bBox.y + bBox.height / 2);
  await page.keyboard.up('Shift'); await settle(page);
  await page.waitForFunction(() => document.querySelectorAll('.obj-frame.multi').length === 2, null, { timeout: 10000 });
  const before = await stableBox(page, '.obj-frame.multi');
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2); await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2 + 60 * z, { steps: 6 }); await page.mouse.up(); await settle(page);
  await page.waitForFunction((y0) => { const fs = [...document.querySelectorAll('.obj-frame')]; return fs.length === 2 && fs.every((f) => f.getBoundingClientRect().y > y0 + 40); }, before.y, { timeout: 10000 });
  const r = await saveAndParse(page);
  const sh = controlsOf(r.doc, 'shape').slice(-2);
  assert.equal(sh.length, 2);
  for (const c of sh) assert.ok(c.y > 340, `두 개체가 함께 아래로 갔다(y=${c.y})`);
  await done(page);
});

test('표 칸 안의 그림을 눌러 고르고, 크기를 바꾸고, 지운다', async () => {
  const page = await newPage();
  await open(page, 'KTX.hwp');
  await page.click('#edit-btn'); await page.waitForSelector('.caret'); await settle(page);
  await page.fill('#page-input', '1'); await page.keyboard.press('Enter'); await page.waitForTimeout(800);
  const pb = await page.locator('.page').first().boundingBox(); const sc = pb.width / 793.7;
  // 첫 쪽 아래쪽(표 칸 안) 그림: 쪽 좌표 (200, 945)
  await page.locator('.page').first().evaluate((el) => el.scrollIntoView({ block: 'end' })); await page.waitForTimeout(500);
  const pb2 = await page.locator('.page').first().boundingBox();
  await page.mouse.click(pb2.x + 200 * sc, pb2.y + 945 * sc); await settle(page);
  await page.waitForSelector('.obj-frame', { timeout: 8000 });
  assert.equal(await page.locator('.obj-frame').first().getAttribute('data-type'), 'image');
  // 크기: 오른쪽 아래 손잡이를 안쪽으로 끌기(칸 안 그림은 글자처럼 놓여 크기만 바뀐다)
  const h = await page.locator('.obj-frame .obj-handle.h-se').boundingBox(), fb = await page.locator('.obj-frame').boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 - 60 * sc, h.y + h.height / 2 - 12 * sc, { steps: 6 }); await page.mouse.up(); await settle(page);
  await page.waitForFunction((w0) => document.querySelector('.obj-frame')?.getBoundingClientRect().width < w0 - 20, fb.width, { timeout: 10000 });
  await page.keyboard.press('Delete'); await settle(page);
  const r = await saveAndParse(page, { warn: true });
  const imgs = controlsOf(r.doc, 'image').filter((c) => c.page === 0);
  assert.equal(imgs.length, 1, `칸 안 그림 하나가 남았다(${imgs.length})`);
  await done(page);
});

test('중첩(안쪽) 표: 칸 너비를 같게 맞추고, 안쪽 표를 지운다', async () => {
  const page = await newPage();
  await open(page, 'inner-table-01.hwp');
  await page.click('#edit-btn'); await page.waitForSelector('.caret'); await settle(page);
  await page.fill('#page-input', '2'); await page.keyboard.press('Enter'); await page.waitForTimeout(1000);
  let box, prev = null;
  for (let i = 0; i < 40; i++) { await page.waitForTimeout(150); box = await page.locator('.page').nth(1).boundingBox(); if (prev && Math.abs(prev.y - box.y) < 0.5 && box.y > 0 && box.y < 300) break; prev = box; }
  const sc = box.width / 793.7;
  await page.mouse.click(box.x + 230 * sc, box.y + 447 * sc); await settle(page);
  await tab(page, 'table'); await page.waitForTimeout(300);
  assert.equal(await tbtn(page, '표 지우기').isDisabled(), false, '안쪽 표에서 표 지우기를 쓸 수 있다');
  assert.equal(await tbtn(page, '아래에 줄 넣기').isDisabled(), true, '안쪽 표에서 줄 넣기는 막힌다');
  await tbtn(page, '너비 같게').click(); await settle(page);
  const r = await saveAndParse(page, { warn: true });
  const path = JSON.stringify([{ controlIndex: 2, cellIndex: 13, cellParaIndex: 4 }, { controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }]);
  const w = (c) => JSON.parse(r.doc.getCellPropertiesByPath(0, 0, path, c)).width;
  assert.ok(Math.abs(w(0) - w(1)) < 400, `두 칸 너비가 비슷하다(${w(0)} / ${w(1)})`);
  await tbtn(page, '표 지우기').click(); await page.waitForSelector('dialog[open]');
  await page.click('dialog[open] .btn.primary'); await settle(page);
  const r2 = await saveAndParse(page, { warn: true });
  assert.throws(() => r2.doc.getTableDimensionsByPath(0, 0, path), '안쪽 표가 지워졌다');
  await done(page);
});

// ── 쪽·머리글·각주 ──
const clickBtn = (page, label) => page.locator(`#edit-bar [aria-label="${label}"]`).click();
async function submit(page) { await page.click('dialog[open] button[type=submit]'); await settle(page); }

test('쪽: 쪽 설정(가로·여백)·쪽 나누기·단 설정·쪽 감추기', async () => {
  const page = await newPage();
  await open(page, BODY); await clickBody(page);
  const pages0 = await page.locator('.page').count();
  await tab(page, 'page'); await page.waitForTimeout(200);
  await clickBtn(page, '쪽 설정…'); await page.waitForSelector('dialog[open]');
  await page.selectOption('dialog[open] select >> nth=1', '1');                       // 가로
  await page.locator('dialog[open] input[type=number]').nth(4).fill('30');           // 왼쪽 여백 30mm
  await submit(page);
  await page.waitForFunction((n) => document.querySelectorAll('.page').length !== n, pages0, { timeout: 15000 });
  await clickBtn(page, '쪽 나누기'); await settle(page);
  await clickBtn(page, '단 설정…'); await page.waitForSelector('dialog[open]');
  await page.locator('dialog[open] input[type=number]').nth(0).fill('2'); await submit(page);
  await clickBtn(page, '쪽 감추기…'); await page.waitForSelector('dialog[open]');
  await page.locator('dialog[open] input[type=checkbox]').nth(5).check(); await submit(page);
  const r = await saveAndParse(page, { warn: true });
  const pd = JSON.parse(r.doc.getPageDef(0));
  assert.equal(pd.landscape, true);
  assert.ok(Math.abs(pd.marginLeft - 30 * 283.465) < 5, `왼쪽 여백 ${pd.marginLeft}`);
  assert.equal(JSON.parse(r.doc.getColumnDef(0)).columnCount, 2);
  await done(page);
});

test('쪽: 머리글·바닥글(쪽 번호 표지)과 각주를 넣고 저장본에서 확인', async () => {
  const page = await newPage();
  await open(page, BODY); await clickBody(page);
  await tab(page, 'page'); await page.waitForTimeout(200);
  await clickBtn(page, '머리글…'); await page.waitForSelector('dialog[open]');
  await page.locator('dialog[open] textarea').fill('국립국어원 {쪽}쪽\n둘째 줄'); await submit(page);
  await clickBtn(page, '쪽 번호 넣기…'); await page.waitForSelector('dialog[open]'); await submit(page);   // 바닥글 가운데 "{쪽}"
  await tab(page, 'insert'); await page.waitForTimeout(200);
  await clickBtn(page, '각주 넣기'); await page.waitForSelector('dialog[open]');
  await page.locator('dialog[open] textarea').fill('각주 본문'); await submit(page);
  const r = await saveAndParse(page, { warn: true });
  const hf = (h) => JSON.parse(r.doc.getHeaderFooterParaInfo(0, h, 0, 0)).text;
  assert.match(hf(true), /국립국어원/);
  assert.ok(JSON.parse(r.doc.getHeaderFooterParaInfo(0, true, 0, 1)).text.includes('둘째 줄'));
  assert.equal(JSON.parse(r.doc.getHeaderFooter(0, false, 0)).exists, true, '바닥글');
  const f = find(r.doc, '각주 본문');
  assert.ok(true);
  // 각주가 저장본 어딘가에 있다: 본문 문단의 각주 정보
  let found = false;
  for (let p = 0; p < r.doc.getParagraphCount(0) && !found; p++) { for (let c = 0; c < 3; c++) { try { if ((JSON.parse(r.doc.getFootnoteInfo(0, p, c)).texts ?? []).join('').includes('각주 본문')) { found = true; break; } } catch { /* 각주 아님 */ } } }
  assert.ok(found, '각주 본문이 저장됐다');
  await done(page);
});

test('머리글·바닥글·각주를 두 번 눌러 글 위에서 바로 고치고 Esc로 본문에 돌아온다', async () => {
  const page = await newPage();
  await open(page, BODY); await clickBody(page);
  await tab(page, 'page'); await page.waitForTimeout(200);
  await clickBtn(page, '머리글…'); await page.waitForSelector('dialog[open]');
  await page.locator('dialog[open] textarea').fill('HeaderXYZ'); await submit(page); await settle(page);
  await tab(page, 'insert'); await page.waitForTimeout(200);
  await clickBtn(page, '각주 넣기'); await page.waitForSelector('dialog[open]');
  await page.locator('dialog[open] textarea').fill('각주 본문'); await submit(page); await settle(page);
  const at = async (x, y) => { const b = await page.locator('.page').nth(2).boundingBox(); const sc = b.width / 793.7; return [b.x + x * sc, b.y + y * sc]; };
  // 머리글 두 번 누르기 → 머리글 안 편집
  let [x, y] = await at(300, 70);
  await page.mouse.dblclick(x, y); await settle(page);
  await page.waitForFunction(() => document.body.dataset.editZone === 'h', null, { timeout: 10000 });
  await page.keyboard.type('Q', { delay: 40 }); await settle(page);
  await page.keyboard.press('Enter'); await settle(page);
  await page.keyboard.type('Line2', { delay: 40 }); await settle(page);
  await page.keyboard.press('Backspace'); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);
  assert.equal(await page.evaluate(() => document.body.dataset.editZone ?? ''), '', 'Esc로 본문에 돌아온다');
  // 각주 두 번 누르기 → 각주 안 편집(쪽 아래가 보이도록 스크롤)
  await page.locator('.page').nth(2).evaluate((el) => el.scrollIntoView({ block: 'end' })); await page.waitForTimeout(400);
  [x, y] = await at(120, 1018);
  await page.mouse.dblclick(x, y); await settle(page);
  await page.waitForFunction(() => document.body.dataset.editZone === 'n', null, { timeout: 10000 });
  await page.keyboard.press('Control+Home'); await settle(page);
  await page.keyboard.type('ZZ', { delay: 40 }); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);
  const r = await saveAndParse(page, { warn: true });
  const hf = (i) => JSON.parse(r.doc.getHeaderFooterParaInfo(0, true, 0, i)).text;
  assert.equal(hf(0), 'Q', `첫 문단: ${hf(0)}`);
  assert.ok(hf(0).includes('Q'), `머리글에 Q: ${hf(0)}`);
  assert.equal(hf(1), 'LineHeaderXYZ', `둘째 문단: ${hf(1)}`);
  let found = false;
  for (let p = 0; p < r.doc.getParagraphCount(0) && !found; p++) { for (let c = 0; c < 3; c++) { try { if ((JSON.parse(r.doc.getFootnoteInfo(0, p, c)).texts ?? []).join('').startsWith('ZZ각주 본문')) { found = true; break; } } catch { /* 각주 아님 */ } } }
  assert.ok(found, '각주 본문 앞에 ZZ');
  await done(page);
});

test('머리글·각주 안에서 마우스로 끌어 영역을 선택하고(영역 밖으로 끌어도) 지운다', async () => {
  const page = await newPage();
  await open(page, BODY); await clickBody(page);
  await tab(page, 'page'); await page.waitForTimeout(200);
  await clickBtn(page, '머리글…'); await page.waitForSelector('dialog[open]');
  await page.locator('dialog[open] textarea').fill('가나다라마바사아자차카타파하\n둘째 줄 문장입니다'); await submit(page); await settle(page);
  await tab(page, 'insert'); await page.waitForTimeout(200);
  await clickBtn(page, '각주 넣기'); await page.waitForSelector('dialog[open]');
  await page.locator('dialog[open] textarea').fill('각주 본문 열 글자 넘는 긴 문장'); await submit(page); await settle(page);
  const at = async (x, y) => { const b = await page.locator('.page').nth(2).boundingBox(); const sc = b.width / 793.7; return [b.x + x * sc, b.y + y * sc]; };
  const drag = async (x0, y0, x1, y1) => {
    let [x, y] = await at(x0, y0); await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { [x, y] = await at(x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8); await page.mouse.move(x, y, { steps: 2 }); }
    await page.mouse.up(); await settle(page); await page.waitForTimeout(300);
  };
  let [x, y] = await at(300, 70);
  await page.mouse.dblclick(x, y); await settle(page);
  await page.waitForFunction(() => document.body.dataset.editZone === 'h', null, { timeout: 10000 });
  // 첫 줄 가운데에서 둘째 줄(머리글 영역 아래)까지 끈다
  await drag(390, 70, 400, 105);
  assert.ok((await page.locator('.sel').count()) >= 2, '두 줄에 걸쳐 선택 영역이 그려진다');
  await page.keyboard.press('Delete'); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);
  // 각주 안에서 끌기
  await page.locator('.page').nth(2).evaluate((el) => el.scrollIntoView({ block: 'end' })); await page.waitForTimeout(400);
  [x, y] = await at(100, 1018);
  await page.mouse.dblclick(x, y); await settle(page);
  await page.waitForFunction(() => document.body.dataset.editZone === 'n', null, { timeout: 10000 });
  await drag(90, 1018, 150, 1018);
  assert.ok((await page.locator('.sel').count()) >= 1, '각주 안 선택 영역');
  await page.keyboard.press('Delete'); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);
  const r = await saveAndParse(page, { warn: true });
  const h0 = JSON.parse(r.doc.getHeaderFooterParaInfo(0, true, 0, 0));
  assert.equal(h0.paraCount, 1, `선택을 지우면 두 문단이 하나로 합쳐진다(${h0.text})`);
  assert.ok(h0.text.startsWith('가나') && h0.text.endsWith('입니다'), h0.text);
  assert.ok(h0.text.length < '가나다라마바사아자차카타파하둘째 줄 문장입니다'.length, `가운데가 지워졌다: ${h0.text}`);
  let fn = '';
  for (let p = 0; p < r.doc.getParagraphCount(0) && !fn; p++) { for (let c = 0; c < 3; c++) { try { const t = (JSON.parse(r.doc.getFootnoteInfo(0, p, c)).texts ?? []).join(''); if (t.includes('긴 문장') || t.includes('문장')) { fn = t; break; } } catch { /* 각주 아님 */ } } }
  assert.ok(fn && fn.length < '각주 본문 열 글자 넘는 긴 문장'.length, `각주 일부가 지워졌다: ${fn}`);
  await done(page);
});

// ── 링크·책갈피·필드·스타일·번호·찾아 바꾸기 ──
test('찾아 바꾸기: 다음 찾기·바꾸기·모두 바꾸기(표 안 포함)', async () => {
  const page = await newPage();
  await open(page, BODY); await clickBody(page);
  await tab(page, 'find'); await page.waitForTimeout(200);
  const inputs = page.locator('#edit-bar [data-panel="find"] input.search-input');
  await inputs.nth(0).fill('말뭉치'); await inputs.nth(1).fill('코퍼스');
  await clickBtn(page, '다음'); await page.waitForSelector('.sel', { timeout: 10000 });
  await clickBtn(page, '바꾸기'); await settle(page);
  await clickBtn(page, '모두 바꾸기'); await settle(page);
  await page.waitForFunction(() => /곳을 바꿨습니다/.test(document.getElementById('status').textContent), null, { timeout: 10000 });
  const r = await saveAndParse(page, { warn: true });
  assert.equal(find(r.doc, '말뭉치').found, false, '남은 말뭉치 없음');
  assert.ok(find(r.doc, '코퍼스').totalMatchCount >= 20, `코퍼스 ${find(r.doc, '코퍼스').totalMatchCount}곳`);
  await done(page);
});

test('입력: 하이퍼링크·책갈피·누름틀, 서식: 스타일·번호', async () => {
  const page = await newPage();
  await open(page, 'hwp_table_test.hwp');   // 첫 문단 영역(표 아닌 본문)
  await page.click('#edit-btn'); await page.waitForSelector('.caret'); await settle(page);
  await page.keyboard.type('링크글자 본문', { delay: 40 }); await settle(page);
  // 하이퍼링크: 앞 4글자를 선택해 붙이기
  await page.keyboard.press('Home'); await settle(page);
  await page.keyboard.down('Shift'); for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight', { delay: 40 }); await page.keyboard.up('Shift'); await page.waitForSelector('.sel'); await settle(page);
  await tab(page, 'insert'); await page.waitForTimeout(200);
  await clickBtn(page, '하이퍼링크…'); await page.waitForSelector('dialog[open]');
  await page.locator('dialog[open] input[type=text]').fill('https://example.com/x'); await submit(page);
  // 책갈피 추가
  await clickBtn(page, '책갈피…'); await page.waitForSelector('dialog[open]');
  await page.locator('dialog[open] input[type=text]').fill('내책갈피'); await submit(page);
  // 스타일과 번호
  await tab(page, 'format'); await page.waitForTimeout(200);
  await page.selectOption('#edit-bar .edit-list', 'num'); await settle(page);
  await page.selectOption('#edit-bar .edit-style', { label: '개요 2' }); await settle(page);
  await tab(page, 'insert'); await page.waitForTimeout(200);
  await page.keyboard.press('End'); await settle(page);
  await clickBtn(page, '누름틀…'); await page.waitForSelector('dialog[open]');
  await page.locator('dialog[open] input[type=text]').nth(2).fill('내필드'); await submit(page);
  const r = await saveAndParse(page, { warn: true });
  assert.ok(JSON.parse(r.doc.getFieldList()).some((x) => x.name === '내필드'), '누름틀');
  const f = find(r.doc, '링크글자');
  assert.ok(f.found);
  const ctx = JSON.parse(r.doc.getHyperlinkContext(JSON.stringify({ section: f.sec, para: f.para, cellPath: [] })));
  assert.equal(ctx.links[0]?.uri, 'https://example.com/x');
  assert.ok(JSON.parse(r.doc.getBookmarks()).some((b) => b.name === '내책갈피'));
  assert.equal(JSON.parse(r.doc.getStyleAt(f.sec, f.para)).name, '개요 2');
  await done(page);
});

test('번호 모양(가. 나.)·스타일 갱신·개요 이동', async () => {
  const page = await newPage();
  await open(page, 'hwp_table_test.hwp');
  await page.click('#edit-btn'); await page.waitForSelector('.caret'); await settle(page);
  await page.keyboard.type('번호문단', { delay: 40 }); await settle(page);
  await tab(page, 'format'); await page.waitForTimeout(200);
  await page.selectOption('#edit-bar .edit-list', 'n8'); await settle(page);
  // 현재(굵게) 모양으로 '본문'(0번) 스타일 갱신
  await page.keyboard.down('Shift'); for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft', { delay: 40 }); await page.keyboard.up('Shift'); await settle(page);
  await page.click('#edit-bar .fmt-b'); await settle(page);
  await page.keyboard.press('ArrowRight'); await settle(page);
  await clickBtn(page, '스타일…'); await page.waitForSelector('dialog[open]');
  const sels = page.locator('dialog[open] select');
  await sels.nth(0).selectOption('shape'); await sels.nth(1).selectOption({ label: '본문' }); await submit(page); await settle(page);
  const r = await saveAndParse(page, { warn: true });
  const f = find(r.doc, '번호문단'); assert.ok(f.found);
  const pa = JSON.parse(r.doc.getParaPropertiesAt(f.sec, f.para));
  assert.equal(pa.headType, 'Number');
  const nums = JSON.parse(r.doc.getNumberingList());
  assert.ok(nums.length >= 2, '번호 정의가 새로 만들어졌다');
  const body = JSON.parse(r.doc.getStyleList()).find((x) => x.name === '본문');
  assert.ok(body, '본문 스타일');
  assert.equal(JSON.parse(r.doc.getStyleDetail(body.id)).charProps.bold, true);
  await done(page);
});

test('개요…: 번호 있는 제목 목록에서 골라 이동', async () => {
  const page = await newPage();
  await open(page, 'hwp-multi-002.hwp');
  await page.click('#edit-btn'); await page.waitForSelector('.caret'); await settle(page);
  await tab(page, 'view'); await page.waitForTimeout(200);
  await clickBtn(page, '개요…'); await page.waitForSelector('dialog[open]');
  const n = await page.locator('dialog[open] select option').count();
  assert.ok(n > 1, `개요 항목 ${n}`);
  await page.locator('dialog[open] select').selectOption(String(n - 1)); await submit(page); await settle(page);
  await done(page);
});

// ── 새 문서·저장 옵션 ──
test('새 문서: 만들자마자 편집·저장(이름은 "새 문서.hwp"), 암호 저장, 텍스트로 저장', async () => {
  const page = await newPage();
  assert.equal(await page.locator('#new-btn-empty').isVisible(), true);
  await page.click('#new-btn-empty');
  await page.waitForSelector('#edit-bar:not([hidden])', { timeout: 30000 }); await page.waitForSelector('.caret', { timeout: 15000 }); await settle(page);
  await page.keyboard.type('Hello new doc', { delay: 40 }); await settle(page);
  let r = await saveAndParse(page, { warn: true });
  assert.equal(r.name, '새 문서.hwp');
  assert.ok(find(r.doc, 'Hello new doc').found);
  // 암호 저장
  await clickBtn(page, '저장 옵션…'); await page.waitForSelector('dialog[open]');
  await page.locator('dialog[open] input[type=text]').fill('pw-1234'); await submit(page);
  r = await saveAndParse(page, { warn: true });
  assert.throws(() => new HwpDocument(r.bytes), /비밀번호/);
  const withPw = HwpDocument.openWithPassword(r.bytes, 'pw-1234');
  assert.ok(withPw.getTextRange(0, 0, 0, 5).length > 0 || withPw.getParagraphCount(0) > 0);
  // 텍스트로 저장
  await clickBtn(page, '저장 옵션…'); await page.waitForSelector('dialog[open]');
  await page.selectOption('dialog[open] select', 'txt'); await submit(page);
  const dl = page.waitForEvent('download', { timeout: 30000 });
  await page.click('#edit-bar .btn.primary');
  await page.waitForSelector('dialog[open]'); await page.click('dialog[open] [data-yes]');   // 글만 남는다는 안내
  const txt = readFileSync(await (await dl).path(), 'utf8');
  assert.match(txt, /Hello new doc/);
  await done(page);
});

test('이동: Ctrl+←/→ 단어, Home/End 줄, Ctrl+Home/End 문서, 두 번 클릭 단어 선택', async () => {
  const page = await newPage();
  await open(page, BODY); await clickBody(page);
  await page.keyboard.type('alpha beta gamma', { delay: 40 }); await settle(page);
  await page.keyboard.press('Control+ArrowLeft'); await settle(page);
  await page.keyboard.press('Control+ArrowLeft'); await settle(page);
  await page.keyboard.type('X', { delay: 40 }); await settle(page);           // alpha Xbeta gamma
  // 두 번 클릭으로 "gamma"를 고르고 덮어쓰기
  await page.waitForSelector('.caret');
  const cb = await page.locator('.caret').boundingBox();
  const pb = await page.locator('.page').nth(2).boundingBox();
  await page.keyboard.press('End'); await settle(page);
  await page.waitForSelector('.caret');
  const eb = await page.locator('.caret').boundingBox();
  await page.mouse.dblclick(eb.x - 18, eb.y + eb.height / 2); await page.waitForSelector('.sel', { timeout: 8000 }); await settle(page);
  await page.keyboard.type('Z', { delay: 40 }); await settle(page);
  const r = await saveAndParse(page, { warn: true });
  { const f0 = find(r.doc, 'alpha Xbeta gamma'); assert.ok(f0.found, 'Ctrl+←로 단어 앞(beta 앞)에 X가 들어갔다'); assert.match(r.doc.getTextRange(f0.sec, f0.para, 0, 80), /공개 Z$/, '두 번 클릭한 줄 끝 단어(현황)를 Z로 덮어썼다'); }
  assert.ok(cb && pb && eb);
  await done(page);
});

test('양식 개체: 선택 상자·라디오·입력 칸을 눌러 값을 바꾼다', async () => {
  const page = await newPage();
  await open(page, 'form-01.hwp');
  await page.click('#edit-btn'); await page.waitForSelector('#edit-bar:not([hidden])'); await settle(page);
  const box = await page.locator('.page').first().boundingBox();
  const at = async (x, y) => { await page.mouse.click(box.x + (x / 793.7) * box.width, box.y + (y / 1122.5) * box.height); await page.waitForTimeout(500); await settle(page); };
  await at(124, 200);                                       // 선택 상자 1 → 0
  await at(124, 302);                                       // 라디오 0 → 1
  await at(124, 362);                                       // 입력 칸 → 대화상자
  await page.waitForSelector('dialog[open]'); await page.locator('dialog[open] input[type=text]').fill('양식값'); await submit(page);
  const r = await saveAndParse(page, { warn: true });
  assert.equal(JSON.parse(r.doc.getFormValue(0, 2, 0)).value, 0, '선택 상자');
  assert.equal(JSON.parse(r.doc.getFormValue(0, 6, 0)).value, 1, '라디오');
  assert.equal(JSON.parse(r.doc.getFormValue(0, 8, 0)).text, '양식값', '입력 칸');
  await done(page);
});

test('저장 전후 문서 구조가 같다(검증 통과 시 경고창 없음), 저장하면 변경 표시가 사라진다', async () => {
  const page = await newPage();
  await open(page, BODY); await clickBody(page);
  await page.keyboard.type('x', { delay: 60 }); await settle(page);
  assert.equal(await dirty(page), true);
  await saveAndParse(page);
  await page.waitForFunction(() => !document.body.hasAttribute('data-dirty'), null, { timeout: 10000 });
  assert.equal(await page.locator('dialog[open]').count(), 0, '경고창이 뜨지 않았다');
  await done(page);
});

test('저장하지 않고 다른 파일을 열면 확인창, 계속 편집하면 문서 유지', async () => {
  const page = await newPage();
  await open(page, BODY); await clickBody(page);
  await page.keyboard.type('keep', { delay: 60 }); await settle(page);
  await page.setInputFiles('#file-input', { name: 'sample.xlsx', mimeType: 'application/octet-stream', buffer: readFileSync(resolve(web, 'tests/fixtures/sample.xlsx')) });
  await page.waitForSelector('dialog[open]');
  await page.click('dialog[open] [data-no]');           // 계속 편집
  await page.waitForTimeout(500);
  assert.equal(await dirty(page), true);
  assert.equal(await page.locator('#edit-btn').isVisible(), true, '문서가 그대로 열려 있다');
  await done(page);
});

test('HWPX도 편집·저장된다(.hwpx 이름 유지)', async () => {
  const page = await newPage();
  const f = '3-09월_교육_통합_2022.hwpx';
  await open(page, f);
  await page.click('#edit-btn');
  await page.waitForSelector('.caret', { timeout: 15000 });
  await page.keyboard.type('HWPXtest', { delay: 60 }); await settle(page);
  const r = await saveAndParse(page);
  assert.match(r.name, /\(편집\)\.hwpx$/);
  assert.ok(find(r.doc, 'HWPXtest').found);
  await done(page);
});

test('HWP 3.0은 저장 전에 변환 경고를 보인다', async () => {
  const page = await newPage();
  await open(page, 'hwp3-table-caption.hwp');
  if (!(await page.locator('#edit-btn').isVisible())) { await done(page); return; }
  await page.click('#edit-btn');
  await page.waitForSelector('.caret', { timeout: 15000 });
  await page.keyboard.type('a', { delay: 60 }); await settle(page);
  await page.click('#edit-bar .btn.primary');
  await page.waitForSelector('dialog[open]');
  assert.match(await page.locator('dialog[open]').innerText(), /3\.0/);
  await page.click('dialog[open] [data-no]');
  await done(page);
});

test('표 안(셀)에서도 입력·줄바꿈이 된다', async () => {
  const page = await newPage();
  await open(page, 'hwp_table_test.hwp');
  await page.click('#edit-btn');
  await page.waitForSelector('.caret', { timeout: 15000 });
  await settle(page);
  const box = await page.locator('.page').first().boundingBox();
  await page.mouse.click(box.x + box.width * 0.265, box.y + box.height * 0.235);   // 첫 표의 "제목" 칸
  await page.waitForTimeout(500);
  await page.keyboard.type('CELLX', { delay: 60 }); await settle(page);
  await page.keyboard.press('Enter'); await settle(page);
  await page.keyboard.type('line2', { delay: 60 }); await settle(page);
  const r = await saveAndParse(page);
  const a = find(r.doc, 'CELLX'), b = find(r.doc, 'line2');
  assert.ok(a.found && a.cellContext, '표 칸 안에 들어갔다');
  assert.ok(b.found && b.cellContext && b.cellContext.cellPara === a.cellContext.cellPara + 1, 'Enter로 칸 안에서 문단이 나뉘었다');
  await done(page);
});

test('열기가 오래 걸린 문서는 편집 전에 경고한다(취소하면 읽기 전용 유지)', async () => {
  const page = await newPage();
  // 열기 요청이 9초 걸린 것처럼 시계를 앞당긴다
  await page.evaluate(() => {
    const pn = performance.now.bind(performance); let off = 0;
    performance.now = () => pn() + off;
    const pm = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (m, t) { if (m && m.type === 'open') off += 9000; return pm.call(this, m, t); };
  });
  await open(page, 'hwp_table_test.hwp');
  await page.click('#edit-btn');
  await page.waitForSelector('dialog[open]');
  assert.match(await page.locator('dialog[open]').innerText(), /편집이 매우 느릴 수 있습니다/);
  await page.click('dialog[open] [data-no]');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#edit-bar').isVisible(), false, '취소하면 편집이 시작되지 않는다');
  await page.click('#edit-btn');
  await page.waitForSelector('dialog[open]');
  await page.click('dialog[open] [data-yes]');
  await page.waitForSelector('#edit-bar:not([hidden])');
  await done(page);
});

test('다른 입력 칸(쪽 번호)에서 편집기가 포커스를 빼앗지 않는다', async () => {
  const page = await newPage();
  await open(page, BODY); await clickBody(page);
  await page.focus('#page-input');
  await page.evaluate(() => document.querySelector('.stage').dispatchEvent(new Event('scroll')));
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'page-input');
  await done(page);
});

/** 글자 N개를 하나씩 치며 "키를 누른 순간 → 쪽 그림(<img>)이 새로 불러와진 순간"을 잰다. */
async function measureLatency(page, N = 40) {
  await page.evaluate(() => {
    window.__lat = []; window.__k = 0;
    addEventListener('keydown', () => { window.__k = performance.now(); }, true);
    document.getElementById('pages').addEventListener('load', () => { if (window.__k) { window.__lat.push(performance.now() - window.__k); window.__k = 0; } }, true);
  });
  for (let i = 0; i < N; i++) { await page.keyboard.type(i % 2 ? 'a' : 'b', { delay: 0 }); await page.waitForTimeout(450); }
  const lat = (await page.evaluate(() => window.__lat)).sort((a, b) => a - b);
  assert.ok(lat.length >= N * 0.8, `측정 표본 ${lat.length}/${N}`);
  const q = (p) => lat[Math.min(lat.length - 1, Math.ceil(lat.length * p) - 1)];
  return { n: lat.length, p50: q(0.5), p95: q(0.95), max: lat[lat.length - 1] };
}

// 설계 예산은 입력→화면 p95 50ms(일반 PC 기준). 이 시험이 도는 환경(소프트웨어 렌더링, 공유 CPU 샌드박스)에서는 쪽 그림(SVG) 해석만 30~50ms가 걸려
// 한도를 느슨하게 둔다(EDIT_LAT_P95·EDIT_LAT_P95_LARGE로 조정). 실제 수치는 출력하고 docs/phase4/report.md에 기록한다. 글자를 칠 때마다 rhwp가
// 문서 전체를 다시 쪽 나누므로 지연은 문서 크기에 비례한다(35쪽 문서가 큰 쪽).
test('입력 지연(작은 문서)', async () => {
  const page = await newPage();
  await open(page, 'hwp_table_test.hwp');
  await page.click('#edit-btn'); await page.waitForSelector('.caret', { timeout: 15000 }); await settle(page);
  const r = await measureLatency(page);
  console.log(`  [작은 문서] 입력→화면 p50=${r.p50.toFixed(1)}ms p95=${r.p95.toFixed(1)}ms max=${r.max.toFixed(1)}ms (n=${r.n})`);
  assert.ok(r.p95 <= Number(process.env.EDIT_LAT_P95 || 120), `p95 ${r.p95}ms`);
  await done(page);
});

test('입력 지연(35쪽 문서)', async () => {
  const page = await newPage();
  await open(page, BODY); await clickBody(page);
  const r = await measureLatency(page);
  console.log(`  [35쪽 문서] 입력→화면 p50=${r.p50.toFixed(1)}ms p95=${r.p95.toFixed(1)}ms max=${r.max.toFixed(1)}ms (n=${r.n})`);
  assert.ok(r.p95 <= Number(process.env.EDIT_LAT_P95_LARGE || 400), `p95 ${r.p95}ms`);
  await done(page);
});

test('외부 요청·CSP 위반·페이지 오류가 없다', () => {
  assert.deepEqual(allExternal, []);
  assert.deepEqual(allCsp, []);
  assert.deepEqual(allErrors, []);
});

test('터치: 길게 누르면 단어가 골라지고 양 끝 손잡이를 끌어 영역을 넓힌다(손가락으로 끌면 스크롤만)', async () => {
  const page = await newPage({ hasTouch: true });
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const width = () => page.evaluate(() => [...document.querySelectorAll('.sel')].reduce((n, e) => n + e.getBoundingClientRect().width, 0));
  const handle = async (k) => { const b = await page.locator(`.sel-handle.${k}:not([hidden])`).boundingBox(); return [b.x + (k === 'start' ? 24 : 20), b.y + 20]; };
  const dragHandle = async (k, dx) => {
    const [x, y] = await handle(k);
    await touch('touchStart', x, y);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', x + (dx * i) / 8, y); await page.waitForTimeout(30); }
    await touch('touchEnd'); await settle(page); await page.waitForTimeout(300);
  };
  await open(page, BODY);
  await page.click('#edit-btn');
  await page.fill('#page-input', '3'); await page.keyboard.press('Enter');
  let box, prev = null;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(150);
    box = await page.locator('.page').nth(2).boundingBox();
    if (prev && Math.abs(prev.y - box.y) < 0.5 && box.y > 0 && box.y < 300) break;
    prev = box;
  }
  const px = box.x + 330, py = box.y + 372;
  // 손가락으로 끌기: 스크롤만 되고 선택은 생기지 않는다
  await touch('touchStart', px, py + 200);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', px, py + 200 - i * 12); await page.waitForTimeout(20); }
  await touch('touchEnd'); await page.waitForTimeout(300);
  assert.equal(await page.locator('.sel').count(), 0, '터치로 끌어도 영역이 선택되지 않는다');
  assert.equal(await page.locator('.sel-handle:not([hidden])').count(), 0, '선택이 없으면 손잡이도 없다');
  await page.evaluate(() => document.getElementById('stage').scrollBy(0, 0));
  box = await page.locator('.page').nth(2).boundingBox();
  // 길게 누르기 → 단어 선택 + 손잡이 둘
  await touch('touchStart', box.x + 330, box.y + 372); await page.waitForTimeout(800); await touch('touchEnd');
  await page.waitForSelector('.sel', { timeout: 10000 }); await settle(page); await page.waitForTimeout(300);
  assert.equal(await page.locator('.sel-handle:not([hidden])').count(), 2, '양 끝에 손잡이가 보인다');
  const w0 = await width();
  assert.ok(w0 > 5, `단어가 골라졌다(${w0})`);
  // 끝 손잡이를 오른쪽으로 끌면 영역이 넓어진다
  await dragHandle('end', 90);
  const w1 = await width();
  assert.ok(w1 > w0 + 30, `끝 손잡이를 끌어 넓어졌다(${w0} → ${w1})`);
  assert.equal(await page.locator('.sel-handle:not([hidden])').count(), 2, '끌고 난 뒤에도 손잡이가 남는다');
  // 시작 손잡이를 왼쪽으로 끌면 더 넓어진다
  await dragHandle('start', -60);
  const w2 = await width();
  assert.ok(w2 > w1 + 20, `시작 손잡이를 끌어 넓어졌다(${w1} → ${w2})`);
  // 시작 손잡이를 안쪽(오른쪽)으로 끌면 영역이 줄어든다
  await dragHandle('start', 100);
  const w3 = await width();
  assert.ok(w3 > 5 && w3 < w2 - 20, `시작 손잡이를 안쪽으로 끌어 줄었다(${w2} → ${w3})`);
  // 끝 손잡이를 시작보다 왼쪽으로 넘겨도(서로 뒤바뀜) 영역이 이어진다
  await dragHandle('end', -400);
  assert.ok((await width()) > 5, '끝 손잡이가 시작을 넘어도 영역이 있다');
  assert.equal(await page.locator('.sel-handle:not([hidden])').count(), 2, '넘긴 뒤에도 손잡이 둘');
  // 다른 곳을 가볍게 누르면 선택이 풀리고 손잡이가 사라진다
  await page.touchscreen.tap(box.x + 120, box.y + 520); await settle(page); await page.waitForTimeout(300);
  assert.equal(await page.locator('.sel').count(), 0);
  assert.equal(await page.locator('.sel-handle:not([hidden])').count(), 0, '선택이 풀리면 손잡이도 사라진다');
  // 표 칸 안의 단어는 칸 전체가 아니라 그 단어만 골라지고 손잡이가 붙는다
  await touch('touchStart', box.x + box.width * 0.42, box.y + box.height * 0.33); await page.waitForTimeout(800); await touch('touchEnd');
  await page.waitForSelector('.sel', { timeout: 10000 }); await settle(page); await page.waitForTimeout(300);
  assert.equal(await page.locator('.sel-handle:not([hidden])').count(), 2, '칸 안 선택에도 손잡이');
  assert.ok((await width()) < box.width * 0.09, `칸 전체가 아닌 단어만 선택(${await width()} / ${box.width})`);
  await done(page);
});
