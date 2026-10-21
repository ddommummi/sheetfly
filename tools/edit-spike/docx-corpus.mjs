// 실제 DOCX 코퍼스에서 4-2 설계의 가정을 측정한다: ① IR 글 블록이 XML 문단과 짝지어지는 비율 ② 편집 가능(잠금 아님) 문단 비율 ③ 색인·정렬 시간.
//   node tools/edit-spike/docx-corpus.mjs <폴더> [--json 결과.json] [--limit N]
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readZip, readPart } from './docx-zip.mjs';
import { indexParagraphs } from './docx-xml.mjs';
import { irOf, flattenIr, align } from './docx-ir.mjs';

const args = process.argv.slice(2);
const dir = args[0]; const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
function* walk(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) yield* walk(p); else if (/\.(docx|docm|dotx)$/i.test(e.name)) yield p; } }
const files = [...walk(dir)].filter((f) => statSync(f).size <= 25e6).slice(0, limit);
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const rows = [], skips = {};
const skip = (why) => { skips[why] = (skips[why] ?? 0) + 1; };
for (const f of files) {
  let buf; try { buf = readFileSync(f); } catch { skip('읽기 실패'); continue; }
  let z; try { z = readZip(buf); } catch (e) { skip(`ZIP 아님/미지원: ${String(e.message).slice(0, 30)}`); continue; }
  const ent = z.entries.find((e) => e.name === 'word/document.xml');
  if (!ent) { skip('word/document.xml 없음'); continue; }
  if (z.entries.some((e) => (e.flags & 1))) { skip('암호화 항목'); continue; }
  let xml; try { xml = readPart(buf, ent).toString('utf8'); } catch (e) { skip('압축 해제 실패'); continue; }
  const prefixOk = new RegExp(`xmlns:w="${W_NS.replace(/\//g, '\\/')}"`).test(xml.slice(0, 4000));
  let ir; const t0 = performance.now();
  try { ir = irOf(buf); } catch (e) { skip(`IR 실패: ${String(e).slice(0, 40)}`); rows.push({ f, irFail: true, prefixOk, xmlLen: xml.length }); continue; }
  const tIr = performance.now() - t0;
  const t1 = performance.now(); const xp = indexParagraphs(xml); const tIdx = performance.now() - t1;
  const blocks = flattenIr(ir); const info = { risky: [] }; const map = align(blocks, xp, 12, info);
  const textBlocks = blocks.filter((b) => b.text !== null);
  const mapped = textBlocks.filter((b) => map[blocks.indexOf(b)] >= 0).length;
  const nonEmpty = textBlocks.filter((b) => b.text !== '').length;
  const mappedNonEmpty = blocks.filter((b, i) => b.text && map[i] >= 0).length;
  const mappedEditable = blocks.filter((b, i) => b.text && map[i] >= 0 && xp[map[i]].editable).length;
  const reasons = {}; blocks.forEach((b, i) => { if (b.text && map[i] >= 0 && !xp[map[i]].editable) reasons[xp[map[i]].why] = (reasons[xp[map[i]].why] ?? 0) + 1; });
  const unmappedSamples = blocks.map((b, i) => (b.text && map[i] < 0 ? b.text.slice(0, 40) : null)).filter(Boolean).slice(0, 3);
  rows.push({ risky: info.risky.length, f, prefixOk, xmlLen: xml.length, xmlParas: xp.length, blocks: textBlocks.length, nonEmpty, mapped: mappedNonEmpty, editable: mappedEditable, reasons, unmappedSamples, tIr: Math.round(tIr), tIdx: Math.round(tIdx), tracked: /<w:(ins|del) /.test(xml) });
}
const ok = rows.filter((r) => !r.irFail);
const sum = (k) => ok.reduce((a, r) => a + r[k], 0);
const totalNE = sum('nonEmpty'), totalMapped = sum('mapped'), totalEd = sum('editable');
const full = ok.filter((r) => r.mapped === r.nonEmpty).length;
console.log(`파일 ${files.length}개 중 분석 ${ok.length}개 (IR 실패 ${rows.length - ok.length}, 건너뜀 ${Object.values(skips).reduce((a, b) => a + b, 0)})`);
console.log('건너뜀 사유:', JSON.stringify(skips));
console.log(`비어 있지 않은 IR 글 블록 ${totalNE}개 중 XML 문단과 짝지어진 것 ${totalMapped}개 (${(100 * totalMapped / Math.max(1, totalNE)).toFixed(2)}%)`);
console.log(`짝지어진 것 중 편집 가능(잠금 아님) ${totalEd}개 (${(100 * totalEd / Math.max(1, totalMapped)).toFixed(1)}%)`);
console.log(`블록이 모두 짝지어진 파일 ${full}/${ok.length} (${(100 * full / Math.max(1, ok.length)).toFixed(1)}%), 접두사가 w:가 아닌 파일 ${ok.filter((r) => !r.prefixOk).length}, 변경 추적 든 파일 ${ok.filter((r) => r.tracked).length}`);
console.log(`확신 낮은 짝(건너뛴 글 문단 있음) ${sum('risky')}개 (짝지어진 것의 ${(100 * sum('risky') / Math.max(1, totalMapped)).toFixed(2)}%), 해당 파일 ${ok.filter((r) => r.risky).length}개`);
const reasons = {}; for (const r of ok) for (const [k, v] of Object.entries(r.reasons)) reasons[k] = (reasons[k] ?? 0) + v;
console.log('잠금 사유(문단 수):', JSON.stringify(Object.fromEntries(Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 10))));
const worst = ok.filter((r) => r.mapped < r.nonEmpty).sort((a, b) => (b.nonEmpty - b.mapped) - (a.nonEmpty - a.mapped)).slice(0, 8);
for (const r of worst) console.log(`  어긋남 ${r.nonEmpty - r.mapped}/${r.nonEmpty}  ${r.f.split('/').slice(-3).join('/')}  예: ${JSON.stringify(r.unmappedSamples)}`);
const times = ok.map((r) => r.tIdx).sort((a, b) => a - b);
console.log(`색인 시간 p50 ${times[times.length >> 1]}ms, 최대 ${times[times.length - 1]}ms; IR 읽기 최대 ${Math.max(...ok.map((r) => r.tIr))}ms`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
