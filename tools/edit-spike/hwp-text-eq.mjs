// 저장 → 다시 열기 후 본문 글자(문단 수·문단 길이·앞 40자)가 같은지: 쪽 수 비교보다 강한 무손실 점검
import { readFileSync, readdirSync } from 'node:fs';
const dir = new URL('../../apps/web/src/wasm/', import.meta.url).pathname;
const { default: init, HwpDocument } = await import(dir + 'rhwp.js');
await init({ module_or_path: readFileSync(dir + 'rhwp_bg.wasm') });
const samples = new URL('../../third_party/rhwp/samples/', import.meta.url).pathname;
const files = readdirSync(samples).filter((f) => /\.hwpx?$/i.test(f)).sort();
const sig = (d) => { const out = []; for (let s = 0; s < d.getSectionCount(); s++) { const n = d.getParagraphCount(s); out.push(n); for (let p = 0; p < Math.min(n, 4000); p++) { const len = d.getParagraphLength(s, p); out.push(len, len ? d.getTextRange(s, p, 0, Math.min(len, 40)) : ''); } } return out.join('|'); };
let tested = 0, same = 0; const diff = [];
for (const f of files) {
  const bytes = new Uint8Array(readFileSync(samples + f));
  if (bytes.length > 12 * 1024 * 1024) continue;
  let d; try { d = new HwpDocument(bytes); } catch { continue; }
  try {
    const a = sig(d);                                   // 편집 전(원본 그대로)
    const re = new HwpDocument(new Uint8Array(d.exportHwp()));
    const b = sig(re);
    tested++; if (a === b) same++; else diff.push(f);
    re.free(); d.free();
  } catch (e) { diff.push(f + ' ERR ' + String(e).slice(0, 40)); }
}
console.log(`원본 → 저장 → 다시 열기: 본문 글자·문단 구조 같음 ${same}/${tested}`);
console.log('다름:', diff.slice(0, 20).join(' | '));
