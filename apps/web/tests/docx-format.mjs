// DOCX 서식·찾아 바꾸기(4-2-4) 단위 시험: 글자·문단 서식이 저장본(XML)과 화면(IR)에 같게 들어가는지, 되돌리기·다시 하기, 입력 서식, 찾기·바꾸기.
//   node --test tests/docx-format.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDocx, p, table, fieldSimple, run } from './docx-fixtures.mjs';
import { irOf } from './docx-edit-helpers.mjs';
import { layoutDocument } from '../src/docx/layout.js';
import { createFakeMeasurer } from '../src/docx/measure.js';
import { DocxEditSession, spansText } from '../src/docx/edit/session.js';
import { flattenIr } from '../src/docx/edit/ir.js';
import { readZip, partText } from '../src/docx/edit/zip.js';
import { openEdit, run as runOp } from '../src/docx-edit.js';

const measure = createFakeMeasurer();
const pos = (p, o) => ({ s: 0, p, o, path: null });
const open = (body) => { const bytes = new Uint8Array(makeDocx(body)); return DocxEditSession.open(bytes, irOf(bytes), measure, { readIr: async (b) => irOf(b), layoutDocument }); };
const docXml = async (bytes) => { const z = readZip(bytes); return partText(bytes, z.entries.find((e) => e.name === 'word/document.xml')); };
/** 문단의 글 조각(서식 포함): [{text, ...속성}] */
const spans = (full, i) => flattenIr(full).filter((b) => b.text)[i].node.content.filter((c) => c.type === 'text');
const mirrorSpans = (s, p) => s.nodes.get(s.model.paras[p].id).node.content.filter((c) => c.type === 'text');
/** 저장본에서 읽은 글 조각과 거울 IR의 글 조각이 같은 서식 경계·값을 갖는지 */
const sig = (list) => { const out = []; for (const c of list) { const k = JSON.stringify({ b: !!c.bold, i: !!c.italic, u: !!c.underline && c.underline !== 'none', s: !!c.strikethrough, z: c.font_size_half_pt, c: c.color ?? null, f: c.font_name, h: c.highlight ?? null }); if (out.length && out.at(-1).k === k) out.at(-1).t += c.text; else out.push({ k, t: c.text }); } return out; };

test('글자 서식: 범위 일부만 굵게 → 런이 쪼개지고 저장본·화면 모두 그 범위만 굵다', async () => {
  const s = await open(p('가나다라마바'));
  await s.fmt({ a: pos(0, 2), b: pos(0, 4), props: { bold: true } });
  const re = irOf(await s.save());
  assert.deepEqual(spans(re, 0).map((c) => [c.text, !!c.bold]), [['가나', false], ['다라', true], ['마바', false]]);
  assert.deepEqual(mirrorSpans(s, 0).map((c) => [c.text, !!c.bold]), [['가나', false], ['다라', true], ['마바', false]]);
  assert.equal(s.model.text(0), '가나다라마바');
});

test('글자 서식 전부: 기울임·밑줄·취소선·크기·색·글꼴·형광펜이 XML에 스키마 순서로 들어가고 다시 읽힌다', async () => {
  const s = await open(p('서식 시험'));
  await s.fmt({ a: pos(0, 0), b: pos(0, 5), props: { highlight: '#00ff00', fontName: 'Arial', color: '#ff0000', fontSize: 40, strikethrough: true, underline: true, italic: true, bold: true } });
  const out = await s.save(), xml = await docXml(out);
  const rpr = /<w:rPr>(.*?)<\/w:rPr>/.exec(xml)[1];
  const order = [...rpr.matchAll(/<w:(\w+)/g)].map((m) => m[1]);
  const want = ['rFonts', 'b', 'i', 'strike', 'color', 'sz', 'szCs', 'u', 'shd'];
  assert.deepEqual(order.filter((n) => want.includes(n)), want, `rPr 순서 ${order}`);
  const c = spans(irOf(out), 0)[0];
  assert.equal(c.bold, true); assert.equal(c.italic, true); assert.equal(c.strikethrough, true); assert.equal(c.underline, 'single');
  assert.equal(c.font_size_half_pt, 40); assert.deepEqual(c.color, [255, 0, 0]); assert.equal(c.font_name, 'Arial'); assert.deepEqual(c.highlight, [0, 255, 0]);
  const m = mirrorSpans(s, 0)[0];
  assert.equal(m.bold, true); assert.equal(m.underline, 'single'); assert.equal(m.font_size_half_pt, 40); assert.deepEqual(m.color, [255, 0, 0]); assert.equal(m.font_name, 'Arial'); assert.deepEqual(m.highlight, [0, 255, 0]);
});

