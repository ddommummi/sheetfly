// office_oxide IR(우리 WASM 래퍼의 toJson) ↔ document.xml 문단 열 정렬. IR에는 출처가 없어서, 글 블록을 문서 순서로 펴서 XML 문단 열과 순서·글로 짝짓는다.
const inl = (content) => (content ?? []).map((c) => (c.text !== undefined ? c.text : c.type === 'line_break' ? '\n' : '')).join('');

/** IR을 문서 순서의 글 블록 목록으로 편다: [{kind, text, node, parent, key}] (글이 없는 블록은 text:null). node는 IR의 문단 객체 그대로다. */
export function flattenIr(full) {
  const out = [];
  const para = (el, kind, parent, key) => out.push({ kind, text: inl(el.content), node: el, parent, key });
  const block = (el, parent, key) => {
    switch (el.type) {
      case 'heading': case 'paragraph': para(el, el.type, parent, key); break;
      case 'list': for (let i = 0; i < (el.items ?? []).length; i++) listItem(el.items[i], el.items, i); break;
      case 'table': for (const r of el.rows ?? []) for (const c of r.cells ?? []) (c.content ?? []).forEach((e, i) => block(e, c.content, i)); break;
      case 'text_box': (el.content ?? []).forEach((e, i) => block(e, el.content, i)); break;
      default: out.push({ kind: el.type, text: null, node: el, parent, key });
    }
  };
  const listItem = (it, parent, key) => {
    (it.content ?? []).forEach((e, i) => { if (e.type === 'paragraph' || e.type === 'heading') para(e, 'list', it.content, i); else block(e, it.content, i); });
    const nn = it.nested; if (nn) (Array.isArray(nn) ? nn : [nn]).forEach((n) => (n.items ?? [n]).forEach((x, i) => listItem(x, n.items ?? [n], i)));
  };
  for (const s of full.ir.sections) s.elements.forEach((e, i) => block(e, s.elements, i));
  return out;
}

/**
 * XML 문단 열과 IR 글 블록 열을 문서 순서로 맞춘다(IR은 빈 문단·쪽 나누기만 든 문단을 문단으로 두지 않는다).
 * 글이 같은 것끼리 짝짓되 **확실한 짝만** 만든다(patience diff): ① 양쪽에서 한 번만 나오는 글을 닻으로 삼아 ② 닻 사이 구간이 개수·순서·글이 모두 같을 때만 구간 안을 짝짓고 ③ 그 밖(같은 글이 여러 번 나오고 개수가 다른 구간 등)은 짝짓지 않는다.
 * 그래서 짝이 "엉뚱한 문단"일 위험을 없애고, 대신 모호한 문단은 읽기 전용이 된다.
 * 반환: map[i] = i번째 IR 블록의 XML 문단 번호(없으면 -1), risky = 항상 빈 집합(호환용).
 */
export function alignBlocks(blocks, xmlParas) {
  const map = new Array(blocks.length).fill(-1);
  const B = [], X = [];
  blocks.forEach((b, i) => { if (b.text) B.push(i); });
  xmlParas.forEach((q, i) => { if (q.all) X.push(i); });
  const bt = B.map((i) => blocks[i].text), xt = X.map((i) => xmlParas[i].all);
  const pair = (bi, xi) => { map[B[bi]] = X[xi]; };
  const solve = (bl, bh, xl, xh) => {
    if (bl >= bh || xl >= xh) return;
    // 구간 안에서 양쪽에 한 번씩만 나오는 글
    const cb = new Map(), cx = new Map();
    for (let i = bl; i < bh; i++) cb.set(bt[i], (cb.get(bt[i]) ?? 0) + 1);
    for (let i = xl; i < xh; i++) cx.set(xt[i], (cx.get(xt[i]) ?? 0) + 1);
    const xpos = new Map(); for (let i = xl; i < xh; i++) if (cx.get(xt[i]) === 1) xpos.set(xt[i], i);
    const cand = []; // [bi, xi]
    for (let i = bl; i < bh; i++) if (cb.get(bt[i]) === 1 && xpos.has(bt[i])) cand.push([i, xpos.get(bt[i])]);
    if (!cand.length) {
      if (bh - bl === xh - xl) { let same = true; for (let k = 0; k < bh - bl; k++) if (bt[bl + k] !== xt[xl + k]) { same = false; break; } if (same) for (let k = 0; k < bh - bl; k++) pair(bl + k, xl + k); }
      return;
    }
    // 닻: xi가 늘어나는 가장 긴 부분열(LIS)
    const tails = [], prev = new Array(cand.length).fill(-1), at = [];
    cand.forEach((c, i) => { let lo = 0, hi = tails.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (cand[tails[mid]][1] < c[1]) lo = mid + 1; else hi = mid; } if (lo > 0) prev[i] = tails[lo - 1]; tails[lo] = i; at[lo] = i; });
    const anchors = []; for (let i = tails[tails.length - 1]; i >= 0; i = prev[i]) anchors.push(cand[i]); anchors.reverse();
    let pb = bl, px = xl;
    for (const [bi, xi] of anchors) { solve(pb, bi, px, xi); pair(bi, xi); pb = bi + 1; px = xi + 1; }
    solve(pb, bh, px, xh);
  };
  solve(0, bt.length, 0, xt.length);
  return { map, risky: new Set() };
}
