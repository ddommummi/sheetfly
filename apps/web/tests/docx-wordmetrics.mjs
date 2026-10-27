// Word 줄 높이 보정 단위 시험: node --test tests/docx-wordmetrics.mjs
// (A) 선언된 한글 글꼴 → Word 한 줄 높이 배수, (B) 줄바꿈은 바로 앞 글의 글꼴을 따른다. 근거: docs/phase4/trial-korean-lineheight.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordLineFactor, applyWordLineFactor } from '../src/docx/wordmetrics.js';
import { createCanvasMeasurer, createFakeMeasurer } from '../src/docx/measure.js';
import { fontFamily, cssFont } from '../src/docx/fonts.js';
import { inlineTokens, breakLines } from '../src/docx/paragraph.js';

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const fontOf = (name, px, o = {}) => cssFont({ italic: o.italic, bold: o.bold, px, family: fontFamily(name) });

test('선언된 첫 글꼴이 표에 있을 때만 배수가 나온다', () => {
  assert.equal(wordLineFactor(fontOf('맑은 고딕', 14.667)), 1.7292);
  assert.equal(wordLineFactor(fontOf('Malgun Gothic', 14.667, { bold: true, italic: true })), 1.7292);
  assert.equal(wordLineFactor(fontOf('malgun gothic', 16)), 1.7292);
  assert.equal(wordLineFactor(fontOf('바탕', 14.667)), 1.3);
  assert.equal(wordLineFactor(fontOf('Batang', 14.667)), 1.3);
  // 표에 없는 글꼴·기본 글꼴은 손대지 않는다(Word 정답이 없다)
  for (const n of ['굴림', '돋움', '궁서', '함초롬바탕', 'Calibri', 'Arial', 'Times New Roman', '', undefined]) assert.equal(wordLineFactor(fontOf(n, 14.667)), null, String(n));
  // 첫 글꼴이 아니라 뒤쪽 대체 글꼴에 있을 뿐이면 해당하지 않는다: Calibri의 대체 목록에는 한글 글꼴이 없고, 굴림은 목록 뒤쪽에 "Malgun Gothic"이 붙는다
  assert.ok(fontOf('굴림', 14.667).includes('"Malgun Gothic"'));
  assert.equal(wordLineFactor(fontOf('굴림', 14.667)), null);
  assert.equal(wordLineFactor('garbage'), null);
});

test('한 줄 높이가 배수×글자 크기가 되고 ascent:descent 비율은 유지된다', () => {
  const m = { ascent: 17.6, descent: 4.4 };   // 합 22(=글자 크기 16px의 1.375배)
  const out = applyWordLineFactor(fontOf('맑은 고딕', 16), m);
  near(out.ascent + out.descent, 16 * 1.7292);
  near(out.ascent / (out.ascent + out.descent), 0.8);
  const bt = applyWordLineFactor(fontOf('Batang', 20), { ascent: 9, descent: 3 });
  near(bt.ascent + bt.descent, 20 * 1.3);
  near(bt.ascent / (bt.ascent + bt.descent), 0.75);
  // 표에 없으면 같은 객체를 그대로 돌려준다
  assert.equal(applyWordLineFactor(fontOf('Calibri', 16), m), m);
  // 브라우저가 0을 주어도 깨지지 않는다
  const z = applyWordLineFactor(fontOf('맑은 고딕', 16), { ascent: 0, descent: 0 });
  near(z.ascent + z.descent, 16 * 1.7292); assert.ok(Number.isFinite(z.ascent) && Number.isFinite(z.descent));
});

