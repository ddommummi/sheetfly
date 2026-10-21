// 조판이 남긴 줄 기록('ln' 항목)으로 하는 캐럿·히트 테스트·선택 영역·이동 질의(4-2-2).
// 줄 기록: { k:'ln', pid, x, y, h, base, w, li, ls, items, trailing, last }. x는 줄 원점, 조각 x는 그 원점 기준, 조각은 { k, x, w, text, font, st, o0, o1 }.
// 위치 번호 o는 문단 글 안 code point 번호이고 편집 모델이 보는 글과 같다. 같은 번호가 한 줄의 끝과 다음 줄의 처음 두 곳에 나타날 수 있어
// aff(1이면 앞 줄 끝, 아니면 다음 줄 처음)로 가린다.

const cps = (s) => Array.from(s);

/** 줄의 글 조각(위치 번호가 있는 것). */
const SEG = new WeakMap();
const segs = (ln) => { let s = SEG.get(ln.items); if (!s) { s = ln.items.filter((it) => it.o0 !== undefined); if (!s.length) s = (ln.trailing ?? []).filter((it) => it.o0 !== undefined); SEG.set(ln.items, s); } return s; };   // 공백뿐인 줄은 매달린 공백도 본문으로 본다

/** 줄의 위치 범위: a 처음, b 본문 끝(줄 끝에 매달린 공백 앞), e 매달린 공백까지. */
function bounds(ln) {
  const S = segs(ln), T = ln.trailing ?? [];
  const a = S.length ? S[0].o0 : T.length ? T[0].o0 : 0;
  let b = a;
  for (const g of S) b = Math.max(b, g.k === 'br' ? g.o0 : g.o1);
  const e = T.length ? Math.max(b, T[T.length - 1].o1) : b;
  return { a, b, e };
}

/** 조각 안 k번째(code point) 앞까지의 폭. */
function prefixW(g, k, measure) {
  const n = g.o1 - g.o0;
  if (k <= 0) return 0;
  if (k >= n) return g.w;
  if (g.k === 'tx') {
    const t = cps(g.text);
    if (t.length !== n) return (g.w * k) / n;        // 대문자 바꿈으로 글자 수가 달라진 조각: 비례
    const sp = g.st?.spacing || 0;
    return measure.width(g.font, t.slice(0, k).join('')) + sp * k;
  }
  return (g.w * k) / n;                              // 공백·탭: 비례
}

/** 줄 안에서 위치 o의 x(줄 원점 기준). */
function xAt(ln, o, measure) {
  const S = segs(ln);
  if (!S.length) return ln.ls ?? 0;
  if (o <= S[0].o0) return S[0].x;
  for (const g of S) {
    if (g.k === 'br') { if (o > g.o0) return g.x; continue; }
    if (o > g.o0 && o <= g.o1) return g.x + prefixW(g, o - g.o0, measure);
  }
  const last = S[S.length - 1];
  return last.x + last.w;
}

/** 줄 안에서 x(줄 원점 기준)에 가장 가까운 위치와, 줄 끝을 넘어갔는지. */
function offsetAt(ln, xr, measure) {
  const S = segs(ln), { a, b } = bounds(ln);
  if (!S.length || xr <= S[0].x) return { o: a, past: false };
  for (let i = 0; i < S.length; i++) {
    const g = S[i], last = i === S.length - 1;
    if (xr < g.x + g.w || (last && xr <= g.x + g.w + 0.5)) {
      const n = g.o1 - g.o0;
      if (n <= 0 || g.k === 'br') return { o: g.o0, past: false };
      let k;
      if (g.k === 'tx' && n > 1) {
        let lo = 0, hi = n;                          // prefix(lo) <= xr-g.x
        const target = xr - g.x;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (prefixW(g, mid, measure) <= target) lo = mid; else hi = mid - 1; }
        const w0 = prefixW(g, lo, measure), w1 = lo < n ? prefixW(g, lo + 1, measure) : w0;
        k = lo < n && target - w0 > (w1 - w0) / 2 ? lo + 1 : lo;
      } else k = Math.round(((xr - g.x) / Math.max(g.w, 1e-6)) * n);
      return { o: g.o0 + Math.max(0, Math.min(n, k)), past: false };
    }
  }
  return { o: b, past: true };
}

