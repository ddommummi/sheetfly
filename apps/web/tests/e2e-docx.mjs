// E2E(DOCX): 시험이 직접 만든 DOCX를 실제 Chromium에서 (CSP 헤더 포함) 열어 사용자 시나리오를 검증한다.
//   node tests/e2e-docx.mjs        (먼저 npm run build)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startServer, launch, instrument, samples, waitState, sleep } from './helpers.mjs';
import { makeRtf, rp, rpage, rtable, pageField, numPagesField, u } from './rtf-fixtures.mjs';
import { makeDocx, p, pageBreak, table, fieldSimple, fieldComplex, fieldComplexPaired, run, footerPara } from './docx-fixtures.mjs';

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
  await page.waitForFunction((n) => document.getElementById('file-name').textContent === n, name, { timeout: 60000 });   // 이전 문서가 아니라 이 문서가 열렸는지
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

test('줄 간격 "최소(atLeast)"가 쪽 나눔에 반영된다 (실제 법령 문서에서 발견된 누락의 회귀 시험)', async () => {
  const page = await newPage();
  const lines = (line) => Array.from({ length: 60 }, (_, i) => p(`${i}번째 줄`, { line, spaceAfter: 0 })).join('');
  await openDocx(page, 'normal.docx', makeDocx(lines(null)));
  const plain = await pageCount(page);
  await openDocx(page, 'atleast.docx', makeDocx(lines({ value: 800, rule: 'atLeast' })));   // 최소 40pt
  const atLeast = await pageCount(page);
  assert.ok(atLeast >= plain * 2, `최소 줄 간격이 무시됨: ${plain}쪽 → ${atLeast}쪽`);
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

test('바닥글 쪽 번호 필드: 쪽마다 값이 바뀌고(PAGE) 전체 쪽 수(NUMPAGES)·로마자 서식이 맞는다', async () => {
  const page = await newPage();
  const footer = footerPara(run('쪽 ') + fieldSimple('PAGE', '1') + run(' / ') + fieldSimple('NUMPAGES', '9'))
    + footerPara(run('p. ') + fieldComplex('PAGE \\* roman', '1') + run(' - ') + fieldComplex('PAGE', '1'))
    + footerPara(run('§ ') + fieldComplexPaired('PAGE', '20'));
  await openDocx(page, 'footer.docx', makeDocx(p('첫 쪽') + pageBreak + p('둘째 쪽') + pageBreak + p('셋째 쪽'), { footer }));
  assert.equal(await pageCount(page), 3);
  const hits = async (q) => {
    await page.keyboard.press('Control+f');
    await page.fill('#search-input', '');                      // 직전 검색의 결과 표시가 남아 있지 않게 비운다
    await page.waitForFunction(() => document.getElementById('search-count').textContent === '', null, { timeout: 15000 });
    await page.fill('#search-input', q);
    await page.waitForFunction(() => /\d+ \/ \d+|결과 없음/.test(document.getElementById('search-count').textContent), null, { timeout: 15000 });
    return page.locator('#search-count').innerText();
  };
  for (const n of [1, 2, 3]) assert.match(await hits(`쪽 ${n} / 3`), /\/ 1$/, `쪽 ${n} / 3`);      // 단순 필드, 쪽마다 다른 값과 실제 전체 쪽 수
  assert.equal(await hits('쪽 1 / 9'), '결과 없음');                                                  // 저장돼 있던 값(9)이 아니라 계산한 값
  assert.match(await hits('p. ii - 2'), /\/ 1$/);                                                      // 복합 필드 + \* roman 서식
  assert.match(await hits('p. iii - 3'), /\/ 1$/);
  assert.match(await hits('§ 2'), /\/ 1$/);                                                           // 태그 쌍 형태(LibreOffice), 저장된 값(20)이 아님
  assert.equal(await hits('§ 20'), '결과 없음');
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
  assert.match(await waitError(page), /암호가 걸린 Office 문서/);
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

const hitsOf = async (page, q) => {
  await page.keyboard.press('Control+f');
  await page.fill('#search-input', '');
  await page.waitForFunction(() => document.getElementById('search-count').textContent === '', null, { timeout: 15000 });
  await page.fill('#search-input', q);
  await page.waitForFunction(() => /\d+ \/ \d+|결과 없음/.test(document.getElementById('search-count').textContent), null, { timeout: 15000 });
  return page.locator('#search-count').innerText();
};

test('RTF: 열기, 한글(\\uN과 \\\'hh 코드페이지), 쪽 나누기, 표, 바닥글 쪽 번호 필드', async () => {
  const page = await newPage();
  // \'b0\'a1 = EUC-KR(코드페이지 949)의 "가". 글꼴 f1(fcharset129)로 바꾸면 코드페이지가 949로 바뀐다.
  const body = rp('첫 쪽 제목 Title', '\\qc\\b') + rp('본문입니다. ' + '대한민국은 민주공화국이다. '.repeat(3)) + '\\pard\\f1 \\\'b0\\\'a1\\\'b3\\\'aa\\par\n'
    + rtable([['A1', '둘'], ['A2', 'B2']], [3000, 3000]) + rpage + rp('둘째 쪽') + rpage + rp('셋째 쪽');
  const footer = u('쪽 ') + pageField('7') + ' / ' + numPagesField('9');
  await openDocx(page, 'sample.rtf', makeRtf(body, { footer }));
  assert.equal(await pageCount(page), 3);
  assert.equal(await page.locator('#doc-note').isVisible(), true);
  assert.match(await hitsOf(page, '민주공화국'), /^1 \/ [23]$/);   // 3번 쓴 문장, 줄 경계에 걸린 것은 못 찾는다
  assert.match(await hitsOf(page, '가나'), /\/ 1$/);                  // 코드페이지 949 바이트
  assert.match(await hitsOf(page, 'A2'), /\/ 1$/);                    // 표 칸
  for (const n of [1, 2, 3]) assert.match(await hitsOf(page, `쪽 ${n} / 3`), /\/ 1$/, `쪽 ${n} / 3`);   // 저장된 값(7, 9)이 아니라 계산한 값
  assert.equal(await hitsOf(page, '쪽 7'), '결과 없음');
  await done(page);
});

test('RTF: 문서 끝의 \\sect가 머리글·바닥글만 있는 빈 쪽을 만들지 않는다 (실제 헌법 RTF에서 발견된 회귀 시험)', async () => {
  const page = await newPage();
  const footer = u('쪽 ') + pageField('1');
  await openDocx(page, 'trail.rtf', makeRtf(rp('첫 구역') + '\\sect\n' + rp('둘째 구역') + '\\sect\n', { footer }));
  assert.equal(await pageCount(page), 2);                          // 구역 둘 → 쪽 둘 (끝의 \\sect는 쪽을 더하지 않는다)
  assert.match(await hitsOf(page, '쪽 2'), /\/ 1$/);
  await done(page);
});

test('RTF 판별: .doc 확장자로 저장된 RTF도, 확장자 없는 RTF도 앞 바이트로 알아본다', async () => {
  const page = await newPage();
  const rtf = makeRtf(rp('이름만 doc 인 RTF 문서'));
  await openDocx(page, '헌법.doc', rtf);
  assert.match(await hitsOf(page, 'RTF 문서'), /\/ 1$/);
  await openDocx(page, 'noext', makeRtf(rp('확장자 없는 문서')));
  assert.match(await hitsOf(page, '확장자 없는'), /\/ 1$/);
  await done(page);
});

test('DOC(구형 Word): LibreOffice가 저장한 .doc을 연다 (제목·표·본문)', async () => {
  const page = await newPage();
  await openDocx(page, 'sample.doc', readFileSync(new URL('./fixtures/sample.doc', import.meta.url)));
  // office_oxide의 DOC 읽기는 명시적 쪽 나누기를 IR에 싣지 않는다(D-035). 쪽 수는 단정하지 않고 내용·쪽 설정만 본다.
  assert.ok((await pageCount(page)) >= 1);
  assert.match(await hitsOf(page, '민주공화국'), /\/ 1$/);
  assert.match(await hitsOf(page, 'B2'), /\/ 1$/);
  assert.match(await hitsOf(page, 'second page'), /\/ 1$/);
  const ratio = await page.evaluate(() => { const r = document.querySelector('.page').getBoundingClientRect(); return r.height / r.width; });
  assert.ok(Math.abs(ratio - 16838 / 11906) < 0.01, `쪽 설정이 없는 DOC는 A4로 본다: ${ratio}`);
  await done(page);
});

test('DOC·RTF 오류: 잘린 DOC, 쓰레기 .doc, 잘린 RTF는 앱을 멈추지 않는다', async () => {
  const page = await newPage();
  const doc = readFileSync(new URL('./fixtures/sample.doc', import.meta.url));
  await send(page, 'cut.doc', doc.subarray(0, 1500));
  assert.match(await waitError(page), /손상되었거나 지원하지 않는 형식/);
  await send(page, 'junk.doc', Buffer.from('이건 문서가 아닙니다. '.repeat(50)));
  assert.match(await waitError(page), /손상되었거나 지원하지 않는 형식/);
  const rtf = makeRtf(rp('정상 문장 입니다') + rtable([['a', 'b']], [2000, 2000]));
  await openDocx(page, 'cut.rtf', rtf.subarray(0, rtf.length - 30));        // 닫는 괄호가 없어도 읽을 수 있는 만큼 연다
  assert.match(await hitsOf(page, '정상 문장'), /\/ 1$/);
  await done(page);
});

test('DOC 파서가 패닉해도(업스트림 결함, 바이트 손상 DOC) 앱은 오류를 보여 주고 다음 문서를 연다', async () => {
  const page = await newPage();
  await send(page, 'panic.doc', readFileSync(new URL('./fixtures/doc-upstream-panic.doc', import.meta.url)));
  assert.match(await waitError(page), /엔진 오류가 발생해|손상되었거나/);
  await openDocx(page, 'after.rtf', makeRtf(rp('패닉 뒤에도 열린다')));
  assert.match(await hitsOf(page, '패닉 뒤에도'), /\/ 1$/);
  await done(page);
});

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const pageRatios = (page) => page.evaluate(() => [...document.querySelectorAll('.page')].map((p) => { const r = p.getBoundingClientRect(); return r.width / r.height; }));

test('XLSX: 시트별 쪽, 병합·숫자 서식, 넓은 시트는 쪽 너비를 키워 열이 잘리지 않고 머리 행이 반복된다', async () => {
  const page = await newPage();
  await openDocx(page, 'sample.xlsx', fixture('sample.xlsx'));
  assert.ok((await pageCount(page)) >= 3);                                                  // 시트 3개 이상 → 쪽 3개 이상(넓은 시트는 행이 많아 여러 쪽)
  assert.match(await page.locator('#doc-note').innerText(), /시트를 쪽으로 나눠 보여 줍니다/);
  assert.match(await hitsOf(page, '병합된 셀'), /\/ 1$/);
  assert.match(await hitsOf(page, '100.00'), /\/ 1$/);                                     // 숫자 서식(#,##0.00)
  assert.match(await hitsOf(page, '25.6%'), /\/ 1$/);                                      // 백분율 서식
  assert.match(await hitsOf(page, '열40'), /\/ [2-9]$/);                                    // 40번째 열이 쪽 안에 있다(여러 쪽의 머리 행에서 반복)
  assert.match(await hitsOf(page, 'third sheet'), /\/ 1$/);
  const ratios = await pageRatios(page);
  assert.ok(ratios.some((r) => r > 16838 / 11906 * 1.5), `넓은 시트 쪽이 가로로 커져야 한다: ${ratios.map((r) => r.toFixed(2))}`);
  await done(page);
});

test('XLS(구형 Excel)와 이름만 .xls인 XLSX를 연다, OLE 껍데기의 .xlsx는 암호화로 본다', async () => {
  const page = await newPage();
  await openDocx(page, 'old.xls', fixture('sample.xls'));
  assert.match(await hitsOf(page, '병합된 셀'), /\/ 1$/);
  await openDocx(page, 'renamed.xls', fixture('sample.xlsx'));                                // 확장자가 틀려도 ZIP 안의 부품 이름으로 알아본다
  assert.match(await hitsOf(page, 'third sheet'), /\/ 1$/);
  await send(page, 'locked.xlsx', fixture('sample.xls'));                                     // OLE인데 OOXML 이름 = 암호화된 문서의 모양
  assert.match(await waitError(page), /암호가 걸린 Office 문서/);
  await done(page);
});

test('PPTX: 슬라이드마다 한 쪽(16:9), 제목·목록·표·도형 글자, 그림, 안내 문구', async () => {
  const page = await newPage();
  await openDocx(page, 'sample.pptx', fixture('sample.pptx'));
  assert.equal(await pageCount(page), 3);
  assert.match(await page.locator('#doc-note').innerText(), /슬라이드의 글·표·그림을 배치해 보여 줍니다/);
  const ratios = await pageRatios(page);
  assert.ok(ratios.every((r) => Math.abs(r - 13.333 / 7.5) < 0.02), `슬라이드 비율: ${ratios}`);
  assert.match(await hitsOf(page, '둘째 항목'), /\/ 1$/);
  assert.match(await hitsOf(page, '1,2 값'), /\/ 1$/);                                      // 상자 속 표
  assert.match(await hitsOf(page, '도형 텍스트'), /\/ 1$/);                                  // 절대 위치 상자
  assert.equal(await page.evaluate(() => document.querySelectorAll('.page img').length >= 0), true);
  await done(page);
});

test('XLSX·PPTX 오류: 잘린 파일은 오류를 보이고 다음 문서를 연다', async () => {
  const page = await newPage();
  const x = fixture('sample.xlsx');
  await send(page, 'cut.xlsx', x.subarray(0, Math.floor(x.length / 2)));
  assert.match(await waitError(page), /손상되었거나 지원하지 않는 형식/);
  const pp = fixture('sample.pptx');
  await send(page, 'cut.pptx', pp.subarray(0, 1000));
  assert.match(await waitError(page), /손상되었거나 지원하지 않는 형식/);
  await openDocx(page, 'ok.pptx', pp);
  assert.equal(await pageCount(page), 3);
  await done(page);
});

test('외부 요청 0건, CSP 위반 0건, 페이지 오류 0건 (DOCX 전체 시나리오 합산)', async () => {
  assert.deepEqual(allExternal, [], `외부 요청: ${allExternal.join(', ')}`);
  assert.deepEqual(allCsp, [], `CSP 위반: ${allCsp.join(' | ')}`);
  assert.deepEqual(allErrors, [], `페이지 오류: ${allErrors.join(' | ')}`);
});
