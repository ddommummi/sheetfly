// PPTX 슬라이드를 직접 읽어 쪽 모델(IR)로 만든다. office_oxide의 IR은 제목·본문 자리 표시자의 위치·세로 정렬·글꼴 크기를 주지 못하므로
// 슬라이드·레이아웃·마스터·테마를 따라가며 상속을 풀어 모든 도형을 절대 위치 상자로 낸다.
// 지원: 위치·크기, 자리 표시자 상속(xfrm·bodyPr·목록 스타일), 글자 서식(크기·굵기·기울임·밑줄·색·글꼴), 문단(정렬·들여쓰기·간격·글머리표),
//       사각형·둥근 사각형·원·삼각형·마름모·선, 채우기·선(테마 색 포함), 그림, 표, 그룹, 배경(색), 마스터/레이아웃 장식, 글자 줄임(fontScale).
// 미지원(건너뜀): 회전, 그림 자르기, 그라데이션·그림 채우기(첫 색만), 차트·도표(자리 표시 상자), 애니메이션, 발표자 노트.
import { openZip } from './zip.js';
import { parseXml, kid, kids, path, num } from './xml.js';

const EMU_PER_TWIP = 635;
const MAX_SLIDES = 2000;
const MAX_SHAPES = 20000;
const MAX_GROUP_DEPTH = 12;
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
const IMG = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', webp: 'webp' };
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
void NS_REL;

const dirOf = (p) => p.slice(0, p.lastIndexOf('/') + 1);
function resolvePath(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (dirOf(base) + target).split('/'); const out = [];
  for (const s of parts) { if (s === '..') out.pop(); else if (s !== '.' && s !== '') out.push(s); }
  return out.join('/');
}
const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };

// ── 색 ──
const clamp01 = (v) => Math.max(0, Math.min(1, v));
function rgbToHsl([r, g, b]) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; } return [h, s, l]; }
function hslToRgb([h, s, l]) { const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }; if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; } const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; return [f(p, q, h + 1 / 3), f(p, q, h), f(p, q, h - 1 / 3)].map((v) => Math.round(v * 255)); }
function applyMods(rgb, node) {
  let c = rgb;
  for (const m of node.c) {
    const v = num(m.a.val, 100000) / 100000;
    if (m.n === 'lumMod') { const [h, s, l] = rgbToHsl(c); c = hslToRgb([h, s, clamp01(l * v)]); }
    else if (m.n === 'lumOff') { const [h, s, l] = rgbToHsl(c); c = hslToRgb([h, s, clamp01(l + v)]); }
    else if (m.n === 'tint') c = c.map((x) => Math.round(255 - (255 - x) * v));
    else if (m.n === 'shade') c = c.map((x) => Math.round(x * v));
  }
  return c;
}
const hex = (s) => (/^[0-9a-fA-F]{6}$/.test(s) ? [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) : null);

class Ctx {
  constructor(zip) { this.zip = zip; this.xmlCache = new Map(); this.relCache = new Map(); this.imgCache = new Map(); this.imgBytes = 0; this.warn = new Set(); this.shapeCount = 0; }
  async xml(p) { if (this.xmlCache.has(p)) return this.xmlCache.get(p); const t = await this.zip.text(p); const x = t ? parseXml(t) : null; this.xmlCache.set(p, x); return x; }
  async rels(p) {
    if (this.relCache.has(p)) return this.relCache.get(p);
    const x = await this.xml(`${dirOf(p)}_rels/${p.slice(p.lastIndexOf('/') + 1)}.rels`);
    const m = new Map(); for (const r of kids(x, 'Relationship')) m.set(r.a.Id, { target: r.a.Mode === 'External' ? null : resolvePath(p, r.a.Target), type: r.a.Type ?? '' });
    this.relCache.set(p, m); return m;
  }
  async image(p) {
    if (this.imgCache.has(p)) return this.imgCache.get(p);
    const fmt = IMG[p.slice(p.lastIndexOf('.') + 1).toLowerCase()];
    let r = null;
    if (!fmt) this.warn.add('지원하지 않는 그림 형식(EMF·WMF·SVG 등)은 자리 표시로 대신했다');
    else { const b = await this.zip.read(p); if (b && b.length <= MAX_IMAGE_BYTES && (this.imgBytes += b.length) <= 96 * 1024 * 1024) r = { format: fmt, data: b64(b) }; else if (b) this.warn.add('큰 그림은 건너뛰었다'); }
    this.imgCache.set(p, r); return r;
  }
}

