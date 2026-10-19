// DOCX 글꼴 이름 → CSS font-family. 사용자 기기 글꼴을 쓰므로 비슷한 글꼴을 뒤에 둔다.
// 시험에서는 setFontOverride('Carlito')로 모든 글꼴을 한 글꼴로 통일해 두 엔진을 같은 조건으로 비교한다.
let override = null;
export const setFontOverride = (family) => { override = family; };

const SERIF = /times|georgia|cambria|garamond|palatino|batang|myungjo|바탕|명조|궁서|gungsuh|mincho|song|simsun|serif/i;
const MONO = /courier|consolas|mono|굴림체|돋움체|gulimche|dotumche|menlo/i;
const KOREAN_SANS = ['"Malgun Gothic"', '"맑은 고딕"', '"Apple SD Gothic Neo"', '"Noto Sans KR"', '"Noto Sans CJK KR"', '"NanumGothic"'];
const KOREAN_SERIF = ['"Batang"', '"바탕"', '"Noto Serif KR"', '"Noto Serif CJK KR"', '"AppleMyungjo"'];
const FALLBACK = {
  calibri: ['Calibri', 'Carlito'], cambria: ['Cambria', 'Caladea'], arial: ['Arial', 'Liberation Sans', 'Helvetica'],
  'times new roman': ['"Times New Roman"', '"Liberation Serif"', 'Times'], 'courier new': ['"Courier New"', '"Liberation Mono"'],
};

export function fontFamily(name) {
  if (override) return override;
  const n = String(name || '').trim();
  if (!n) return 'Calibri, Carlito, sans-serif';
  const key = n.toLowerCase().replace(/ light$| semilight$/, '');
  const quoted = /[\s,]/.test(n) ? `"${n.replace(/"/g, '')}"` : n;
  const list = FALLBACK[key] ?? [quoted];
  const generic = MONO.test(n) ? 'monospace' : SERIF.test(n) ? 'serif' : 'sans-serif';
  const ko = SERIF.test(n) ? KOREAN_SERIF : KOREAN_SANS;
  return [...list, ...ko, generic].join(', ');
}

/** CSS font 단축 속성. */
export const cssFont = ({ italic, bold, px, family }) => `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${Math.round(px * 1000) / 1000}px ${family}`;
