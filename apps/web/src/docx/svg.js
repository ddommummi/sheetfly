// 쪽 표시 목록 → SVG 문자열. <img>로 불러 쓰므로 스크립트·외부 로드가 없다(이미지는 data URL만).
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => Math.round(v * 1000) / 1000;
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
      case 'leader': {
        const dw = measure ? measure.width(it.font, it.ch) : 6;
        const cnt = Math.max(0, Math.floor(it.w / Math.max(1, dw)) - 1);
        if (cnt) out.push(`<text x="${n(it.x + (it.w - cnt * dw))}" y="${n(it.y)}" style="font:${esc(it.font)}" fill="${esc(it.fill)}" xml:space="preserve">${esc(it.ch.repeat(cnt))}</text>`);
        break;
      }
      case 'i': {
        const u = dataUrl(it.img);
        if (u) out.push(`<image href="${u}" x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" preserveAspectRatio="none"/>`);
        else out.push(`<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" fill="#eee" stroke="#bbb"/>`);
        break;
      }
      default: break;
    }
  }
  const w = n(page.width), h = n(page.height);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#ffffff"/>${out.join('')}</svg>`;
}
