// 문단 조판: IR 문단 → 줄 목록. 줄은 위치가 정해진 조각(글자·탭·그림)을 가진다.
import { twipsToPx, halfPtToPx, emuToPx, rgb } from './units.js';
import { fontFamily, cssFont } from './fonts.js';
import { tokenize, canBreakBetween } from './text.js';

export const DEFAULT_HALF_PT = 22;       // 11pt
const DEFAULT_TAB_PX = 48;                // 720 twips
const EPS = 0.01;
const MAX_TOKENS = 200000;                // 신뢰할 수 없는 입력 상한

/** 글자 조각의 서식을 CSS 글꼴과 장식으로 푼다. */
export function runStyle(r, baseHalfPt = DEFAULT_HALF_PT) {
  let px = halfPtToPx(r.font_size_half_pt ?? baseHalfPt);
  let shift = 0;
  if (r.vertical_align === 'superscript' || r.vertical_align === 'subscript') {
    const orig = px; px *= 0.65; shift = r.vertical_align === 'superscript' ? -orig * 0.35 : orig * 0.12;
  }
  if (r.small_caps && !r.all_caps) px *= 0.8;
  const family = fontFamily(r.font_name);
  return {
    px, shift, family, bold: !!r.bold, italic: !!r.italic,
    color: rgb(r.color) ?? '#000000', underline: r.underline || null, strike: !!r.strikethrough,
    highlight: Array.isArray(r.highlight) ? rgb(r.highlight) : (r.highlight ?? null), upper: !!(r.all_caps || r.small_caps), link: r.hyperlink ?? null,
    spacing: r.char_spacing_half_pt ? twipsToPx(r.char_spacing_half_pt) : 0,   // 이름은 half_pt이나 값은 twips(1/20pt): -10 → -0.667px (BetterOffice와 일치)
    font: cssFont({ italic: !!r.italic, bold: !!r.bold, px, family }),
  };
}

const cpLen = (s) => { let n = 0; for (const _ of s) n++; return n; };

/**
 * 문단의 인라인 요소를 토큰 목록으로 만든다.
 * track이면 토큰마다 문단 글 안의 위치 [o0, o1)(code point, 편집 모델이 보는 글과 같은 번호)을 단다. 캐럿·히트 테스트용이다.
 */
export function inlineTokens(content, measure, notes, track = false) {
  const tokens = [];
  let prevRunLastWord = false;
  let cp = 0;
  for (const r of content ?? []) {
    if (tokens.length > MAX_TOKENS) break;
    if (r.type === 'text') {
      const st = runStyle(r);
      const src = r.text;
      let text = st.upper ? src.toUpperCase() : src;
      // 대문자로 바꾸면 글자 수가 달라지는 글자(ß→SS 등)는 원문을 나누고 토큰마다 바꾼다(위치 번호를 원문 기준으로 지키려고)
      const mapped = track && st.upper && cpLen(text) !== cpLen(src);
      if (mapped) text = src;
      let first = true;
      for (const tk of tokenize(text)) {
        const t = { kind: tk.kind, text: mapped ? tk.text.toUpperCase() : tk.text, nbsp: tk.nbsp, st };
        if (first && tk.kind === 'word' && prevRunLastWord) t.noBreakBefore = true;
        first = false;
        if (track) { t.o0 = cp; cp += cpLen(tk.text); t.o1 = cp; }
        tokens.push(t);
      }
      const last = tokens[tokens.length - 1];
      prevRunLastWord = !!last && last.kind === 'word' && !last.text.endsWith('-');
    } else if (r.type === 'line_break') {
      const t = { kind: 'br', text: '\n', st: runStyle({}) };
      if (track) { t.o0 = cp; t.o1 = ++cp; }
      tokens.push(t);
      prevRunLastWord = false;
    } else if (r.type === 'footnote_ref' || r.type === 'endnote_ref') {
      const st = runStyle({ vertical_align: 'superscript' });
      const n = notes ? notes.number(r.type, r.note_id) : r.note_id;
      tokens.push({ kind: 'word', text: String(n), st, virt: true });
      prevRunLastWord = false;
    } else if (r.type === 'image') {
      const t = { kind: 'img', text: '', st: runStyle({}), img: r };
      if (track) t.o0 = t.o1 = cp;
      tokens.push(t);
      prevRunLastWord = false;
    }
  }
  for (const t of tokens) {
    if (t.kind === 'img') {
      t.w = emuToPx(t.img.display_width_emu || 0); t.h = emuToPx(t.img.display_height_emu || 0);
    } else if (t.kind === 'tab' || t.kind === 'br') {
      t.w = 0;
    } else {
      t.w = measure.width(t.st.font, t.text) + t.st.spacing * [...t.text].length;
    }
  }
  return tokens;
}