test('서식 끄기: 스타일이 굵게인 제목에서 굵게를 끄면 명시적으로 꺼지고, 형광펜 지우기는 shd·highlight를 모두 지운다', async () => {
  const s = await open(p('제목 글', { heading: 1 }) + `<w:p><w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>노랑</w:t></w:r></w:p>`);
  assert.equal(s.props({ pos: pos(0, 1) }).char.bold, true, '제목 스타일은 굵다');
  await s.fmt({ a: pos(0, 0), b: pos(0, 4), props: { bold: false } });
  await s.fmt({ a: pos(1, 0), b: pos(1, 2), props: { highlight: null } });
  const out = await s.save(), re = irOf(out);
  assert.ok(!spans(re, 0)[0].bold, '굵게가 꺼졌다');
  assert.equal(s.props({ pos: pos(0, 1) }).char.bold, false, '화면(제목 스타일 위에서)도 꺼졌다');
  assert.equal(spans(re, 1)[0].highlight, undefined);
  assert.ok(!/<w:highlight/.test(await docXml(out)));
  assert.ok(mirrorSpans(s, 1)[0].highlight === undefined);
});

test('이미 서식이 있는 런을 쪼개도 기존 서식은 양쪽에 남고, 하이퍼링크 안 런도 된다', async () => {
  const s = await open(`<w:p><w:r><w:rPr><w:i/><w:color w:val="0000FF"/></w:rPr><w:t>파란 기울임 글</w:t></w:r></w:p>`);
  await s.fmt({ a: pos(0, 3), b: pos(0, 6), props: { bold: true } });
  const sp = spans(irOf(await s.save()), 0);
  assert.deepEqual(sp.map((c) => [c.text, !!c.bold, !!c.italic, c.color?.join()]), [['파란 ', false, true, '0,0,255'], ['기울임', true, true, '0,0,255'], [' 글', false, true, '0,0,255']]);
  const h = await open(`<w:p><w:hyperlink w:anchor="x"><w:r><w:t>링크 글자</w:t></w:r></w:hyperlink></w:p>`);
  await h.fmt({ a: pos(0, 1), b: pos(0, 3), props: { underline: true } });
  const xml = await docXml(await h.save());
  assert.match(xml, /<w:hyperlink[^>]*>.*<w:u w:val="single"\/>.*<\/w:hyperlink>/);
  assert.equal(h.model.text(0), '링크 글자');
});

test('여러 문단·표 칸에 걸친 서식은 한 번에 되돌려진다', async () => {
  const s = await open(p('첫째') + table([['가', '나']]) + p('끝'));
  const base = JSON.stringify(sig(mirrorSpans(s, 0)));
  await s.fmt({ a: pos(0, 0), b: pos(3, 1), props: { italic: true } });
  for (let q = 0; q < s.model.paragraphCount; q++) assert.ok(mirrorSpans(s, q).every((c) => c.italic), `문단 ${q}`);
  const re = irOf(await s.save());
  assert.ok(flattenIr(re).filter((b) => b.text).every((b) => b.node.content.filter((c) => c.type === 'text').every((c) => c.italic)));
  await s.undo();
  assert.ok(mirrorSpans(s, 0).every((c) => !c.italic)); assert.equal(JSON.stringify(sig(mirrorSpans(s, 0))), base);
  await s.redo();
  assert.ok(mirrorSpans(s, 3).every((c) => c.italic));
});

