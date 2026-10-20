// 편집기 나머지 기능: 하이퍼링크·책갈피·누름틀(필드), 스타일·번호·글머리표, 찾아 바꾸기, 표 계산식, 차트 값.
const TM = {
  link: '하이퍼링크…', linkTitle: '선택한 글(또는 새로 쓴 글)에 인터넷 주소를 붙입니다. 링크 위에서는 고치거나 지웁니다', bookmark: '책갈피…', field: '누름틀…',
  uri: '주소', shown: '보일 글', shownHint: '선택한 글이 없을 때 이 글이 캐럿 자리에 들어가고 링크가 붙습니다.', removeLink: '링크 지우기(글은 그대로)', needSameParaLink: '링크는 한 문단 안의 글에만 붙일 수 있습니다.',
  linkFail: '이 문단에는 링크를 붙일 수 없습니다(개체·여러 문단 필드가 있는 문단).',
  action: '작업', bmActions: [['add', '캐럿 자리에 추가'], ['goto', '책갈피로 이동'], ['rename', '이름 바꾸기'], ['delete', '지우기']], bmName: '이름', bmPick: '책갈피 고르기', noBm: '(책갈피 없음)',
  fActions: [['new', '누름틀 만들기'], ['fill', '값 넣기'], ['remove', '캐럿의 누름틀 지우기']], guide: '안내문', memo: '메모', fname: '이름', fpick: '누름틀 고르기', fvalue: '값', noField: '(누름틀 없음)',
  style: '스타일', styleBtn: '스타일…', styleActions: [['new', '새 스타일'], ['rename', '이름 바꾸기'], ['shape', '현재 모양으로 스타일 갱신'], ['delete', '지우기']], styleName: '스타일 이름', stylePick: '대상 스타일',
  list: '번호·글머리', lists: [['', '목록 모양'], ['none', '없음'], ['num', '1. 2. 3.'], ['n8', '가. 나. 다.'], ['n1', '① ② ③'], ['n2', 'I. II. III.'], ['n4', 'A. B. C.'], ['n10', 'ㄱ. ㄴ. ㄷ.'], ['n12', '일. 이. 삼.'], ['b●', '● 글머리'], ['b■', '■ 글머리'], ['b◆', '◆ 글머리'], ['b○', '○ 글머리'], ['b▶', '▶ 글머리'], ['b-', '- 글머리']],
  lvUp: '수준 올리기', lvDown: '수준 내리기',
  findTab: '찾기', findLabel: '찾을 말', replLabel: '바꿀 말', next: '다음', prev: '이전', repl: '바꾸기', replAll: '모두 바꾸기', cs: '대소문자 구분', noMatch: '찾지 못했습니다.', replaced: (n) => `${n}곳을 바꿨습니다.`,
  wrapped: '문서 처음(끝)으로 돌아가 찾았습니다.', found: (n) => `${n}곳 중에서 찾았습니다.`,
  formula: '계산식…', formulaLabel: '계산식', formulaHint: '예) =SUM(A1:A4), =A1+B2*3 (칸 이름은 열 A·B…, 줄 1·2…)', formulaFail: '계산식을 계산하지 못했습니다.',
  chart: '차트 값…', noChart: '차트를 클릭해 고른 뒤 누르세요.', chartHint: '값만 고칩니다. 줄마다 "계열 이름: 값, 값, …" — 개수는 그대로여야 합니다.', chartFail: '차트 값을 바꾸지 못했습니다(개수가 달라졌거나 숫자가 아닙니다).',
  outline: '개요…', outlineTitle: '번호가 매겨진 제목 목록에서 골라 이동합니다', outlinePick: '제목', noOutline: '번호가 매겨진 제목(개요)이 없습니다.',
  ok: '확인', del: '지우기', no: '취소',
};

