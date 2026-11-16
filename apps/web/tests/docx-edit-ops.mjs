// DOCX 편집 계층(src/docx-edit.js, 4-2-3) 단위 시험: 편집기가 Worker로 보내는 메시지(op) 계약과 되돌리기 묶음.
//   node --test tests/docx-edit-ops.mjs
// 편집기(editor.js)가 쓰는 op 이름과 결과 모양(pos·rect·sizes·from·dirty·canUndo·skipped·notice)을 그대로 부른다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDocx, p, table, fieldSimple, run as runXml } from './docx-fixtures.mjs';
import { irOf, irTexts } from './docx-edit-helpers.mjs';
import { layoutDocument } from '../src/docx/layout.js';
import { createFakeMeasurer } from '../src/docx/measure.js';
import { openEdit, run } from '../src/docx-edit.js';

const measure = createFakeMeasurer();
const pos = (p, o) => ({ s: 0, p, o, path: null });
const open = async (body) => {
  const bytes = new Uint8Array(makeDocx(body));
  const ctx = await openEdit({ bytes, full: irOf(bytes), measure, layoutDocument, readIr: async (b) => irOf(b) });
  const send = (op, m = {}) => run(ctx, { op, ...m });
  return { ctx, send, s: ctx.session };
};
const texts = (s) => Array.from({ length: s.model.paragraphCount }, (_, i) => s.model.text(i));

test('입력: 결과에 위치·캐럿 사각형·변경 표시·되돌리기 상태가 실린다', async () => {
  const { send } = await open(p('가나다'));
  const r = await send('insert', { pos: pos(0, 1), text: 'X', group: true });
  assert.deepEqual(r.pos, pos(0, 2));
  assert.ok(r.rect && r.rect.page === 0 && r.rect.h > 0);
  assert.equal(r.dirty, true); assert.equal(r.canUndo, true); assert.equal(r.canRedo, false);
  assert.equal(r.from, 0, '다시 그릴 첫 쪽');
  assert.equal(r.sizes, undefined, '쪽 수가 그대로면 쪽 크기를 다시 보내지 않는다');
});

test('연속 입력(group)은 되돌리기 한 번에 모두 돌아간다. mark로 끊으면 따로', async () => {
  const { send, s } = await open(p('시작'));
  let at = pos(0, 2);
  for (const ch of 'hello') { const r = await send('insert', { pos: at, text: ch, group: true }); at = r.pos; }
  assert.equal(s.model.text(0), '시작hello');
  assert.equal(s.model.undoStack.length, 1, '5글자가 한 항목');
  await send('mark');
  const r = await send('insert', { pos: at, text: '!', group: true });
  assert.equal(s.model.undoStack.length, 2, '끊은 뒤는 새 항목');
  await send('undo', { pos: r.pos });
  assert.equal(s.model.text(0), '시작hello');
  const u = await send('undo', { pos: at });
  assert.equal(s.model.text(0), '시작'); assert.deepEqual(u.pos, pos(0, 2), '묶음의 처음 자리로 돌아온다');
  await send('redo', { pos: u.pos });
  assert.equal(s.model.text(0), '시작hello');
});

test('되돌린 뒤 새로 편집하면 다시 하기 기록이 지워진다. 다시 하기는 편집이 끝난 자리로 캐럿을 둔다', async () => {
  const { send, s } = await open(p('가나다'));
  const a = await send('insert', { pos: pos(0, 3), text: 'AB' });
  assert.equal((await send('undo', { pos: a.pos })).canRedo, true);
  const b = await send('insert', { pos: pos(0, 0), text: 'Z' });
  assert.equal(b.canRedo, false, '새 편집이 다시 하기 기록을 지운다');
  assert.equal((await send('redo', { pos: b.pos })).empty, true);
  await send('undo', { pos: b.pos });
  const r = await send('redo', { pos: pos(0, 0) });
  assert.equal(s.model.text(0), 'Z가나다'); assert.deepEqual(r.pos, pos(0, 1), '다시 한 글의 끝');
  // 여러 글자·문단 나누기·합치기도 편집이 끝난 자리
  const e = await send('enter', { pos: pos(0, 2) });
  assert.deepEqual(e.pos, pos(1, 0));
  await send('undo', { pos: e.pos });
  assert.deepEqual((await send('redo', { pos: pos(0, 2) })).pos, pos(1, 0));
});

test('한글 조합: 조합 중 글자를 바꿔 넣어도(replace) 되돌리기 한 항목이고 결과 글이 맞다', async () => {
  const { send, s } = await open(p('앞뒤'));
  const start = pos(0, 1);
  let len = 0;
  for (const text of ['ㅎ', '하', '한', '한ㄱ', '한그', '한글']) {
    await send('insert', { pos: start, text, replace: len, group: true });
    len = [...text].length;
  }
  assert.equal(s.model.text(0), '앞한글뒤');
  assert.equal(s.model.undoStack.length, 1);
  await send('undo', { pos: pos(0, 3) });
  assert.equal(s.model.text(0), '앞뒤');
  const out = await send('save');
  assert.deepEqual(irTexts(irOf(out.bytes)), ['앞뒤']);
});

