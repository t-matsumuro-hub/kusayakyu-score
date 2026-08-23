/* 起動処理。データを読み込み、画面を登録してから最初の画面を描く。 */

import { loadAll, state } from './store.js';
import { requestPersistence } from './db.js';
import {
  registerScreens, go, initChrome, rerender, setTabResolver, setTabLabeler
} from './ui/router.js';
import { toast, keepAwake, reacquireWakeLock } from './ui/common.js';
import { backupWarning, exportAllFile } from './backup.js';

import playersScreen from './ui/players.js';
import { gamesScreen, gameDetailScreen } from './ui/games.js';
import lineupScreen from './ui/lineup.js';
import scoreScreen from './ui/score.js';
import statsScreen from './ui/stats.js';
import settingsScreen from './ui/settings.js';
import { personalScreen, personalGameScreen, personalStatsScreen } from './ui/personal.js';

async function boot() {
  try {
    await loadAll();
  } catch (err) {
    document.getElementById('view').innerHTML =
      `<div class="empty">データベースを開けませんでした。<br>
       プライベートブラウズを解除するか、ブラウザを変えてお試しください。<br>
       <span class="tiny">${String(err && err.message || err)}</span></div>`;
    return;
  }

  registerScreens({
    games: gamesScreen,
    gameDetail: gameDetailScreen,
    lineup: lineupScreen,
    score: scoreScreen,
    players: playersScreen,
    stats: statsScreen,
    settings: settingsScreen,
    personal: personalScreen,
    personalGame: personalGameScreen,
    personalStats: personalStatsScreen
  });

  // モードによって「試合」タブと「成績」タブの中身を差し替える
  const isPersonal = () => state.settings.appMode === 'personal';
  setTabResolver((tab) => {
    if (tab === 'games') return isPersonal() ? 'personal' : 'games';
    if (tab === 'stats') return isPersonal() ? 'personalStats' : 'stats';
    return tab;
  });
  setTabLabeler((tab) => {
    if (tab === 'games') return isPersonal() ? '個人' : '試合';
    return null;
  });

  initChrome();
  await go(isPersonal() ? 'personal' : 'games', {}, { resetTo: true });

  // 記録があるのに永続化されていない場合だけ、そっと要求する
  if (state.games.length || state.players.length) requestPersistence();

  await refreshBackupBanner();
  registerSW();

  // アプリに戻ってきたら画面の常時点灯を取り直す
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      reacquireWakeLock(state.settings.keepAwake);
      refreshBackupBanner();
    } else {
      keepAwake(false);
    }
  });
}

/* ---------------- 未バックアップの警告バナー ---------------- */

export async function refreshBackupBanner() {
  const el = document.getElementById('backup-banner');
  const warn = await backupWarning();
  if (!warn) { el.hidden = true; el.innerHTML = ''; return; }

  el.hidden = false;
  el.innerHTML = `<span>⚠ ${warn.message}</span>
    <button class="btn" data-banner-export>書き出す</button>`;
  el.querySelector('[data-banner-export]').onclick = async () => {
    await exportAllFile();
    await refreshBackupBanner();
  };
}

/* ---------------- Service Worker ---------------- */

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;

  // 開発時に ?nosw を付けると、オフライン用キャッシュを無効にして常に最新を読む
  if (new URLSearchParams(location.search).has('nosw')) {
    navigator.serviceWorker.getRegistrations()
      .then((rs) => Promise.all(rs.map((r) => r.unregister())))
      .then(() => caches.keys())
      .then((ks) => Promise.all(ks.map((k) => caches.delete(k))))
      .catch(() => {});
    return;
  }

  navigator.serviceWorker.register('./sw.js').catch(() => {
    // オフライン対応が効かないだけなので、失敗しても続行する
  });
}

/* ---------------- 想定外のエラーを握りつぶさず知らせる ---------------- */

window.addEventListener('error', (e) => {
  console.error(e.error || e.message);
  toast('エラーが発生しました', { danger: true });
});
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  toast('処理に失敗しました', { danger: true });
});

boot();
