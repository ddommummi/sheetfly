// 스파이크: BetterOffice DisplayList(JSON) → 쪽별 SVG 문자열.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);
const fontCss = (f) => (f || '').replace(/Calibri/g, 'Carlito');

function glyphRun(p) {
  const font = fontCss(p.fallbackFont);
  const chars = Array.from(p.text ?? '');
  const g = p.glyphs ?? [];
  let out = '';
  const fill = p.color ?? '#000';
  // 클러스터가 글자와 1:1이면 한 <text>에 x 목록으로 낸다.
  if (g.length && g.length === p.text.length && g.every((q, i) => q.cluster === i)) {
    out += `<text x="${g.map((q) => n(q.x)).join(' ')}" y="${g.map((q) => n(q.y)).join(' ')}" style="font:${esc(font)}" fill="${esc(fill)}" xml:space="preserve">${esc(p.text)}</text>`;
  } else {
    for (let i = 0; i < g.length; i++) {
      const a = g[i].cluster, b = i + 1 < g.length ? g[i + 1].cluster : p.text.length;
      const s = p.text.slice(a, b);
      if (!s.trim()) continue;
      out += `<text x="${n(g[i].x)}" y="${n(g[i].y)}" style="font:${esc(font)}" fill="${esc(fill)}" xml:space="preserve">${esc(s)}</text>`;
    }
  }
  return out;
}
function prim(p) {
  switch (p.kind) {
    case 'glyphRun': return glyphRun(p);
    case 'text': return p.text ? `<text x="${n(p.x)}" y="${n(p.baselineY)}" style="font:${esc(fontCss(p.font))}" fill="${esc(p.color ?? '#000')}" xml:space="preserve">${esc(p.text)}</text>` : '';
    case 'decoration': return `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" fill="${esc(p.color ?? '#000')}"/>`;
    case 'rect': return `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" fill="${esc(p.fill ?? 'none')}"/>`;
    case 'line': return `<line x1="${n(p.x1)}" y1="${n(p.y1)}" x2="${n(p.x2)}" y2="${n(p.y2)}" stroke="${esc(p.color ?? '#000')}" stroke-width="${n(p.strokeWidth ?? 1)}"/>`;
    case 'image': return /^data:image\/(png|jpeg|gif|webp);base64,/.test(p.relId ?? '') ? `<image href="${esc(p.relId)}" x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" preserveAspectRatio="none"/>` : '';
    case 'shape': {
      const d = (p.geometryPath ?? []).map((c) => c.type === 'move' ? `M${n(c.x)} ${n(c.y)}` : c.type === 'line' ? `L${n(c.x)} ${n(c.y)}` : c.type === 'close' ? 'Z' : c.type === 'cubic' ? `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}` : c.type === 'quad' ? `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}` : '').join('');
      return `<path d="${d}" fill="${esc(p.fill ?? 'none')}" stroke="${esc(p.stroke?.color ?? 'none')}" stroke-width="${n(p.stroke?.width ?? 0)}"/>`;
    }
    default: return '';
  }
}
export function pageSvg(pg) {
  const w = n(pg.width), h = n(pg.height);
  const all = [...(pg.primitives ?? []), ...(pg.header?.primitives ?? []), ...(pg.footer?.primitives ?? []), ...((pg.noteAreas ?? []).flatMap((a) => a.primitives ?? []))];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${esc(pg.background ?? '#fff')}"/>${all.map(prim).join('')}</svg>`;
}
