/* 画面共通のユーティリティ。テンプレート、モーダル、トーストなど。 */

const RAW = Symbol('raw');

export function raw(s) { return { [RAW]: String(s) }; }

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function part(v) {
  if (v == null || v === false) return '';
  if (Array.isArray(v)) return v.map(part).join('');
  if (typeof v === 'object' && RAW in v) return v[RAW];
  return esc(v);
}

/** 補間値を自動エスケープするテンプレートリテラル。生 HTML は raw() で包む。 */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < vals.length ? part(vals[i]) : ''); });
  return raw(out);
}

export function toHTML(node) { return part(node); }

export function render(container, node) {
  container.innerHTML = toHTML(node);
  return container;
}

/** イベント委譲。root に対して1つだけリスナを張る。 */
export function on(root, event, selector, handler) {
  root.addEventListener(event, (e) => {
    const t = e.target.closest(selector);
    if (t && root.contains(t)) handler(e, t);
  });
}

export function qs(sel, root = document) { return root.querySelector(sel); }
export function qsa(sel, root = document) { return [...root.querySelectorAll(sel)]; }

/* ---------------- トースト ---------------- */

const TOAST_MAX = 3;

export function toast(msg, { danger = false, ms = 2000 } = {}) {
  const root = document.getElementById('toast-root');
  // 何かの拍子に大量発生しても画面を埋め尽くさないよう古いものから捨てる
  while (root.children.length >= TOAST_MAX) root.firstElementChild.remove();
  const div = document.createElement('div');
  div.className = 'toast' + (danger ? ' is-danger' : '');
  div.textContent = msg;
  root.appendChild(div);
  setTimeout(() => {
    div.style.transition = 'opacity .2s';
    div.style.opacity = '0';
    setTimeout(() => div.remove(), 220);
  }, ms);
}

/* ---------------- モーダル（ボトムシート） ---------------- */

let openCount = 0;

/**
 * ボトムシートを開く。
 * @param {object} opts { title, body(HTML), actions:[{label, value, kind}], dismissible }
 * @returns {Promise<any>} 選ばれた value（背景タップ/キャンセルは null）
 */
export function sheet({ title = '', body = '', actions = [], dismissible = true, onMount = null, wide = false } = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = toHTML(html`
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div class="grow">${title}</div>
          ${dismissible ? raw('<button class="mini" data-close>✕</button>') : ''}
        </div>
        <div class="modal-body">${typeof body === 'string' ? raw(body) : body}</div>
        ${actions.length ? raw(`<div class="modal-foot">${actions.map((a, i) =>
          `<button class="btn ${a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : ''}" data-idx="${i}">${esc(a.label)}</button>`
        ).join('')}</div>`) : ''}
      </div>`);

    let settled = false;
    const close = (v) => {
      if (settled) return;
      settled = true;
      back.remove();
      openCount = Math.max(0, openCount - 1);
      if (!openCount) document.body.style.overflow = '';
      resolve(v);
    };

    back.addEventListener('click', (e) => {
      if (e.target === back && dismissible) return close(null);
      const closeBtn = e.target.closest('[data-close]');
      if (closeBtn) return close(null);
      const btn = e.target.closest('[data-idx]');
      if (btn) return close(actions[Number(btn.dataset.idx)].value);
    });

    root.appendChild(back);
    openCount += 1;
    document.body.style.overflow = 'hidden';
    if (onMount) onMount(back.querySelector('.modal'), close);
  });
}

export async function confirmSheet(message, { title = '確認', okLabel = 'OK', danger = false } = {}) {
  const v = await sheet({
    title,
    body: html`<p style="margin:4px 0 14px">${message}</p>`,
    actions: [
      { label: 'キャンセル', value: false },
      { label: okLabel, value: true, kind: danger ? 'danger' : 'primary' }
    ]
  });
  return v === true;
}

export async function alertSheet(message, { title = 'お知らせ' } = {}) {
  await sheet({
    title,
    body: html`<p style="margin:4px 0 14px; white-space:pre-wrap">${message}</p>`,
    actions: [{ label: '閉じる', value: true, kind: 'primary' }]
  });
}

/**
 * 入力フォーム付きシート。
 * ボタンのクリックはモーダル内で先に捕まえられるので、閉じる前に値を読み取れる。
 * @returns {Promise<{action:any, values:any}>}
 */