test('되돌리기·다시 하기가 글자 서식(쪼개진 조각 포함)을 그대로 돌린다', async () => {
  const s = await open(p('가나다라마바'));
  const base = JSON.stringify(sig(mirrorSpans(s, 0)));
  await s.fmt({ a: pos(0, 1), b: pos(0, 3), props: { bold: true } });
  await s.fmt({ a: pos(0, 2), b: pos(0, 5), props: { color: '#ff0000' } });
  const after = JSON.stringify(sig(mirrorSpans(s, 0)));
  await s.undo(); await s.undo();
  assert.equal(JSON.stringify(sig(mirrorSpans(s, 0))), base);
  assert.equal(irOf(await s.save()) && sig(spans(irOf(await s.save()), 0)).length, 1, '저장본도 한 덩어리로 돌아온다');
  await s.redo(); await s.redo();
  assert.equal(JSON.stringify(sig(mirrorSpans(s, 0))), after);
  assert.equal(s.stats.reconcile, 0, '서식은 거울로 처리(저장본 다시 읽기 없음)');
});

test('문단 서식: 정렬·왼쪽 여백·첫 줄·문단 간격·줄 간격이 저장본·화면·조판에 들어간다', async () => {
  const s = await open(p('가운데 정렬 시험 문단') + p('둘째'));
  const y0 = s.caret({ pos: pos(1, 0) }).rect.y;
  await s.parafmt({ a: pos(0, 0), b: pos(0, 0), props: { alignment: 'center', indentLeft: 720, firstLine: -240, spaceAfter: 480, lineSpacing: 200 } });
  const out = await s.save(), xml = await docXml(out), node = flattenIr(irOf(out)).find((b) => b.text).node;
  assert.equal(node.alignment, 'center'); assert.equal(node.indent_left_twips, 720); assert.equal(node.first_line_indent_twips, -240); assert.equal(node.space_after_twips, 480); assert.deepEqual(node.line_spacing, { auto: 480 });
  assert.match(xml, /<w:pPr>(?:(?!<\/w:pPr>).)*<w:spacing[^>]*w:line="480"[^>]*w:lineRule="auto"[^>]*\/><w:ind[^>]*w:left="720"[^>]*w:hanging="240"[^>]*\/><w:jc w:val="center"\/>/);
  const m = s.nodes.get(s.model.paras[0].id).node;
  assert.equal(m.alignment, 'center'); assert.equal(m.indent_left_twips, 720);
  assert.ok(s.caret({ pos: pos(1, 0) }).rect.y > y0 + 10, '문단 간격·줄 간격이 쪽 배치에 반영되어 아래 문단이 내려갔다');
  assert.ok(s.caret({ pos: pos(0, 0) }).rect.x > 96 + 40, '왼쪽 여백만큼 캐럿이 오른쪽으로');
  await s.undo();
  const n2 = s.nodes.get(s.model.paras[0].id).node;
  assert.equal(n2.alignment, undefined); assert.equal(n2.indent_left_twips, undefined);
  assert.equal(s.caret({ pos: pos(1, 0) }).rect.y, y0, '되돌리면 처음 배치');
});

test('문단 서식: 기존 w:ind·w:spacing의 다른 속성은 보존하고 Chars 속성은 지운다', async () => {
  const s = await open(`<w:p><w:pPr><w:spacing w:before="100" w:after="100" w:beforeLines="50"/><w:ind w:left="100" w:leftChars="50" w:right="200"/></w:pPr><w:r><w:t>글</w:t></w:r></w:p>`);
  await s.parafmt({ a: pos(0, 0), b: pos(0, 0), props: { indentLeft: 300, spaceBefore: 0 } });
  const xml = await docXml(await s.save());
  const pPr = /<w:pPr>(.*?)<\/w:pPr>/.exec(xml)[1];
  assert.match(pPr, /<w:spacing[^>]*w:after="100"/); assert.match(pPr, /w:before="0"/); assert.doesNotMatch(pPr, /beforeLines/);
  assert.match(pPr, /<w:ind[^>]*w:left="300"[^>]*w:right="200"|<w:ind[^>]*w:right="200"[^>]*w:left="300"/); assert.doesNotMatch(pPr, /leftChars/);
});

