// docx-engine(GenOffice)을 코퍼스에 돌려 ① 열림/실패·시간 ② 원본 앵커(docxIndex)의 정확성과 범위 ③ 모델이 노출하는 기능을 모은다. (v2)
//   node ge-survey.mjs <코퍼스 폴더> <out.json> [--limit N]
// v1과 달라진 점: 앵커는 엔진이 쓰는(정규화된) XML과 그 요소 범위로 검증하고, 글 문단은 위치 포함 관계로 블록에 잇고,
// 기능 탐지는 모델 전체를 재귀 탐색한다. 구조로 낸 것과 원문만 보존한 것(preserved)을 구분한다.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readZip, readPart } from '../../edit-spike/docx-zip.mjs';
import { scanDocumentXml, featureFlags } from './xml-survey.mjs';
import { parseDocx, sectionSettingsFromXml } from './work/out-node.mjs';

const [dir, outPath] = process.argv.slice(2);
const limit = process.argv.includes('--limit') ? Number(process.argv[process.argv.indexOf('--limit') + 1]) : Infinity;
function* walk(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) yield* walk(p); else if (/\.(docx|docm|dotx)$/i.test(e.name)) yield p; } }
const files = [...walk(dir)].filter((f) => statSync(f).size <= 25e6).sort().slice(0, limit);

/** 모델 객체 전체에서 "값이 있는" 키 집합을 모은다(문자열·바이트·Map은 들어가지 않는다). */
function deepKeys(root, cap = 3_000_000) {
  const keys = new Set(); let n = 0; const seen = new WeakSet();
  const walkObj = (o) => {
    if (!o || typeof o !== 'object' || n++ > cap || seen.has(o) || o instanceof Uint8Array || o instanceof Map || o instanceof Set) return;
    seen.add(o);
    if (Array.isArray(o)) { for (const x of o) walkObj(x); return; }
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (v == null || v === false || (Array.isArray(v) && v.length === 0) || v === '') continue;
      keys.add(k); if (typeof v === 'object') walkObj(v);
    }
  };
  walkObj(root); return keys;
}
const FIELD_KEYS = ['instrField', 'refField', 'refInstr', 'refFieldInstr', 'fldBeginXml', 'fieldDisplay', 'zoteroFieldId'];
const REV_KEYS = ['ins', 'del', 'rPrChange', 'rowRevisions', 'cellRevision', 'revisions'];
const anyKey = (ks, names) => names.some((k) => ks.has(k));

