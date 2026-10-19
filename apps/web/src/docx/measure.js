// 글자 폭 측정기. 조판은 이 인터페이스만 안다: width(font, text) → px, metrics(font) → { ascent, descent } px.
// 실제 브라우저에서는 Canvas가 그리는 쪽(SVG 텍스트)과 같은 글꼴 엔진이라 측정과 그림이 맞는다.
export function createCanvasMeasurer() {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const widths = new Map();
  const mets = new Map();
  let last = '';
  const set = (font) => { if (font !== last) { ctx.font = font; last = font; } };
  return {
    width(font, text) {
      const key = `${font}\u0000${text}`;
      let w = widths.get(key);
      if (w === undefined) {
        set(font);
        w = ctx.measureText(text).width;
        if (widths.size > 200000) widths.clear();
        widths.set(key, w);
      }
      return w;
    },
    metrics(font) {
      let m = mets.get(font);
      if (!m) {
        set(font);
        const t = ctx.measureText('Hg한');
        const px = parseFloat(/([\d.]+)px/.exec(font)?.[1] ?? '16');
        m = { ascent: t.fontBoundingBoxAscent ?? px * 0.9, descent: t.fontBoundingBoxDescent ?? px * 0.25 };
        mets.set(font, m);
      }
      return m;
    },
  };
}

/** 시험용 결정적 측정기: 영문 0.5em, 전각 1em, 높이 1.2em. */
export function createFakeMeasurer() {
  return {
    width(font, text) {
      const px = parseFloat(/([\d.]+)px/.exec(font)?.[1] ?? '16');
      let w = 0;
      for (const ch of text) w += /[ᄀ-ᇿ⺀-힯豈-﫿＀-￯]/.test(ch) ? px : px * 0.5;
      return w;
    },
    metrics(font) {
      const px = parseFloat(/([\d.]+)px/.exec(font)?.[1] ?? '16');
      return { ascent: px * 0.9, descent: px * 0.3 };
    },
  };
}