test('서식을 먼저 정하고 입력하면 넣은 글에만 입히고 입력과 되돌리기 한 항목이다', async () => {
  const s = await open(p('앞뒤'));
  const r = await s.insert({ pos: pos(0, 1), text: 'XY', group: false, fmt: { bold: true, color: '#00ff00' } });
  assert.deepEqual(r.pos, pos(0, 3));
  assert.deepEqual(mirrorSpans(s, 0).map((c) => [c.text, !!c.bold]), [['앞', false], ['XY', true], ['뒤', false]]);
  assert.equal(s.model.undoStack.length, 1);
  await s.undo();
  assert.equal(s.model.text(0), '앞뒤'); assert.deepEqual(sig(mirrorSpans(s, 0)).length, 1);
});

test('props: 캐럿 앞 글자의 서식(스타일이 정한 값까지 풀려서)과 문단 서식', async () => {
  const s = await open(p('제목', { heading: 1 }) + p('본문', { align: 'right' }));
  const a = s.props({ pos: pos(0, 1) });
  assert.equal(a.char.bold, true); assert.equal(a.char.fontSize, 32 * 50); assert.equal(a.char.textColor, '#2e74b5');
  const b = s.props({ pos: pos(1, 0) });
  assert.equal(b.char.bold, false); assert.equal(b.para.alignment, 'right'); assert.equal(b.char.fontFamily, 'Calibri');
});

test('찾기: 앞뒤 방향·한 바퀴·대소문자·같은 문단 안 여러 개', async () => {
  const s = await open(p('Apple pie') + p('apple APPLE') + p('끝'));
  let r = s.find({ pos: pos(0, 0), query: 'apple' });
  assert.deepEqual([r.a, r.b], [pos(0, 0), pos(0, 5)]);
  r = s.find({ pos: r.b, query: 'apple' });
  assert.deepEqual([r.a, r.b], [pos(1, 0), pos(1, 5)]);
  r = s.find({ pos: r.b, query: 'apple' });
  assert.deepEqual(r.a, pos(1, 6));
  r = s.find({ pos: r.b, query: 'apple' });
  assert.deepEqual(r.a, pos(0, 0)); assert.equal(r.wrapped, true, '한 바퀴');
  assert.deepEqual(s.find({ pos: pos(0, 0), query: 'apple', caseSensitive: true }).a, pos(1, 0));
  r = s.find({ pos: pos(1, 6), query: 'apple', dir: -1 });
  assert.deepEqual(r.a, pos(1, 0));
  assert.equal(s.find({ pos: pos(0, 0), query: '없는글' }).a, null);
  assert.equal(s.find({ pos: pos(0, 0), query: '' }).a, null);
});

test('바꾸기: 첫 글자의 서식을 이어받고, 되돌리기 한 번, 화면·저장본이 같다', async () => {
  const s = await open(`<w:p><w:r><w:t>앞 </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>굵은말</w:t></w:r><w:r><w:t> 뒤</w:t></w:r></w:p>`);
  const base = JSON.stringify(sig(mirrorSpans(s, 0)));
  const f = s.find({ pos: pos(0, 0), query: '굵은말' });
  const r = await s.replace({ a: f.a, b: f.b, text: '진한 글' });
  assert.equal(s.model.text(0), '앞 진한 글 뒤'); assert.deepEqual(r.pos, pos(0, 6));
  assert.deepEqual(mirrorSpans(s, 0).map((c) => [c.text, !!c.bold]), [['앞 ', false], ['진한 글', true], [' 뒤', false]]);
  assert.deepEqual(sig(spans(irOf(await s.save()), 0)), sig(mirrorSpans(s, 0)));
  assert.equal(s.model.undoStack.length, 1);
  assert.equal(s.stats.reconcile, 0, '단일 바꾸기는 거울로 처리');
  await s.undo();
  assert.equal(s.model.text(0), '앞 굵은말 뒤'); assert.equal(JSON.stringify(sig(mirrorSpans(s, 0))), base);
  // 빈 글로 바꾸기(지우기)와 한 글자 바꾸기
  const g = await open(p('가나다라'));
  await g.replace({ a: pos(0, 1), b: pos(0, 3), text: '' });
  assert.equal(g.model.text(0), '가라');
  await g.replace({ a: pos(0, 0), b: pos(0, 1), text: 'XYZ' });
  assert.equal(g.model.text(0), 'XYZ라');
});

