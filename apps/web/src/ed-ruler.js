// 눈금자: 캐럿이 있는 쪽의 가로 눈금(cm)과 쪽 여백을 보여 주고, 문단의 왼쪽 여백·첫 줄 들여쓰기·오른쪽 여백을 끌어서 바꾼다.
// 문단 값(marginLeft·indent·marginRight)은 rhwp가 96dpi 픽셀로 돌려주고 쓸 때는 150배(HWPUNIT×2)로 받는다 — 쪽 좌표(96dpi 픽셀)와 눈금이 1:1로 맞는다.
const TR = { ruler: '눈금자', title: '눈금자 보이기·숨기기(문단의 여백·첫 줄 들여쓰기를 끌어서 바꿉니다)', first: '첫 줄 시작', left: '왼쪽 여백', right: '오른쪽 여백' };
const CM = 96 / 2.54;       // 1cm = 37.795px
const UNIT = 150;           // 문단 값 1px = 150

export function installRuler(api) {
  const el = document.createElement('div'); el.className = 'ruler'; el.hidden = true; el.setAttribute('aria-hidden', 'true');
  const page = document.createElement('div'); page.className = 'ruler-page'; el.append(page);
  api.addRow(el);
  const mk = (cls, title) => { const m = document.createElement('div'); m.className = `ruler-mk ${cls}`; m.title = title; return m; };
  const mFirst = mk('first', TR.first), mLeft = mk('left', TR.left), mRight = mk('right', TR.right);
  let on = false, info = null, infoPage = -1, geo = null;

  const btn = api.btn('', TR.ruler, TR.title, () => { on = !on; btn.setAttribute('aria-pressed', String(on)); el.hidden = !on; if (on) api.enqueue(draw); });
  btn.setAttribute('aria-label', TR.ruler); btn.setAttribute('aria-pressed', 'false');
  api.group('view').append(btn);

  async function pageInfo(n) {
    if (infoPage === n && info) return info;
    try { info = (await api.req('q', { fn: 'getPageInfo', args: [n] })).result; infoPage = n; } catch { info = null; }
    return info;
  }
  async function draw() {
    if (!on) return;
    const pos = api.pos, r = api.rect, p = pos && r ? api.viewer.pageEls[r.page] : null;
    if (!p) { page.replaceChildren(); geo = null; return; }
    const pi = await pageInfo(r.page); if (!pi) return;
    const z = api.zoom, pb = p.getBoundingClientRect(), rb = el.getBoundingClientRect();
    const w = pi.width * z;
    page.style.left = `${pb.left - rb.left}px`; page.style.width = `${w}px`;
    const ml = pi.marginLeft * z, mr = pi.marginRight * z;
    page.replaceChildren();
    for (const [x, ww] of [[0, ml], [w - mr, mr]]) { const s = document.createElement('div'); s.className = 'ruler-shade'; s.style.left = `${x}px`; s.style.width = `${ww}px`; page.append(s); }
    for (let i = 0; i * CM < pi.width; i++) {
      const t = document.createElement('div'); t.className = 'ruler-tick'; t.style.left = `${i * CM * z}px`;
      const rel = i - Math.round(pi.marginLeft / CM);
      if (i > 0 && z > 0.5) t.textContent = String(Math.abs(rel));
      page.append(t);
    }
    // 문단 표지: 표 칸 안·머리글·각주 안에서는 문단 값의 기준이 달라 보이지 않는다
    geo = null;
    if (!pos.path && !pos.hf && api.cur.marginLeft !== undefined) {
      const cl = api.cur.marginLeft ?? 0, ind = api.cur.indent ?? 0, cr = api.cur.marginRight ?? 0;
      geo = { z, pb, ml: pi.marginLeft, mr: pi.marginRight, width: pi.width };
      const L = ml + cl * z, F = L + ind * z, R = w - mr - cr * z;
      mFirst.style.left = `${F - 5}px`; mLeft.style.left = `${L - 5}px`; mRight.style.left = `${R - 5}px`;
      page.append(mFirst, mLeft, mRight);
    }
  }
  api.onContext(() => { if (on) api.enqueue(draw); });
  api.viewer.stage.addEventListener('scroll', () => { if (on) requestAnimationFrame(() => api.enqueue(draw)); }, { passive: true });
  api.viewer.addEventListener('zoomchange', () => { if (on) api.enqueue(draw); });
  window.addEventListener('resize', () => { if (on) api.enqueue(draw); });

  function drag(marker, which) {
    marker.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !geo) return;
      e.preventDefault(); e.stopPropagation();
      const g = geo, cur = { ...api.cur };
      const pagePx = (ev) => (ev.clientX - g.pb.left) / g.z;                       // 쪽 안 가로 위치(px)
      const move = (ev) => {
        marker.style.left = `${pagePx(ev) * g.z - 5}px`;
      };
      const up = (ev) => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        const x = pagePx(ev), left = g.ml + (cur.marginLeft ?? 0);
        const props = {};
        if (which === 'left') props.marginLeft = Math.max(0, Math.round((x - g.ml) * UNIT));
        else if (which === 'first') props.indent = Math.round((x - left) * UNIT);
        else props.marginRight = Math.max(0, Math.round((g.width - g.mr - x) * UNIT));
        api.enqueue(async () => {
          const a = api.hasSel ? api.anchor : api.pos, b = api.pos;
          const res = await api.req('parafmt', { a, b, props });
          api.setDirty(true); api.viewer.refresh(res.sizes, {});
          await api.placeCaret(api.pos);
        });
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
  }
  drag(mFirst, 'first'); drag(mLeft, 'left'); drag(mRight, 'right');
}
