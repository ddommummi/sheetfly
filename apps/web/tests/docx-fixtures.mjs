// 시험용 DOCX를 직접 만든다(저장하지 않는 최소 ZIP). 외부 샘플 파일의 저작권·용량 문제를 피하고, 구조를 시험이 통제한다.
import { crc32 } from 'node:zlib';

function zip(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const u16 = (v) => Buffer.from([v & 255, (v >> 8) & 255]);
  const u32 = (v) => Buffer.from([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);
  for (const [name, data] of files) {
    const nameB = Buffer.from(enc.encode(name));
    const body = Buffer.isBuffer(data) ? data : Buffer.from(enc.encode(data));
    const crc = crc32(body);
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(body.length), u32(body.length), u16(nameB.length), u16(0), nameB, body]);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(body.length), u32(body.length), u16(nameB.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameB]));
    chunks.push(local);
    offset += local.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cd.length), u32(offset), u16(0)]);
  return Buffer.concat([...chunks, cd, end]);
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const p = (text, { bold, italic, size, align, heading, spaceAfter, line } = {}) => {
  const rpr = `${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}${size ? `<w:sz w:val="${size}"/>` : ''}`;
  const ppr = `${heading ? `<w:pStyle w:val="Heading${heading}"/>` : ''}${align ? `<w:jc w:val="${align}"/>` : ''}${spaceAfter != null || line ? `<w:spacing${spaceAfter != null ? ` w:after="${spaceAfter}"` : ''}${line ? ` w:line="${line.value}" w:lineRule="${line.rule}"` : ''}/>` : ''}`;
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
};
export const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
export const table = (rows) => `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid>${rows[0].map(() => '<w:gridCol w:w="3000"/>').join('')}</w:tblGrid>${rows.map((r) => `<w:tr>${r.map((c) => `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${p(c, { spaceAfter: 0 })}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;

const STYLES = `<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="2E74B5"/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`;

/** 본문 XML(body)만 주면 열리는 DOCX를 만든다. */
/** 필드: 단순(fldSimple)과 복합(fldChar+instrText) 두 가지 저장 형태. 결과 글자는 저장된 값('1')이다. */
export const fieldSimple = (instr, cached = '1') => `<w:fldSimple w:instr=" ${instr} "><w:r><w:t>${cached}</w:t></w:r></w:fldSimple>`;
export const fieldComplex = (instr, cached = '1') => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${cached}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
/** LibreOffice가 쓰는 형태: fldChar를 자기 닫힘이 아니라 여는/닫는 태그 쌍으로 쓴다 (실제 법령 문서에서 발견). */
export const fieldComplexPaired = (instr, cached = '1') => `<w:r><w:fldChar w:fldCharType="begin"></w:fldChar></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"></w:fldChar></w:r><w:r><w:t>${cached}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"></w:fldChar></w:r>`;
export const run = (text) => `<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
export const footerPara = (inner) => `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${inner}</w:p>`;

export function makeDocx(body, { sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708"/></w:sectPr>', footer = null } = {}) {
  if (footer) sect = sect.replace('<w:sectPr>', '<w:sectPr><w:footerReference w:type="default" r:id="rId2"/>');
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' + (footer ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : '') + '</Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' + (footer ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' : '') + '</Relationships>'],
    ['word/styles.xml', STYLES],
    ...(footer ? [['word/footer1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}>${footer}</w:ftr>`]] : []),
    ['word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`],
  ]);
}