// ── 테마 ──
function readTheme(theme) {
  const colors = {}, fonts = { major: {}, minor: {} };
  const cs = path(theme, 'themeElements', 'clrScheme');
  for (const c of cs?.c ?? []) { const v = c.c[0]; colors[c.n] = v ? (v.n === 'sysClr' ? hex(v.a.lastClr ?? '') : hex(v.a.val ?? '')) : null; }
  const fs = path(theme, 'themeElements', 'fontScheme');
  for (const [k, nm] of [['major', 'majorFont'], ['minor', 'minorFont']]) { const f = kid(fs, nm); fonts[k] = { latin: kid(f, 'latin')?.a.typeface, ea: kid(f, 'ea')?.a.typeface }; }
  return { colors, fonts };
}
function colorOf(node, env) {
  // node: solidFill 같은 색 상자의 부모 또는 색 요소 자신
  const c = node && ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr'].includes(node.n) ? node : node?.c.find((x) => ['srgbClr', 'schemeClr', 'sysClr', 'prstClr'].includes(x.n));
  if (!c) return null;
  let rgb = null;
  if (c.n === 'srgbClr') rgb = hex(c.a.val ?? '');
  else if (c.n === 'sysClr') rgb = hex(c.a.lastClr ?? '') ?? (c.a.val === 'window' ? [255, 255, 255] : [0, 0, 0]);
  else if (c.n === 'prstClr') rgb = ({ black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255], yellow: [255, 255, 0], gray: [128, 128, 128] })[c.a.val] ?? null;
  else if (c.n === 'schemeClr') {
    let key = c.a.val;
    if (key === 'phClr') return env.phClr ?? null;
    key = env.clrMap?.[key] ?? key;
    rgb = env.theme.colors[key] ?? env.theme.colors[({ tx1: 'dk1', tx2: 'dk2', bg1: 'lt1', bg2: 'lt2' })[key]] ?? null;
  }
  return rgb ? applyMods(rgb, c) : null;
}
function fillOf(spPr, env) {
  if (!spPr) return undefined;                       // undefined: 지정 없음(상속·스타일), null: 채우지 않음
  if (kid(spPr, 'noFill')) return null;
  const sf = kid(spPr, 'solidFill'); if (sf) return colorOf(sf, env);
  const gf = kid(spPr, 'gradFill'); if (gf) { const gs = kid(gf, 'gsLst')?.c[0]; return gs ? colorOf(gs, env) : null; }
  if (kid(spPr, 'blipFill') || kid(spPr, 'pattFill')) return undefined;
  return undefined;
}
function lineOf(spPr, env) {
  const ln = kid(spPr, 'ln'); if (!ln) return undefined;
  if (kid(ln, 'noFill')) return null;
  const sf = kid(ln, 'solidFill');
  const w = ln.a.w != null ? num(ln.a.w) : undefined;
  return { color: sf ? colorOf(sf, env) : undefined, w, dash: kid(ln, 'prstDash')?.a.val };
}

// ── 텍스트 스타일 상속 ──
const lvlOf = (listStyle, lvl) => kid(listStyle, `lvl${lvl + 1}pPr`);
function mergeLevel(base, node) {
  if (!node) return base;
  const out = { ...base, a: { ...base.a }, kids: { ...base.kids } };
  Object.assign(out.a, node.a);
  for (const k of node.c) out.kids[k.n] = k;
  return out;
}
const emptyLvl = () => ({ a: {}, kids: {} });