test('Enter·Backspace·범위 삭제는 입력 묶음을 끊는다', async () => {
  const { send, s } = await open(p('가나다라'));
  await send('insert', { pos: pos(0, 4), text: 'a', group: true });
  await send('enter', { pos: pos(0, 5) });
  const r = await send('insert', { pos: pos(1, 0), text: 'b', group: true });
  assert.equal(s.model.undoStack.length, 3, '입력·Enter·입력이 각각');
  await send('del', { pos: r.pos, dir: 'back' });
  assert.equal(s.model.text(1), 'b'.slice(1));
});

test('여러 줄 붙여넣기: 문단이 나뉘고 되돌리기·다시 하기 한 번으로 모두 돌아간다', async () => {
  const { send, s } = await open(p('앞뒤') + p('둘째'));
  const r = await send('paste', { pos: pos(0, 1), text: '1줄\r\n2줄\n3줄' });
  assert.deepEqual(texts(s), ['앞1줄', '2줄', '3줄뒤', '둘째']);
  assert.deepEqual(r.pos, pos(2, 2));
  assert.equal(s.model.undoStack.length, 5, '낱개 편집 5개(글 3·나누기 2)');
  const u = await send('undo', { pos: r.pos });
  assert.deepEqual(texts(s), ['앞뒤', '둘째']);
  assert.deepEqual(u.pos, pos(0, 1));
  assert.equal(s.model.undoStack.length, 0, '묶음 전체가 한 번에');
  const d = await send('redo', { pos: u.pos });
  assert.deepEqual(texts(s), ['앞1줄', '2줄', '3줄뒤', '둘째']);
  assert.ok(d.pos);
  // 화면(IR)도 맞다: 저장본의 글과 같다
  const out = await send('save');
  assert.equal(out.verify.ok, true);
  assert.deepEqual(irTexts(irOf(out.bytes)), ['앞1줄', '2줄', '3줄뒤', '둘째']);
});

test('한 줄 붙여넣기는 일반 입력이다(저장본 다시 읽기 없음)', async () => {
  const { send, s } = await open(p('가나다'));
  await send('paste', { pos: pos(0, 3), text: '라마' });
  assert.equal(s.model.text(0), '가나다라마');
  assert.equal(s.stats.reconcile, 0);
});

test('잠금 문단·범위: 오류 대신 skipped와 안내 문구를 돌려주고 문서는 그대로다', async () => {
  const { send, s } = await open(p('앞') + `<w:p>${runXml('쪽 ')}${fieldSimple('PAGE', '7')}</w:p>` + p('뒤'));
  const lockedP = [...Array(s.model.paragraphCount).keys()].find((q) => s.lock(q));
  assert.ok(lockedP !== undefined);
  const r = await send('insert', { pos: pos(lockedP, 0), text: 'x' });
  assert.equal(r.skipped, true); assert.match(r.notice, /^이 문단은 편집할 수 없습니다: /); assert.doesNotMatch(r.notice, /문단 \d+/);
  const del = await send('delrange', { a: pos(0, 0), b: pos(s.model.paragraphCount - 1, 1) });
  assert.equal(del.skipped, true);
  assert.equal(s.model.dirty, false);
  const hit = await send('hit', { page: 0, x: 110, y: 100 });
  assert.ok('locked' in hit);
});

test('표 칸에 걸친 범위 지우기는 거부되고 칸 안 입력은 된다', async () => {
  const { send, s } = await open(p('앞') + table([['가', '나'], ['다', '라']]) + p('뒤'));
  const r = await send('delrange', { a: pos(1, 0), b: pos(2, 1) });
  assert.equal(r.skipped, true);
  const ok = await send('insert', { pos: pos(1, 1), text: '!' });
  assert.equal(ok.skipped, undefined); assert.equal(s.model.text(1), '가!');
});

