// office_oxide IR(우리 fmt-docx WASM)과 기존 P2 정렬을 코퍼스에 돌려 ① IR이 구조로 내는 기능 ② 문단 분류별 "짝+편집 가능" 비율을 모은다.
//   node oo-survey.mjs <코퍼스 폴더> <out.json>
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readZip, readPart } from '../../edit-spike/docx-zip.mjs';
import { indexParagraphs } from '../../edit-spike/docx-xml.mjs';
import { irOf, flattenIr, align } from '../../edit-spike/docx-ir.mjs';
import { scanDocumentXml } from './xml-survey.mjs';

const [dir, outPath] = process.argv.slice(2);
function* walk(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) yield* walk(p); else if (/\.(docx|docm|dotx)$/i.test(e.name)) yield p; } }
const files = [...walk(dir)].filter((f) => statSync(f).size <= 25e6).sort();
const rows = [];
for (const f of files) {
  const row = { f: f.slice(dir.length + 1) };
  let buf; try { buf = readFileSync(f); } catch { continue; }
  let z; try { z = readZip(buf); } catch { row.skip = 'zip'; rows.push(row); continue; }
  const ent = z.entries.find((e) => e.name === 'word/document.xml');
  if (!ent || z.entries.some((e) => e.flags & 1)) { row.skip = 'nodoc/enc'; rows.push(row); continue; }
  let xml; try { xml = readPart(buf, ent).toString('utf8'); } catch { row.skip = 'inflate'; rows.push(row); continue; }
  const t0 = performance.now(); let ir;
  try { ir = irOf(buf); } catch (e) { row.oo = { ok: false, err: String(e).slice(0, 60) }; rows.push(row); continue; }
  const ms = performance.now() - t0;
  // --- IR가 구조로 내는 기능 ---
  const types = new Set(); const kinds = { imgPos: false, link: false, tabs: false };
  const visit = (o) => { if (Array.isArray(o)) return o.forEach(visit); if (o && typeof o === 'object') { if (typeof o.type === 'string') types.add(o.type); if (o.type === 'image' && o.positioning && typeof o.positioning === 'object' && o.positioning.floating) kinds.imgPos = true; if (o.type === 'text' && o.hyperlink) kinds.link = true; if ((o.type === 'paragraph' || o.type === 'heading') && o.tabs?.length) kinds.tabs = true; if ((o.type === 'paragraph' || o.type === 'heading') && o.frame_position) kinds.imgPos = true; Object.values(o).forEach(visit); } };
  visit(ir.ir.sections);
  const secs = ir.ir.sections;
  const cols = secs.some((s) => s.columns && (s.columns.count ?? s.columns.num ?? s.columns.columns ?? 2) > 1);
  const feat = {
    field: false, revision: false, math: false, chart: false, sdt: false, docGrid: false, ruby: false, symbol: false,
    comment: types.has('comment_start') || types.has('comment_ref'),
    noteRef: types.has('footnote_ref') || types.has('endnote_ref'),
    columns: cols,
    floating: kinds.imgPos || types.has('text_box') || types.has('shape'),
    inlineDrawing: types.has('image'),
    textbox: types.has('text_box'),
    header: secs.some((s) => s.header || s.first_page_header || s.even_page_header),
    footer: secs.some((s) => s.footer || s.first_page_footer || s.even_page_footer),
    numbering: types.has('list'), hyperlink: kinds.link, tab: kinds.tabs,
    multiSection: secs.length > 1,
  };
  // --- P2: 문단 분류별 짝+편집 가능 ---
  const scan = scanDocumentXml(xml);
  const xp = indexParagraphs(xml);
  const blocks = flattenIr(ir);
  const map = align(blocks, xp, 12, { risky: [] });
  const mappedSet = new Set(map.filter((j) => j >= 0));
  const startToJ = new Map(xp.map((p, j) => [p.start, j]));
  const cats = {};
  for (const p of scan.paras) {
    const c = (cats[p.cat] ??= { n: 0, mappedEditable: 0, mappedLocked: 0, unmapped: 0 });
    c.n++;
    const j = startToJ.get(p.start);
    if (j == null || !mappedSet.has(j)) c.unmapped++;
    else if (xp[j].editable) c.mappedEditable++; else c.mappedLocked++;
  }
  row.oo = { ok: true, ms: Math.round(ms * 10) / 10, feat, cats, irTextBlocks: blocks.filter((b) => b.text).length };
  rows.push(row);
}
writeFileSync(outPath, JSON.stringify(rows));
const ok = rows.filter((r) => r.oo?.ok);
console.log({ files: rows.length, ok: ok.length, irFail: rows.filter((r) => r.oo && !r.oo.ok).length, skip: rows.filter((r) => r.skip).length });