test('모두 바꾸기: 편집할 수 있는 문단만 바꾸고 못 바꾼 개수를 알리며, 되돌리기 한 번', async () => {
  const s = await open(p('고양이 고양이') + `<w:p>${run('고양이 ')}${fieldSimple('PAGE', '7')}</w:p>` + p('고양이') + table([['고양이', '개']]));
  const r = await s.replaceAll({ query: '고양이', text: '강아지' });
  assert.equal(r.count, 4); assert.equal(r.skipped >= 1, true, `잠긴 문단 일치 ${r.skipped}`);
  const texts = Array.from({ length: s.model.paragraphCount }, (_, i) => s.model.text(i));
  assert.equal(texts[0], '강아지 강아지'); assert.equal(texts.filter((t) => t.includes('강아지')).length, 3, '바뀐 문단 3개(일치 4개)');
  const re = irOf(await s.save());
  assert.ok(flattenIr(re).filter((b) => b.text).some((b) => b.text === '강아지 강아지'));
  await s.undo();
  assert.equal(s.model.text(0), '고양이 고양이'); assert.ok(Array.from({ length: s.model.paragraphCount }, (_, i) => s.model.text(i)).every((t) => !t.includes('강아지')));
  await s.redo();
  assert.equal(s.model.text(0), '강아지 강아지');
  assert.equal((await s.replaceAll({ query: 'zzz', text: 'x' })).count, 0);
});

test('편집 계층 op: fmt·parafmt(편집기 속성 이름)·props·find·replace·replaceall', async () => {
  const bytes = new Uint8Array(makeDocx(p('굵게 시험 문장') + p('찾을 글 찾을 글')));
  const ctx = await openEdit({ bytes, full: irOf(bytes), measure, layoutDocument, readIr: async (b) => irOf(b) });
  const send = (op, m = {}) => runOp(ctx, { op, ...m });
  const f = await send('fmt', { a: pos(0, 0), b: pos(0, 2), props: { bold: true, fontSize: 1600, textColor: '#112233', fontName: 'Arial', shadeColor: '#ffffff' } });
  assert.equal(f.dirty, true); assert.equal(f.canUndo, true);
  const c = mirrorSpans(ctx.session, 0)[0];
  assert.equal(c.bold, true); assert.equal(c.font_size_half_pt, 32); assert.deepEqual(c.color, [17, 34, 51]); assert.equal(c.font_name, 'Arial'); assert.equal(c.highlight, undefined, '흰색 형광펜 = 지우기');
  const pr = await send('props', { pos: pos(0, 1) });
  assert.equal(pr.char.bold, true); assert.equal(pr.char.fontSize, 1600); assert.equal(pr.char.fontFamily, 'Arial');
  await send('parafmt', { a: pos(1, 0), b: pos(1, 0), props: { alignment: 'center', lineSpacing: 150, lineSpacingType: 'Percent', marginLeft: 3000 } });
  const n = ctx.session.nodes.get(ctx.session.model.paras[1].id).node;
  assert.equal(n.alignment, 'center'); assert.deepEqual(n.line_spacing, { auto: 360 }); assert.equal(n.indent_left_twips, 600, '3000 HWPUNIT = 600 twips');
  const found = await send('find', { from: pos(1, 0), query: '찾을', caseSensitive: false, forward: true });
  assert.deepEqual([found.found, found.a, found.b, found.total], [true, pos(1, 0), pos(1, 2), 2]);
  assert.equal((await send('find', { from: pos(1, 0), query: '없는말', forward: true })).found, false);
  const rep = await send('repl', { a: found.a, b: found.b, text: '바뀐' });
  assert.equal(ctx.session.model.text(1), '바뀐 글 찾을 글');
  assert.ok(rep.dirty && rep.pos);
  const all = await send('replall', { query: '글', text: '문장', pos: pos(1, 0) });
  assert.equal(all.count, 2); assert.equal(all.skipped, 0);
  const locked = await send('fmt', { a: pos(0, 0), b: pos(0, 1), props: { bold: false } });
  assert.equal(locked.skipped, undefined);
  const out = await send('save');
  assert.equal(out.verify.ok, true);
});