function paraProps(chain, lvl, pPr) {
  let p = emptyLvl();
  for (const ls of chain) p = mergeLevel(p, lvlOf(ls, lvl));
  return mergeLevel(p, pPr);
}

function fontName(spec, theme, text) {
  if (!spec) return undefined;
  const ko = /[ᄀ-ᇿ㄰-㆏가-힯぀-ヿ一-鿿]/.test(text);
  const resolve = (t, kind) => { if (!t) return undefined; if (t === '+mj-lt') return theme.fonts.major.latin; if (t === '+mn-lt') return theme.fonts.minor.latin; if (t === '+mj-ea') return theme.fonts.major.ea || theme.fonts.major.latin; if (t === '+mn-ea') return theme.fonts.minor.ea || theme.fonts.minor.latin; void kind; return t; };
  const latin = resolve(spec.latin?.a.typeface, 'lt'), ea = resolve(spec.ea?.a.typeface, 'ea');
  return (ko ? ea || latin : latin || ea) || undefined;
}

function runProps(chainRPr, rPr) {
  // chainRPr: 낮은 우선순위부터 defRPr 노드들. 속성은 덮어쓰고 자식(색·글꼴)도 덮어쓴다.
  const a = {}, k = {};
  for (const n of [...chainRPr, rPr]) if (n) { Object.assign(a, n.a); for (const c of n.c) k[c.n] = c; }
  return { a, k };
}

async function buildParas(txBody, env, shapeCtx) {
  // shapeCtx: { chain: [listStyle...], masterKind, fontRefColor, scale, lnReduce }
  const paras = [];
  const counters = [];
  for (const p of kids(txBody, 'p')) {
    const pPr = kid(p, 'pPr');
    const lvl = Math.min(8, num(pPr?.a.lvl, 0));
    const props = paraProps(shapeCtx.chain, lvl, pPr);
    const defRPr = props.kids.defRPr;
    const runs = [];
    const endRPr = kid(p, 'endParaRPr');
    let flatText = '';
    for (const r of p.c) {
      if (r.n === 'r' || r.n === 'fld' || r.n === 'br') {
        if (r.n === 'br') { runs.push({ type: 'line_break' }); continue; }
        const text = kid(r, 't')?.t ?? '';
        if (!text) continue;
        const rp = runProps([defRPr], kid(r, 'rPr'));
        const sz = num(rp.a.sz, 1800) * (shapeCtx.scale ?? 1);
        const color = (rp.k.solidFill ? colorOf(rp.k.solidFill, env) : null) ?? shapeCtx.fontRefColor ?? env.defaultText;
        const run = { type: 'text', text, font_size_half_pt: Math.max(1, sz / 50) };
        const fname = fontName(rp.k, env.theme, text); if (fname) run.font_name = fname;
        if (rp.a.b === '1') run.bold = true;
        if (rp.a.i === '1') run.italic = true;
        if (rp.a.u && rp.a.u !== 'none') run.underline = 'single';
        if (rp.a.strike && rp.a.strike !== 'noStrike') run.strikethrough = true;
        if (color) run.color = color;
        const bl = num(rp.a.baseline, 0); if (bl > 0) run.vertical_align = 'superscript'; else if (bl < 0) run.vertical_align = 'subscript';
        const sp = num(rp.a.spc, 0); if (sp) run.char_spacing_half_pt = sp * 20 / 100;   // 1/100pt → twips (이름은 half_pt이나 값은 twips, D-032)
        runs.push(run); flatText += text;
      }
    }
    const el = { type: 'paragraph', content: runs };
    const algn = props.a.algn;
    el.alignment = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' || algn === 'justLow' || algn === 'dist' ? 'justify' : 'left';
    const marL = num(props.a.marL, 0), indent = num(props.a.indent, 0);
    el.indent_left_twips = Math.round(marL / EMU_PER_TWIP);
    if (indent) el.first_line_indent_twips = Math.round(indent / EMU_PER_TWIP);
    // 간격: 줄 간격은 비율(spcPct)·고정(spcPts), 문단 앞뒤는 pt 또는 글자 크기 비율
    const sizePt = (runs.find((r) => r.type === 'text')?.font_size_half_pt ?? num(endRPr?.a.sz, num(defRPr?.a.sz, 1800)) / 50) / 2;
    const sp = (nm) => { const n = props.kids[nm]; if (!n) return 0; const pts = kid(n, 'spcPts'), pct = kid(n, 'spcPct'); return pts ? num(pts.a.val) / 100 * 20 : pct ? num(pct.a.val) / 100000 * sizePt * 20 : 0; };
    const lnSpc = props.kids.lnSpc;
    if (lnSpc) { const pct = kid(lnSpc, 'spcPct'), pts = kid(lnSpc, 'spcPts'); if (pct) el.line_spacing = { auto: Math.max(60, Math.round((num(pct.a.val) / 100000 - (shapeCtx.lnReduce ?? 0)) * 240)) }; else if (pts) el.line_spacing = { exact: Math.round(num(pts.a.val) / 100 * 20) }; }
    el.space_before_twips = Math.round(sp('spcBef') * (shapeCtx.scale ?? 1)); el.space_after_twips = Math.round(sp('spcAft') * (shapeCtx.scale ?? 1));
    // 글머리표
    if (flatText.trim() && !props.kids.buNone) {
      const bc = props.kids.buChar, ba = props.kids.buAutoNum;
      if (bc) { el.marker_text = bc.a.char ?? '•'; counters.length = lvl; }
      else if (ba) { counters.length = lvl + 1; counters[lvl] = (counters[lvl] ?? num(ba.a.startAt, 1) - 1) + 1; el.marker_text = `${counters[lvl]}${(ba.a.type ?? '').includes('Period') ? '.' : (ba.a.type ?? '').includes('Paren') ? ')' : '.'}`; }
      else counters.length = 0;
    } else if (flatText.trim()) counters.length = 0;
    paras.push(el);
  }
  return paras;
}

