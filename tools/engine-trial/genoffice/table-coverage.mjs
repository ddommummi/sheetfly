// 표 모델이 XML 표 안 글 문단을 얼마나 담는가(셀 paras 문자열 + 중첩 표 재귀).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { scanDocumentXml } from './xml-survey.mjs';
import { parseDocx } from './work/out-node.mjs';
const dir = process.argv[2];
function* walk(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) yield* walk(p); else if (/\.(docx|docm|dotx)$/i.test(e.name)) yield p; } }
const countModel = (tm) => { let n = 0; for (const row of tm.rows ?? []) for (const c of (Array.isArray(row) ? row : row.cells ?? [])) { n += (c.paras ?? []).filter((s) => typeof s === 'string' ? s.trim() !== '' : true).length; for (const nt of c.nestedTables ?? []) n += countModel(nt); } return n; };
let xmlN = 0, modelN = 0, docs = 0, full = 0, over = 0; const deficits = [];
for (const f of [...walk(dir)].filter((f) => statSync(f).size <= 25e6).sort()) {
  let doc; try { doc = await parseDocx(new Uint8Array(readFileSync(f))); } catch { continue; }
  const scan = scanDocumentXml(doc.internal.documentXml);
  const x = scan.paras.filter((p) => p.cat === 'table').length; if (!x) continue;
  const m = doc.blocks.filter((b) => b.table).reduce((a, b) => a + countModel(b.table), 0);
  docs++; xmlN += x; modelN += Math.min(m, x); if (m >= x) full++; if (m > x) over++; else deficits.push({ f: f.slice(dir.length + 1).split('/').pop(), x, m, miss: x - m });
}
deficits.sort((a, b) => b.miss - a.miss);
console.log(`표가 있는 문서 ${docs}개, XML 표 글 문단 ${xmlN}개 중 모델이 담은 것 ${modelN}개 (${(100 * modelN / xmlN).toFixed(1)}%), 모델이 XML 수 이상 담은 문서 ${full}/${docs} (초과 ${over}개 문서)`);
console.log('모자란 문서(상위 6):', deficits.filter((d) => d.miss > 0).slice(0, 6).map((d) => `${d.f} ${d.m}/${d.x}`).join(', '));
console.log('모자란 문서 수', deficits.filter((d) => d.miss > 0).length, '모자람 합계', deficits.reduce((a, d) => a + Math.max(0, d.miss), 0));
