import { makeDocx, p } from '../../apps/web/tests/docx-fixtures.mjs';
import { indexParagraphs, insertText } from './docx-xml.mjs';
import { readZip, readPart, rewriteZip } from './docx-zip.mjs';
import { irOf, flattenIr, align } from './docx-ir.mjs';
for (const n of [1000, 10000, 40000]) {
  const body = Array.from({ length: n }, (_, i) => p(`문단 ${i} 가나다라마바사 아자차카타파하 ` + 'lorem ipsum '.repeat(8))).join('');
  const z = makeDocx(body);
  const e = readZip(z).entries.find((x) => x.name === 'word/document.xml'); const xml = readPart(z, e).toString('utf8');
  let t = performance.now(); const xp = indexParagraphs(xml); const tIdx = performance.now() - t;
  t = performance.now(); const x2 = insertText(xml, xp[n >> 1], 5, 'X'); const tIns = performance.now() - t;
  t = performance.now(); const out = rewriteZip(z, new Map([['word/document.xml', Buffer.from(x2)]])); const tZip = performance.now() - t;
  let tIr = null, tAl = null; if (n <= 10000) { t = performance.now(); const ir = irOf(z); tIr = performance.now() - t; t = performance.now(); align(flattenIr(ir), xp); tAl = performance.now() - t; }
  console.log(`문단 ${n}: XML ${(xml.length / 1e6).toFixed(1)}MB  색인 ${tIdx.toFixed(0)}ms  글자 넣기(문자열 이어 붙이기) ${tIns.toFixed(1)}ms  ZIP 다시 쓰기 ${tZip.toFixed(0)}ms` + (tIr != null ? `  IR 읽기 ${tIr.toFixed(0)}ms  정렬 ${tAl.toFixed(0)}ms` : ''));
}