// ── 도형 ──
const PH_KIND = (ph) => (ph.a.type === 'title' || ph.a.type === 'ctrTitle' ? 'title' : ph.a.type === 'body' || ph.a.type === 'subTitle' || ph.a.type == null || ph.a.type === 'obj' ? 'body' : ph.a.type);
function findPlaceholder(shapes, ph) {
  if (!ph) return null;
  const idx = ph.a.idx, type = ph.a.type;
  let m = idx != null ? shapes.find((s) => s.ph && s.ph.a.idx === idx && (!type || !s.ph.a.type || s.ph.a.type === type || PH_KIND(s.ph) === PH_KIND(ph))) : null;
  if (!m && type) m = shapes.find((s) => s.ph && (s.ph.a.type === type || PH_KIND(s.ph) === PH_KIND(ph)) && (idx == null || s.ph.a.idx == null || true));
  if (!m && idx == null && !type) m = shapes.find((s) => s.ph && PH_KIND(s.ph) === 'body');
  return m;
}
const shapeList = (tree) => (tree ? tree.c.filter((n) => ['sp', 'pic', 'grpSp', 'cxnSp', 'graphicFrame'].includes(n.n)).map((n) => ({ node: n, ph: path(n, 'nvSpPr', 'nvPr', 'ph') ?? path(n, 'nvPicPr', 'nvPr', 'ph') ?? path(n, 'nvGraphicFramePr', 'nvPr', 'ph') })) : []);
const xfrmOf = (n, kind = 'spPr') => { const sp = kind === 'grp' ? kid(n, 'grpSpPr') : kid(n, kind); return kid(sp, 'xfrm'); };
function readXfrm(x) {
  if (!x) return null;
  const off = kid(x, 'off'), ext = kid(x, 'ext');
  if (!off || !ext) return null;
  return { x: num(off.a.x), y: num(off.a.y), cx: num(ext.a.cx), cy: num(ext.a.cy), flipH: x.a.flipH === '1', flipV: x.a.flipV === '1', rot: num(x.a.rot, 0) };
}

