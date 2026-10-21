// DOCX 편집 모델 단위 시험(합성 문서): node --test tests/docx-edit-model.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDocx, p, run, table, fieldSimple, zip } from './docx-fixtures.mjs';
import { DocxEditModel, EditError } from '../src/docx/edit/model.js';
import { readZip, readPart } from '../src/docx/edit/zip.js';
import { irOf, irTexts } from './docx-edit-helpers.mjs';

const u8 = (b) => new Uint8Array(b);
const open = async (body, opts) => { const bytes = u8(makeDocx(body, opts)); return { bytes, m: await DocxEditModel.open(bytes, irOf(bytes)) }; };
/** 저장→다시 열기: office_oxide가 읽은 글이 모델의 글과 같은가 */
async function reload(m) { const out = await m.save(); return { out, texts: irTexts(irOf(out)) }; }
const modelTexts = (m) => Array.from({ length: m.paragraphCount }, (_, i) => m.text(i)).filter(Boolean);

test('글 넣기·지우기·나누기·합치기와 저장 뒤 다시 읽기', async () => {
  const { m } = await open(p('제목', { heading: 1 }) + p('첫 문단입니다.', { bold: true }) + `<w:p><w:r><w:t>가나</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>다라</w:t></w:r><w:r><w:t xml:space="preserve"> 마바</w:t></w:r></w:p>` + p('끝'));
  assert.equal(m.canEdit(2), true);
  let pos = m.insertText(2, 3, 'XY&<>"\''); assert.deepEqual(pos, { p: 2, o: 3 + 7 });
  assert.equal(m.text(2), "가나다XY&<>\"'라 마바");
  m.deleteRange({ p: 2, o: 0 }, { p: 2, o: 2 }); assert.equal(m.text(2), "다XY&<>\"'라 마바");
  pos = m.splitParagraph(2, 3); assert.deepEqual(pos, { p: 3, o: 0 });
  assert.equal(m.text(2), '다XY'); assert.equal(m.text(3), "&<>\"'라 마바");
  m.insertText(3, 0, '탭\t뒤');
  assert.equal(m.text(3), "탭\t뒤&<>\"'라 마바");
  pos = m.mergeBack(3); assert.equal(pos.p, 2); assert.equal(m.text(2), "다XY탭\t뒤&<>\"'라 마바");
  m.deleteRange({ p: 1, o: 3 }, { p: 3, o: 1 });   // 문단을 가로지르는 지우기
  const { texts } = await reload(m);
  assert.deepEqual(texts, modelTexts(m));
});

test('되돌리기·다시 하기가 문단 목록과 글을 되돌린다', async () => {
  const { m } = await open(p('하나') + p('둘') + p('셋'));
  const before = m.xml();
  m.insertText(0, 1, 'A'); m.splitParagraph(1, 1); m.mergeBack(2); m.deleteRange({ p: 0, o: 0 }, { p: 1, o: 1 });
  const after = m.xml();
  assert.notEqual(after, before);
  while (m.undo()); assert.equal(m.xml(), before); assert.equal(m.paragraphCount, 3);
  while (m.redo()); assert.equal(m.xml(), after);
});

test('편집하지 않은 부분은 한 글자도, 바꾸지 않은 ZIP 부품은 바이트도 같다', async () => {
  const { bytes, m } = await open(p('앞 문단') + p('가운데') + table([['A1', 'B1'], ['A2', 'B2']]) + p('뒤 문단'), { footer: p('바닥글') });
  const xml0 = m.xml();
  m.insertText(1, 1, '★');
  const xml1 = m.xml();
  let pre = 0; while (xml0[pre] === xml1[pre]) pre++;
  let suf = 0; while (xml0[xml0.length - 1 - suf] === xml1[xml1.length - 1 - suf]) suf++;
  assert.ok(xml1.length - pre - suf <= 4, `바뀐 구간 ${xml1.length - pre - suf}자`);
  const out = await m.save();
  const z0 = readZip(bytes), z1 = readZip(out);
  for (const e of z0.entries) {
    if (e.name === 'word/document.xml') continue;
    const f = z1.entries.find((x) => x.name === e.name);
    assert.ok(bytes.subarray(e.localOff, e.localOff + e.localLen).every((v, i) => v === out[f.localOff + i]) && e.localLen === f.localLen, `${e.name} 바이트 동일`);
  }
  assert.equal(await (async () => new TextDecoder().decode(await readPart(out, z1.entries.find((x) => x.name === 'word/document.xml'))))(), xml1);
});