export function installMisc(api) {
  const run = (fn) => api.enqueue(fn);
  const mk = (label, title, fn) => { const b = api.btn('', label, title ?? label, fn); b.setAttribute('aria-label', label); return b; };
  const numIds = new Map();
  const q = async (fn, args) => (await api.req('q', { fn, args })).result;
  const target = (pos) => ({ section: pos.s, para: pos.p, cellPath: (pos.path ?? []).map((x) => [x.controlIndex, x.cellIndex, x.cellParaIndex]) });

  // ── 입력 탭: 링크·책갈피·누름틀 ──
  const g = api.group('insert');
  g.append(mk(TM.link, TM.linkTitle, () => run(hyperlink)), mk(TM.bookmark, null, () => run(bookmarks)), mk(TM.field, null, () => run(fields)));

  async function hyperlink() {
    const pos = api.pos; if (!pos) return;
    const sel = api.hasSel && !api.cellBlock ? [api.anchor, pos] : null;
    // 캐럿이 링크 위인지
    let links = [];
    try { links = (await q('getHyperlinkContext', [JSON.stringify(target(pos))]))?.links ?? []; } catch { links = []; }
    const on = links.find((l) => l.start <= pos.o && pos.o <= l.end);
    if (on) {
      const v = await api.form(TM.link, [{ key: 'uri', label: TM.uri, type: 'text', value: on.uri }, { key: 'rm', label: TM.removeLink, type: 'checkbox', value: false }]);
      if (!v) return;
      if (v.rm) await api.mutateApi('removeHyperlinkEx', [JSON.stringify({ target: target(pos), fieldId: on.fieldId, restoreFormatting: true })]);
      else await api.mutateApi('updateHyperlinkEx', [JSON.stringify({ target: target(pos), fieldId: on.fieldId, uri: v.uri })]);
      return;
    }
    let a, b, text = '';
    if (sel) {
      const [x, y] = [sel[0], sel[1]];
      const same = x.s === y.s && x.p === y.p && JSON.stringify(x.path) === JSON.stringify(y.path);
      if (!same) { api.status(TM.needSameParaLink); return; }
      a = x.o <= y.o ? x : y; b = x.o <= y.o ? y : x;
    } else { a = pos; b = pos; }
    const fields = [{ key: 'uri', label: TM.uri, type: 'text', value: 'https://' }];
    if (!sel) fields.push({ key: 'text', label: TM.shown, type: 'text', value: '', hint: TM.shownHint });
    const v = await api.form(TM.link, fields);
    if (!v || !v.uri.trim()) return;
    if (!sel && !v.text) return;
    try {
      const r = await api.req('hlinsert', { a, b, uri: v.uri.trim(), text: sel ? '' : v.text });
      api.setDirty(true); api.viewer.refresh(r.sizes, {});
      await api.placeCaret(r.pos ?? pos);
    } catch { api.status(TM.linkFail); }
  }

  async function bookmarks() {
    const pos = api.pos; if (!pos) return;
    const list = (await q('getBookmarks', [])) ?? [];
    const opts = list.length ? list.map((b, i) => [String(i), b.name]) : [['', TM.noBm]];
    const v = await api.form(TM.bookmark, [
      { key: 'act', label: TM.action, type: 'select', value: 'add', options: TM.bmActions },
      { key: 'name', label: TM.bmName, type: 'text', value: '', hint: '추가·이름 바꾸기에 쓰는 이름' },
      { key: 'pick', label: TM.bmPick, type: 'select', value: '', options: opts },
    ]);
    if (!v) return;
    const b = list[Number(v.pick)];
    if (v.act === 'add') { if (v.name.trim()) await api.mutateApi('addBookmark', [pos.s, pos.p, pos.o, v.name.trim()]); }
    else if (!b) return;
    else if (v.act === 'goto') await api.placeCaret({ s: b.sec, p: b.para, o: b.charPos ?? 0, path: null });
    else if (v.act === 'rename') { if (v.name.trim()) await api.mutateApi('renameBookmark', [b.sec, b.para, b.ctrlIdx, v.name.trim()]); }
    else if (v.act === 'delete') await api.mutateApi('deleteBookmark', [b.sec, b.para, b.ctrlIdx]);
  }

  async function fields() {
    const pos = api.pos; if (!pos) return;
    const list = ((await q('getFieldList', [])) ?? []).filter((f) => f.fieldType === 'clickhere');
    const opts = list.length ? list.map((f, i) => [String(i), f.name || f.guide || `#${f.fieldId}`]) : [['', TM.noField]];
    const v = await api.form(TM.field, [
      { key: 'act', label: TM.action, type: 'select', value: 'new', options: TM.fActions },
      { key: 'guide', label: TM.guide, type: 'text', value: '여기에 입력하세요' }, { key: 'memo', label: TM.memo, type: 'text', value: '' }, { key: 'name', label: TM.fname, type: 'text', value: '' },
      { key: 'pick', label: TM.fpick, type: 'select', value: '', options: opts }, { key: 'value', label: TM.fvalue, type: 'text', value: '', hint: '"값 넣기"에 쓰는 값' },
    ]);
    if (!v) return;
    if (v.act === 'new') {
      if (pos.path) { api.status('표 안에서는 누름틀을 만들 수 없습니다.'); return; }
      await api.mutateApi('insertClickHereField', [pos.s, pos.p, pos.o, v.guide, v.memo, v.name, true]);
    } else if (v.act === 'fill') { const f = list[Number(v.pick)]; if (f) await api.mutateApi('setFieldValue', [f.fieldId, v.value]); }
    else if (v.act === 'remove') { if (!pos.path) await api.mutateApi('removeFieldAt', [pos.s, pos.p, pos.o]); }
  }

  // ── 서식 탭: 스타일·번호·글머리표 ──
  const fg = api.group('format');
  let styles = [];
  const styleSel = api.select('edit-style', TM.style, [], (id) => run(async () => {
    const r = api.anchor && api.pos ? [api.anchor, api.pos] : [api.pos, api.pos];
    const [a, b] = r[0].p <= r[1].p ? r : [r[1], r[0]];
    for (let p = a.p; p <= b.p; p++) {
      if (a.path) await api.mutateApi('applyCellStyle', [a.s, a.p, a.path[0].controlIndex, a.path[0].cellIndex, a.path[0].cellParaIndex, Number(id)], { pos: api.pos });
      else await api.mutateApi('applyStyle', [a.s, p, Number(id)], { pos: api.pos });
      if (a.path) break;
    }
  }));
  const loadStyles = async () => {
    try { styles = (await q('getStyleList', [])) ?? []; } catch { styles = []; }
    api.fillSelect(styleSel, styles.map((s) => [String(s.id), s.name]), styleSel.value);
  };
  loadStyles();
  fg.append(styleSel, mk(TM.styleBtn, null, () => run(styleManage)));
  api.onContext(async () => {
    const p = api.pos; if (!p || p.path) return;
    try { const st = await q('getStyleAt', [p.s, p.p]); if (st && styleSel.value !== String(st.id)) api.fillSelect(styleSel, styles.map((s) => [String(s.id), s.name]), String(st.id)); } catch { /* 표시만 */ }
  });
  async function styleManage() {
    await loadStyles();
    const v = await api.form(TM.styleBtn, [
      { key: 'act', label: TM.action, type: 'select', value: 'new', options: TM.styleActions },
      { key: 'name', label: TM.styleName, type: 'text', value: '' },
      { key: 'pick', label: TM.stylePick, type: 'select', value: '1', options: styles.map((s) => [String(s.id), s.name]) },
    ]);
    if (!v) return;
    if (v.act === 'new' && v.name.trim()) await api.mutateApi('createStyle', [JSON.stringify({ name: v.name.trim(), englishName: v.name.trim(), type: 0, nextStyleId: 0 })]);
    else if (v.act === 'rename' && v.name.trim()) await api.mutateApi('updateStyle', [Number(v.pick), JSON.stringify({ name: v.name.trim() })]);
    else if (v.act === 'shape' && api.pos) {
      const r = await api.req('stylefromcaret', { style: Number(v.pick), pos: api.pos });
      api.setDirty(true); api.viewer.refresh(r.sizes, {}); await api.placeCaret(api.pos);
    }
    else if (v.act === 'delete' && Number(v.pick) !== 0) await api.mutateApi('deleteStyle', [Number(v.pick)]);
    await loadStyles();
  }

  const listSel = api.select('edit-list', TM.list, TM.lists, (v) => { listSel.value = ''; run(() => setList(v)); });
  fg.append(listSel, mk(TM.lvUp, null, () => run(() => level(-1))), mk(TM.lvDown, null, () => run(() => level(1))));
  async function paraRange() { const x = api.anchor && api.pos ? [api.anchor, api.pos] : [api.pos, api.pos]; return x; }
  async function setList(kind) {
    if (!kind) return;
    let props;
    if (kind === 'none') props = { headType: 'None', numberingId: 0, paraLevel: 0 };
    else if (/^n\d+$/.test(kind)) {   // 번호 모양 만들기(한 번 만든 모양은 다시 쓴다)
      const code = Number(kind.slice(1));
      const levelFormats = code === 1 ? ['^1', '^2', '^3', '^4', '^5', '^6', '^7'] : ['^1.', '^2)', '(^3)', '^4', '^5', '^6', '^7'];
      const numberFormats = [code, 0, 8, 0, 0, 0, 0];
      let id = numIds.get(code);                       // getNumberingList는 숫자 모양을 알려주지 않아, 만든 것을 기억해 재사용한다
      if (id == null) { id = Number(await api.mutateApi('createNumbering', [JSON.stringify({ levelFormats, numberFormats, startNumber: 1 })])); numIds.set(code, id); }
      props = { headType: 'Number', numberingId: id || 1, paraLevel: 0 };
    } else if (kind === 'num') { const id = (await api.mutateApi('ensureDefaultNumbering', [])) ?? 1; props = { headType: 'Number', numberingId: Number(id) || 1, paraLevel: 0 }; }
    else { const id = (await api.mutateApi('ensureDefaultBullet', [kind.slice(1)])) ?? 1; props = { headType: 'Bullet', numberingId: Number(id) || 1, paraLevel: 0 }; }
    const [x, y] = await paraRange();
    const r = await api.req('parafmt', { a: x, b: y, props });
    api.setDirty(true); api.viewer.refresh(r.sizes, {});
    await api.placeCaret(api.pos);
  }
  async function level(d) {
    const p = api.pos; if (!p) return;
    const lv = Math.max(0, Math.min(6, (api.cur.paraLevel ?? 0) + d));
    const [x, y] = await paraRange();
    const r = await api.req('parafmt', { a: x, b: y, props: { paraLevel: lv } });
    api.setDirty(true); api.viewer.refresh(r.sizes, {});
    await api.placeCaret(api.pos);
  }

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

  // ── 표 탭: 계산식 ──
  const tg = api.group('table');
  const fBtn = mk(TM.formula, null, () => run(async () => {
    const t = (await api.req('tableAt', { pos: api.pos })).table; if (!t) return;
    const v = await api.form(TM.formula, [{ key: 'f', label: TM.formulaLabel, type: 'text', value: '=SUM(A1:A3)', hint: TM.formulaHint }]);
    if (!v || !v.f.trim()) return;
    try { await api.mutateApi('evaluateTableFormula', [t.s, t.p, t.ctrl, t.row, t.col, v.f.trim(), true], { pos: api.pos }); } catch { api.status(TM.formulaFail); }
  }));
  tg.append(fBtn);
  api.onContext(() => { fBtn.disabled = !api.tbl; });

  // ── 보기 탭: 개요(번호 있는 제목으로 이동) ──
  const vg = api.group('view');
  vg.append(mk(TM.outline, TM.outlineTitle, () => run(async () => {
    const o = (await q('getOutlineNavigation', []))?.outline ?? [];
    if (!o.length) { api.status(TM.noOutline); return; }
    const v = await api.form(TM.outline, [{ key: 'i', label: TM.outlinePick, type: 'select', size: 10, value: '0', options: o.map((x, i) => [String(i), `${'　'.repeat(Math.max(0, x.level - 1))}${x.number} ${x.title} (${x.page}쪽)`]) }]);
    if (!v) return;
    const x = o[Number(v.i)];
    if (x) await api.placeCaret({ s: x.section, p: x.paragraph, o: 0, path: null });
  })));

  // ── 양식 개체(선택 상자·라디오·입력·콤보): 누르면 값이 바뀐다 ──
  api.onForm(async (f) => {
    const t = f.formType;
    if (t === 'CheckBox') await api.mutateApi('setFormValue', [f.sec, f.para, f.ci, JSON.stringify({ value: f.value ? 0 : 1 })], { pos: api.pos });
    else if (t === 'RadioButton') await api.mutateApi('setFormValue', [f.sec, f.para, f.ci, JSON.stringify({ value: 1 })], { pos: api.pos });
    else if (t === 'Edit' || t === 'ComboBox') {
      const v = await api.form(f.caption || f.name || '입력', [{ key: 't', label: '값', type: 'text', value: f.text ?? '' }]);
      if (v) await api.mutateApi('setFormValue', [f.sec, f.para, f.ci, JSON.stringify({ text: v.t })], { pos: api.pos });
    } else api.status('이 단추는 문서 안에서 동작하지 않습니다.');
  });

  // ── 개체 탭: 차트 값 ──
  const og = api.group('object');
  const cBtn = mk(TM.chart, null, () => run(async () => {
    const o = api.obj;
    if (!o || !['ole', 'chart'].includes(o.type)) { api.status(TM.noChart); return; }
    let data; try { data = await q('getChartData', [o.s, o.p, o.ctrl]); } catch { data = null; }
    if (!data || !data.ok) { api.status(TM.noChart); return; }
    const text = (data.series ?? []).map((s) => `${s.name ?? ''}: ${(s.values ?? []).join(', ')}`).join('\n');
    const v = await api.form(TM.chart, [{ key: 't', label: `${TM.chart} (항목: ${(data.labels ?? []).join(', ')})`, type: 'textarea', value: text, rows: 6, hint: TM.chartHint }]);
    if (!v) return;
    const series = v.t.split('\n').filter((l) => l.trim()).map((l) => ({ values: l.slice(l.indexOf(':') + 1).split(',').map((x) => x.trim()).filter((x) => x !== '') }));
    const r = await api.mutateApi('setChartData', [o.s, o.p, o.ctrl, JSON.stringify({ series })], { pos: api.pos });
    if (r && r.ok === false) api.status(TM.chartFail);
  }));
  og.append(cBtn);
}