export async function formSheet({ title, body, okLabel = '保存', extraActions = [], read, onMount, dismissible = true }) {
  let snapshot = null;
  const actions = [
    { label: 'キャンセル', value: 'cancel' },
    ...extraActions,
    { label: okLabel, value: 'ok', kind: 'primary' }
  ];
  const action = await sheet({
    title, body, actions, dismissible,
    onMount(modal, close) {
      modal.addEventListener('click', (e) => {
        if (e.target.closest('[data-idx]') && read) snapshot = read(modal);
      });
      if (onMount) onMount(modal, close);
    }
  });
  return { action, values: snapshot };
}

/** モーダル内のフォーム値をまとめて読む */
export function readFields(modal) {
  const o = {};
  for (const inp of modal.querySelectorAll('[name]')) {
    if (inp.type === 'checkbox') o[inp.name] = inp.checked;
    else o[inp.name] = inp.value;
  }
  for (const seg of modal.querySelectorAll('[data-seg]')) {
    const onBtn = seg.querySelector('.is-on');
    o[seg.dataset.seg] = onBtn ? onBtn.dataset.val : '';
  }
  return o;
}

/** セグメントコントロール（単一選択）を配線する */
export function wireSegments(root) {
  on(root, 'click', '[data-seg] button', (e, btn) => {
    const seg = btn.closest('[data-seg]');
    for (const b of seg.querySelectorAll('button')) b.classList.toggle('is-on', b === btn);
  });
}

export function segment(name, options, value) {
  return html`<div class="seg" data-seg="${name}">
    ${raw(options.map((o) =>
      `<button type="button" data-val="${esc(o.value)}" class="${String(o.value) === String(value) ? 'is-on' : ''}">${esc(o.label)}</button>`
    ).join(''))}
  </div>`;
}

/* ---------------- 選手ピッカー ---------------- */

/**
 * 選手を1人選ぶ。
 * 戻り値: 選手 ID / '' （「選ばない」を選択）/ null （キャンセル）
 */
export function pickPlayer(players, { title = '選手を選ぶ', allowNone = false, noneLabel = '選ばない' } = {}) {
  const body = html`
    <div class="pick-grid">
      ${raw(players.map((p) => `
        <button data-pid="${esc(p.id)}">
          ${esc(p.name)}
          ${p.sub ? `<span class="sub">${esc(p.sub)}</span>` : ''}
        </button>`).join(''))}
    </div>
    ${allowNone ? raw(`<button class="btn btn-block" style="margin-top:10px" data-pid="">${esc(noneLabel)}</button>`) : ''}
  `;
  return sheet({
    title, body,
    onMount(modal, close) {
      modal.addEventListener('click', (e) => {
        const b = e.target.closest('[data-pid]');
        if (b) close(b.dataset.pid); // 「選ばない」は空文字。キャンセル(null)と区別する
      });
    }
  });
}

/* ---------------- 数値ステッパー ---------------- */

export function stepper(name, value, { min = 0, max = 99 } = {}) {
  return html`
    <div class="stepper" data-stepper="${name}" data-min="${min}" data-max="${max}">
      <button type="button" class="mini" data-step="-1">−</button>
      <span class="val" data-val>${value}</span>
      <button type="button" class="mini" data-step="1">＋</button>
    </div>`;
}

export function wireSteppers(root, onChangeCb) {
  on(root, 'click', '[data-step]', (e, btn) => {
    const box = btn.closest('[data-stepper]');
    const valEl = box.querySelector('[data-val]');
    const min = Number(box.dataset.min), max = Number(box.dataset.max);
    const next = Math.max(min, Math.min(max, Number(valEl.textContent) + Number(btn.dataset.step)));
    valEl.textContent = String(next);
    if (onChangeCb) onChangeCb(box.dataset.stepper, next);
  });
}

export function stepperValue(root, name) {
  const box = root.querySelector(`[data-stepper="${name}"]`);
  return box ? Number(box.querySelector('[data-val]').textContent) : 0;
}

/* ---------------- 表示ヘルパ ---------------- */

export function pad2(n) { return String(n).padStart(2, '0'); }

export function nowStamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

/** iOS では画面が消えると入力が中断されるため、可能なら常時点灯を試みる */
let wakeLock = null;
export async function keepAwake(enable) {
  try {
    if (!('wakeLock' in navigator)) return false;
    if (enable) {
      if (!wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
      return true;
    }
    if (wakeLock) { await wakeLock.release(); wakeLock = null; }
    return false;
  } catch {
    return false;
  }
}

export function reacquireWakeLock(enabled) {
  if (enabled && document.visibilityState === 'visible') keepAwake(true);
}
