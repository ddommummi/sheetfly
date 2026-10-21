// DOCX 편집 세션 단위 시험(4-2-2): 캐럿·히트 테스트·이동·선택·낱말, 빈 문단(캐럿), 표 칸, 되돌리기가 조판을 되돌림, 쪽 넘침, 목록 나누기(조정), 잠금.
//   node --test tests/docx-session.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDocx, p, table, fieldSimple, run } from './docx-fixtures.mjs';
import { irOf, irTexts } from './docx-edit-helpers.mjs';
import { DocxEditSession } from '../src/docx/edit/session.js';
import { EditError } from '../src/docx/edit/model.js';
import { wordStep, wordRange } from '../src/docx/edit/geom.js';
import { createFakeMeasurer } from '../src/docx/measure.js';

const measure = createFakeMeasurer();
const HAN = 11 * 96 / 72;        // 11pt 한글 한 글자 폭(가짜 측정기: 전각 1em)
const LAT = HAN / 2;              // 영문·공백 폭
const X0 = 96, TOP = 96;          // 쪽 여백(1440 twips)
const open = (body) => { const bytes = new Uint8Array(makeDocx(body)); return DocxEditSession.open(bytes, irOf(bytes), measure, { readIr: async (b) => irOf(b) }); };
const pos = (p, o, aff) => ({ s: 0, p, o, path: null, ...(aff ? { aff } : {}) });
const near = (a, b, msg, eps = 0.05) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≈ ${b}`);
const canon = (pages) => JSON.stringify(pages.map((pg) => ({ w: pg.width, h: pg.height, no: pg.no, items: pg.items })));

test('캐럿 x는 글자 폭만큼 늘고, 히트 테스트는 가까운 글자 경계를 고른다', async () => {
  const s = await open(p('가나다라마'));
  for (let o = 0; o <= 5; o++) { const r = s.caret({ pos: pos(0, o) }).rect; near(r.x, X0 + HAN * o, `o=${o} x`); near(r.y, TOP, `o=${o} y`); assert.equal(r.page, 0); }
  const hit = (k) => s.hit({ page: 0, x: X0 + HAN * k, y: TOP + 5 }).pos.o;
  assert.equal(hit(1.3), 1); assert.equal(hit(1.7), 2); assert.equal(hit(0), 0); assert.equal(hit(4.9), 5);
  assert.equal(s.hit({ page: 0, x: 5, y: TOP + 5 }).pos.o, 0, '줄 왼쪽 밖');
  assert.equal(s.hit({ page: 0, x: 700, y: TOP + 5 }).pos.o, 5, '줄 오른쪽 밖');
  assert.equal(s.hit({ page: 0, x: 200, y: 900 }).pos.p, 0, '문단 아래 빈 곳도 가장 가까운 줄');
});

test('영문·공백이 섞인 글: 낱말 안 위치와 공백 위치', async () => {
  const s = await open(p('Hello World'));
  near(s.caret({ pos: pos(0, 5) }).rect.x, X0 + LAT * 5, '공백 앞');
  near(s.caret({ pos: pos(0, 6) }).rect.x, X0 + LAT * 6, '공백 뒤');
  near(s.caret({ pos: pos(0, 11) }).rect.x, X0 + LAT * 11, '끝');
  assert.equal(s.hit({ page: 0, x: X0 + LAT * 8.2, y: TOP + 3 }).pos.o, 8);
  assert.equal(s.hit({ page: 0, x: X0 + LAT * 5.4, y: TOP + 3 }).pos.o, 5);
  assert.equal(s.hit({ page: 0, x: X0 + LAT * 5.6, y: TOP + 3 }).pos.o, 6);
});

test('줄바꿈: 줄 끝/다음 줄 처음 두 곳의 위치 번호를 aff로 가린다, Home·End·위·아래', async () => {
  const s = await open(p('가'.repeat(60)));   // 한 줄 41자 안팎
  const r0 = s.caret({ pos: pos(0, 0) }).rect;
  const first = [...Array(60).keys()].find((o) => s.caret({ pos: pos(0, o) }).rect.y > r0.y + 1);
  assert.ok(first > 30 && first < 50, `둘째 줄이 시작하는 위치 ${first}`);
  const endOfFirst = s.caret({ pos: pos(0, first, 1) }).rect, startOfSecond = s.caret({ pos: pos(0, first) }).rect;
  near(endOfFirst.y, r0.y, '앞 줄 끝 y'); assert.ok(endOfFirst.x > X0 + HAN * (first - 1)); near(startOfSecond.x, X0, '다음 줄 처음 x'); assert.ok(startOfSecond.y > r0.y + 5);
  // 첫 줄 오른쪽 밖을 누르면 앞 줄 끝(aff 1)
  const h = s.hit({ page: 0, x: 780, y: r0.y + 3 }).pos;
  assert.equal(h.o, first); assert.equal(h.aff, 1);
  // End/Home
  const end = s.move({ pos: pos(0, 3), kind: 'end' }).pos; assert.equal(end.o, first); assert.equal(end.aff, 1);
  assert.equal(s.move({ pos: pos(0, first + 4), kind: 'home' }).pos.o, first);
  // 위·아래: 같은 x를 유지
  const px = s.caret({ pos: pos(0, 5) }).rect.x;
  const d = s.move({ pos: pos(0, 5), kind: 'down', px: -1 });
  assert.equal(d.pos.o, first + 5); near(d.px, px, '유지할 x');
  assert.equal(s.move({ pos: d.pos, kind: 'up', px: d.px }).pos.o, 5);
  assert.equal(s.move({ pos: pos(0, 5), kind: 'up' }).pos.o, 5, '맨 위에서 위로는 그대로');
});

test('가운데·오른쪽 정렬, 탭, 줄바꿈 글자', async () => {
  const c = await open(p('가나', { align: 'center' }));
  near(c.caret({ pos: pos(0, 0) }).rect.x, X0 + (601.7 - 2 * HAN) / 2, '가운데', 0.2);
  const r = await open(p('가나', { align: 'right' }));
  near(r.caret({ pos: pos(0, 2) }).rect.x, X0 + 601.7, '오른쪽 끝', 0.2);
  const s = await open('<w:p><w:r><w:t>가</w:t><w:tab/><w:t>나</w:t><w:br/><w:t>다</w:t></w:r></w:p>');
  assert.equal(s.model.text(0), '가\t나\n다');
  near(s.caret({ pos: pos(0, 1) }).rect.x, X0 + HAN, '탭 앞');
  near(s.caret({ pos: pos(0, 2) }).rect.x, X0 + 48, '탭 뒤(기본 탭 정지 48px)');
  near(s.caret({ pos: pos(0, 3) }).rect.x, X0 + 48 + HAN, '줄바꿈 앞');
  const l2 = s.caret({ pos: pos(0, 4) }).rect; near(l2.x, X0, '줄바꿈 뒤는 다음 줄 처음'); assert.ok(l2.y > TOP + 5);
  assert.equal(s.hit({ page: 0, x: X0 + 30, y: TOP + 3 }).pos.o, 1, '탭 왼쪽 절반');
  assert.equal(s.hit({ page: 0, x: X0 + 40, y: TOP + 3 }).pos.o, 2, '탭 오른쪽 절반');
});

test('빈 문단에도 캐럿이 놓이고 글을 넣으면 저장본에 문단으로 남는다', async () => {
  const s = await open(p('위') + '<w:p/>' + p('아래'));
  assert.equal(s.model.paragraphCount, 3);
  assert.ok(s.navigable(1), '빈 문단(편집 중 IR에 빈 문단으로 둠)에 줄이 있다');
  const above = s.caret({ pos: pos(0, 0) }).rect, blank = s.caret({ pos: pos(1, 0) }).rect, below = s.caret({ pos: pos(2, 0) }).rect;
  assert.ok(blank.y > above.y + 5 && blank.y < below.y - 5, '빈 문단은 위·아래 문단 사이 줄에 있다');
  const h = s.hit({ page: 0, x: 200, y: blank.y + blank.h / 2 }).pos;
  assert.equal(h.p, 1); assert.equal(h.o, 0);
  const r = await s.insert({ pos: pos(1, 0), text: '새글' });
  assert.deepEqual([r.pos.p, r.pos.o], [1, 2]);
  assert.equal(s.model.text(1), '새글');
  near(s.caret({ pos: pos(1, 2) }).rect.x, X0 + 2 * HAN, '넣은 글 뒤');
  const out = await s.save();
  assert.deepEqual(irTexts(irOf(out)), ['위', '새글', '아래']);
});

test('표 칸 안 문단: 눌러서 캐럿을 놓고 글을 넣는다', async () => {
  const s = await open(p('앞') + table([['셀1', '셀2'], ['셀3', '셀4']]) + p('뒤'));
  const texts = [...Array(s.model.paragraphCount).keys()].map((q) => s.model.text(q));
  assert.deepEqual(texts, ['앞', '셀1', '셀2', '셀3', '셀4', '뒤']);
  const c2 = s.caret({ pos: pos(2, 0) }).rect, c4 = s.caret({ pos: pos(4, 0) }).rect;
  assert.ok(c2.x > s.caret({ pos: pos(1, 0) }).rect.x + 50, '둘째 칸은 오른쪽');
  assert.ok(c4.y > c2.y + 5, '둘째 줄 칸은 아래');
  for (const [q, want] of [[1, '셀1'], [2, '셀2'], [3, '셀3'], [4, '셀4']]) {
    const c = s.caret({ pos: pos(q, 1) }).rect;
    const h = s.hit({ page: 0, x: c.x + 0.3, y: c.y + c.h / 2 }).pos;
    assert.equal(s.model.text(h.p), want); assert.equal(h.o, 1);
  }
  await s.insert({ pos: pos(2, 2), text: '!' });
  const out = await s.save();
  assert.deepEqual(irTexts(irOf(out)), ['앞', '셀1', '셀2!', '셀3', '셀4', '뒤']);
  // 표 앞뒤 문단 사이 이동
  assert.deepEqual(s.move({ pos: pos(1, 0), kind: 'left' }).pos, pos(0, 1));
});

test('낱말 단위 이동·선택', () => {
  const t = 'hello world 가나다 test';
  assert.equal(wordStep(t, 0, 1), 6); assert.equal(wordStep(t, 6, 1), 12); assert.equal(wordStep(t, 12, 1), 16); assert.equal(wordStep(t, 16, 1), 20); assert.equal(wordStep(t, 20, 1), 20);
  assert.equal(wordStep(t, 12, -1), 6); assert.equal(wordStep(t, 6, -1), 0); assert.equal(wordStep(t, 8, -1), 6);
  assert.deepEqual(wordRange(t, 2), [0, 5]); assert.deepEqual(wordRange(t, 5), [5, 6]); assert.deepEqual(wordRange(t, 13), [12, 15]); assert.deepEqual(wordRange(t, 20), [16, 20]);
  assert.deepEqual(wordRange('', 0), [0, 0]); assert.deepEqual(wordRange('a,b', 1), [1, 2]);
});

test('낱말·문단 선택(wordat), 위치 이동(문단 경계·문서 처음/끝), 선택 글', async () => {
  const s = await open(p('첫째 문단 글') + p('둘째') + p('셋째 끝'));
  assert.deepEqual(s.wordat({ pos: pos(0, 4) }), { a: pos(0, 3), b: pos(0, 5) }, '낱말');
  assert.deepEqual(s.wordat({ pos: pos(0, 1), whole: true }), { a: pos(0, 0), b: pos(0, 7) }, '문단 전체');
  assert.deepEqual(s.move({ pos: pos(1, 0), kind: 'left' }).pos, pos(0, 7));
  assert.deepEqual(s.move({ pos: pos(0, 7), kind: 'right' }).pos, pos(1, 0));
  assert.deepEqual(s.move({ pos: pos(1, 1), kind: 'docstart' }).pos, pos(0, 0));
  assert.deepEqual(s.move({ pos: pos(1, 1), kind: 'docend' }).pos, pos(2, 4));
  assert.deepEqual(s.move({ pos: pos(2, 0), kind: 'wordleft' }).pos, pos(1, 0), '문단 맨 앞에서 낱말 왼쪽은 앞 문단 낱말 처음');
  assert.equal(s.text({ a: pos(0, 4), b: pos(2, 2) }).text, '단 글\n둘째\n셋째');
  assert.equal(s.text({ a: pos(2, 2), b: pos(0, 4) }).text, '단 글\n둘째\n셋째', '거꾸로 줘도 같다');
});

test('선택 사각형: 한 줄·여러 줄·여러 문단', async () => {
  const s = await open(p('가'.repeat(60)) + p('짧은 글'));
  const one = s.selrects({ a: pos(1, 0), b: pos(1, 2) }).rects;
  assert.equal(one.length, 1); near(one[0].w, 2 * HAN, '폭', 0.1); near(one[0].x, X0, 'x');
  const first = [...Array(60).keys()].find((o) => s.caret({ pos: pos(0, o) }).rect.y > TOP + 1);
  const multi = s.selrects({ a: pos(0, 3), b: pos(0, first + 5) }).rects;
  assert.equal(multi.length, 2);
  near(multi[0].x, X0 + 3 * HAN, '첫 줄 시작'); near(multi[0].w, (first - 3) * HAN, '첫 줄 폭', 0.1); near(multi[1].x, X0, '둘째 줄 시작'); near(multi[1].w, 5 * HAN, '둘째 줄 폭', 0.1);
  const paras = s.selrects({ a: pos(0, 30), b: pos(1, 2) }).rects;
  assert.ok(paras.length >= 3, `문단 걸침 ${paras.length}`);
  assert.ok(paras.every((r) => r.w > 0 && r.h > 0));
  const full = s.selrects({ a: pos(0, 0), b: pos(1, 0) }).rects;   // 둘째 문단 맨 앞까지: 첫 문단 끝의 줄바꿈 표시가 마지막 사각형에 포함된다
  assert.equal(full.at(-1).w > 5, true);
});

test('되돌리기·다시 하기가 조판(쪽 항목)도 그대로 되돌린다', async () => {
  const s = await open(p('가나다 라마바') + p('둘째 문단') + p('셋째 문단'));
  const base = canon(s.pages);
  await s.insert({ pos: pos(0, 3), text: '가나다라마바사아자차카타파하'.repeat(5) });
  assert.notEqual(canon(s.pages), base);
  await s.enter({ pos: pos(1, 2) });
  await s.delrange({ a: pos(0, 1), b: pos(2, 1) });
  while (s.status().canUndo) await s.undo();
  assert.equal(canon(s.pages), base, '모두 되돌리면 처음 조판과 같다');
  assert.equal(s.stats.reconcile, 0, '일반 문단 편집은 거울로 처리(저장본 다시 읽기 없음)');
  while (s.status().canRedo) await s.redo();
  assert.equal(s.model.paragraphCount, 3 + 1 - 2 + 0 === 2 ? 2 : s.model.paragraphCount);
});

test('글을 많이 넣으면 쪽이 늘고, 지우면 줄며, 바뀐 쪽 목록을 돌려준다', async () => {
  const s = await open(Array.from({ length: 50 }, (_, i) => p(`문단 ${i} ` + '가나다라마바사 '.repeat(6))).join(''));
  const n0 = s.pageCount;
  const r = await s.insert({ pos: pos(10, 3), text: '긴 글 '.repeat(2000) });
  assert.ok(s.pageCount > n0, `쪽 ${n0} → ${s.pageCount}`);
  assert.ok(r.view.changed.length >= 1 && r.view.changed.every((i) => i >= 0 && i < s.pageCount));
  assert.equal(r.view.pageCount, s.pageCount);
  assert.ok(r.rect.page >= 0 && r.rect.page < s.pageCount);
  assert.equal(s.stats.reconcile, 0);
  const del = await s.delrange({ a: pos(10, 3), b: pos(10, 3 + 8000) });
  assert.equal(s.pageCount, n0);
  assert.equal(del.view.pageCount, n0);
  assert.equal(s.sizes().length, n0 * 2);
});

test('목록 문단 Enter는 저장본을 다시 읽어 IR을 맞춘다(조정)', async () => {
  const li = (t) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run(t)}</w:p>`;
  const s = await open(p('앞') + li('항목 하나') + li('항목 둘') + p('뒤'));
  const before = s.model.paragraphCount;
  const r = await s.enter({ pos: pos(1, 2) });
  assert.equal(s.model.paragraphCount, before + 1);
  assert.deepEqual([s.model.text(1), s.model.text(2)], ['항목', ' 하나']);
  assert.equal(s.stats.reconcile, 1);
  assert.equal(r.view.reconciled, true);
  assert.ok(s.navigable(2) && s.caret({ pos: pos(2, 0) }).rect, '조정 뒤에도 캐럿이 놓인다');
  const out = await s.save();
  assert.deepEqual(irTexts(irOf(out)), ['앞', '항목', ' 하나', '항목 둘', '뒤']);
});

