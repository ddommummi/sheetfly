// 시험용 RTF를 직접 만든다. 한글은 \uN?(유니코드)과 \'hh(코드페이지 949)를 모두 써서 두 경로를 시험한다.
export const u = (s) => [...s].map((c) => { const n = c.codePointAt(0); return n < 128 ? c : `\\u${n > 32767 ? n - 65536 : n}?`; }).join('');
export const rp = (text, fmt = '') => `\\pard${fmt} ${u(text)}\\par\n`;
export const rpage = '\\page\n';
export const rtable = (rows, widths) => rows.map((cells) => {
  let x = 0;
  const defs = widths.map((w) => `\\clcbpat1\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10\\cellx${(x += w)}`).join('');
  return `\\trowd\\trgaph108${defs}\n${cells.map((c) => `\\pard\\intbl ${u(c)}\\cell`).join('')}\\row\n`;
}).join('');

/** 최소 RTF 문서. A4(11906x16838), 여백 1440. body는 위 헬퍼로 만든 조각. */
export function makeRtf(body, { footer = '', header = '', extra = '' } = {}) {
  const head = `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fnil\\fcharset0 Arial;}{\\f1\\fnil\\fcharset129 Malgun Gothic;}}{\\colortbl;\\red255\\green255\\blue255;\\red255\\green0\\blue0;}\\paperw11906\\paperh16838\\margl1440\\margr1440\\margt1440\\margb1440${extra}\n`;
  const hf = (header ? `{\\header\\pard ${header}\\par}` : '') + (footer ? `{\\footer\\pard\\qc ${footer}\\par}` : '');
  return Buffer.from(head + hf + body + '}', 'latin1');
}
export const pageField = (cached = '1') => `{\\field{\\*\\fldinst PAGE}{\\fldrslt ${cached}}}`;
export const numPagesField = (cached = '1') => `{\\field{\\*\\fldinst NUMPAGES}{\\fldrslt ${cached}}}`;
