// 쪽 목록 뷰: 가상화(보이는 쪽만 렌더), 확대/축소, 쪽 이동, 검색 강조.
// 쪽은 엔진이 만든 SVG를 <img>(blob URL)로 보여 준다. <img> 안의 SVG는 스크립트와 외부 로딩이
// 실행되지 않으므로, 문서에서 나온 SVG를 DOM에 직접 넣는 것보다 안전하다.
const GAP = 12;
const PAD = 16;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
const KEEP_RENDERED = 14;
const MAX_INFLIGHT = 2;
const STALE_HOLD_MS = 350;   // 편집 직후 이 시간 동안은 글자를 치는 쪽만 다시 그린다

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class Viewer extends EventTarget {
  constructor(stage, pagesEl) {
    super();
    this.stage = stage;
    this.pagesEl = pagesEl;
    // 간격 상수를 CSS와 어긋나지 않게 여기서 직접 지정한다
    pagesEl.style.padding = `${PAD}px`;
    pagesEl.style.gap = `${GAP}px`;
    this.sizes = [];
    this.pageEls = [];
    this.tops = [];
    this.zoom = 1;
    this.mode = 'auto'; // 'auto' | 'fit-width' | 'fit-page' | 'custom'
    this.current = 0;
    this.gen = 0;
    this.renderFn = null;
    this.rendered = new Map(); // page -> blob url
    this.inflight = new Set();
    this.stale = new Set();   // 편집으로 내용이 바뀌어 다시 그려야 하는(이미 그려진) 쪽
    this.ver = 0; this.hot = null; this.holdUntil = 0; this.holdTimer = 0;
    this.visible = new Set();
    this.hlLayers = new Map();
    this.matches = [];
    this.pumpQueued = false;
    this.scrollQueued = false;

    this.io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const i = Number(en.target.dataset.index);
        if (en.isIntersecting) this.visible.add(i); else this.visible.delete(i);
      }
      this.#queuePump();
    }, { root: stage, rootMargin: '120% 0px' });

    stage.addEventListener('scroll', () => {
      if (this.scrollQueued) return;
      this.scrollQueued = true;
      requestAnimationFrame(() => { this.scrollQueued = false; this.#updateCurrent(); });
    }, { passive: true });

    let resizeTimer = 0;
    new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (this.mode !== 'custom' && this.sizes.length) this.fit(this.mode); }, 60);
    }).observe(stage);
  }

  get pageCount() { return this.sizes.length; }

  load(sizes, renderFn) {
    this.clear();
    this.gen++;
    this.renderFn = renderFn;
    const n = sizes.length / 2;
    for (let i = 0; i < n; i++) this.sizes.push({ w: sizes[i * 2], h: sizes[i * 2 + 1] });
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'page';
      el.dataset.index = String(i);
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', `${i + 1}쪽`);
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.draggable = false;
      img.addEventListener('load', () => { el.dataset.rendered = '1'; });
      const hl = document.createElement('div');
      hl.className = 'hl-layer';
      el.append(img, hl);
      this.hlLayers.set(i, hl);
      this.pageEls.push(el);
      frag.append(el);
    }
    this.pagesEl.append(frag);
    this.fit('auto');
    for (const el of this.pageEls) this.io.observe(el);
    this.current = 0;
    this.dispatchEvent(new CustomEvent('pagechange', { detail: { page: 0 } }));
  }

  clear() {
    this.gen++;
    this.io.disconnect();
    for (const url of this.rendered.values()) URL.revokeObjectURL(url);
    this.rendered.clear();
    this.inflight.clear();
    this.stale.clear();
    this.visible.clear();
    this.hlLayers.clear();
    this.matches = [];
    this.pagesEl.replaceChildren();
    this.pageEls = [];
    this.sizes = [];
    this.tops = [];
    this.renderFn = null;
  }

  // ── 배치 ─────────────────────────────────────────────────────────
  #layout() {
    let y = 0;
    this.tops = [];
    for (let i = 0; i < this.sizes.length; i++) {
      const w = Math.max(1, Math.round(this.sizes[i].w * this.zoom));
      const h = Math.max(1, Math.round(this.sizes[i].h * this.zoom));
      const el = this.pageEls[i];
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      this.tops.push(y);
      y += h + GAP;
    }
  }

  /** 기준 쪽의 상대 위치를 유지하며 배율을 바꾼다. */
  #applyZoom(zoom) {
    const cur = this.current;
    const oldTop = this.tops[cur] ?? 0;
    const oldH = (this.sizes[cur]?.h ?? 1) * this.zoom;
    const frac = oldH ? (this.stage.scrollTop - PAD - oldTop) / oldH : 0;
    this.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    this.#layout();
    const newH = (this.sizes[cur]?.h ?? 1) * this.zoom;
    this.stage.scrollTop = Math.max(0, PAD + (this.tops[cur] ?? 0) + frac * newH);
    this.dispatchEvent(new CustomEvent('zoomchange', { detail: { zoom: this.zoom, mode: this.mode } }));
    this.#updateCurrent();
    this.#queuePump();
  }

  setZoom(z) { this.mode = 'custom'; this.#applyZoom(z); }

  fit(mode) {
    if (!this.sizes.length) return;
    this.mode = mode;
    const avail = this.stage.clientWidth - PAD * 2;
    let z;
    if (mode === 'fit-page') {
      const cur = this.sizes[this.current] ?? this.sizes[0];
      z = Math.min(avail / cur.w, (this.stage.clientHeight - PAD * 2) / cur.h);
    } else {
      const maxW = this.sizes.reduce((m, s) => Math.max(m, s.w), 1);
      z = avail / maxW;
      if (mode === 'auto') z = Math.min(z, 1.25); // 넓은 화면에서 과하게 커지지 않게
    }
    this.#applyZoom(z);
  }

  zoomBy(factor) { this.setZoom(this.zoom * factor); }

  // ── 쪽 이동 ───────────────────────────────────────────────────────
  goTo(page, smooth = false) {
    if (!this.sizes.length) return;
    const i = clamp(Math.round(page), 0, this.sizes.length - 1);
    this.stage.scrollTo({ top: Math.max(0, PAD + this.tops[i] - 8), behavior: smooth ? 'smooth' : 'auto' });
    if (!smooth) { this.current = i; this.dispatchEvent(new CustomEvent('pagechange', { detail: { page: i } })); }
  }

  #updateCurrent() {
    if (!this.tops.length) return;
    const probe = this.stage.scrollTop - PAD + this.stage.clientHeight * 0.35;
    let lo = 0, hi = this.tops.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.tops[mid] <= probe) lo = mid; else hi = mid - 1;
    }
    if (lo !== this.current) {
      this.current = lo;
      this.dispatchEvent(new CustomEvent('pagechange', { detail: { page: lo } }));
      this.#queuePump();
    }
  }

  // ── 렌더 큐 ───────────────────────────────────────────────────────
  #queuePump() {
    if (this.pumpQueued) return;
    this.pumpQueued = true;
    queueMicrotask(() => { this.pumpQueued = false; this.#pump(); });
  }

  #pump() {
    if (!this.renderFn) return;
    const want = new Set(this.visible);
    want.add(this.current);
    const now = performance.now();
    const held = this.holdUntil > now;
    if (held) { clearTimeout(this.holdTimer); this.holdTimer = setTimeout(() => this.#queuePump(), this.holdUntil - now + 5); }
    const order = [...want].filter((i) => (!this.rendered.has(i) || this.stale.has(i)) && !this.inflight.has(i) && !(held && this.rendered.has(i) && !this.hot?.has(i)))
      .sort((a, b) => Math.abs(a - this.current) - Math.abs(b - this.current));
    for (const i of order) {
      if (this.inflight.size >= MAX_INFLIGHT) break;
      this.#renderOne(i);
    }
  }

  async #renderOne(i) {
    const gen = this.gen;
    const el = this.pageEls[i];
    this.inflight.add(i);
    try {
      const ver = this.ver;
      const buf = await this.renderFn(i);
      if (gen !== this.gen) return;
      const url = URL.createObjectURL(new Blob([buf], { type: 'image/svg+xml' }));
      const old = this.rendered.get(i);
      this.rendered.set(i, url);
      if (ver === this.ver) this.stale.delete(i);       // 그리는 사이에 또 편집됐으면 stale로 남겨 다시 그린다
      delete el.dataset.error;
      el.firstElementChild.src = url;
      if (old) URL.revokeObjectURL(old);
      this.#evict();
    } catch (err) {
      if (gen !== this.gen) return;
      if (err && (err.code === 'cancelled')) return;
      el.dataset.error = '1';
      this.dispatchEvent(new CustomEvent('rendererror', { detail: { page: i, error: err } }));
    } finally {
      if (gen === this.gen) { this.inflight.delete(i); this.#queuePump(); }
    }
  }

  #evict() {
    if (this.rendered.size <= KEEP_RENDERED) return;
    const far = [...this.rendered.keys()].filter((i) => !this.visible.has(i) && i !== this.current)
      .sort((a, b) => Math.abs(b - this.current) - Math.abs(a - this.current));
    while (this.rendered.size > KEEP_RENDERED && far.length) {
      const i = far.shift();
      const el = this.pageEls[i];
      el.firstElementChild.removeAttribute('src');
      delete el.dataset.rendered;
      URL.revokeObjectURL(this.rendered.get(i));
      this.rendered.delete(i);
      this.stale.delete(i);
    }
  }

  // ── 편집 지원 ─────────────────────────────────────────────────────
  /**
   * 편집으로 내용이 바뀌었다: 그려진 쪽을 낡은 것으로 표시하고 다시 그린다. sizes가 있으면 쪽 수·크기를 먼저 맞춘다.
   * from: 이 쪽 앞은 바뀌지 않았다. hot: 바로 다시 그릴 쪽들(글자를 치는 자리). 나머지 낡은 쪽은 입력이 잠시 멈춘 뒤에 그린다
   * (한 글자마다 보이는 쪽을 모두 다시 그리면 입력이 그 뒤에 줄을 서서 느려진다).
   */
  refresh(sizes, { from = 0, hot = null } = {}) {
    this.ver++;
    if (sizes) this.#resizePages(sizes);
    for (const i of this.rendered.keys()) if (i >= from) this.stale.add(i);
    if (hot) {
      this.hot = new Set(hot);
      this.holdUntil = performance.now() + STALE_HOLD_MS;
      for (const i of this.hot) if (this.rendered.has(i)) this.stale.add(i);
    } else this.holdUntil = 0;
    this.#queuePump();
  }

  /** 쪽 수가 바뀐 경우(입력으로 쪽이 늘거나 줄었다): 쪽 요소를 맞추고 확대 비율·위치는 유지한다. */
  #resizePages(sizes) {
    const n = sizes.length / 2;
    const old = this.pageEls.length;
    const top = this.stage.scrollTop;
    for (let i = 0; i < n; i++) this.sizes[i] = { w: sizes[i * 2], h: sizes[i * 2 + 1] };
    this.sizes.length = n;
    for (let i = old; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'page'; el.dataset.index = String(i); el.setAttribute('role', 'img'); el.setAttribute('aria-label', `${i + 1}쪽`);
      const img = document.createElement('img');
      img.alt = ''; img.decoding = 'async'; img.draggable = false;
      img.addEventListener('load', () => { el.dataset.rendered = '1'; });
      const hl = document.createElement('div'); hl.className = 'hl-layer';
      el.append(img, hl);
      this.hlLayers.set(i, hl); this.pageEls.push(el); this.pagesEl.append(el); this.io.observe(el);
    }
    for (let i = n; i < old; i++) {
      this.io.unobserve(this.pageEls[i]); this.pageEls[i].remove(); this.hlLayers.delete(i);
      const u = this.rendered.get(i); if (u) URL.revokeObjectURL(u);
      this.rendered.delete(i); this.stale.delete(i); this.visible.delete(i); this.inflight.delete(i);
    }
    this.pageEls.length = n;
    this.#layout();
    this.stage.scrollTop = top;
    if (this.current >= n) this.current = Math.max(0, n - 1);
    this.dispatchEvent(new CustomEvent('pagecount', { detail: { count: n } }));
  }

  /** 쪽 안의 한 점(쪽 좌표 y, 높이 h)이 화면에 보이도록 스크롤한다. */
  ensureVisible(page, y, h) {
    const t = PAD + (this.tops[page] ?? 0) + y * this.zoom;
    const b = t + h * this.zoom;
    const vt = this.stage.scrollTop, vb = vt + this.stage.clientHeight;
    const margin = 48;
    if (t - margin < vt) this.stage.scrollTop = Math.max(0, t - margin);
    else if (b + margin > vb) this.stage.scrollTop = b + margin - this.stage.clientHeight;
  }

  // ── 검색 강조 ─────────────────────────────────────────────────────
  // 결과는 쪽 순서로 스트리밍되어 들어오므로 DOM을 이어 붙인다 (매번 전부 다시 만들면 O(n²)).
  resetMatches() {
    this.matches = [];
    for (const layer of this.hlLayers.values()) if (layer.firstChild) layer.replaceChildren();
  }

  appendMatches(list) {
    for (const m of list) {
      this.matches.push(m);
      const layer = this.hlLayers.get(m.page);
      const size = this.sizes[m.page];
      if (!layer || !size) continue;
      for (const [x, y, w, h] of m.rects) {
        const d = document.createElement('div');
        d.className = 'hl';
        d.style.left = `${(x / size.w) * 100}%`;
        d.style.top = `${(y / size.h) * 100}%`;
        d.style.width = `${(w / size.w) * 100}%`;
        d.style.height = `${(h / size.h) * 100}%`;
        layer.append(d);
      }
    }
  }

  clearMatches() { this.resetMatches(); }

  /** 현재 일치 항목 강조만 바꾸고 그 위치로 스크롤한다. */
  focusMatch(index) {
    const m = this.matches[index];
    if (!m) return;
    for (const el of this.pagesEl.querySelectorAll('.hl-current')) el.classList.remove('hl-current');
    const layer = this.hlLayers.get(m.page);
    // 같은 쪽의 일치가 여러 개일 때 몇 번째인지 센다
    let nth = 0;
    for (let k = 0; k < index; k++) if (this.matches[k].page === m.page) nth += this.matches[k].rects.length;
    if (layer) for (let k = 0; k < m.rects.length; k++) layer.children[nth + k]?.classList.add('hl-current');
    const y = PAD + this.tops[m.page] + m.rects[0][1] * this.zoom - this.stage.clientHeight * 0.3;
    this.stage.scrollTo({ top: Math.max(0, y) });
    this.#updateCurrent();
  }
}
