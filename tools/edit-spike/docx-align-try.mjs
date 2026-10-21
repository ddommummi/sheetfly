import { makeDocx, p, run, table } from '../../apps/web/tests/docx-fixtures.mjs';
import { irOf, flattenIr, align } from './docx-ir.mjs';
import { indexParagraphs } from './docx-xml.mjs';
import { readZip, readPart } from './docx-zip.mjs';
const cases = {
  hyperlink: `<w:p>${run('링크 ')}<w:hyperlink r:id="rId9"><w:r><w:t>여기</w:t></w:r></w:hyperlink>${run(' 끝')}</w:p>`,
  tracked: `<w:p>${run('가')}<w:ins w:id="1" w:author="a"><w:r><w:t>삽입</w:t></w:r></w:ins><w:del w:id="2" w:author="a"><w:r><w:delText>삭제</w:delText></w:r></w:del>${run('나')}</w:p>`,
  smart: `<w:p><w:smartTag w:uri="x" w:element="y"><w:r><w:t>스마트</w:t></w:r></w:smartTag>${run('뒤')}</w:p>`,
  sdtInline: `<w:p>${run('앞')}<w:sdt><w:sdtContent><w:r><w:t>컨트롤</w:t></w:r></w:sdtContent></w:sdt>${run('뒤')}</w:p>`,
  sdtBlock: `<w:sdt><w:sdtContent><w:p>${run('블록컨트롤')}</w:p></w:sdtContent></w:sdt>`,
  numbered: `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run('목록 항목')}</w:p>`,
  empties: `<w:p/><w:p/>${p('빈 문단 사이')}<w:p/>`,
  footnoteRef: `<w:p>${run('각주')}<w:r><w:footnoteReference w:id="2"/></w:r>${run('뒤')}</w:p>`,
  textbox: `<w:p>${run('상자 앞')}<w:r><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="wps"><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData><wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:txbx><w:txbxContent><w:p>${run('상자 안')}</w:p></w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice><mc:Fallback><w:pict><v:textbox xmlns:v="urn:schemas-microsoft-com:vml"><w:txbxContent><w:p>${run('상자 안')}</w:p></w:txbxContent></v:textbox></w:pict></mc:Fallback></mc:AlternateContent></w:r>${run('상자 뒤')}</w:p>`,
  nested: `<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>${p('바깥')}<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>${p('안쪽')}</w:tc></w:tr></w:tbl><w:p/></w:tc></w:tr></w:tbl>`,
  spaces: `<w:p><w:r><w:t xml:space="preserve">  앞뒤 공백  </w:t></w:r></w:p>`,
  tabsBreaks: `<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t></w:r></w:p>`,
  mergedRuns: `<w:p>${run('한')}${run('글')}${run(' ')}${run('Word')}</w:p>`,
  caps: `<w:p><w:r><w:rPr><w:caps/></w:rPr><w:t>abc</w:t></w:r></w:p>`,
};
let bad = 0;
for (const [name, xmlBody] of Object.entries(cases)) {
  const body = p('앞문단') + xmlBody + p('뒷문단');
  const z = makeDocx(body, {});
  let ir; try { ir = irOf(z); } catch (e) { console.log(name.padEnd(12), 'IR 실패', String(e).slice(0, 60)); continue; }
  const e = readZip(z).entries.find((x) => x.name === 'word/document.xml'); const xml = readPart(z, e).toString('utf8');
  const xp = indexParagraphs(xml), bl = flattenIr(ir), map = align(bl, xp);
  const miss = bl.map((b, i) => (b.text !== null && map[i] < 0 ? `${i}:${JSON.stringify(b.text)}` : null)).filter(Boolean);
  const edit = xp.filter((q) => q.editable).length;
  if (miss.length) bad++;
  console.log(name.padEnd(12), `XML문단 ${xp.length}(편집가능 ${edit}) IR블록 ${bl.length}`, miss.length ? `맞지 않음 ${miss.join(' ')}` : '모두 맞음', '| IR:', bl.map((b) => b.text ?? `<${b.kind}>`).join('¦').slice(0, 90));
}
console.log(bad ? `맞지 않는 경우 ${bad}` : '전부 맞음');