function tabStops(tabs) {
  return (tabs ?? []).map((t) => ({ pos: twipsToPx(t.position_twips), align: String(t.alignment || 'Left').toLowerCase(), leader: String(t.leader || 'None').toLowerCase() }))
    .sort((a, b) => a.pos - b.pos);
}

/**
 * 토큰을 줄로 나눈다.
 * o: { width, left, right, first, align, tabs, lineSpacing, measure, defaultFont }
 * 반환: [{ items, w, ascent, descent, height, base, justify, forced, indent }]
 */
export function breakLines(tokens, o) {
  const { measure } = o;
  const limit = o.width - o.right;
  const stops = tabStops(o.tabs);
  const lines = [];
  let items = [];
  let x = 0;
  let lineStart = o.left + o.first;
  let hasContent = false;
  let prevTok = null;

  const lineMetrics = (its) => {
    let ascent = 0, descent = 0;
    for (const it of its) {
      if (it.k === 'img') { ascent = Math.max(ascent, it.h); continue; }
      const m = measure.metrics(it.font);
      ascent = Math.max(ascent, m.ascent); descent = Math.max(descent, m.descent);
    }
    if (!its.length) { const m = measure.metrics(o.defaultFont); ascent = m.ascent; descent = m.descent; }
    return { ascent, descent };
  };

  // 토큰의 문단 글 위치([o0, o1))를 조각에 단다(추적할 때만)
  const at = (it, t, o0 = t.o0, o1 = t.o1) => { if (o0 !== undefined) { it.o0 = o0; it.o1 = o1; if (t.st && t.st.upper && it.k === 'tx') it.up = true; } return it; };

  const finish = (forced) => {
    // 줄 끝에 매달린 공백은 폭에 넣지 않는다
    let end = items.length;
    while (end > 0 && items[end - 1].k === 'sp') end--;
    const body = items.slice(0, end);
    const lastBody = body[body.length - 1];
    const w = lastBody ? lastBody.x + lastBody.w - lineStart : 0;
    const { ascent, descent } = lineMetrics(body.length ? body : items);
    const natural = ascent + descent;
    const ls = o.lineSpacing;
    let height, base;
    if (ls && ls.exact != null) { height = twipsToPx(ls.exact); base = height * 0.8; }
    else if (ls && ls.at_least != null) { height = Math.max(natural, twipsToPx(ls.at_least)); base = height - descent; } // "최소": 글자가 더 크면 글자에 맞춘다
    else { const f = ls && ls.auto ? ls.auto / 240 : 1; height = natural * f; base = height - descent; }
    lines.push({ items: body, trailing: items.slice(end), w, ascent, descent, height, base, forced, lineStart, limit });
    items = []; x = lineStart = o.left; hasContent = false; prevTok = null;
    x = lineStart;
  };

  x = lineStart;
  const push = (it) => { items.push(it); x = it.x + it.w; };
  if (o.marker) {
    // 번호/글머리표는 첫 줄 시작에 놓고, 본문은 왼쪽 들여쓰기 위치(내어쓰기 끝)에서 시작한다
    push({ k: 'tx', x, w: o.marker.w, text: o.marker.text, st: o.marker.st, font: o.marker.st.font, marker: true });
    x = Math.max(x + o.marker.w + 4, o.left);
    hasContent = true;
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === 'br') { push(at({ k: 'br', x, w: 0, font: t.st.font }, t)); finish(true); continue; }
    if (t.kind === 'tab') {
      let stop = stops.find((s) => s.pos > x + 0.5 && s.pos >= o.left - 0.5);
      let target; let leader = 'none';
      if (stop && stop.align !== 'left') {
        let seg = 0;
        for (let j = i + 1; j < tokens.length && tokens[j].kind !== 'tab' && tokens[j].kind !== 'br'; j++) seg += tokens[j].w;
        target = stop.align === 'right' ? stop.pos - seg : stop.align === 'center' ? stop.pos - seg / 2 : stop.pos;
        if (target < x) target = x;
        leader = stop.leader;
      } else if (stop) { target = stop.pos; leader = stop.leader; }
      else {
        const base = Math.max(0, o.left);
        target = base + (Math.floor((x - base + 0.5) / DEFAULT_TAB_PX) + 1) * DEFAULT_TAB_PX;
      }
      if (target > limit + EPS && hasContent) { finish(false); continue; }
      push(at({ k: 'tab', x, w: Math.max(0, target - x), leader, font: t.st.font, color: t.st.color }, t));
      hasContent = true; prevTok = t;
      continue;
    }
    if (t.kind === 'space') {
      push(at({ k: 'sp', x, w: t.w, text: t.text, font: t.st.font, st: t.st }, t));
      prevTok = t; continue;
    }
    // word / cjk / img
    if (hasContent && x + t.w > limit + EPS && canBreakBetween(prevTok, t)) finish(false);
    if (t.kind !== 'img' && x + t.w > limit + EPS && t.w > limit - lineStart + EPS) {
      // 한 줄보다 긴 낱말: 글자 단위로 쪼갠다
      let part = '', po = t.o0, n = 0;
      const piece = () => at({ k: 'tx', x, w: measure.width(t.st.font, part) + t.st.spacing * [...part].length, text: part, st: t.st, font: t.st.font }, t, po, po === undefined ? undefined : po + n);
      for (const ch of t.text) {
        const cw = measure.width(t.st.font, ch) + t.st.spacing;
        if (part && x + measure.width(t.st.font, part + ch) + t.st.spacing * [...part + ch].length > limit + EPS) {
          push(piece());
          finish(false); if (po !== undefined) po += n; part = ''; n = 0;
        }
        part += ch; n++; void cw;
      }
      if (part) { push(piece()); hasContent = true; }
      prevTok = t; continue;
    }
    if (t.kind === 'img') push(at({ k: 'img', x, w: t.w, h: t.h, img: t.img, font: t.st.font }, t));
    else push(at({ k: 'tx', x, w: t.w, text: t.text, st: t.st, font: t.st.font }, t));
    hasContent = true; prevTok = t;
  }
  if (items.length || !lines.length) finish(false);
  if (lines.length) lines[lines.length - 1].last = true;

  // 정렬
  for (const line of lines) {
    const avail = limit - line.lineStart;
    const extra = avail - line.w;
    const align = o.align;
    if (align === 'center') line.dx = Math.max(0, extra / 2);
    else if (align === 'right') line.dx = Math.max(0, extra);
    else line.dx = 0;
    if ((align === 'both' || align === 'justify' || align === 'distribute') && !line.last && !line.forced && extra > 0) {
      const gaps = line.items.filter((it) => it.k === 'sp').length;
      if (gaps) {
        const add = extra / gaps; let shift = 0;
        for (const it of line.items) { it.x += shift; if (it.k === 'sp') { it.w += add; shift += add; } }
        line.w += extra;
      }
    }
  }
  return lines;
}

