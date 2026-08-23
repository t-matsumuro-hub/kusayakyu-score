/* 設定とバックアップ。iOS ではストレージが保証されないので、
   この画面のバックアップ導線を最も目立たせている。 */

import {
  html, raw, esc, render, on, toast, sheet, formSheet, readFields,
  wireSegments, segment, confirmSheet, alertSheet
} from './common.js';
import { state, saveSettings, loadAll } from '../store.js';
import { PITCH_MODES, DEFAULT_SETTINGS } from '../model.js';
import { requestPersistence, storageEstimate, dbClear, STORE_GAMES, STORE_PLAYERS } from '../db.js';
import { exportAllFile, importWithConfirm, lastBackupAt, daysSinceBackup } from '../backup.js';
import { rerender } from './router.js';

export default {
  title: () => '設定',

  async render(view) {
    const s = state.settings;
    const at = await lastBackupAt();
    const days = await daysSinceBackup();
    const est = await storageEstimate();
    const persisted = navigator.storage && navigator.storage.persisted
      ? await navigator.storage.persisted().catch(() => false) : false;

    const paCount = state.games.reduce((n, g) => n + (g.pas || []).length, 0);

    render(view, html`
      <h2 class="section">入力モード</h2>
      <div class="card card-pad">
        <div class="seg" data-appmode>
          <button class="${s.appMode !== 'personal' ? 'is-on' : ''}" data-mode="team">試合のスコア</button>
          <button class="${s.appMode === 'personal' ? 'is-on' : ''}" data-mode="personal">個人成績</button>
        </div>
        <p class="tiny muted" style="margin:8px 0 0">
          「試合のスコア」はチームの試合を丸ごと記録します。
          「個人成績」はスコアを付けずに、選んだメンバー1人の成績だけを残します。
        </p>
      </div>

      <h2 class="section">バックアップ</h2>
      <div class="card card-pad">
        <div class="small ${days != null && days >= (s.backupWarnDays || 7) ? '' : 'muted'}"
             style="${days != null && days >= (s.backupWarnDays || 7) ? 'color:var(--warn);font-weight:700' : ''}">
          ${at ? `最終バックアップ：${new Date(at).toLocaleString('ja-JP')}（${days}日前）`
               : 'まだ一度もバックアップしていません'}
        </div>
        <div class="small muted" style="margin-top:6px">
          選手 ${state.players.length}人 ・ 試合 ${state.games.length}件 ・ 打席 ${paCount}件
          ${state.personal.length ? html` ・ 個人記録 ${state.personal.length}件` : ''}
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" data-export>書き出す</button>
          <button class="btn" data-import>取り込む</button>
        </div>
        <p class="tiny muted" style="margin:4px 0 0">
          iPhone では「書き出す」→ 共有シートの「"ファイル"に保存」で iCloud Drive に置くのが確実です。
          機種変更やアプリ削除でデータは消えるため、試合ごとの書き出しをおすすめします。
        </p>
      </div>

      <div class="card card-pad">
        <div class="switch">
          <div>
            <div style="font-weight:600">ストレージの永続化</div>
            <div class="tiny muted">${persisted ? '許可されています' : 'ブラウザに削除される可能性があります'}</div>
          </div>
          ${persisted ? raw('<span class="badge badge-our">有効</span>')
                      : raw('<button class="btn btn-sm" data-persist>要求する</button>')}
        </div>
        ${est ? html`<div class="tiny muted" style="margin-top:8px">
          使用量 ${fmtBytes(est.usage)} / 割当 ${fmtBytes(est.quota)}
        </div>` : ''}
      </div>

      <h2 class="section">チームと試合の既定値</h2>
      <div class="card">
        <button class="row" data-edit-basic>
          <div class="row-main">
            <div class="row-title">チーム名</div>
            <div class="row-sub">${esc(s.teamName || '未設定')}</div>
          </div><span class="chev">›</span>
        </button>
        <button class="row" data-edit-basic>
          <div class="row-main">
            <div class="row-title">既定のイニング数・球数記録</div>
            <div class="row-sub">${s.defaultInnings}回制 ・ ${esc(pitchModeLabel(s.defaultPitchMode))}</div>
          </div><span class="chev">›</span>
        </button>
        <button class="row" data-edit-qual>
          <div class="row-main">
            <div class="row-title">規定打席</div>
            <div class="row-sub">${s.qualMode === 'fixed'
              ? `固定 ${s.qualFixed} 打席`
              : `試合数 × ${s.qualFactor}`}</div>
          </div><span class="chev">›</span>
        </button>
        <button class="row" data-edit-era>
          <div class="row-main">
            <div class="row-title">防御率の基準イニング</div>
            <div class="row-sub">${s.eraInnings || 9}回換算</div>
          </div><span class="chev">›</span>
        </button>
        <button class="row" data-edit-misc>
          <div class="row-main">
            <div class="row-title">その他</div>
            <div class="row-sub">バックアップ警告 ${s.backupWarnDays}日 ・ 画面の常時点灯 ${s.keepAwake ? 'オン' : 'オフ'}</div>
          </div><span class="chev">›</span>
        </button>
      </div>

      <h2 class="section">このアプリについて</h2>
      <div class="card card-pad small muted">
        草野球スコア v1.0.0<br>
        データはこの端末の中だけに保存され、外部には送信されません。
      </div>

      <h2 class="section">危険な操作</h2>
      <div class="card card-pad">
        <button class="btn btn-danger btn-block" data-wipe>すべてのデータを削除</button>
        <p class="tiny muted" style="margin:8px 0 0">
          元に戻せません。実行前に必ず書き出しておいてください。
        </p>
      </div>
    `);

    on(view, 'click', '[data-appmode] [data-mode]', async (e, b) => {
      if (b.dataset.mode === s.appMode) return;
      await saveSettings({ appMode: b.dataset.mode });
      const { go } = await import('./router.js');
      go(b.dataset.mode === 'personal' ? 'personal' : 'games', {}, { resetTo: true });
    });

    on(view, 'click', '[data-export]', async () => { await exportAllFile(); rerender(); });
    on(view, 'click', '[data-import]', async () => { await importWithConfirm(); rerender(); });

    on(view, 'click', '[data-persist]', async () => {
      const r = await requestPersistence();
      toast(r.persisted ? '永続化が許可されました' : 'ブラウザに拒否されました。こまめな書き出しをおすすめします',
        { danger: !r.persisted, ms: r.persisted ? 2000 : 3500 });
      rerender();
    });

    on(view, 'click', '[data-edit-basic]', () => editBasic());
    on(view, 'click', '[data-edit-qual]', () => editQual());
    on(view, 'click', '[data-edit-era]', () => editEra());
    on(view, 'click', '[data-edit-misc]', () => editMisc());

    on(view, 'click', '[data-wipe]', async () => {
      const ok = await confirmSheet(
        `本当にすべて削除しますか？\n選手 ${state.players.length}人 / 試合 ${state.games.length}件 / 打席 ${paCount}件 が失われます。`,
        { title: '全データの削除', okLabel: '削除する', danger: true });
      if (!ok) return;
      const again = await confirmSheet('元に戻せません。最後の確認です。', { title: '最終確認', okLabel: '削除を実行', danger: true });
      if (!again) return;
      await dbClear(STORE_GAMES);
      await dbClear(STORE_PLAYERS);
      await loadAll();
      toast('すべて削除しました');
      rerender();
    });
  }
};

