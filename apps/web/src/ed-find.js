// 찾아 바꾸기 탭(HWP·DOCX 공통): 찾을 말·바꿀 말·이전/다음/바꾸기/모두 바꾸기. 편집 계층의 find·repl·replall 메시지를 쓴다.
const TM = {
  findTab: '찾기', findLabel: '찾을 말', replLabel: '바꿀 말', next: '다음', prev: '이전', repl: '바꾸기', replAll: '모두 바꾸기', cs: '대소문자 구분', noMatch: '찾지 못했습니다.', replaced: (n) => `${n}곳을 바꿨습니다.`,
  wrapped: '문서 처음(끝)으로 돌아가 찾았습니다.', found: (n) => `${n}곳 중에서 찾았습니다.`,
};

export function installFind(api) {
  const run = (fn) => api.enqueue(fn);
  const mk = (label, title, fn) => { const b = api.btn('', label, title ?? label, fn); b.setAttribute('aria-label', label); return b; };
  // ── 찾기 탭(찾아 바꾸기) ──
  const fp = api.panel('find');
  const row = document.createElement('div'); row.className = 'group'; fp.append(row);
  const inpFind = document.createElement('input'); inpFind.className = 'search-input'; inpFind.placeholder = TM.findLabel; inpFind.setAttribute('aria-label', TM.findLabel);
  const inpRepl = document.createElement('input'); inpRepl.className = 'search-input'; inpRepl.placeholder = TM.replLabel; inpRepl.setAttribute('aria-label', TM.replLabel);
  const cs = document.createElement('label'); cs.className = 'edit-cap'; const csBox = document.createElement('input'); csBox.type = 'checkbox'; cs.append(csBox, ` ${TM.cs}`);
  row.append(inpFind, inpRepl);
  const row2 = document.createElement('div'); row2.className = 'group'; fp.append(row2);
  row2.append(mk(TM.prev, null, () => run(() => findNext(false))), mk(TM.next, null, () => run(() => findNext(true))), mk(TM.repl, null, () => run(replaceOne)), mk(TM.replAll, null, () => run(replaceAll)), cs);
  for (const i of [inpFind, inpRepl]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(() => findNext(!e.shiftKey)); } });
  const matchSel = () => { const a = api.anchor, p = api.pos; if (!a || !p) return null; return [a, p]; };
  async function findNext(forward) {
    const q0 = inpFind.value; if (!q0) return;
    const sel = matchSel();
    const base = api.pos ?? { s: 0, p: 0, o: 0 };
    const from = sel ? (forward ? (cmpPos(sel[0], sel[1]) <= 0 ? sel[1] : sel[0]) : (cmpPos(sel[0], sel[1]) <= 0 ? sel[0] : sel[1])) : base;
    const r = await api.req('find', { query: q0, caseSensitive: csBox.checked, forward, from: { s: from.s, p: from.p, o: from.o } });
    if (!r.found) { api.status(TM.noMatch); return; }
    await api.selectRange(r.a, r.b);
    api.status(r.wrapped ? TM.wrapped : TM.found(r.total ?? 1));
  }
  const cmpPos = (a, b) => (a.p - b.p) || (a.o - b.o);
  async function replaceOne() {
    const sel = matchSel();
    const cur = sel ? await api.req('text', { a: sel[0], b: sel[1] }) : null;
    const same = cur && (csBox.checked ? cur.text === inpFind.value : cur.text.toLowerCase() === inpFind.value.toLowerCase());
    if (!same) { await findNext(true); return; }                // 선택이 일치가 아니면 먼저 찾는다
    const [a, b] = cmpPos(sel[0], sel[1]) <= 0 ? sel : [sel[1], sel[0]];
    const r = await api.req('repl', { a, b, text: inpRepl.value });
    api.setDirty(true); api.viewer.refresh(r.sizes, {});
    await api.placeCaret(r.pos);
    await findNext(true);
  }
  async function replaceAll() {
    if (!inpFind.value) return;
    const r = await api.req('replall', { query: inpFind.value, text: inpRepl.value, caseSensitive: csBox.checked });
    if (r.count) { api.setDirty(true); api.viewer.refresh(r.sizes, {}); await api.placeCaret(api.pos); }
    api.status(TM.replaced(r.count));
  }
  api.openFind = () => { api.showTab('find'); inpFind.focus(); inpFind.select(); };
}