const rows = [];
for (const f of files) {
  const row = { f: f.slice(dir.length + 1) };
  let buf; try { buf = readFileSync(f); } catch { row.skip = 'read'; rows.push(row); continue; }
  let z; try { z = readZip(buf); } catch (e) { row.skip = 'zip:' + String(e.message).slice(0, 30); rows.push(row); continue; }
  const ent = z.entries.find((e) => e.name === 'word/document.xml');
  if (!ent) { row.skip = 'no-document.xml'; rows.push(row); continue; }
  if (z.entries.some((e) => e.flags & 1)) { row.skip = 'encrypted'; rows.push(row); continue; }
  let rawXml; try { rawXml = readPart(buf, ent).toString('utf8'); } catch { row.skip = 'inflate'; rows.push(row); continue; }
  const partNames = z.entries.map((e) => e.name);

  const t0 = performance.now();
  let doc;
  try { doc = await parseDocx(new Uint8Array(buf)); } catch (e) { row.ge = { ok: false, err: String(e.message ?? e).slice(0, 80) }; rows.push(row); continue; }
  const ms = performance.now() - t0;
  const xml = doc.internal.documentXml;            // 엔진이 저장 때 되돌아가는 기준 XML(접두사 정규화 뒤)
  const els = doc.extras.elements;                 // 엔진의 최상위 요소 범위(최상위 SDT는 펼쳐짐)
  const scan = scanDocumentXml(xml);
  const blocks = doc.blocks;
  const byType = {}; for (const b of blocks) byType[b.type] = (byType[b.type] ?? 0) + 1;

  row.xml = {
    len: rawXml.length, normalized: xml !== rawXml, tops: scan.tops.length, els: els.length,
    cats: scan.paras.reduce((a, p) => ((a[p.cat] = (a[p.cat] ?? 0) + 1), a), {}),
    feat: featureFlags(xml, {
      header: partNames.some((n) => /^word\/header\d*\.xml$/.test(n)),
      footer: partNames.some((n) => /^word\/footer\d*\.xml$/.test(n)),
      footnotes: partNames.includes('word/footnotes.xml'), comments: partNames.includes('word/comments.xml'),
    }),
  };

  // ① 앵커 내부 일관성: originalXml == 기준 XML의 요소 조각
  let anchored = 0, exact = 0, sdtWrapped = 0, firstBad = null;
  const byIdx = new Map();
  for (const b of blocks) {
    if (b.docxIndex == null) continue;
    anchored++;
    const el = els[b.docxIndex];
    if (el && b.originalXml != null && xml.slice(el.start, el.end) === b.originalXml) exact++;
    else { if (b.sdtShell) sdtWrapped++; firstBad ??= { idx: b.docxIndex, type: b.type, hasEl: !!el, hasOrig: b.originalXml != null }; }
    if (!byIdx.has(b.docxIndex)) byIdx.set(b.docxIndex, b);
  }
  // ② 글 문단 → 포함하는 요소 → 블록
  const elStarts = els.map((e) => e.start);
  const elOf = (pos) => { let lo = 0, hi = els.length - 1, ans = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (elStarts[mid] <= pos) { ans = mid; lo = mid + 1; } else hi = mid - 1; } return ans >= 0 && pos < els[ans].end ? ans : -1; };
  const cover = {};
  for (const p of scan.paras) {
    const c = (cover[p.cat] ??= { n: 0, none: 0, editable: 0, tableModel: 0, textboxDisplay: 0, protectedBlock: 0 });
    c.n++;
    const i = elOf(p.start); const b = i >= 0 ? byIdx.get(i) : null;
    if (!b) { c.none++; continue; }
    const self = els[i].start === p.start;            // 이 문단이 곧 그 요소인가(중첩이 아닌가)
    if (self && ['paragraph', 'heading', 'listItem'].includes(b.type) && b.runs) c.editable++;
    else if (b.type === 'table' && b.table) c.tableModel++;
    else if (!self && b.textboxes?.length) c.textboxDisplay++;
    else c.protectedBlock++;
  }

  // ③ 모델이 구조로 내는 기능(재귀 탐색) + 원문만 보존한 기능(preserved)
  const ks = deepKeys({ blocks, comments: doc.comments, footnotes: doc.footnotes, endnotes: doc.endnotes, headerParas: doc.headerParas, footerParas: doc.footerParas, hfParts: doc.hfParts });
  const origAll = blocks.map((b) => b.originalXml ?? '').join('\n');
  const preservedRe = { floating: /<wp:anchor\b/, math: /<m:oMath\b/, chart: /<c:chart\b/, field: /<w:fldChar\b|<w:fldSimple\b/, revision: /<w:ins\s|<w:del\s/, textbox: /<w:txbxContent\b/, sdt: /<w:sdt\b/ };
  // 구역: 모델이 보존한 조각(블록 원문·문단 pPr)에서 sectPr을 꺼내 공개 함수로 해석한다(XML을 직접 넘기지 않는다)
  const sectSlices = blocks.flatMap((b) => [b.originalXml, b.rawPPr].filter(Boolean)).flatMap((x) => x.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g) ?? []);
  let cols = false, grid = false;
  for (const s of sectSlices) { try { const st = sectionSettingsFromXml(s, {}); if ((st.columns ?? 1) > 1) cols = true; if (st.docGrid && st.docGrid.type && st.docGrid.type !== 'default') grid = true; } catch { /* 해석 실패 = 기능 없음 */ } }
  const struct = {
    field: anyKey(ks, FIELD_KEYS), revision: anyKey(ks, REV_KEYS),
    comment: (doc.comments?.length ?? 0) > 0 || ks.has('commentIds'),
    noteRef: ks.has('noteRef') || (doc.footnotes?.length ?? 0) + (doc.endnotes?.length ?? 0) > 0,
    columns: cols, docGrid: grid,
    floating: anyKey(ks, ['imageWrap', 'textboxes', 'floatPos', 'anchoredBoxes', 'frame']),
    inlineDrawing: ks.has('image') || ks.has('imageDataUrl') || blocks.some((b) => b.type === 'image'),
    textbox: anyKey(ks, ['textboxes', 'anchoredBoxes']),
    math: anyKey(ks, ['math', 'formulaDisplay']), chart: ks.has('chartDisplay'), sdt: ks.has('sdtShell'),
    header: (doc.headerParas?.length ?? 0) > 0 || Object.keys(doc.hfParts ?? {}).length > 0,
    footer: (doc.footerParas?.length ?? 0) > 0 || Object.keys(doc.hfParts ?? {}).length > 0,
    numbering: blocks.some((b) => b.list) || ks.has('list'),
    hyperlink: ks.has('link'), tab: ks.has('tabStops'), ruby: ks.has('ruby'), symbol: ks.has('sym'),
    multiSection: sectSlices.length > 1,
  };
  const preserved = {}; for (const [k, re] of Object.entries(preservedRe)) preserved[k] = re.test(origAll);
  row.ge = { ok: true, ms: Math.round(ms), blocks: blocks.length, byType, anchored, exact, sdtWrapped, firstBad, cover, feat: struct, preserved };
  rows.push(row);
}
writeFileSync(outPath, JSON.stringify(rows));
const ok = rows.filter((r) => r.ge?.ok), fail = rows.filter((r) => r.ge && !r.ge.ok), skip = rows.filter((r) => r.skip);
console.log({ files: rows.length, ok: ok.length, fail: fail.length, skip: skip.length });
