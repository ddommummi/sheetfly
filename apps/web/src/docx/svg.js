// 쪽 표시 목록 → SVG 문자열. <img>로 불러 쓰므로 스크립트·외부 로드가 없다(이미지는 data URL만).
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => Math.round(v * 1000) / 1000;
const f6 = (v) => Math.round(v * 1e6) / 1e6;
const IMG_OK = new Set(['png', 'jpeg', 'jpg', 'gif', 'webp']);

function dataUrl(img) {
  const f = String(img.format || '').toLowerCase();
  if (!IMG_OK.has(f) || typeof img.data !== 'string' || !/^[A-Za-z0-9+/=\s]+$/.test(img.data)) return null;
  return `data:image/${f === 'jpg' ? 'jpeg' : f};base64,${img.data.replace(/\s+/g, '')}`;
}

export function pageToSvg(page, measure) {
  const out = [];
  for (const it of page.items) {
    switch (it.k) {
      case 'r': out.push(`<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" fill="${esc(it.fill)}"/>`); break;
      case 'l': out.push(`<line x1="${n(it.x1)}" y1="${n(it.y1)}" x2="${n(it.x2)}" y2="${n(it.y2)}" stroke="${esc(it.color)}" stroke-width="${n(it.w)}"/>`); break;
      case 't': out.push(`<text x="${n(it.x)}" y="${n(it.y)}" style="font:${esc(it.font)}" fill="${esc(it.fill)}"${it.ls ? ` letter-spacing="${n(it.ls)}"` : ''} xml:space="preserve">${esc(it.s)}</text>`); break;
      case 's': {   // 도형(슬라이드): 채우기·선
        const f = it.fill ? esc(it.fill) : 'none', st = it.stroke ? ` stroke="${esc(it.stroke)}" stroke-width="${n(it.sw)}"` : '';
        const x = n(it.x), y = n(it.y), w = n(it.w), h = n(it.h);
        if (it.shape === 'ellipse') out.push(`<ellipse cx="${n(it.x + it.w / 2)}" cy="${n(it.y + it.h / 2)}" rx="${n(it.w / 2)}" ry="${n(it.h / 2)}" fill="${f}"${st}/>`);
        else if (it.shape === 'roundRect') { const r = n(Math.min(it.w, it.h) * Math.max(0, Math.min(0.5, (Number.isFinite(it.adj) ? it.adj : 16667) / 100000))); out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${f}"${st}/>`); }
        else if (it.shape === 'triangle') out.push(`<polygon points="${n(it.x + it.w / 2)},${y} ${n(it.x + it.w)},${n(it.y + it.h)} ${x},${n(it.y + it.h)}" fill="${f}"${st}/>`);
        else if (it.shape === 'diamond') out.push(`<polygon points="${n(it.x + it.w / 2)},${y} ${n(it.x + it.w)},${n(it.y + it.h / 2)} ${n(it.x + it.w / 2)},${n(it.y + it.h)} ${x},${n(it.y + it.h / 2)}" fill="${f}"${st}/>`);
        else out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}"${st}/>`);
        break;
      }
      case 'leader': {
        const dw = measure ? measure.width(it.font, it.ch) : 6;
        const cnt = Math.max(0, Math.floor(it.w / Math.max(1, dw)) - 1);
        if (cnt) out.push(`<text x="${n(it.x + (it.w - cnt * dw))}" y="${n(it.y)}" style="font:${esc(it.font)}" fill="${esc(it.fill)}" xml:space="preserve">${esc(it.ch.repeat(cnt))}</text>`);
        break;
      }
      case 'i': {
        const u = dataUrl(it.img);
        const c = it.img.crop;
        const cw = c ? 1 - c.l - c.r : 1, ch = c ? 1 - c.t - c.b : 1;
        if (u && c && [c.l, c.t, c.r, c.b].every(Number.isFinite) && cw > 0.01 && ch > 0.01 && cw < 20 && ch < 20) {
          // 그림 자르기: 안쪽 svg의 viewBox로 원본(0..1)의 일부만 보이게 하고 상자 밖은 잘린다
          out.push(`<svg x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" viewBox="${f6(c.l)} ${f6(c.t)} ${f6(cw)} ${f6(ch)}" preserveAspectRatio="none"><image href="${u}" x="0" y="0" width="1" height="1" preserveAspectRatio="none"/></svg>`);
        } else if (u) out.push(`<image href="${u}" x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" preserveAspectRatio="none"/>`);
        else out.push(`<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" fill="#eee" stroke="#bbb"/>`);
        break;
      }
      default: break;
    }
  }
  const w = n(page.width), h = n(page.height);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#ffffff"/>${out.join('')}</svg>`;
}
