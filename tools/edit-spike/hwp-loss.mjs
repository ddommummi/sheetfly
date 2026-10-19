// 편집(글자 입력) 뒤 저장 시 content-loss 보고서 분포: HWP로 저장, HWPX로 저장 둘 다
import { readFileSync, readdirSync } from 'node:fs';
const dir = new URL('../../apps/web/src/wasm/', import.meta.url).pathname;
const { default: init, HwpDocument } = await import(dir + 'rhwp.js');
await init({ module_or_path: readFileSync(dir + 'rhwp_bg.wasm') });
const samples = new URL('../../third_party/rhwp/samples/', import.meta.url).pathname;
const files = readdirSync(samples).filter((f) => /\.hwpx?$/i.test(f)).sort();
const kinds = new Map(); let withLoss = 0, n = 0, big = 0;
const ex = [];
for (const f of files) {
  const bytes = new Uint8Array(readFileSync(samples + f));
  if (bytes.length > 12 * 1024 * 1024) { big++; continue; }
  let d; try { d = new HwpDocument(bytes); } catch { continue; }
  try {
    d.insertText(0, 0, 0, 'x');
    for (const [fmt, fn] of [['hwp', 'exportHwpWithReport'], ['hwpx', 'exportHwpxWithReport']]) {
      const r = d[fn]();
      const j = JSON.parse(r.contentLoss()); r.free?.();
      n++;
      if (j.count > 0) { withLoss++; for (const l of j.losses) { const k = `${fmt}:${l.kind ?? l.code ?? l.category ?? JSON.stringify(l).slice(0, 60)}`; kinds.set(k, (kinds.get(k) || 0) + 1); } if (ex.length < 3) ex.push([f, fmt, JSON.stringify(j).slice(0, 300)]); }
    }
  } catch (e) { /* 암호 문서 등 */ }
  try { d.free(); } catch {}
}
console.log(`저장 시도 ${n}건(HWP·HWPX), 손실 보고 있음 ${withLoss}건, 큰 파일 제외 ${big}`);
console.log([...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${v}\t${k}`).join('\n'));
console.log(JSON.stringify(ex));