test('잠금: 필드·표 칸 경계·변경 추적·이름 공간', async () => {
  const { m } = await open(p('보통') + `<w:p>${run('앞 ')}${fieldSimple('PAGE', '7')}${run(' 뒤')}</w:p>` + table([['A1', 'B1']]) + p('끝'));
  assert.equal(m.canEdit(0), true);
  assert.match(m.lock(1), /fldSimple/);
  assert.throws(() => m.insertText(1, 0, 'x'), (e) => e instanceof EditError && e.code === 'locked');
  // 표 칸 안 입력은 된다, 칸을 가로지르는 합치기·지우기는 안 된다
  assert.equal(m.canEdit(2), true);
  m.insertText(2, 2, '!'); assert.equal(m.text(2), 'A1!');
  assert.throws(() => m.mergeBack(3), (e) => e.code === 'not_sibling');
  assert.throws(() => m.deleteRange({ p: 2, o: 0 }, { p: 3, o: 1 }), (e) => e.code === 'not_sibling');
  // 변경 내용 추적
  const bytes = u8(zip([['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>글</w:t></w:r></w:p></w:body></w:document>'],
    ['word/settings.xml', '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:trackRevisions/></w:settings>']]));
  const t = await DocxEditModel.open(bytes, null);
  assert.match(t.lock(0), /추적/);
  // 접두사가 w가 아닌 문서
  const ns = u8(zip([['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', '<?xml version="1.0"?><ns0:document xmlns:ns0="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><ns0:body><ns0:p><ns0:r><ns0:t>접두사</ns0:t></ns0:r></ns0:p></ns0:body></ns0:document>']]));
  const n = await DocxEditModel.open(ns, null);
  assert.equal(n.canEdit(0), true); n.insertText(0, 3, '다름'); n.splitParagraph(0, 2);
  assert.equal(n.text(0), '접두'); assert.equal(n.text(1), '사다름');
  assert.match(n.xml(), /<ns0:p><ns0:r><ns0:t xml:space="preserve">사다름<\/ns0:t>|<ns0:t xml:space="preserve">접두<\/ns0:t>/);
});

test('빈 문단·하이퍼링크 문단에 글 넣기', async () => {
  const { m } = await open(p('앞') + '<w:p><w:pPr><w:rPr><w:i/></w:rPr></w:pPr></w:p>' + `<w:p>${run('링크 ')}<w:hyperlink r:id="rId9"><w:r><w:t>여기</w:t></w:r></w:hyperlink>${run(' 끝')}</w:p>` + p('뒤'));
  // 서식만 있는 빈 문단: IR이 문단으로 두면 편집되고(문단 부호 서식을 물려받는다), 아니면 짝이 없어 잠긴다
  if (m.canEdit(1)) { m.insertText(1, 0, '새'); assert.equal(m.text(1), '새'); assert.match(m.xml(), /<w:i\/><\/w:rPr><w:t xml:space="preserve">새/); } else assert.match(m.lock(1), /짝/);
  assert.equal(m.canEdit(2), true);
  m.insertText(2, 3, '+'); assert.equal(m.text(2), '링크 +여기 끝');
  m.insertText(2, 6, '!'); assert.equal(m.text(2), '링크 +여기! 끝');
  m.splitParagraph(2, 5);
  assert.equal(m.text(2), '링크 +여'); assert.equal(m.text(3), '기! 끝');
  const { texts } = await reload(m);
  assert.deepEqual(texts, modelTexts(m));
});
