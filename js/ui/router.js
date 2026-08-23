/* 画面遷移。履歴をスタックで持ち、上部バーとタブバーの状態を面倒みる。
   画面モジュールは { title, hideTabs, action, render } を実装する。 */

const screens = {};
let stack = [];
let busy = false;

export function registerScreens(map) { Object.assign(screens, map); }

export function current() { return stack[stack.length - 1] || null; }

/** タブと、そのタブに属するルート。モードによって開く画面が変わる。 */
const TAB_ROUTES = {
  games: ['games', 'personal'],
  players: ['players'],
  stats: ['stats', 'personalStats'],
  settings: ['settings']
};

/** タブ名から実際に開くルートを決める関数（app.js から差し替える） */
let tabResolver = (name) => name;
export function setTabResolver(fn) { tabResolver = fn; }

/** タブのラベルを差し替える関数（モードによって「試合」「個人」を切り替える） */
let tabLabeler = null;
export function setTabLabeler(fn) { tabLabeler = fn; }

export async function go(name, params = {}, { replace = false, resetTo = false } = {}) {
  if (!screens[name]) throw new Error(`未登録の画面: ${name}`);
  if (resetTo) stack = [];
  if (replace && stack.length) stack.pop();
  stack.push({ name, params });
  await rerender();
}

export async function back() {
  if (stack.length > 1) {
    stack.pop();
    await rerender();
    return true;
  }
  return false;
}

/** 指定画面まで戻る（見つからなければ何もしない） */
export async function backTo(name) {
  const i = stack.map((s) => s.name).lastIndexOf(name);
  if (i < 0) return false;
  stack = stack.slice(0, i + 1);
  await rerender();
  return true;
}

export function replaceParams(patch) {
  const c = current();
  if (c) c.params = { ...c.params, ...patch };
}

/** 中身もイベントリスナーも持たない #view に置き換えて返す */
function freshView() {
  const old = document.getElementById('view');
  const next = document.createElement('main');
  next.id = 'view';
  old.replaceWith(next);
  return next;
}

export async function rerender() {
  if (busy) return;
  const c = current();
  if (!c) return;
  const screen = screens[c.name];
  busy = true;
  try {
    // 画面モジュールは on() で #view にイベントを委譲登録する。
    // 中身だけ差し替えると登録が積み重なり、1タップで処理が複数回走ってしまうため、
    // 描画のたびに #view 自体を作り直して古いリスナーを捨てる。
    const view = freshView();
    const titleEl = document.getElementById('app-title');
    const backBtn = document.getElementById('btn-back');
    const actionBtn = document.getElementById('btn-action');

    titleEl.textContent = typeof screen.title === 'function' ? screen.title(c.params) : (screen.title || '');

    const canBack = stack.length > 1;
    backBtn.hidden = !canBack;

    const act = typeof screen.action === 'function' ? screen.action(c.params) : null;
    if (act) {
      actionBtn.hidden = false;
      actionBtn.textContent = act.label;
      actionBtn.onclick = () => act.run();
    } else {
      actionBtn.hidden = true;
      actionBtn.onclick = null;
    }

    document.body.classList.toggle('no-tabbar', !!screen.hideTabs);

    // タブの選択状態とラベル
    const tabRoot = stack[0]?.name;
    for (const b of document.querySelectorAll('#tabbar .tab')) {
      const routes = TAB_ROUTES[b.dataset.nav] || [b.dataset.nav];
      b.classList.toggle('is-active', routes.includes(tabRoot));
      if (tabLabeler) {
        const label = tabLabeler(b.dataset.nav);
        if (label) {
          const span = b.querySelector('span:not(.ic)');
          if (span) span.textContent = label;
        }
      }
    }

    view.scrollTop = 0;
    window.scrollTo(0, 0);
    await screen.render(view, c.params);
  } finally {
    busy = false;
  }
}

export function initChrome() {
  document.getElementById('btn-back').addEventListener('click', () => back());
  for (const b of document.querySelectorAll('#tabbar .tab')) {
    b.addEventListener('click', () => {
      const name = b.dataset.nav;
      if (!TAB_ROUTES[name]) return;
      go(tabResolver(name), {}, { resetTo: true });
    });
  }
}