async function renderShapes(tree, level, env, out, T, depth) {
  // level: { chain(placeholders' shapes), clrMap, rels, base, layoutShapes, masterShapes }
  for (const { node, ph } of shapeList(tree)) {
    if (++env.ctx.shapeCount > MAX_SHAPES) { env.ctx.warn.add('도형이 너무 많아 일부만 그렸다'); return; }
    if (node.n === 'grpSp') {
      if (depth >= MAX_GROUP_DEPTH) continue;
      const x = kid(kid(node, 'grpSpPr'), 'xfrm');
      const off = kid(x, 'off'), ext = kid(x, 'ext'), cho = kid(x, 'chOff'), che = kid(x, 'chExt');
      let T2 = T;
      if (off && ext && cho && che && num(che.a.cx) && num(che.a.cy)) {
        const sx = num(ext.a.cx) / num(che.a.cx), sy = num(ext.a.cy) / num(che.a.cy);
        T2 = { sx: T.sx * sx, sy: T.sy * sy, tx: T.tx + T.sx * (num(off.a.x) - num(cho.a.x) * sx), ty: T.ty + T.sy * (num(off.a.y) - num(cho.a.y) * sy) };
      }
      await renderShapes(node, level, env, out, T2, depth + 1);
      continue;
    }
    if (node.n === 'cxnSp') { const sp = kid(node, 'spPr'); const x = readXfrm(kid(sp, 'xfrm')); if (!x) continue; const ln = lineOf(sp, env); const style = kid(node, 'style'); const lnRef = kid(style, 'lnRef'); const color = ln?.color ?? (lnRef ? colorOf(lnRef, env) : [0, 0, 0]); if (ln === null) continue; out.push({ type: 'text_box', ...boxOf(x, T), content: [], shape: 'line', flipH: x.flipH, flipV: x.flipV, stroke: { color: color ?? [0, 0, 0], w: ln?.w ?? 12700 } }); continue; }
    if (node.n === 'graphicFrame') { await renderFrame(node, env, out, T); continue; }
    // sp, pic
    const isPic = node.n === 'pic';
    const spPr = kid(node, 'spPr');
    // 위치: 도형 자신 → 레이아웃 자리 표시자 → 마스터 자리 표시자
    let x = readXfrm(kid(spPr, 'xfrm'));
    let lay = null, mas = null;
    if (ph) { lay = findPlaceholder(level.layoutShapes, ph); mas = findPlaceholder(level.masterShapes, lay?.ph ?? ph); if (!x) x = readXfrm(kid(kid(lay?.node, 'spPr'), 'xfrm')) ?? readXfrm(kid(kid(mas?.node, 'spPr'), 'xfrm')); }
    if (!x) continue;
    const box = { type: 'text_box', ...boxOf(x, T), content: [] };
    // 채우기·선: 직접 지정 → (자리 표시자) 레이아웃·마스터 → 도형 스타일 참조
    const style = kid(node, 'style');
    const e2 = { ...env, phClr: null };
    let fill = fillOf(spPr, env);
    if (fill === undefined && ph) fill = fillOf(kid(lay?.node, 'spPr'), env) ?? fillOf(kid(mas?.node, 'spPr'), env);
    if (fill === undefined && style) { const fr = kid(style, 'fillRef'); if (fr && num(fr.a.idx) > 0) fill = colorOf(fr, e2); }
    let line = lineOf(spPr, env);
    if (line === undefined && ph) line = lineOf(kid(lay?.node, 'spPr'), env) ?? lineOf(kid(mas?.node, 'spPr'), env);
    if (line === undefined && style) { const lr = kid(style, 'lnRef'); if (lr && num(lr.a.idx) > 0) line = { color: colorOf(lr, e2), w: [0, 9525, 12700, 19050][Math.min(3, num(lr.a.idx))] }; }
    if (fill) box.fill = fill;
    if (line && line.color) box.stroke = { color: line.color, w: line.w ?? 12700 };
    const geom = kid(spPr, 'prstGeom')?.a.prst ?? (ph ? 'rect' : kid(spPr, 'custGeom') ? 'cust' : 'rect');
    if (geom !== 'rect' && !isPic) { box.shape = geom; const adj = kid(kid(kid(spPr, 'prstGeom'), 'avLst'), 'gd'); if (adj && /^adj/.test(adj.a.name ?? '')) box.adj = num((adj.a.fmla ?? '').replace('val ', ''), undefined); }
    if (isPic) {
      const blip = path(node, 'blipFill', 'blip');
      const rid = blip?.a['r:embed'];
      const rel = rid ? level.rels.get(rid) : null;
      const img = rel?.target ? await env.ctx.image(rel.target) : null;
      if (img) { box.content = [{ type: 'image', format: img.format, data: img.data, display_width_emu: Math.round(box.width_emu), display_height_emu: Math.round(box.height_emu), positioning: 'inline' }]; box.inset = [0, 0, 0, 0]; box.picture = true; }
      else { box.fill = [238, 238, 238]; box.stroke = { color: [187, 187, 187], w: 9525 }; }
      out.push(box); continue;
    }
    const txBody = kid(node, 'txBody');
    if (txBody && kids(txBody, 'p').length) {
      // 글 서식 상속 사슬: 마스터 txStyles → 마스터 자리 표시자 → 레이아웃 자리 표시자 → 도형 자신
      const kind = ph ? PH_KIND(ph) : 'other';
      const chain = [];
      const txStyles = env.masterTx;
      chain.push(kind === 'title' ? kid(txStyles, 'titleStyle') : kind === 'body' ? kid(txStyles, 'bodyStyle') : kid(txStyles, 'otherStyle'));
      if (ph) { chain.push(kid(kid(mas?.node, 'txBody'), 'lstStyle'), kid(kid(lay?.node, 'txBody'), 'lstStyle')); }
      chain.push(kid(txBody, 'lstStyle'));
      const bodyPrs = [kid(kid(mas?.node, 'txBody'), 'bodyPr'), kid(kid(lay?.node, 'txBody'), 'bodyPr'), kid(txBody, 'bodyPr')];
      const bp = {}; for (const b of bodyPrs) if (b) Object.assign(bp, b.a);
      const na = bodyPrs.map((b) => kid(b, 'normAutofit')).filter(Boolean).pop();
      const scale = na?.a.fontScale ? num(na.a.fontScale) / 100000 : 1;
      const lnReduce = na?.a.lnSpcReduction ? num(na.a.lnSpcReduction) / 100000 : 0;
      const fr = kid(style, 'fontRef');
      const fontRefColor = fr ? colorOf(fr, e2) : null;
      box.content = await buildParas(txBody, env, { chain: chain.filter(Boolean), scale, lnReduce, fontRefColor });
      box.anchor = bp.anchor ?? 't';
      box.fit = true;                                   // 대체 글꼴이 넓어 넘치면 글자를 줄여 맞춘다
      const ins = (k, d) => (bp[k] != null ? num(bp[k]) : d);
      box.inset = [ins('lIns', 91440), ins('tIns', 45720), ins('rIns', 91440), ins('bIns', 45720)];
      if (bp.wrap === 'none') box.nowrap = true;
      if (!box.content.some((p) => p.content.length) && !box.fill && !box.stroke) continue;
    } else if (!box.fill && !box.stroke) continue;
    out.push(box);
  }
}
function boxOf(x, T) { return { x_emu: T.tx + T.sx * x.x, y_emu: T.ty + T.sy * x.y, width_emu: Math.max(0, T.sx * x.cx), height_emu: Math.max(0, T.sy * x.cy), h_anchor: 'page', v_anchor: 'page' }; }