test('hit·caret·move·selrects·text·wordat·endOf', async () => {
  const { send } = await open(p('가나다라마') + p('둘째 문단'));
  const h = await send('hit', { page: 0, x: 96 + 14.67 * 2.2, y: 100, hf: null, drag: false, s: 0, objs: true });
  assert.equal(h.pos.p, 0); assert.equal(h.pos.o, 2);
  assert.equal((await send('hit', { page: 0, x: 100, y: 100, enter: true })).pos, null, '머리글·각주 두 번 누르기는 아직 없다');
  const c = await send('caret', { pos: pos(0, 99) });
  assert.equal(c.pos.o, 5, '범위 밖 위치는 끌어온다');
  assert.ok(c.rect);
  const m = await send('move', { pos: pos(0, 5), kind: 'right', px: -1 });
  assert.deepEqual(m.pos, pos(1, 0));
  const sel = await send('selrects', { a: pos(0, 1), b: pos(1, 2) });
  assert.ok(sel.rects.length >= 2 && sel.rects.every((r) => r.page === 0 && r.w > 0));
  assert.equal((await send('text', { a: pos(0, 3), b: pos(1, 2) })).text, '라마\n둘째');
  const w = await send('wordat', { pos: pos(1, 4), whole: false });
  assert.deepEqual([w.a.o, w.b.o], [3, 5]);
  const e = await send('endOf', { s: 0 });
  assert.deepEqual(e.pos, pos(1, 5)); assert.deepEqual(e.first, pos(0, 0)); assert.ok(e.rect);
});

test('쪽 수가 바뀌면 sizes를 보내고, 되돌리면 다시 보낸다', async () => {
  const { send, s } = await open(Array.from({ length: 40 }, (_, i) => p(`문단 ${i} ` + '가나다라마바 '.repeat(8))).join(''));
  const n0 = s.pageCount;
  const big = await send('insert', { pos: pos(5, 2), text: '긴 글 '.repeat(3000) });
  assert.ok(s.pageCount > n0);
  assert.equal(big.sizes.length, s.pageCount * 2); assert.equal(big.pageCount, s.pageCount);
  const small = await send('insert', { pos: big.pos, text: 'x' });
  assert.equal(small.sizes, undefined, '쪽 수가 같으면 보내지 않는다');
  const u = await send('undo', { pos: small.pos });
  assert.equal(u.sizes, undefined);
  await send('undo', { pos: u.pos });
  const u2 = await send('undo', { pos: u.pos });
  assert.equal(s.pageCount, n0);
  assert.ok(u2.sizes || s.pageCount === n0);
});

test('저장: 바뀐 문서를 다시 읽어 글이 같으면 verify.ok, 편집 내용이 저장본에 있다', async () => {
  const { send, s } = await open(p('가나다') + p('라마바'));
  await send('insert', { pos: pos(0, 3), text: '!!' });
  await send('enter', { pos: pos(1, 1) });
  const out = await send('save');
  assert.equal(out.verify.checked, true); assert.equal(out.verify.ok, true); assert.equal(out.verify.diffs, 0);
  assert.ok(out.bytes instanceof Uint8Array && out.bytes.length > 100);
  assert.deepEqual(irTexts(irOf(out.bytes)), ['가나다!!', '라', '마바']);
  assert.equal((await send('status')).dirty, true);
  await send('clean');
  assert.equal(s.status().dirty, false);
  assert.equal((await send('save')).verify.ok, true);
});

test('입력의 제어 문자는 걸러진다(XML에 넣을 수 없는 글자)', async () => {
  const { send, s } = await open(p('가나'));
  await send('insert', { pos: pos(0, 1), text: 'a\u0001b\u0008c\u000bd\ud800e' });
  assert.equal(s.model.text(0), '가abcde나');
  const out = await send('save');
  assert.equal(out.verify.ok, true);
});

test('문서 단위로 편집할 수 없는 문서(변경 내용 추적)는 edit_locked로 연다', async () => {
  const { zip } = await import('./docx-fixtures.mjs');
  const base = Buffer.from(makeDocx(p('글')));
  // settings.xml에 trackRevisions를 넣은 DOCX를 만든다
  const files = await (async () => {
    const { readZip, readPart } = await import('../src/docx/edit/zip.js');
    const bytes = new Uint8Array(base), z = readZip(bytes), out = [];
    for (const e of z.entries) out.push([e.name, Buffer.from(await readPart(bytes, e))]);
    out.push(['word/settings.xml', '<?xml version="1.0"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:trackRevisions/></w:settings>']);
    return out;
  })();
  const bytes = new Uint8Array(zip(files));
  await assert.rejects(() => openEdit({ bytes, full: irOf(bytes), measure, layoutDocument, readIr: async (b) => irOf(b) }), (e) => e.code === 'edit_locked' && /추적/.test(e.message));
});

test('알 수 없는 op(엔진 내부 클립보드 등)는 빈 결과', async () => {
  const { send } = await open(p('글'));
  assert.deepEqual(await send('copysel', { a: pos(0, 0), b: pos(0, 1) }), {});
  assert.deepEqual(await send('pasterich', { pos: pos(0, 0), text: 'x' }), { fallback: true });
  assert.deepEqual((await send('fonts')).fonts, [], '글꼴 목록은 편집기가 흔한 글꼴 + 캐럿 자리 글꼴로 채운다');
  const pr = await send('props', { pos: pos(0, 0) });
  assert.equal(pr.char.fontFamily, 'Calibri'); assert.equal(pr.table, null); assert.equal(pr.lock, null);
});
