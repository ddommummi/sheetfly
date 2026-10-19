// 글자 분해와 줄 나눔 규칙. 한글·한자·가나는 글자 단위로 끊고, 금칙 문장부호는 줄 머리/끝에 오지 않게 한다.
const CJK = /[ᄀ-ᇿ⺀-⿟　-〿぀-ヿ㄰-㆏ㇰ-ㇿ㈀-㋿㐀-䶿一-鿿가-힯豈-﫿＀-￯]/;
// 줄 머리에 올 수 없는 글자(닫는 문장부호, 마침표 등)
const NO_START = new Set(Array.from('、。，．・：；？！゛゜ヽヾー）〕］｝〉》」』】’”%‰°′″,.:;!?)]}'));
// 줄 끝에 올 수 없는 글자(여는 문장부호)
const NO_END = new Set(Array.from('（〔［｛〈《「『【‘“([{'));

export const isCjk = (ch) => CJK.test(ch);
export const isSpace = (ch) => ch === ' ' || ch === ' ' || ch === '　' ? true : false;

/**
 * 한 줄 안의 글자열을 토큰으로 나눈다.
 * kind: 'space' | 'word' | 'cjk' | 'tab' | 'br'. 'cjk'는 글자 하나(한글 음절 포함).
 */
export function tokenize(text) {
  const out = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ kind: 'word', text: buf }); buf = ''; } };
  for (const ch of text) {
    if (ch === '\t') { flush(); out.push({ kind: 'tab', text: ch }); }
    else if (ch === '\n' || ch === '\v') { flush(); out.push({ kind: 'br', text: ch }); }
    else if (ch === ' ' || ch === ' ') { flush(); const last = out[out.length - 1]; if (last && last.kind === 'space' && last.text[0] === ch) last.text += ch; else out.push({ kind: 'space', text: ch, nbsp: ch === ' ' }); }
    else if (CJK.test(ch)) { flush(); out.push({ kind: 'cjk', text: ch }); }
    else if (ch === '-' && buf) { buf += ch; flush(); }
    else buf += ch;
  }
  flush();
  return out;
}

/** 두 토큰 사이에서 줄을 바꿀 수 있는가. prev/next는 같은 문단의 연속 토큰. */
export function canBreakBetween(prev, next) {
  if (!prev || !next) return false;
  if (next.kind === 'space') return false;       // 공백은 앞 토큰에 매달린다
  if (prev.kind === 'space') return !prev.nbsp;
  if (prev.kind === 'br' || next.kind === 'br') return false;
  if (prev.kind === 'tab') return true;
  if (next.noBreakBefore) return false;           // 같은 낱말이 서식 경계에서 갈린 경우
  const nextFirst = next.text[0];
  const prevLast = prev.text[prev.text.length - 1];
  if (NO_START.has(nextFirst) && next.kind === 'cjk') return false;
  if (NO_END.has(prevLast) && prev.kind === 'cjk') return false;
  if (prev.kind === 'cjk' || next.kind === 'cjk') return true;
  if (prev.kind === 'word' && prev.text.endsWith('-')) return true; // 하이픈 뒤
  return false;
}

// ── 목록 번호 ────────────────────────────────────────────────────────
const ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
const roman = (n) => { let s = ''; for (const [v, r] of ROMAN) while (n >= v) { s += r; n -= v; } return s; };
const alpha = (n) => { let s = ''; while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } return s; };
const HANGUL = Array.from('가나다라마바사아자차카타파하');
const KOREAN_GANADA = (n) => HANGUL[(n - 1) % HANGUL.length];

export function formatNumber(n, style) {
  switch (String(style || 'decimal')) {
    case 'lowerLetter': case 'lower_letter': return alpha(n);
    case 'upperLetter': case 'upper_letter': return alpha(n).toUpperCase();
    case 'lowerRoman': case 'lower_roman': return roman(n);
    case 'upperRoman': case 'upper_roman': return roman(n).toUpperCase();
    case 'ganada': case 'korean': return KOREAN_GANADA(n);
    case 'decimalZero': return String(n).padStart(2, '0');
    default: return String(n);
  }
}
