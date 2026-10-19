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
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
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
  return { name, bytes, doc: new HwpDocument(bytes), warning };
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
  await page.click('#edit-bar [title="문단 부호 보이기·숨기기"]'); await settle(page);
  assert.equal(await page.locator('#edit-bar [title="문단 부호 보이기·숨기기"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await dirty(page), false, '보기 옵션은 변경 표시를 만들지 않는다');
  await done(page);
});

// ── 표 편집 ──
const tab = (page, name) => page.click(`#edit-bar .btn.tab[data-tab="${name}"]`);
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
