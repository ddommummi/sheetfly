// 편집기 개체(그림·도형·수식): 삽입, 선택 틀(옮기기·크기 조절), 순서·배치·속성, 복사·붙이기, 지우기.
// 입력 탭에 삽입 단추를, 개체 탭에 선택한 개체에 쓰는 단추를 둔다. 개체는 클릭으로 고른다(editor.js가 hit 결과의 obj를 넘겨준다).
// 위치·크기는 rhwp 개체 속성(HWPUNIT, 1px = 75)으로 바꾼다. 떠 있는 개체는 쪽 기준 절대 위치로 바꿔 계산을 단순하게 한다.
const TO = {
  picture: '그림…', pictureTitle: '그림 파일을 캐럿 위치에 넣습니다', textbox: '글상자', shape: '도형', shapeTitle: '도형을 캐럿 위치 근처에 넣습니다', equation: '수식…',
  shapes: [['rectangle', '사각형'], ['ellipse', '타원'], ['line', '선'], ['arc', '호'], ['polygon', '삼각형'], ['connector-straight', '연결선']],
  props: '속성…', front: '맨 앞으로', back: '맨 뒤로', forward: '앞으로', backward: '뒤로', copy: '복사', paste: '붙이기', ungroup: '묶음 풀기', group: '묶기', groupTitle: 'Shift+누르기로 고른 개체 여러 개를 하나로 묶습니다', del: '개체 지우기',
  textIn: '글 넣기', textInTitle: '이 도형 안에 글을 쓸 수 있게 하고 캐럿을 둡니다(글상자 붙이기)', textOut: '글 떼기', textOutTitle: '도형에서 글상자를 떼어 냅니다(글은 없어집니다)',
  textOutAsk: '도형 안의 글이 없어집니다', textOutYes: '글 떼기', textOutNo: '취소', textSec0: '글 넣기는 아직 첫 구역의 도형에서만 됩니다.', textNotShape: '도형을 고른 뒤 쓸 수 있습니다.',
  needTwo: '묶을 개체를 Shift+누르기로 두 개 이상 고르세요', groupSec: '같은 구역의 개체만 묶을 수 있습니다', groupFail: '이 개체들은 묶을 수 없습니다.', rotate: '돌리기(끌어서 회전, Shift는 15도씩)', cellNoDel: '표 칸 안의 도형은 지울 수 없습니다(그림만 지울 수 있습니다).', cellNo: '표 칸 안의 개체에는 쓸 수 없는 기능입니다.', lineStart: '시작 점(끌어서 옮기기)', lineEnd: '끝 점(끌어서 옮기기)',
  needObj: '그림·도형을 클릭해 고르세요', noPaste: '붙일 개체가 없습니다(먼저 개체를 복사하세요)',
  w: '너비(mm)', h: '높이(mm)', wrap: '배치', wraps: [['TreatAsChar', '글자처럼'], ['TopAndBottom', '자리 차지'], ['Square', '어울림'], ['InFrontOfText', '글 앞으로'], ['BehindText', '글 뒤로']],
  hflip: '좌우 뒤집기', vflip: '상하 뒤집기', rot: '회전(도)', desc: '설명(대체 글)', bright: '밝기', contrast: '대비', effect: '효과', effects: [['RealPic', '원래 그림'], ['GrayScale', '회색조'], ['BlackWhite', '흑백']],
  cropL: '왼쪽 자르기(mm)', cropT: '위쪽 자르기(mm)', cropR: '오른쪽 자르기(mm)', cropB: '아래쪽 자르기(mm)',
  lineColor: '선 색', lineWidth: '선 굵기(0.01mm)', lineNone: '선 없음', fill: '채우기', fillNone: '없음', fillSolid: '색', fillColor: '채움 색',
  script: '수식(한글 수식 문법)', size: '글자 크기(pt)', color: '글자 색', eqHint: '예) x over 2, sqrt{a+b}, sum from{i=1} to{n} i', ok: '확인',
  badImage: '그림 파일을 읽지 못했습니다.', badEq: '수식을 넣지 못했습니다. 수식 문법을 확인하세요.',
};
const HU = 75;            // 쪽 좌표 1px = 75 HWPUNIT
const MM = 283.465;       // 1mm = 283.465 HWPUNIT
const mm = (hu) => Math.round((hu / MM) * 100) / 100;
const hu = (v) => Math.round(v * MM);
const bgr = (hex) => { const n = parseInt(hex.slice(1), 16); return ((n & 0xff) << 16) | (n & 0xff00) | (n >> 16); };
const hexOf = (c) => { const n = Number(c) >>> 0; return `#${[n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff].map((x) => x.toString(16).padStart(2, '0')).join('')}`; };
const DEL = { image: 'deletePictureControl', equation: 'deleteEquationControl' };