/** IR 문단 → 조판 결과. width는 문단이 놓일 칸의 폭(px). */
export function layoutParagraph(p, ctx) {
  const { measure, width } = ctx;
  const track = p.pid !== undefined;
  const tokens = inlineTokens(p.content, measure, ctx.notes, track);
  const first = tokens.find((t) => t.st);
  const baseSt = first ? first.st : runStyle({}, ctx.defaultHalfPt);
  const left = twipsToPx(p.indent_left_twips || 0) + (ctx.extraLeft || 0);
  const right = twipsToPx(p.indent_right_twips || 0);
  const firstIndent = twipsToPx(p.first_line_indent_twips || 0);
  const lines = breakLines(tokens, {
    width, left, right, first: firstIndent, align: normAlign(p.alignment), tabs: p.tabs,
    lineSpacing: p.line_spacing, measure, defaultFont: baseSt.font,
    marker: ctx.marker ? (() => { const st = { ...baseSt, underline: null, strike: false, highlight: null }; return { text: ctx.marker, st, w: measure.width(st.font, ctx.marker) }; })() : null,
  });
  return {
    lines, left, right, first: firstIndent,
    before: twipsToPx(p.space_before_twips || 0), after: twipsToPx(p.space_after_twips ?? 0),
    keepNext: !!p.keep_with_next, keepTogether: !!p.keep_together,
    background: rgb(p.background_color), border: p.border ?? null,
    contextual: !!p.contextual_spacing,
    pid: p.pid,
  };
}

function normAlign(a) {
  const s = String(a || 'left').toLowerCase();
  if (s === 'both' || s === 'justify' || s === 'justified') return 'both';
  if (s === 'center' || s === 'right' || s === 'distribute') return s;
  return 'left';
}
