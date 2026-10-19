// 편집→저장→다시 열기 왕복을 샘플 코퍼스 전체에서 시험한다(무손실 판정 통계)
import { readFileSync, readdirSync } from 'node:fs';
const dir = new URL('../../apps/web/src/wasm/', import.meta.url).pathname;
const { default: init, HwpDocument } = await import(dir + 'rhwp.js');
await init({ module_or_path: readFileSync(dir + 'rhwp_bg.wasm') });
const samples = new URL('../../third_party/rhwp/samples/', import.meta.url).pathname;
const files = readdirSync(samples).filter((f) => /\.hwpx?$/i.test(f)).sort();
const rows = [];
const withTimeout = (f) => { const t = performance.now(); try { const r = f(); return { r, ms: performance.now() - t }; } catch (e) { return { e: String(e).slice(0, 100), ms: performance.now() - t }; } };
for (const f of files) {
  const bytes = new Uint8Array(readFileSync(samples + f));
  if (bytes.length > 12 * 1024 * 1024) { rows.push({ f, skip: 'big' }); continue; }
  const row = { f, kb: Math.round(bytes.length / 1024) };
  const o = withTimeout(() => new HwpDocument(bytes));
  if (o.e) { row.open = o.e; rows.push(row); continue; }
  const d = o.r;
  try {
    row.pages = d.pageCount();
    const ins = withTimeout(() => d.insertText(0, 0, 0, '가나다 abc')); row.insertMs = Math.round(ins.ms); row.insertOk = !ins.e && /"ok":true/.test(ins.r);
    const hw = withTimeout(() => d.exportHwp()); row.exportHwp = hw.e ? 'ERR ' + hw.e : Math.round(hw.ms);
    if (!hw.e) { const re = withTimeout(() => new HwpDocument(new Uint8Array(hw.r))); row.reopen = re.e ? 'ERR ' + re.e : 'ok'; if (!re.e) { row.reopenPages = re.r.pageCount(); row.textKept = re.r.getTextRange(0, 0, 0, 6).startsWith('가나다'); } }
    const rep = withTimeout(() => d.exportHwpWithReport()); row.report = rep.e ? 'ERR ' + rep.e : (() => { try { const x = rep.r; const j = JSON.parse(typeof x.contentLoss === 'function' ? x.contentLoss() : '{}'); return JSON.stringify(j).slice(0, 140); } catch (e) { return 'parse ' + String(e).slice(0, 40); } })();
    const ver = withTimeout(() => JSON.parse(d.exportHwpVerify())); row.recovered = ver.e ? 'ERR' : ver.r.recovered; if (!ver.e) row.pagesBA = `${ver.r.pageCountBefore}→${ver.r.pageCountAfter}`;
  } catch (e) { row.error = String(e).slice(0, 100); }
  try { d.free(); } catch {}
  rows.push(row);
}
const ok = rows.filter((r) => r.insertOk && r.reopen === 'ok' && r.textKept);
console.log(`files ${rows.length}, 편집·저장·다시 열기 성공 ${ok.length}`);
console.log('recovered=false:', rows.filter((r) => r.recovered === false).map((r) => `${r.f}(${r.pagesBA})`).join(' | ').slice(0, 900));
console.log('실패:', rows.filter((r) => !(r.insertOk && r.reopen === 'ok' && r.textKept) && !r.skip).map((r) => `${r.f}: ${r.open ?? r.error ?? JSON.stringify({ i: r.insertOk, re: r.reopen, k: r.textKept })}`).join('\n').slice(0, 1500));
const rep = rows.filter((r) => r.report && r.report !== '{}' && !String(r.report).startsWith('ERR')).slice(0, 6); console.log('보고서 예:', JSON.stringify(rep.map((r) => [r.f, r.report])).slice(0, 900));
const ms = rows.filter((r) => typeof r.exportHwp === 'number').map((r) => r.exportHwp).sort((a, b) => a - b); console.log('exportHwp ms p50/p95/max', ms[Math.floor(ms.length / 2)], ms[Math.floor(ms.length * 0.95)], ms.at(-1));