/** 줄의 가로 범위(쪽 좌표). */
function extent(ln) {
  const S = segs(ln);
  if (!S.length) { const x = ln.x + (ln.ls ?? 0); return [x, x]; }
  const l = S[S.length - 1];
  return [ln.x + S[0].x, ln.x + l.x + l.w];
}

export class Geometry {
  /** @param {() => object[]} pages 쪽 목록(조판이 다시 만들면 달라질 수 있어 함수로 받는다) @param measure 글자 폭 측정기 */
  constructor(pages, measure) { this.pages = pages; this.measure = measure; this.by = null; }
  /** 쪽 줄 기록이 바뀐 뒤 호출. */
  invalidate() { this.by = null; }

  pageLines(pi) { const pg = this.pages()[pi]; return pg ? (pg.lns ??= pg.items.filter((i) => i.k === 'ln')) : []; }
  #index() {
    if (this.by) return this.by;
    const m = new Map();
    this.pages().forEach((pg, pi) => { for (const ln of (pg.lns ??= pg.items.filter((i) => i.k === 'ln'))) { let l = m.get(ln.pid); if (!l) m.set(ln.pid, l = []); l.push({ pi, ln }); } });
    return (this.by = m);
  }
  /** pid 문단의 줄 목록(위에서 아래로). 없으면 undefined. */
  linesOf(pid) { return this.#index().get(pid); }
  has(pid) { return this.#index().has(pid); }

  #rect(pi, ln, o) { return { page: pi, x: ln.x + xAt(ln, o, this.measure), y: ln.y, h: ln.h }; }

  /** 위치 o(aff)가 놓이는 줄. */
  #lineFor(pid, o, aff) {
    const L = this.linesOf(pid);
    if (!L) return null;
    const hit = [];
    for (const it of L) { const { a, e } = bounds(it.ln); if (o >= a && o <= e) hit.push(it); }
    if (hit.length) return aff === 1 ? hit[0] : hit[hit.length - 1];
    return o < bounds(L[0].ln).a ? L[0] : L[L.length - 1];
  }

  /** 위치의 캐럿 사각형 { page, x, y, h }. 문단에 줄이 없으면 null. */
  caret(pid, o, aff = 0) { const t = this.#lineFor(pid, o, aff); return t ? this.#rect(t.pi, t.ln, o) : null; }

  /** 쪽 좌표 (x, y) → 가장 가까운 줄의 글 위치 { pid, o, aff } (줄이 하나도 없으면 null). */
  hit(pi, x, y) {
    const lines = this.pageLines(pi);
    let best = null, bs = Infinity;
    for (const ln of lines) {
      const dy = y < ln.y ? ln.y - y : y > ln.y + ln.h ? y - (ln.y + ln.h) : 0;
      const [x0, x1] = extent(ln), dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
      const sc = dy * 1e4 + dx;
      if (sc < bs) { bs = sc; best = ln; }
    }
    if (!best) return null;
    return this.#at(pi, best, x - best.x);
  }
  #at(pi, ln, xr) {
    const r = offsetAt(ln, xr, this.measure);
    let aff = 0;
    if (r.past && !ln.last) { const { b, e } = bounds(ln); if (b === e) aff = 1; }   // 줄 끝을 눌렀는데 그 위치가 다음 줄의 처음이기도 하면 앞 줄 끝에 둔다
    return { pid: ln.pid, o: r.o, aff, rect: this.#rect(pi, ln, r.o) };
  }

  /** 줄의 처음·끝 위치. */
  lineEnds(pid, o, aff) {
    const t = this.#lineFor(pid, o, aff);
    if (!t) return null;
    const { a, b, e } = bounds(t.ln);
    return { a, b, last: t.ln.last, ambiguous: b === e };
  }

  /** 위·아래 이동: 지금 줄에서 위(-1)·아래(1)의 가장 가까운 줄에서 px 쪽 위치. */
  vertical(pid, o, aff, dir, px) {
    const t = this.#lineFor(pid, o, aff);
    if (!t) return null;
    const cur = this.#rect(t.pi, t.ln, o);
    const x = px >= 0 ? px : cur.x;
    const pick = (pi, filter) => {
      let best = null, bs = Infinity;
      for (const ln of this.pageLines(pi)) {
        const d = dir < 0 ? t.ln.y - ln.y : ln.y - t.ln.y;
        if (!filter(ln, d)) continue;
        const [x0, x1] = extent(ln), dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
        const sc = (dx > 0.5 ? 1e6 : 0) + Math.abs(d) * 10 + dx;   // 가로로 겹치는 줄 먼저, 그다음 가까운 줄
        if (sc < bs) { bs = sc; best = ln; }
      }
      return best;
    };
    let ln = pick(t.pi, (l, d) => d > 0.5), pi = t.pi;
    if (!ln) {   // 쪽을 넘어간다
      const pages = this.pages();
      for (let q = t.pi + dir; q >= 0 && q < pages.length && !ln; q += dir) {
        const ls = this.pageLines(q);
        if (!ls.length) continue;
        pi = q;
        let best = null, bs = Infinity;
        for (const l of ls) {
          const edge = dir < 0 ? -(l.y + l.h) : l.y, [x0, x1] = extent(l), dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
          const sc = edge * 10 + (dx > 0.5 ? 1e6 : 0) + dx;
          if (sc < bs) { bs = sc; best = l; }
        }
        ln = best;
      }
    }
    if (!ln) return null;
    const r = this.#at(pi, ln, x - ln.x);
    return { ...r, px: x };
  }

  /** 선택 영역의 줄별 사각형. lo..hi는 pid 문단 안 범위(hi가 Infinity면 문단 끝까지), pastEnd면 문단 끝의 줄바꿈도 포함. */
  rects(pid, lo, hi, pastEnd) {
    const L = this.linesOf(pid), out = [];
    if (!L) return out;
    for (const { pi, ln } of L) {
      const { a, e } = bounds(ln);
      const s = Math.max(lo, a), t = Math.min(hi, e);
      let x0 = null, x1 = null;
      if (s < t) { x0 = ln.x + xAt(ln, s, this.measure); x1 = ln.x + xAt(ln, t, this.measure); }
      const br = segs(ln).find((g) => g.k === 'br' && g.o0 >= lo && g.o0 < hi);   // 고른 줄바꿈 글자
      const mark = pastEnd && ln.last && lo <= e;                                  // 고른 문단 끝 줄바꿈
      if (x0 === null) { if (br) x0 = x1 = ln.x + br.x; else if (mark) x0 = x1 = ln.x + xAt(ln, e, this.measure); else continue; }
      const w = Math.max(0, x1 - x0) + (br || (mark && t >= e) ? 5 : 0);
      if (w > 0.2) out.push({ page: pi, x: x0, y: ln.y, w, h: ln.h });
    }
    return out;
  }
}

// ── 글자 종류와 낱말 ──────────────────────────────────────────────────
const cls = (ch) => (/\s/.test(ch) ? 0 : /[\p{L}\p{N}\p{M}_]/u.test(ch) ? 1 : 2);   // 0 공백, 1 낱말 글자, 2 기호

/** 낱말 단위 이동: 위치 o에서 왼쪽(-1)·오른쪽(1) 낱말 경계. */
export function wordStep(text, o, dir) {
  const t = cps(text), n = t.length;
  let i = o;
  if (dir > 0) {
    if (i >= n) return n;
    const c = cls(t[i]);
    while (i < n && cls(t[i]) === c && c !== 0) i++;
    while (i < n && cls(t[i]) === 0) i++;
    return i === o ? Math.min(n, o + 1) : i;
  }
  if (i <= 0) return 0;
  while (i > 0 && cls(t[i - 1]) === 0) i--;
  if (i > 0) { const c = cls(t[i - 1]); while (i > 0 && cls(t[i - 1]) === c) i--; }
  return i;
}

/** 위치의 낱말 범위(두 번 누르기). 공백 위면 그 공백 덩어리, 문단 끝이면 마지막 낱말. */
export function wordRange(text, o) {
  const t = cps(text), n = t.length;
  if (!n) return [0, 0];
  let i = Math.min(o, n - 1);
  if (o >= n) i = n - 1;
  const c = cls(t[i]);
  let a = i, b = i + 1;
  while (a > 0 && cls(t[a - 1]) === c) a--;
  while (b < n && cls(t[b]) === c) b++;
  return [a, b];
}