async function renderFrame(node, env, out, T) {
  const x = readXfrm(kid(node, 'xfrm')); if (!x) return;
  const tbl = path(node, 'graphic', 'graphicData', 'tbl');
  if (!tbl) { const label = path(node, 'graphic', 'graphicData')?.c[0]?.n; out.push({ type: 'text_box', ...boxOf(x, T), content: [{ type: 'paragraph', alignment: 'center', content: [{ type: 'text', text: label === 'chart' ? '[차트]' : '[도표·개체]', font_size_half_pt: 24, color: [136, 136, 136] }] }], fill: [245, 245, 245], stroke: { color: [200, 200, 200], w: 9525 }, anchor: 'ctr', inset: [91440, 45720, 91440, 45720] }); env.ctx.warn.add('차트·도표는 표시하지 않고 자리 표시로 대신했다'); return; }
  const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => Math.max(1, num(g.a.w)));
  const rows = [];
  for (const tr of kids(tbl, 'tr')) {
    const cells = [];
    for (const tc of kids(tr, 'tc')) {
      if (tc.a.hMerge === '1' || tc.a.vMerge === '1') continue;
      const txBody = kid(tc, 'txBody');
      const tcPr = kid(tc, 'tcPr');
      const content = txBody ? await buildParas(txBody, env, { chain: [kid(env.masterTx, 'otherStyle'), kid(txBody, 'lstStyle')].filter(Boolean) }) : [{ type: 'paragraph', content: [] }];
      const cell = { content: content.length ? content : [{ type: 'paragraph', content: [] }], col_span: Math.max(1, num(tc.a.gridSpan, 1)), row_span: Math.max(1, num(tc.a.rowSpan, 1)) };
      const f = fillOf(tcPr, env); if (f) cell.background_color = f;
      const b = {};
      for (const [k, nm] of [['left', 'lnL'], ['right', 'lnR'], ['top', 'lnT'], ['bottom', 'lnB']]) { const ln = lineOf({ c: [kid(tcPr, nm)].filter(Boolean) }, env); if (ln === null) b[k] = { style: 'none' }; else if (ln?.color) b[k] = { style: 'single', size: Math.max(2, Math.round((ln.w ?? 12700) / 12700 * 8)), color: ln.color }; }
      if (Object.keys(b).length) cell.border = b;
      cells.push(cell);
    }
    rows.push({ cells, height_emu: num(tr.a.h) });
  }
  const gw = cols.reduce((a, b) => a + b, 0) || 1;
  const table = { type: 'table', column_widths_twips: cols.map((c) => Math.round(c * (T.sx * x.cx / gw) / EMU_PER_TWIP)), rows, cell_padding_twips: { left_twips: 144, right_twips: 144, top_twips: 72, bottom_twips: 72 }, border: { top: GRIDL, bottom: GRIDL, left: GRIDL, right: GRIDL, inside_h: GRIDL, inside_v: GRIDL } };
  for (const r of table.rows) for (const c of r.cells) c.width_twips = undefined;
  out.push({ type: 'text_box', ...boxOf(x, T), content: [table], inset: [0, 0, 0, 0] });
}
const GRIDL = { style: 'single', size: 4, color: [160, 160, 160] };