test('필드·잠금 문단: 눌러서 캐럿은 놓이지만 편집은 거부된다', async () => {
  const s = await open(p('앞') + `<w:p>${run('쪽 ')}${fieldSimple('PAGE', '7')}</w:p>` + p('뒤'));
  const lockedP = [...Array(s.model.paragraphCount).keys()].find((q) => s.lock(q));
  assert.ok(lockedP !== undefined);
  if (s.navigable(lockedP)) assert.ok(s.caret({ pos: pos(lockedP, 0) }).rect);
  await assert.rejects(() => s.insert({ pos: pos(lockedP, 0), text: 'x' }), (e) => e instanceof EditError && e.code === 'locked');
});

test('Backspace·Delete: 문단 경계에서는 합치고, 문서 처음·끝에서는 아무 일도 없다', async () => {
  const s = await open(p('가나') + p('다라'));
  let r = await s.del({ pos: pos(1, 0), dir: 'back' });
  assert.equal(s.model.paragraphCount, 1); assert.deepEqual([r.pos.p, r.pos.o], [0, 2]); assert.equal(s.model.text(0), '가나다라');
  r = await s.del({ pos: pos(0, 0), dir: 'back' }); assert.equal(r.view, null);
  r = await s.del({ pos: pos(0, 4), dir: 'fwd' }); assert.equal(r.view, null);
  r = await s.del({ pos: pos(0, 1), dir: 'fwd' }); assert.equal(s.model.text(0), '가다라');
  await s.undo(); assert.equal(s.model.text(0), '가나다라');
});