function pitchModeLabel(code) {
  return PITCH_MODES.find((m) => m.code === code)?.label || code;
}

function fmtBytes(n) {
  if (n == null) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function editBasic() {
  const s = state.settings;
  const { action, values } = await formSheet({
    title: 'チームと既定値',
    body: html`
      <div class="card" style="margin:0">
        <label class="field"><span>チーム名</span>
          <input name="teamName" type="text" value="${s.teamName || ''}" placeholder="わがチーム"></label>
        <label class="field"><span>既定のイニング数</span>
          <input name="defaultInnings" type="number" inputmode="numeric" min="1" max="15" value="${s.defaultInnings}"></label>
        <div class="field"><span>既定の球数記録</span>
          ${segment('defaultPitchMode', PITCH_MODES.map((m) => ({ value: m.code, label: m.label })), s.defaultPitchMode)}</div>
      </div>
      <p class="small muted" style="margin-top:10px">
        ${raw(PITCH_MODES.map((m) => `<b>${esc(m.label)}</b>：${esc(m.hint)}`).join('<br>'))}
      </p>`,
    read: readFields,
    onMount: (modal) => wireSegments(modal)
  });
  if (action !== 'ok' || !values) return;
  await saveSettings({
    teamName: (values.teamName || '').trim() || 'わがチーム',
    defaultInnings: Math.max(1, Math.min(15, Number(values.defaultInnings) || 7)),
    defaultPitchMode: values.defaultPitchMode || 'none'
  });
  toast('保存しました');
  rerender();
}

async function editQual() {
  const s = state.settings;
  const { action, values } = await formSheet({
    title: '規定打席',
    body: html`
      <div class="card" style="margin:0 0 12px">
        <div class="field"><span>計算方法</span>
          ${segment('qualMode', [
            { value: 'factor', label: '試合数 × 係数' },
            { value: 'fixed', label: '固定打席数' }
          ], s.qualMode)}</div>
        <div class="field-row">
          <label class="field"><span>係数</span>
            <input name="qualFactor" type="number" inputmode="decimal" step="0.1" min="0" max="10" value="${s.qualFactor}"></label>
          <label class="field"><span>固定打席数</span>
            <input name="qualFixed" type="number" inputmode="numeric" min="0" max="999" value="${s.qualFixed}"></label>
        </div>
      </div>
      <p class="small muted">
        年間の試合数が25〜100と幅があるため、固定値ではなく係数方式を既定にしています。
        全員打ちのチームでは、公式の3.1より小さめ（2.0前後）が実態に合います。
      </p>`,
    read: readFields,
    onMount: (modal) => wireSegments(modal)
  });
  if (action !== 'ok' || !values) return;
  await saveSettings({
    qualMode: values.qualMode || 'factor',
    qualFactor: Math.max(0, Number(values.qualFactor) || 0),
    qualFixed: Math.max(0, Number(values.qualFixed) || 0)
  });
  toast('保存しました');
  rerender();
}

async function editEra() {
  const s = state.settings;
  const { action, values } = await formSheet({
    title: '防御率の基準イニング',
    body: html`
      <div class="card" style="margin:0 0 12px">
        <div class="field"><span>換算するイニング数</span>
          ${segment('eraInnings', [
            { value: '9', label: '9回（一般的）' },
            { value: '7', label: '7回（試合に合わせる）' }
          ], String(s.eraInnings || 9))}</div>
      </div>
      <p class="small muted">
        防御率は「自責点 ÷ 投球回 × 基準イニング」で計算します。
        一般に公表される防御率は9回換算なので既定は9です。
        自チームの7回制の実感に合わせたい場合は7を選んでください。
      </p>`,
    read: readFields,
    onMount: (modal) => wireSegments(modal)
  });
  if (action !== 'ok' || !values) return;
  await saveSettings({ eraInnings: Number(values.eraInnings) || 9 });
  toast('保存しました');
  rerender();
}

async function editMisc() {
  const s = state.settings;
  const { action, values } = await formSheet({
    title: 'その他の設定',
    body: html`
      <div class="card" style="margin:0">
        <label class="field"><span>バックアップ警告を出す日数</span>
          <input name="backupWarnDays" type="number" inputmode="numeric" min="1" max="90" value="${s.backupWarnDays}"></label>
        <label class="field switch">
          <span style="margin:0">打席入力中に画面を消さない</span>
          <input name="keepAwake" type="checkbox" ${raw(s.keepAwake ? 'checked' : '')}>
        </label>
      </div>
      <p class="small muted" style="margin-top:10px">
        画面の常時点灯は端末やブラウザによって効かない場合があります。
      </p>`,
    read: readFields
  });
  if (action !== 'ok' || !values) return;
  await saveSettings({
    backupWarnDays: Math.max(1, Math.min(90, Number(values.backupWarnDays) || 7)),
    keepAwake: !!values.keepAwake
  });
  toast('保存しました');
  rerender();
}