// ── 슬라이드 ──
export async function parsePptx(bytes, opts = {}) {
  const zip = openZip(bytes);
  const ctx = new Ctx(zip);
  const pres = await ctx.xml('ppt/presentation.xml');
  if (!pres) throw new Error('pptx: no presentation.xml');
  const sz = kid(pres, 'sldSz');
  const W = num(sz?.a.cx, 12192000), H = num(sz?.a.cy, 6858000);
  const presRels = await ctx.rels('ppt/presentation.xml');
  const slideIds = kids(kid(pres, 'sldIdLst'), 'sldId').slice(0, MAX_SLIDES);
  const sections = [];
  const themeCache = new Map();
  for (const sid of slideIds) {
    const rel = presRels.get(sid.a['r:id']); if (!rel?.target) continue;
    const slidePath = rel.target;
    const slide = await ctx.xml(slidePath); if (!slide) continue;
    const srels = await ctx.rels(slidePath);
    const layoutRel = [...srels.values()].find((r) => r.type.endsWith('/slideLayout'));
    const layoutPath = layoutRel?.target;
    const layout = layoutPath ? await ctx.xml(layoutPath) : null;
    const lrels = layoutPath ? await ctx.rels(layoutPath) : new Map();
    const masterRel = [...lrels.values()].find((r) => r.type.endsWith('/slideMaster'));
    const masterPath = masterRel?.target;
    const master = masterPath ? await ctx.xml(masterPath) : null;
    const mrels = masterPath ? await ctx.rels(masterPath) : new Map();
    const themeRel = [...mrels.values()].find((r) => r.type.endsWith('/theme'));
    let theme = themeCache.get(themeRel?.target);
    if (!theme) { const tx = themeRel?.target ? await ctx.xml(themeRel.target) : null; theme = tx ? readTheme(tx) : { colors: {}, fonts: { major: {}, minor: {} } }; themeCache.set(themeRel?.target, theme); }
    const clrMap = {}; { const cm = kid(master, 'clrMap'); if (cm) Object.assign(clrMap, cm.a); const ov = kid(kid(slide, 'clrMapOvr'), 'overrideClrMapping'); if (ov) Object.assign(clrMap, ov.a); }
    const env = { ctx, theme, clrMap, masterTx: kid(master, 'txStyles'), defaultText: colorOf({ n: 'schemeClr', a: { val: 'tx1' }, c: [] }, { theme, clrMap }) ?? [0, 0, 0] };
    const sTree = path(slide, 'cSld', 'spTree'), lTree = path(layout, 'cSld', 'spTree'), mTree = path(master, 'cSld', 'spTree');
    const layoutShapes = shapeList(lTree), masterShapes = shapeList(mTree);
    const bgOf = (n) => { const bg = path(n, 'cSld', 'bg'); if (!bg) return undefined; const pr = kid(bg, 'bgPr'); if (pr) return fillOf(pr, env) ?? null; const ref = kid(bg, 'bgRef'); return ref ? colorOf(ref, env) : null; };
    let background = bgOf(slide); if (background === undefined) background = bgOf(layout); if (background === undefined) background = bgOf(master);
    const elements = [];
    const ident = { sx: 1, sy: 1, tx: 0, ty: 0 };
    const showMaster = layout?.a.showMasterSp !== '0' && slide.a.showMasterSp !== '0';
    // 마스터·레이아웃의 장식(자리 표시자가 아닌 도형)을 먼저 깐다
    if (showMaster && mTree) await renderShapes({ c: mTree.c.filter((n) => !path(n, 'nvSpPr', 'nvPr', 'ph') && !path(n, 'nvPicPr', 'nvPr', 'ph')) }, { rels: mrels, layoutShapes: [], masterShapes: [] }, env, elements, ident, 0);
    if (showMaster && lTree && layout?.a.showMasterSp !== '0') await renderShapes({ c: lTree.c.filter((n) => !path(n, 'nvSpPr', 'nvPr', 'ph') && !path(n, 'nvPicPr', 'nvPr', 'ph')) }, { rels: lrels, layoutShapes: [], masterShapes: [] }, env, elements, ident, 0);
    await renderShapes(sTree, { rels: srels, layoutShapes, masterShapes }, env, elements, ident, 0);
    sections.push({
      title: path(slide, 'cSld') && kid(path(slide, 'cSld'), 'spTree') ? undefined : undefined,
      elements, break_type: 'next_page', background_color: background ?? [255, 255, 255],
      page_setup: { width_twips: Math.round(W / EMU_PER_TWIP), height_twips: Math.round(H / EMU_PER_TWIP), margin_top_twips: 0, margin_bottom_twips: 0, margin_left_twips: 0, margin_right_twips: 0, header_distance_twips: 0, footer_distance_twips: 0 },
    });
  }
  void opts;
  if (!sections.length) throw new Error('pptx: no slides');
  return { ir: { metadata: { format: 'pptx' }, sections }, warnings: [...ctx.warn] };
}