test('캔버스 측정기: 어떤 환경의 값이 와도 선언 글꼴의 줄 높이가 같다', () => {
  const saved = globalThis.OffscreenCanvas;
  try {
    for (const [asc, desc] of [[0.9, 0.22], [1.1, 0.35], [1.0884, 0.2417]]) {   // 글꼴 없음·Noto Sans KR 비슷·Windows 맑은 고딕 비슷
      globalThis.OffscreenCanvas = class { getContext() { let px = 16; return { set font(f) { px = parseFloat(/([\d.]+)px/.exec(f)[1]); }, measureText: () => ({ width: 0, fontBoundingBoxAscent: px * asc, fontBoundingBoxDescent: px * desc }) }; } };
      const mm = createCanvasMeasurer();
      const k = mm.metrics(fontOf('맑은 고딕', 14.667)); near(k.ascent + k.descent, 14.667 * 1.7292);
      const b = mm.metrics(fontOf('바탕', 14.667)); near(b.ascent + b.descent, 14.667 * 1.3);
      const c = mm.metrics(fontOf('Calibri', 14.667)); near(c.ascent + c.descent, 14.667 * (asc + desc));   // 표 밖 글꼴은 브라우저 값 그대로
    }
  } finally { globalThis.OffscreenCanvas = saved; }
});

test('줄바꿈은 바로 앞 글의 글꼴·크기·굵기를 따른다', () => {
  const fake = createFakeMeasurer();
  const toks = inlineTokens([
    { type: 'text', text: '앞', font_name: '맑은 고딕', font_size_half_pt: 40, bold: true, italic: true },
    { type: 'line_break' },
    { type: 'text', text: '뒤', font_name: '바탕', font_size_half_pt: 18 },
    { type: 'line_break' },
  ], fake, null);
  const brs = toks.filter((t) => t.kind === 'br');
  assert.equal(brs.length, 2);
  assert.equal(brs[0].st.font, toks[0].st.font);   // 앞 글과 같은 CSS 글꼴(굵게·기울임·크기·글꼴 목록)
  assert.equal(brs[1].st.font, toks[2].st.font);
  assert.notEqual(brs[0].st.font, brs[1].st.font);
});

test('맨 앞의 줄바꿈과 첨자 뒤의 줄바꿈', () => {
  const fake = createFakeMeasurer();
  const dflt = inlineTokens([{ type: 'line_break' }], fake, null)[0].st.font;
  assert.equal(dflt, cssFont({ px: 22 / 2 * 96 / 72, family: fontFamily(undefined) }));   // 앞 글이 없으면 문서 기본 11pt
  // 위 첨자는 크기가 줄어 있지만 줄바꿈은 줄어든 크기를 물려받지 않는다
  const sup = inlineTokens([{ type: 'text', text: '2', font_size_half_pt: 40, vertical_align: 'superscript' }, { type: 'line_break' }], fake, null);
  const plain = inlineTokens([{ type: 'text', text: '2', font_size_half_pt: 40 }, { type: 'line_break' }], fake, null);
  assert.equal(sup[1].st.font, plain[1].st.font);
  assert.ok(sup[0].st.px < plain[0].st.px);
  // 그림·각주 표시 뒤에는 그 앞의 글 조각을 따른다(그림은 글꼴이 없다)
  const afterImg = inlineTokens([{ type: 'text', text: '가', font_size_half_pt: 40 }, { type: 'image', display_width_emu: 9525, display_height_emu: 9525 }, { type: 'line_break' }], fake, null);
  assert.equal(afterImg[2].st.font, afterImg[0].st.font);
});

test('큰 글씨 뒤의 줄바꿈이 있는 줄 높이가 문서 기본 글꼴 높이로 줄지 않는다(조판 통합)', () => {
  const fake = createFakeMeasurer();   // 높이 = 글자 크기 × 1.2
  const line = (rs) => {
    const tokens = inlineTokens(rs, fake, null);
    return breakLines(tokens, { width: 600, left: 0, right: 0, first: 0, align: 'left', tabs: [], lineSpacing: null, measure: fake, defaultFont: fontOf(undefined, 14.667) })[0];
  };
  // 20pt 글자 뒤 줄바꿈: 첫 줄 높이는 20pt 글자 기준이다
  const big = line([{ type: 'text', text: '큰', font_size_half_pt: 40 }, { type: 'line_break' }]);
  near(big.height, 40 / 2 * 96 / 72 * 1.2);
  // 줄바꿈이 든 글 조각이 더 작은 글씨일 때(8pt)는 줄바꿈이 문서 기본(11pt)을 끌어들여 줄이 늘어나면 안 된다
  const small = line([{ type: 'text', text: '작', font_size_half_pt: 16 }, { type: 'line_break' }]);
  near(small.height, 16 / 2 * 96 / 72 * 1.2);
});
