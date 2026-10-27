// Word가 한 줄의 높이를 정하는 방식에 맞추는 보정.
//
// 브라우저(캔버스)는 "실제로 그리는 글꼴"의 ascent+descent를 준다. 그런데 Word는 문서가 선언한 글꼴의 값으로 줄을 쌓는다.
// 맑은 고딕을 선언한 문서는 사용자 기기에 맑은 고딕이 없어도(Linux·모바일) Word에서는 글자 크기의 1.7292배 높이로 줄이 쌓인다.
// 브라우저 값(글꼴 없음 1.12, Noto Sans KR 1.45, Windows의 맑은 고딕 약 1.33)을 그대로 쓰면 줄이 11~39% 짧아져 쪽 나눔이 어긋난다.
// 그래서 선언된 글꼴이 아래 표에 있으면 한 줄 높이(ascent+descent)를 `배수 × 글자 크기`로 정한다. ascent:descent 비율은 브라우저 값을 따른다.
//
// 값은 GenOffice가 Word for Mac으로 잰 정답이다(packages/docx-engine/tests/fixtures/truths 의 malgun-line-pitch-sizes·cjk-face-factors).
// 표에 없는 글꼴(굴림·돋움·궁서·함초롬 등)은 Word 정답이 없어 브라우저 값을 그대로 쓴다. 근거와 한계: docs/phase4/trial-korean-lineheight.md.
const FACTORS = new Map([
  ['맑은 고딕', 1.7292], ['malgun gothic', 1.7292],
  ['바탕', 1.3], ['batang', 1.3],
]);

/** CSS font 단축 속성("italic bold 14.667px "맑은 고딕", sans-serif")에서 글자 크기(px)와 첫 번째 글꼴 이름을 꺼낸다. */
function parseFont(font) {
  const m = /(?:^|\s)([\d.]+)px\s+(.+)$/.exec(font);
  if (!m) return null;
  const first = m[2].split(',')[0].trim().replace(/^["']|["']$/g, '');
  return { px: parseFloat(m[1]), family: first };
}

/** 선언된(CSS 목록의 첫 번째) 글꼴의 Word 한 줄 높이 배수. 표에 없으면 null. */
export function wordLineFactor(font) {
  const p = parseFont(font);
  return p ? (FACTORS.get(p.family.toLowerCase()) ?? null) : null;
}

/** 브라우저가 준 { ascent, descent }를 Word 배수에 맞춘다. 표에 없는 글꼴이면 그대로 돌려준다. */
export function applyWordLineFactor(font, m) {
  const f = wordLineFactor(font);
  if (f == null) return m;
  const { px } = parseFont(font);
  const sum = m.ascent + m.descent;
  const total = px * f;
  const r = sum > 0 ? m.ascent / sum : 0.8;
  return { ascent: total * r, descent: total * (1 - r) };
}
