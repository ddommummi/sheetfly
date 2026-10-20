import { makeDocx, p, run, table, fieldSimple, fieldComplex } from '../../apps/web/tests/docx-fixtures.mjs';
import { irOf, flattenIr, dump, align } from './docx-ir.mjs';
import { indexParagraphs } from './docx-xml.mjs';
import { readZip, readPart } from './docx-zip.mjs';
const body = p('제목', { heading: 1 }) + p('첫 문단입니다.', { bold: true }) + `<w:p><w:r><w:t>가나</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>다라</w:t></w:r><w:r><w:t xml:space="preserve"> 마바</w:t></w:r></w:p>`
  + `<w:p>${run('앞 ')}${fieldSimple('PAGE', '7')}${run(' 뒤')}</w:p>` + `<w:p>${run('복합 ')}${fieldComplex('PAGE', '9')}</w:p>`
  + table([['A1', 'B1'], ['A2', 'B2']]) + `<w:p><w:r><w:t>탭</w:t><w:tab/><w:t>끝&amp;&lt;</w:t></w:r></w:p>` + `<w:p/>` + `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
const ir = irOf(makeDocx(body));
console.log(JSON.stringify(flattenIr(ir)));
console.log(dump(ir).slice(0, 1500));

const z = makeDocx(body); const e = readZip(z).entries.find((x) => x.name === 'word/document.xml'); const xml = readPart(z, e).toString('utf8');
const xp = indexParagraphs(xml), blocks = flattenIr(ir), map = align(blocks, xp);
console.log(blocks.map((b, i) => `${i}:${b.kind}→${map[i]}`).join(' '));
