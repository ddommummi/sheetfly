// DOCX 편집 모델 퍼저(합성 문서): 여러 구성(필드·변경 추적·내용 컨트롤·글상자·중첩 표·병합 칸·빈 문단 …)을 무작위로 이어 붙인 문서에
// 무작위 편집 열을 적용하고 docx-edit-oracle.mjs로 검증한다. 코퍼스가 없어도 CI에서 돈다.   node tests/docx-edit-fuzz.mjs [--seed N] [--docs N] [--ops N]
import { makeDocx, p, run, table, fieldSimple, fieldComplex } from './docx-fixtures.mjs';
import { checkDocx, rng } from './docx-edit-oracle.mjs';

const argv = process.argv.slice(2), arg = (k, d) => (argv.includes(`--${k}`) ? Number(argv[argv.indexOf(`--${k}`) + 1]) : d);
const SEED = arg('seed', 1), DOCS = arg('docs', 150), OPS = arg('ops', 12);
const R = rng(SEED);
const WORDS = ['가나다', '라마바', 'Hello', 'World', '문단', '예', '4', '2024년', '※', 'abc def', '한 글 and English'];
const w = () => WORDS[Math.floor(R() * WORDS.length)] + (R() < 0.3 ? ` ${WORDS[Math.floor(R() * WORDS.length)]}` : '');
const rp = (n = 1) => Array.from({ length: n }, () => w()).join('');
const BLOCKS = [
  () => p(w()), () => p(w(), { bold: true }), () => p(w(), { heading: 1 }), () => p(w(), { align: 'center' }),
  () => '<w:p/>', () => '<w:p><w:pPr><w:rPr><w:i/></w:rPr></w:pPr></w:p>',
  () => `<w:p><w:r><w:t>${w()}</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>${w()}</w:t></w:r><w:r><w:t xml:space="preserve"> ${w()}</w:t></w:r></w:p>`,
  () => `<w:p>${run(w() + ' ')}<w:hyperlink r:id="rId9"><w:r><w:t>${w()}</w:t></w:r></w:hyperlink>${run(' ' + w())}</w:p>`,
  () => `<w:p>${run('앞 ')}${fieldSimple('PAGE', '7')}${run(' 뒤')}</w:p>`,
  () => `<w:p>${run('복합 ')}${fieldComplex('PAGE', '9')}</w:p>`,
  () => `<w:p>${run('가')}<w:ins w:id="1" w:author="a"><w:r><w:t>삽입</w:t></w:r></w:ins>${run('나')}</w:p>`,
  () => `<w:p>${run('앞')}<w:sdt><w:sdtContent><w:r><w:t>컨트롤</w:t></w:r></w:sdtContent></w:sdt>${run('뒤')}</w:p>`,
  () => `<w:sdt><w:sdtContent><w:p>${run(w())}</w:p><w:p/></w:sdtContent></w:sdt>`,
  () => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run(w())}</w:p>`,
  () => `<w:p><w:r><w:t>${w()}</w:t><w:tab/><w:t>${w()}</w:t><w:br/><w:t>${w()}</w:t></w:r></w:p>`,
  () => `<w:p><w:r><w:rPr><w:caps/></w:rPr><w:t>${w()}</w:t></w:r></w:p>`,
  () => `<w:p>${run('각주')}<w:r><w:footnoteReference w:id="2"/></w:r>${run('뒤')}</w:p>`,
  () => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
  () => table([[w(), w()], ['', w()], [w(), '']]),
  () => `<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>${p(w())}<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>${p(w())}</w:tc></w:tr></w:tbl><w:p/></w:tc></w:tr></w:tbl>`,
  () => `<w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>${p(w())}</w:tc><w:tc>${p(w())}</w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc>${p(w())}</w:tc></w:tr></w:tbl>`,
  () => `<w:p>${run(w())}<w:r><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="wps"><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData><wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:txbx><w:txbxContent><w:p>${run(w())}</w:p></w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice><mc:Fallback><w:pict><v:textbox xmlns:v="urn:schemas-microsoft-com:vml"><w:txbxContent><w:p>${run('폴백')}</w:p></w:txbxContent></v:textbox></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`,
  () => `<w:p><w:r><w:t xml:space="preserve">  ${w()}  </w:t></w:r></w:p>`,
  () => `<w:p w14:paraId="${Math.floor(R() * 9e7)}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">${run(w())}</w:p>`,
];
const fails = []; let ops = 0, docs = 0, skipped = 0;
for (let d = 0; d < DOCS; d++) {
  const n = 4 + Math.floor(R() * 26);
  const body = Array.from({ length: n }, () => BLOCKS[Math.floor(R() * BLOCKS.length)]()).join('');
  const bytes = new Uint8Array(makeDocx(body));
  const r = await checkDocx(bytes, rng(SEED * 7919 + d), OPS);
  if (r.status === 'skip') { skipped++; continue; }
  docs++; ops += r.applied;
  if (r.status === 'fail') fails.push({ d, msg: r.failure, body: body.length > 900 ? `${body.slice(0, 900)}…` : body });
}
console.log(`퍼저 seed=${SEED}: 문서 ${docs}개(건너뜀 ${skipped}), 편집 ${ops}회, 실패 ${fails.length}`);
for (const f of fails.slice(0, 5)) console.log(`  ✗ doc ${f.d}: ${f.msg}\n    ${f.body.slice(0, 500)}`);
process.exitCode = fails.length ? 1 : 0;
