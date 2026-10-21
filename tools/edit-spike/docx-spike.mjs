// 4-2-0 스파이크: ① ZIP 부분 교체가 바꾸지 않은 부품을 바이트 그대로 남기는가 ② document.xml 문단·런 색인이 구조를 맞게 읽는가 ③ 부분 수정이 나머지를 건드리지 않는가.
//   node tools/edit-spike/docx-spike.mjs
import { deflateRawSync, crc32 } from 'node:zlib';
import assert from 'node:assert/strict';
import { makeDocx, p, run, table, fieldSimple, fieldComplex } from '../../apps/web/tests/docx-fixtures.mjs';
import { readZip, readPart, rewriteZip } from './docx-zip.mjs';
import { indexParagraphs, insertText } from './docx-xml.mjs';

/** 실제 Word 파일처럼 deflate로 압축한 ZIP(시험 보조의 zip()은 무압축). */
function deflateZipFrom(buf) {
  const { entries } = readZip(buf);
  const parts = entries.map((e) => [e.name, readPart(buf, e)]);
  const chunks = [], central = []; let off = 0;
  for (const [name, data] of parts) {
    const nameB = Buffer.from(name), comp = deflateRawSync(data), crc = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt16LE(0, 10); h.writeUInt16LE(0x21, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nameB.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10); c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nameB.length, 28); c.writeUInt32LE(off, 42);
    chunks.push(h, nameB, comp); central.push(Buffer.concat([c, nameB])); off += 30 + nameB.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...chunks, cd, end]);
}

const body = p('제목', { heading: 1 }) + p('첫 문단입니다.', { bold: true }) + `<w:p><w:r><w:t>가나</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>다라</w:t></w:r><w:r><w:t xml:space="preserve"> 마바</w:t></w:r></w:p>`
  + `<w:p>${run('앞 ')}${fieldSimple('PAGE', '7')}${run(' 뒤')}</w:p>` + `<w:p>${run('복합 ')}${fieldComplex('PAGE', '9')}</w:p>`
  + table([['A1', 'B1'], ['A2', 'B2']]) + `<w:p><w:r><w:t>탭</w:t><w:tab/><w:t>끝&amp;&lt;</w:t></w:r></w:p>` + `<w:p/>` + `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
const plain = makeDocx(body);
const docx = deflateZipFrom(plain);

// ① ZIP 부분 교체
const z = readZip(docx);
const docPart = z.entries.find((e) => e.name === 'word/document.xml');
const xml = readPart(docx, docPart).toString('utf8');
const marker = Buffer.from('<w:t xml:space="preserve">첫 문단입니다.</w:t>', 'utf8');
const edited = Buffer.from(xml.replace('첫 문단입니다.', '첫 문단입니다. 추가!'), 'utf8');
const out = rewriteZip(docx, new Map([['word/document.xml', edited]]));
const z2 = readZip(out);
let same = 0;
for (const e of z.entries) {
  const f = z2.entries.find((x) => x.name === e.name);
  if (e.name === 'word/document.xml') { assert.equal(readPart(out, f).toString('utf8'), edited.toString('utf8')); continue; }
  const a = docx.subarray(e.localOff, e.localOff + e.localLen), b = out.subarray(f.localOff, f.localOff + f.localLen);
  assert.ok(a.equals(b), `${e.name} 바이트가 같아야 한다`); same++;
}
console.log(`① ZIP 부분 교체: 부품 ${z.entries.length}개 중 ${same}개는 압축 바이트까지 동일, document.xml만 교체 — OK`);

// ② 문단·런 색인
const paras = indexParagraphs(xml);
const summary = paras.map((q) => `${q.editable ? 'E' : 'R'}${q.depth ? `d${q.depth}` : ''}:${JSON.stringify(q.text)}${q.why ? `(${q.why})` : ''}`);
console.log('② 문단 색인:', summary.join(' | '));
assert.equal(paras.length, 12);
assert.deepEqual(paras.map((q) => q.editable), [true, true, true, false, false, true, true, true, true, true, true, false]);
assert.equal(paras[2].text, '가나다라 마바'); assert.equal(paras[2].runs.length, 3);
assert.equal(paras[9].text, '탭\t끝&<');
// 문서 문자열에서 범위가 문단 태그와 맞는지
for (const q of paras) { assert.ok(xml.slice(q.start, q.start + 4).startsWith('<w:p'), '문단 시작'); assert.ok(xml.slice(q.end - 6, q.end).endsWith('</w:p>') || xml.slice(q.start, q.end).endsWith('/>'), '문단 끝'); }

// ③ 부분 수정: 글자 넣기가 나머지를 건드리지 않는다
const para = paras[2];
const xml2 = insertText(xml, para, 3, 'XYZ');   // '가나다' 다음(둘째 런 끝)
assert.ok(xml2);
const idx2 = indexParagraphs(xml2);
assert.equal(idx2[2].text, '가나다XYZ라 마바');
console.log('   넣은 뒤 문단 3:', JSON.stringify(idx2[2].text));
// 넣은 자리 밖은 문자 단위로 같다
const a = xml, b = xml2, pre = (() => { let i = 0; while (a[i] === b[i]) i++; return i; })(), suf = (() => { let i = 0; while (a[a.length - 1 - i] === b[b.length - 1 - i]) i++; return i; })();
console.log(`③ 부분 수정: 바뀐 구간 앞 ${pre}자·뒤 ${suf}자 동일 (문서 ${a.length}자, 바뀐 부분 ${b.length - pre - suf}자)`);
assert.ok(pre + suf >= a.length - 10);
console.log('스파이크 통과');
