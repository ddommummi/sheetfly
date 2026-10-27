// 축소 번들(V3: TIFF·EMF 스텁 + JSZip shim)이 전체 번들(V0)과 같은 파싱 결과를 내는지 코퍼스 전체로 비교한다.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const [dir] = process.argv.slice(2);
const V0 = await import('./out/variants/V0.js'), V3 = await import('./out/variants/V3.js');
const h = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);
const txt = (b) => (b.runs ?? []).map((r) => r.text ?? '').join('');
const cellTxt = (t) => JSON.stringify((t?.rows ?? []).map((row) => (Array.isArray(row) ? row : row.cells ?? []).map((c) => c.paras)));
function sig(d) {
  return {
    n: d.blocks.length,
    types: h(d.blocks.map((b) => b.type).join(',')),
    idx: h(d.blocks.map((b) => b.docxIndex).join(',')),
    orig: h(d.blocks.map((b) => b.originalXml ?? '').join('\u0000')),
    text: h(d.blocks.map(txt).join('\u0000')),
    cells: h(d.blocks.map((b) => cellTxt(b.table)).join('\u0000')),
    hf: h(JSON.stringify([d.headerText, d.footerText, d.headerParas?.length, d.footerParas?.length])),
    notes: h(JSON.stringify([d.footnotes?.length, d.endnotes?.length, d.comments?.length])),
    xml: h(d.internal.documentXml),
  };
}
function* walk(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) yield* walk(p); else if (/\.(docx|docm|dotx)$/i.test(e.name)) yield p; } }
let n = 0, same = 0, bothFail = 0, onlyV0Failed = 0, onlyV3Failed = 0; const diffs = []; let t0s = 0, t3s = 0;
for (const f of [...walk(dir)].filter((f) => statSync(f).size <= 25e6).sort()) {
  const bytes = new Uint8Array(readFileSync(f)); let a, b, ea, eb;
  let t = performance.now(); try { a = await V0.parseDocx(bytes); } catch (e) { ea = e; } t0s += performance.now() - t;
  t = performance.now(); try { b = await V3.parseDocx(bytes); } catch (e) { eb = e; } t3s += performance.now() - t;
  if (ea && eb) { bothFail++; continue; }
  if (ea || eb) { if (ea) onlyV0Failed++; else onlyV3Failed++; diffs.push({ f: f.slice(dir.length + 1).split('/').pop(), why: ea ? 'V0 실패 ' + String(ea.message).slice(0, 50) : 'V3 실패 ' + String(eb.message).slice(0, 80) }); continue; }
  n++;
  const sa = sig(a), sb = sig(b); const bad = Object.keys(sa).filter((k) => sa[k] !== sb[k]);
  if (!bad.length) same++; else diffs.push({ f: f.slice(dir.length + 1).split('/').pop(), bad });
}
console.log(`둘 다 연 문서 ${n}개 중 결과 서명 완전 일치 ${same}개 (${(100 * same / n).toFixed(1)}%); 둘 다 실패 ${bothFail}; V3만 실패 ${onlyV3Failed}; V0만 실패 ${onlyV0Failed}`);
console.log(`읽기 시간 합계(ms): V0 ${Math.round(t0s)}, V3 ${Math.round(t3s)}`);
console.log('차이 예:', JSON.stringify(diffs.slice(0, 8)));
const kinds = {}; for (const d of diffs) for (const k of d.bad ?? [d.why]) kinds[k] = (kinds[k] ?? 0) + 1; console.log('차이 종류별 문서 수:', kinds);