export function installObjects(api) {
  const run = (fn) => api.enqueue(fn);
  const btns = {};
  const mk = (panel, key, label, title, fn) => { const b = api.btn('', label, title ?? label, fn); b.setAttribute('aria-label', label); btns[key] = b; return b; };

  // ── 삽입 ──
  const ins = api.group('insert');
  const caret = () => { const pos = api.pos; return pos ? { pos, rect: api.rect } : null; };
  ins.append(
    mk('insert', 'picture', TO.picture, TO.pictureTitle, () => run(insertPicture)),
    mk('insert', 'textbox', TO.textbox, TO.textbox, () => run(() => insertShape('textbox'))),
  );
  const shapeSel = api.select('edit-shape', TO.shape, [['', `${TO.shape}…`], ...TO.shapes], (v) => { shapeSel.value = ''; run(() => insertShape(v)); });
  shapeSel.title = TO.shapeTitle;
  ins.append(shapeSel, mk('insert', 'equation', TO.equation, TO.equation, () => run(insertEquation)));

  async function insertPicture() {
    const c = caret(); if (!c) return;
    const v = await api.form(TO.picture, [{ key: 'file', label: TO.picture.replace('…', ''), type: 'file', accept: 'image/png,image/jpeg,image/gif,image/bmp,image/webp,image/svg+xml' }]);
    if (!v?.file) return;
    let img;
    try { img = await readImage(v.file); } catch { api.status(TO.badImage); return; }
    const w = Math.min(img.w, 320) , h = Math.round((w / img.w) * img.h);          // 처음 크기: 너비 320px 이하
    const pos = c.pos;
    const res = await api.mutateApi('insertPicture', [pos.s, pos.p, pos.o, pos.path ? JSON.stringify(pos.path) : '', img.bytes, w * HU, h * HU, img.w, img.h, img.ext, v.file.name.slice(0, 60)], { pos });
    if (res?.paraIdx != null && !pos.path) await api.mutateApi('setPictureProperties', [pos.s, res.paraIdx, res.controlIdx, JSON.stringify({ treatAsChar: true })], { pos });   // 글자처럼 놓는다(끌어서 옮기려면 배치를 바꾼다)
    await selectAfter(pos.s, res?.paraIdx, res?.controlIdx, 'image');
  }
  /** 그림 파일 → 바이트·크기·확장자. png·jpg·gif·bmp가 아니면 PNG로 바꾼다. */
  async function readImage(file) {
    const bmp = await createImageBitmap(file);
    const w = bmp.width, h = bmp.height;
    const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp' })[file.type];
    if (ext) return { bytes: new Uint8Array(await file.arrayBuffer()), w, h, ext };
    const cv = new OffscreenCanvas(w, h); cv.getContext('2d').drawImage(bmp, 0, 0);
    const blob = await cv.convertToBlob({ type: 'image/png' });
    return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h, ext: 'png' };
  }
  async function insertShape(kind) {
    if (!kind) return;
    const c = caret(); if (!c) return;
    const pos = c.pos, r = c.rect;
    const body = { sectionIdx: pos.s, paraIdx: pos.p, charOffset: pos.o, shapeType: kind === 'textbox' ? 'textbox' : kind, width: kind === 'line' || kind.startsWith('connector') ? 12000 : 12000, height: kind === 'line' || kind.startsWith('connector') ? 0 : 7000 };
    if (kind === 'line' || kind.startsWith('connector')) body.height = 6000;
    if (kind === 'polygon') body.polygonPoints = [{ x: Math.round(body.width / 2), y: 0 }, { x: body.width, y: body.height }, { x: 0, y: body.height }];
    if (kind === 'textbox') body.treatAsChar = true;
    else { body.treatAsChar = false; body.textWrap = 'InFrontOfText'; if (r) { body.horzOffset = Math.round(r.x * HU); body.vertOffset = Math.round((r.y + r.h) * HU); } }
    const res = await api.mutateApi('createShapeControl', [JSON.stringify(body)], { pos });
    await selectAfter(pos.s, res?.paraIdx, res?.controlIdx, 'shape', r?.page);
  }
  async function insertEquation() {
    const c = caret(); if (!c) return;
    const v = await api.form(TO.equation, [
      { key: 'script', label: TO.script, type: 'text', value: 'x over 2', hint: TO.eqHint },
      { key: 'size', label: TO.size, type: 'number', value: 10, min: 4, max: 200, step: 1 },
      { key: 'color', label: TO.color, type: 'color', value: '#000000' },
    ]);
    if (!v || !v.script.trim()) return;
    const pos = c.pos;
    let res;
    try { res = await api.mutateApi('insertEquation', [pos.s, pos.p, pos.o, v.script, Math.round(v.size * 100), bgr(v.color)], { pos }); } catch { api.status(TO.badEq); return; }
    await selectAfter(pos.s, res?.paraIdx, res?.controlIdx, 'equation');
  }
  /** 방금 넣은 개체를 골라 틀을 보인다(쪽을 모르면 처음부터 찾는다). */
  async function selectAfter(s, p, ctrl, type, page) {
    if (p == null) return;
    const r = await api.req('objfind', { page: page ?? api.rect?.page ?? null, s, p, ctrl });
    if (r.obj) api.selectObj(r.obj);
  }

  // ── 개체 탭: 선택한 개체에 쓰는 단추 ──
  const og = api.group('object');
  const zo = (op) => run(async () => { const o = api.obj; if (!o) return; await api.mutateApi('changeShapeZOrder', [o.s, o.p, o.ctrl, op]); await reselect(o); });
  og.append(
    mk('object', 'props', TO.props, TO.props, () => run(objProps)),
    mk('object', 'front', TO.front, TO.front, () => zo('front')), mk('object', 'forward', TO.forward, TO.forward, () => zo('forward')),
    mk('object', 'backward', TO.backward, TO.backward, () => zo('backward')), mk('object', 'back', TO.back, TO.back, () => zo('back')),
  );
  const og2 = api.group('object');
  og2.append(
    mk('object', 'copy', TO.copy, TO.copy, () => run(async () => { const o = api.obj; if (!o) return; await api.req('q', { fn: 'copyControl', args: [o.s, o.p, '', o.ctrl] }); copied = true; refreshState(); })),
    mk('object', 'paste', TO.paste, TO.paste, () => run(async () => {
      const pos = api.pos; if (!pos) return;
      const has = (await api.req('q', { fn: 'clipboardHasControl', args: [] })).result;
      if (!has) { api.status(TO.noPaste); return; }
      const res = await api.mutateApi('pasteControl', [pos.s, pos.p, pos.o], { pos });
      await selectAfter(pos.s, res?.paraIdx, res?.controlIdx, 'shape');
    })),
    mk('object', 'group', TO.group, TO.groupTitle, () => run(groupSel)),
    mk('object', 'ungroup', TO.ungroup, TO.ungroup, () => run(async () => { const o = api.obj; if (!o || o.type !== 'group') return; await api.mutateApi('ungroupShape', [o.s, o.p, o.ctrl]); })),
    mk('object', 'textIn', TO.textIn, TO.textInTitle, () => run(textIn)),
    mk('object', 'textOut', TO.textOut, TO.textOutTitle, () => run(textOut)),
    mk('object', 'del', TO.del, TO.del, () => run(deleteObj)),
  );
  let copied = false;

  async function reselect(o) {
    const r = await api.req('objfind', { page: o.page, s: o.s, p: o.p, ctrl: o.ctrl, cell: o.cell });
    if (r.obj) api.selectObj(r.obj);
  }
  async function deleteObj() {
    // 여러 개를 골랐으면 모두 지운다(같은 문단 안에서 뒤의 개체부터 지워야 번호가 어긋나지 않는다)
    const list = (api.objs.length ? [...api.objs] : (api.obj ? [api.obj] : [])).sort((a, b) => (b.s - a.s) || (b.p - a.p) || (b.ctrl - a.ctrl));
    for (const o of list) {
      if (o.cell) {   // 칸 안 개체: 그림만 지울 수 있다(엔진에 칸 안 도형 삭제가 없다)
        if (o.type !== 'image') { api.status(TO.cellNoDel); continue; }
        await api.mutateApi('deleteCellPictureControlByPath', [o.s, o.p, JSON.stringify(o.cell.path), o.ctrl], { pos: api.pos });
      } else await api.mutateApi(DEL[o.type] ?? 'deleteShapeControl', [o.s, o.p, o.ctrl], { pos: api.pos });
    }
  }
  /** 고른 개체 여러 개를 하나의 묶음으로. */
  async function groupSel() {
    const all = api.objs;
    if (all.length < 2) { api.status(TO.needTwo); return; }
    if (all.some((o) => o.s !== all[0].s)) { api.status(TO.groupSec); return; }
    let r;
    try { r = await api.mutateApi('groupShapes', [JSON.stringify({ sectionIdx: all[0].s, targets: all.map((o) => ({ paraIdx: o.p, controlIdx: o.ctrl })) })], { pos: api.pos }); } catch { api.status(TO.groupFail); return; }
    if (r?.paraIdx == null) { api.status(TO.groupFail); return; }
    await selectAfter(all[0].s, r.paraIdx, r.controlIdx, 'group', all[0].page);
  }
  /** 도형에 글상자를 붙이고(이미 있으면 그대로) 그 안에 캐럿을 둔다. 엔진 API가 구역을 받지 않아 첫 구역에서만 쓴다. */
  async function textIn() {
    const o = api.obj;
    if (!o || o.type !== 'shape') { api.status(TO.textNotShape); return; }
    if (o.s !== 0) { api.status(TO.textSec0); return; }
    const p = await getProps(o); if (!p) return;
    if (p.tbMarginLeft === undefined) await api.mutateApi('setTextBoxAt', [o.p, o.ctrl, true], { pos: api.pos });
    const pos = { s: o.s, p: o.p, o: 0, path: [{ controlIndex: o.ctrl, cellIndex: 0, cellParaIndex: 0 }] };
    const c = await api.req('caret', { pos });
    // 빈 글상자는 엔진이 캐럿 좌표를 주지 않는다: 틀의 왼쪽 위 안쪽에 둔다(첫 글자를 넣으면 엔진이 좌표를 준다)
    api.setCaret(pos, c.rect ?? { page: o.page, x: o.x + 4, y: o.y + 4, h: 16 });
  }
  async function textOut() {
    const o = api.obj;
    if (!o || o.type !== 'shape') { api.status(TO.textNotShape); return; }
    if (o.s !== 0) { api.status(TO.textSec0); return; }
    const p = await getProps(o); if (!p || p.tbMarginLeft === undefined) return;
    if (!(await api.ask(TO.textOut, [TO.textOutAsk], TO.textOutYes, TO.textOutNo))) return;
    await api.mutateApi('setTextBoxAt', [o.p, o.ctrl, false], { pos: api.pos });
    await reselect(o);
  }
  const getProps = async (o) => (await api.req('objprops', { obj: o })).props;
  /** 개체 속성을 쓰는 API 호출(최상위 개체와 표 칸 안 개체의 이름·인자가 다르다). */
  const setProps = (o, kind, json) => (o.cell
    ? [kind === 'picture' ? 'setCellPicturePropertiesByPath' : 'setCellShapePropertiesByPath', [o.s, o.p, JSON.stringify(o.cell.path), o.ctrl, json]]
    : [kind === 'picture' ? 'setPictureProperties' : 'setShapeProperties', [o.s, o.p, o.ctrl, json]]);
  const writeProps = (o, kind, out) => { const [fn, args] = setProps(o, kind, JSON.stringify(out)); return api.mutateApi(fn, args, { pos: api.pos }); };

  async function objProps() {
    const o = api.obj; if (!o) return;
    const p = await getProps(o); if (!p) return;
    if (p.kind === 'equation') {
      const v = await api.form(TO.equation, [
        { key: 'script', label: TO.script, type: 'text', value: p.script ?? '', hint: TO.eqHint },
        { key: 'size', label: TO.size, type: 'number', value: Math.round((p.fontSize ?? 1000) / 100), min: 4, max: 200 },
        { key: 'color', label: TO.color, type: 'color', value: hexOf(p.color ?? 0) },
      ]);
      if (!v) return;
      await api.mutateApi('setEquationProperties', [o.s, o.p, o.ctrl, -1, -1, JSON.stringify({ script: v.script, fontSize: Math.round(v.size * 100), color: bgr(v.color) })], { pos: api.pos });
      await reselect(o);
      return;
    }
    const wrapNow = p.treatAsChar ? 'TreatAsChar' : (p.textWrap ?? 'Square');
    const fields = [
      { key: 'w', label: TO.w, type: 'number', value: mm(p.width), min: 1, max: 1000, step: 0.5 },
      { key: 'h', label: TO.h, type: 'number', value: mm(p.height), min: 1, max: 1000, step: 0.5 },
      { key: 'wrap', label: TO.wrap, type: 'select', value: wrapNow, options: TO.wraps },
      { key: 'rot', label: TO.rot, type: 'number', value: p.rotationAngle ?? 0, min: -360, max: 360 },
      { key: 'hf', label: TO.hflip, type: 'checkbox', value: !!p.horzFlip }, { key: 'vf', label: TO.vflip, type: 'checkbox', value: !!p.vertFlip },
      { key: 'desc', label: TO.desc, type: 'text', value: p.description ?? '' },
    ];
    if (p.kind === 'picture') {
      fields.push(
        { key: 'bright', label: TO.bright, type: 'number', value: p.brightness ?? 0, min: -100, max: 100 }, { key: 'contrast', label: TO.contrast, type: 'number', value: p.contrast ?? 0, min: -100, max: 100 },
        { key: 'effect', label: TO.effect, type: 'select', value: p.effect ?? 'RealPic', options: TO.effects },
        { key: 'cl', label: TO.cropL, type: 'number', value: mm(p.cropLeft ?? 0), min: 0, step: 0.5 }, { key: 'ct', label: TO.cropT, type: 'number', value: mm(p.cropTop ?? 0), min: 0, step: 0.5 },
        { key: 'cr', label: TO.cropR, type: 'number', value: mm(p.cropRight ?? 0), min: 0, step: 0.5 }, { key: 'cb', label: TO.cropB, type: 'number', value: mm(p.cropBottom ?? 0), min: 0, step: 0.5 },
      );
    } else {
      fields.push(
        { key: 'lc', label: TO.lineColor, type: 'color', value: hexOf(p.borderColor ?? 0) }, { key: 'lw', label: TO.lineWidth, type: 'number', value: p.borderWidth ?? 33, min: 0, max: 2000, step: 1 },
        { key: 'fill', label: TO.fill, type: 'select', value: p.fillType === 'solid' ? 'solid' : (p.fillType === 'none' ? 'none' : 'keep'), options: [['keep', '바꾸지 않음'], ['none', TO.fillNone], ['solid', TO.fillSolid]] },
        { key: 'fc', label: TO.fillColor, type: 'color', value: '#ffee99' },
      );
    }
    const v = await api.form(TO.props, fields);
    if (!v) return;
    const out = { width: hu(v.w), height: hu(v.h), rotationAngle: v.rot, horzFlip: v.hf, vertFlip: v.vf, description: v.desc };
    if (v.wrap === 'TreatAsChar') out.treatAsChar = true;
    else { out.treatAsChar = false; out.textWrap = v.wrap; }
    if (p.kind === 'picture') Object.assign(out, { brightness: v.bright, contrast: v.contrast, effect: v.effect, cropLeft: hu(v.cl), cropTop: hu(v.ct), cropRight: hu(v.cr), cropBottom: hu(v.cb) });
    else {
      out.borderColor = bgr(v.lc); out.borderWidth = v.lw;
      if (v.fill === 'solid') { out.fillType = 'solid'; out.fillColor = bgr(v.fc); } else if (v.fill === 'none') out.fillType = 'none';
    }
    await writeProps(o, p.kind, out);
    await reselect(o);
  }

  // ── 선택 틀: 옮기기·크기 조절 ──
  const layers = [];
  const clearFrames = () => { for (const l of layers.splice(0)) l.remove(); };
  const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  function drawFrame(o, all = []) {
    clearFrames();
    if (!o) return;
    const list = all.length ? all : [o];
    const multi = list.length > 1;
    for (const q of list) {
      const el = api.viewer.pageEls[q.page];
      if (!el) continue;
      const sz = api.viewer.sizes[q.page];
      const layer = document.createElement('div'); layer.className = 'obj-layer';
      const f = document.createElement('div'); f.className = multi ? 'obj-frame multi' : 'obj-frame'; f.dataset.type = q.type;
      const place = (box) => { f.style.left = `${(box.x / sz.w) * 100}%`; f.style.top = `${(box.y / sz.h) * 100}%`; f.style.width = `${(box.w / sz.w) * 100}%`; f.style.height = `${(box.h / sz.h) * 100}%`; };
      place(q);
      if (!multi) {
        for (const h of handles) { const d = document.createElement('div'); d.className = `obj-handle h-${h}`; d.dataset.h = h; f.append(d); }
        if (q.type === 'line') {   // 선: 시작·끝 점을 끌어 옮긴다(엔진이 점 좌표를 받는다)
          getProps(q).then((p) => {
            if (!p || !layers.includes(layer)) return;
            const hf = !!p.horzFlip, vf = !!p.vertFlip;
            for (const [k, fx, fy] of [['start', hf ? 1 : 0, vf ? 1 : 0], ['end', hf ? 0 : 1, vf ? 0 : 1]]) {
              const d = document.createElement('div'); d.className = 'obj-endpoint'; d.dataset.h = 'end'; d.dataset.end = k; d.title = k === 'start' ? TO.lineStart : TO.lineEnd;
              d.style.left = `${fx * 100}%`; d.style.top = `${fy * 100}%`; f.append(d);
            }
          }).catch(() => {});
        }
        if (q.type === 'shape' || q.type === 'image') {
          const rh = document.createElement('div'); rh.className = 'obj-rot'; rh.title = TO.rotate; rh.dataset.h = 'rot'; f.append(rh);
          getProps(q).then((p) => { if (p?.rotationAngle && layers.includes(layer)) f.style.transform = `rotate(${p.rotationAngle}deg)`; }).catch(() => {});
        }
        f.addEventListener('pointerdown', (e) => (e.target.dataset?.h === 'rot' ? startRotate(e, q, f) : e.target.dataset?.h === 'end' ? startEndpoint(e, q, f) : startDrag(e, q, f, place)));
      } else { f.style.cursor = 'move'; f.addEventListener('pointerdown', (e) => startMulti(e, list)); }
      layer.append(f); el.append(layer); layers.push(layer);
    }
  }
  api.onObject((o, all) => { drawFrame(o, all); refreshState(); });

  /** 선의 시작·끝 점 끌기: 쪽 좌표(px)로 새 점을 구해 엔진에 HWPUNIT 절대 좌표로 넘긴다. */
  function startEndpoint(e, o, f) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const which = e.target.dataset.end, el = api.viewer.pageEls[o.page], z = api.zoom, h = e.target;
    getProps(o).then((p) => {
      const hf = !!p?.horzFlip, vf = !!p?.vertFlip;
      const startPt = { x: hf ? o.x + o.w : o.x, y: vf ? o.y + o.h : o.y }, endPt = { x: hf ? o.x : o.x + o.w, y: vf ? o.y : o.y + o.h };
      const at = (ev) => { const b = el.getBoundingClientRect(); return { x: (ev.clientX - b.left) / z, y: (ev.clientY - b.top) / z }; };
      let pt = which === 'start' ? startPt : endPt;
      const move = (ev) => { pt = at(ev); const b = f.getBoundingClientRect(), eb = el.getBoundingClientRect(); h.style.left = `${((pt.x * z + eb.left - b.left) / b.width) * 100}%`; h.style.top = `${((pt.y * z + eb.top - b.top) / b.height) * 100}%`; };
      const up = (ev) => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        pt = at(ev);
        const a = which === 'start' ? pt : startPt, b = which === 'start' ? endPt : pt;
        run(async () => { await api.mutateApi('moveLineEndpoint', [o.s, o.p, o.ctrl, Math.round(a.x * HU), Math.round(a.y * HU), Math.round(b.x * HU), Math.round(b.y * HU)], { pos: api.pos }); await reselect(o); });
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    }).catch(() => {});
  }
  /** 여러 개를 고른 채 하나를 끌면 모두 같은 만큼 옮긴다(글자처럼 놓인 개체는 옮기지 않는다). */
  function startMulti(e, list) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const z = api.zoom, x0 = e.clientX, y0 = e.clientY, frames = [...layers].map((l) => l.firstChild);
    const move = (ev) => { const dx = ev.clientX - x0, dy = ev.clientY - y0; for (const f of frames) f.style.transform = `translate(${dx}px, ${dy}px)`; };
    const up = (ev) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      const dx = (ev.clientX - x0) / z, dy = (ev.clientY - y0) / z;
      if (Math.abs(dx) + Math.abs(dy) < 1) { for (const f of frames) f.style.transform = ''; return; }
      run(() => moveMany(list, dx, dy));
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  async function moveMany(list, dx, dy) {
    for (const o of list) {
      const p = await getProps(o); if (!p || p.treatAsChar) continue;
      const out = { horzRelTo: 'Paper', horzAlign: 'Left', horzOffset: Math.max(0, Math.round((o.x + dx) * HU)), vertRelTo: 'Paper', vertAlign: 'Top', vertOffset: Math.max(0, Math.round((o.y + dy) * HU)) };
      await writeProps(o, p.kind, out);
    }
    // 옮긴 개체들을 다시 고른다(처음 것은 새로 고르고 나머지는 더한다)
    let first = true;
    for (const o of list) { const r = await api.req('objfind', { page: o.page, s: o.s, p: o.p, ctrl: o.ctrl, cell: o.cell }); if (r.obj) { api.selectObj(r.obj, !first); first = false; } }
  }

  /** 회전 손잡이: 틀 가운데에서 포인터까지의 각도로 돌린다(위쪽이 0도, 시계 방향). Shift는 15도 단위. */
  function startRotate(e, o, f) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const r0 = f.getBoundingClientRect();
    const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    const angle = (ev) => { let a = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90; a = ((a % 360) + 360) % 360; if (ev.shiftKey) a = Math.round(a / 15) * 15 % 360; return Math.round(a); };
    let deg = 0;
    const move = (ev) => { deg = angle(ev); f.style.transform = `rotate(${deg}deg)`; };
    const up = (ev) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      deg = angle(ev);
      run(async () => { await writeProps(o, o.type === 'image' ? 'picture' : 'shape', { rotationAngle: deg }); await reselect(o); });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }

  function startDrag(e, o, f, place) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const mode = e.target.dataset?.h ?? 'move';
    const z = api.zoom, x0 = e.clientX, y0 = e.clientY;
    let box = { x: o.x, y: o.y, w: o.w, h: o.h };
    const calc = (ev) => {
      const dx = (ev.clientX - x0) / z, dy = (ev.clientY - y0) / z;
      let { x, y, w, h } = o;
      if (mode === 'move') { x += dx; y += dy; }
      else {
        if (mode.includes('e')) w += dx; if (mode.includes('s')) h += dy;
        if (mode.includes('w')) { x += dx; w -= dx; } if (mode.includes('n')) { y += dy; h -= dy; }
        if (mode.length === 2 && o.type === 'image' && !ev.shiftKey) {          // 그림은 모서리로 줄이고 늘릴 때 가로세로 비율을 지킨다(Shift로 해제)
          const k = Math.max(w / o.w, h / o.h); const nw = o.w * k, nh = o.h * k;
          if (mode.includes('w')) x += w - nw; if (mode.includes('n')) y += h - nh; w = nw; h = nh;
        }
        w = Math.max(6, w); h = Math.max(6, h);
      }
      return { x, y, w, h };
    };
    const move = (ev) => { box = calc(ev); place(box); };
    const up = (ev) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      box = calc(ev);
      if (Math.abs(box.x - o.x) + Math.abs(box.y - o.y) + Math.abs(box.w - o.w) + Math.abs(box.h - o.h) < 1) return;
      run(() => applyBox(o, box, mode));
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  /** 틀의 새 위치·크기를 개체 속성으로 쓴다. 글자처럼 놓인 개체는 크기만 바꾼다(위치는 글 흐름이 정한다). */
  async function applyBox(o, box, mode) {
    const p = await getProps(o); if (!p) return;
    const out = {};
    const sizeChanged = Math.abs(box.w - o.w) > 0.5 || Math.abs(box.h - o.h) > 0.5;
    if (sizeChanged) { out.width = Math.round(box.w * HU); out.height = Math.round(box.h * HU); }
    if (!p.treatAsChar && (Math.abs(box.x - o.x) > 0.5 || Math.abs(box.y - o.y) > 0.5)) {
      Object.assign(out, { horzRelTo: 'Paper', horzAlign: 'Left', horzOffset: Math.max(0, Math.round(box.x * HU)), vertRelTo: 'Paper', vertAlign: 'Top', vertOffset: Math.max(0, Math.round(box.y * HU)) });
    }
    if (!Object.keys(out).length) return;
    await writeProps(o, p.kind, out);
    await reselect(o);
  }

  // 키: 지우기·화살표로 옮기기·Esc로 선택 해제
  api.setObjKeyHandler((e) => {
    const o = api.obj; if (!o) return false;
    const k = e.key;
    if (k === 'Delete' || k === 'Backspace') { run(deleteObj); return true; }
    if (k === 'Escape') { api.clearObj(); return true; }
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
    if (d && api.objs.length > 1) return true;   // 여러 개를 골랐을 때 화살표는 쓰지 않는다(하나씩 옮기려면 하나만 고른다)
    if (d) { const step = e.shiftKey ? 10 : 1; run(() => applyBox(o, { x: o.x + d[0] * step, y: o.y + d[1] * step, w: o.w, h: o.h }, 'move')); return true; }
    return false;
  });

  // 개체를 골랐는지에 따라 단추를 켜고 끈다
  function refreshState() {
    const has = !!api.obj;
    const cellObj = has && api.objs.some((q) => q.cell);
    for (const k of ['props', 'front', 'back', 'forward', 'backward', 'copy', 'del']) { btns[k].disabled = !has; btns[k].title = has ? btns[k].getAttribute('aria-label') : `${btns[k].getAttribute('aria-label')} — ${TO.needObj}`; }
    btns.group.disabled = api.objs.length < 2 || cellObj;
    btns.textIn.disabled = !(has && api.obj.type === 'shape') || cellObj; btns.textOut.disabled = btns.textIn.disabled;
    btns.ungroup.disabled = !(has && api.obj.type === 'group') || cellObj;
    for (const k of ['front', 'back', 'forward', 'backward', 'copy']) if (cellObj) { btns[k].disabled = true; btns[k].title = `${btns[k].getAttribute('aria-label')} — ${TO.cellNo}`; }
    btns.paste.disabled = false;
  }
  api.onContext(refreshState);
  refreshState();
}
