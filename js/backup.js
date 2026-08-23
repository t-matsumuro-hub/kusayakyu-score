/* バックアップと入出力。
   iOS ではブラウザのストレージが保証されないため、この機構が生命線になる。
   試合単位の書き出しには参照している選手も同梱し、別端末で取り込めるようにする
   （当番制でスコアを付けた端末から本体へ取り込む用途）。 */

import { STORE_PLAYERS, STORE_GAMES, STORE_PERSONAL, dbBulkPut } from './db.js';
import { state, loadAll, setMeta, getMeta, saveSettings } from './store.js';
import { toast, alertSheet, confirmSheet, sheet, html, raw, esc, nowStamp } from './ui/common.js';
import { formatDate } from './model.js';

const APP_TAG = 'bbscore';
const FORMAT_VERSION = 1;

/* ---------------- 書き出し ---------------- */

export function buildFullBackup() {
  return {
    app: APP_TAG,
    kind: 'full',
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    players: state.players,
    games: state.games,
    personal: state.personal
  };
}

/** 1試合分。参照している選手を同梱する。 */
export function buildGameBundle(game) {
  const ids = new Set();
  const addRef = (r) => { if (r && String(r).length > 2) ids.add(r); }; // 相手走者は '1'〜'9'

  for (const e of game.lineup || []) if (e.playerId) ids.add(e.playerId);
  for (const pa of game.pas || []) {
    if (pa.playerId) ids.add(pa.playerId);
    if (pa.errorBy) ids.add(pa.errorBy);
    addRef(pa.batterRef);
    for (const b of [pa.basesBefore, pa.basesAfter]) if (b) for (const v of Object.values(b)) addRef(v);
    for (const o of pa.outsOnPlay || []) addRef(o.ref);
    for (const r of pa.runsOnPlay || []) addRef(r.ref);
  }
  for (const ev of game.runnerEvents || []) {
    addRef(ev.ref);
    for (const mv of ev.moves || []) addRef(mv.ref);
    for (const b of [ev.basesBefore, ev.basesAfter]) if (b) for (const v of Object.values(b)) addRef(v);
    for (const o of ev.outsOnPlay || []) addRef(o.ref);
    for (const r of ev.runsOnPlay || []) addRef(r.ref);
  }
  for (const d of game.defense || []) for (const v of Object.values(d.map || {})) if (v) ids.add(v);
  for (const s of game.scorers || []) if (s.playerId) ids.add(s.playerId);
  for (const s of game.steals || []) if (s.playerId) ids.add(s.playerId);

  // 過去成績は試合とは無関係なので同梱しない（取り込み先の値を壊さないため）
  const players = state.players
    .filter((p) => ids.has(p.id))
    .map((p) => ({ ...p, legacy: [] }));

  return {
    app: APP_TAG,
    kind: 'game',
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    players,
    games: [game]
  };
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * ファイルを共有または保存する。
 * iOS Safari では共有シート経由が最も確実（「ファイルに保存」で iCloud Drive に置ける）。
 */
export async function shareOrDownload(text, filename, mime = 'application/json', shareTitle = '') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const file = new File([blob], filename, { type: mime });

  if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title: shareTitle || filename });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      // 共有に失敗したらダウンロードにフォールバック
    }
  }
  download(blob, filename);
  return 'downloaded';
}

export async function exportAllFile() {
  const data = buildFullBackup();
  const name = `bbscore-backup-${nowStamp()}.json`;
  const r = await shareOrDownload(JSON.stringify(data), name, 'application/json', 'スコアのバックアップ');
  if (r === 'cancelled') return r;
  await markBackedUp();
  toast(r === 'shared' ? '書き出しました' : `${name} を保存しました`);
  return r;
}

export async function exportGameFile(game) {
  const data = buildGameBundle(game);
  const safeOpp = (game.opponent || 'game').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 20);
  const name = `bbscore-game-${game.date}-${safeOpp}.json`;
  const r = await shareOrDownload(JSON.stringify(data), name, 'application/json', '試合データ');
  if (r !== 'cancelled') toast(r === 'shared' ? '書き出しました' : `${name} を保存しました`);
  return r;
}

/* ---------------- 取り込み ---------------- */

export function pickFile(accept = 'application/json,.json') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.remove();
      resolve(f || null);
    });
    // キャンセルは change が発火しないブラウザがあるため、フォーカス復帰で片付ける
    window.addEventListener('focus', () => setTimeout(() => {
      if (document.body.contains(input) && !(input.files && input.files.length)) {
        input.remove();
        resolve(null);
      }
    }, 800), { once: true });
    input.click();
  });
}

function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error('ファイルを読み取れませんでした（JSON として不正です）'); }
  if (!data || data.app !== APP_TAG) throw new Error('このアプリのバックアップファイルではありません');
  if (!Array.isArray(data.games) || !Array.isArray(data.players)) throw new Error('ファイルの中身が壊れています');
  if (!Array.isArray(data.personal)) data.personal = [];   // 個人記録より前のバックアップ
  return data;
}

/**
 * 取り込むデータの選手 ID を、既存データに合わせて付け替える。
 * 同じ ID があればそのまま、無ければ同名の選手に寄せ、それも無ければ新規作成する。
 */
function remapPlayers(incomingPlayers) {
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const byName = new Map(state.players.map((p) => [normName(p.name), p]));
  const map = new Map();
  const toCreate = [];

  for (const p of incomingPlayers) {
    if (byId.has(p.id)) { map.set(p.id, p.id); continue; }
    const same = byName.get(normName(p.name));
    if (same) { map.set(p.id, same.id); continue; }
    map.set(p.id, p.id);
    toCreate.push({ ...p, legacy: p.legacy || [] });
  }
  return { map, toCreate };
}

function normName(s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); }

function applyRemap(game, map) {
  const m = (id) => (id && map.has(id) ? map.get(id) : id);
  const mBases = (b) => (b ? Object.fromEntries(Object.entries(b).map(([k, v]) => [k, m(v)])) : b);
  const mRefs = (arr) => (arr || []).map((x) => ({ ...x, ref: m(x.ref) }));

  return {
    ...game,
    lineup: (game.lineup || []).map((e) => ({ ...e, playerId: m(e.playerId) })),
    pas: (game.pas || []).map((pa) => ({
      ...pa,
      playerId: m(pa.playerId),
      errorBy: m(pa.errorBy),
      batterRef: m(pa.batterRef),
      basesBefore: mBases(pa.basesBefore),
      basesAfter: mBases(pa.basesAfter),
      outsOnPlay: mRefs(pa.outsOnPlay),
      runsOnPlay: mRefs(pa.runsOnPlay),
      prevCur: pa.prevCur ? { ...pa.prevCur, bases: mBases(pa.prevCur.bases) } : pa.prevCur
    })),
    runnerEvents: (game.runnerEvents || []).map((ev) => ({
      ...ev,
      ref: m(ev.ref),
      moves: (ev.moves || []).map((mv) => ({ ...mv, ref: m(mv.ref) })),
      basesBefore: mBases(ev.basesBefore),
      basesAfter: mBases(ev.basesAfter),
      outsOnPlay: mRefs(ev.outsOnPlay),
      runsOnPlay: mRefs(ev.runsOnPlay),
      prevCur: ev.prevCur ? { ...ev.prevCur, bases: mBases(ev.prevCur.bases) } : ev.prevCur
    })),
    cur: game.cur ? { ...game.cur, bases: mBases(game.cur.bases) } : game.cur,
    defense: (game.defense || []).map((d) => ({
      inning: d.inning,
      map: Object.fromEntries(Object.entries(d.map || {}).map(([k, v]) => [k, m(v)]))
    })),
    scorers: (game.scorers || []).map((s) => ({ ...s, playerId: m(s.playerId) })),
    steals: (game.steals || []).map((s) => ({ ...s, playerId: m(s.playerId) }))
  };
}

/**
 * バックアップ／試合ファイルを取り込む。
 * @param {File} file
 * @param {'merge'|'replace'} mode
 */
export async function importFile(file, mode = 'merge') {
  const text = await file.text();
  const data = parseBackup(text);

  if (mode === 'replace') {
    // 置き換えは ID の付け替えをせず、そのまま入れる
    const { dbClear } = await import('./db.js');
    await dbClear(STORE_PLAYERS);
    await dbClear(STORE_GAMES);
    await dbClear(STORE_PERSONAL);
    await dbBulkPut(STORE_PLAYERS, data.players);
    await dbBulkPut(STORE_GAMES, data.games);
    await dbBulkPut(STORE_PERSONAL, data.personal);
    if (data.settings) await saveSettings(data.settings);
    await loadAll();
    return { players: data.players.length, games: data.games.length, personal: data.personal.length, mode };
  }

  const { map, toCreate } = remapPlayers(data.players);
  const games = data.games.map((g) => applyRemap(g, map));
  const personal = data.personal.map((r) => ({
    ...r, playerId: map.has(r.playerId) ? map.get(r.playerId) : r.playerId
  }));

  // 既存の選手情報は上書きしない（引退フラグや過去成績を壊さないため）
  if (toCreate.length) await dbBulkPut(STORE_PLAYERS, toCreate);
  if (games.length) await dbBulkPut(STORE_GAMES, games);
  if (personal.length) await dbBulkPut(STORE_PERSONAL, personal);
  await loadAll();
  return {
    players: toCreate.length, games: games.length, personal: personal.length,
    mode, matched: data.players.length - toCreate.length
  };
}

/** 取り込み前に中身を要約して確認してもらう */
export async function importWithConfirm() {
  const file = await pickFile();
  if (!file) return null;

  let data;
  try { data = parseBackup(await file.text()); }
  catch (err) { await alertSheet(err.message, { title: '取り込めません' }); return null; }

  const dup = data.games.filter((g) => state.games.some((x) => x.id === g.id));
  const isFull = data.kind === 'full';

  const body = html`
    <div class="card card-pad" style="margin:0 0 12px">
      <div class="small muted">ファイル</div>
      <div style="font-weight:700;word-break:break-all">${file.name}</div>
      <div class="small muted" style="margin-top:8px">
        種類：${isFull ? '全データのバックアップ' : '試合データ'}<br>
        書き出し日時：${data.exportedAt ? new Date(data.exportedAt).toLocaleString('ja-JP') : '不明'}<br>
        選手 ${data.players.length}人 ・ 試合 ${data.games.length}件${data.personal.length ? ` ・ 個人記録 ${data.personal.length}件` : ''}
      </div>
    </div>
    ${data.games.length ? html`<div class="card"><ul class="list">
      ${raw(data.games.slice(0, 8).map((g) => `<li class="row" style="min-height:0">
        <div class="row-main"><div class="row-sub">${esc(formatDate(g.date))} vs ${esc(g.opponent || '相手')}
        ${state.games.some((x) => x.id === g.id) ? '<span class="badge badge-warn">既存を上書き</span>' : ''}</div></div>
      </li>`).join(''))}
      ${data.games.length > 8 ? raw(`<li class="row" style="min-height:0"><div class="row-sub muted">ほか ${data.games.length - 8}件</div></li>`) : ''}
    </ul></div>` : ''}
    ${dup.length ? html`<p class="small" style="color:var(--warn)">同じ試合が${dup.length}件あります。取り込むと上書きされます。</p>` : ''}
  `;

  const actions = [{ label: 'キャンセル', value: null }];
  if (isFull) actions.push({ label: '全消しして復元', value: 'replace', kind: 'danger' });
  actions.push({ label: '追加して取り込む', value: 'merge', kind: 'primary' });

  const mode = await sheet({ title: 'データの取り込み', body, actions });
  if (!mode) return null;

  if (mode === 'replace') {
    const ok = await confirmSheet(
      '今この端末にあるデータをすべて削除し、ファイルの内容で置き換えます。よろしいですか？',
      { title: '最終確認', okLabel: '置き換える', danger: true });
    if (!ok) return null;
  }

  try {
    const r = await importFile(file, mode);
    await alertSheet(
      mode === 'replace'
        ? `復元しました。\n選手 ${r.players}人 / 試合 ${r.games}件 / 個人記録 ${r.personal}件`
        : `取り込みました。\n新規に追加した選手 ${r.players}人（既存と一致 ${r.matched}人）\n試合 ${r.games}件 / 個人記録 ${r.personal}件`,
      { title: '完了' });
    return r;
  } catch (err) {
    await alertSheet(err.message || '取り込みに失敗しました', { title: 'エラー' });
    return null;
  }
}

/* ---------------- バックアップ日時の管理 ---------------- */

export async function markBackedUp() {
  await setMeta('lastBackupAt', new Date().toISOString());
}

export async function lastBackupAt() {
  return getMeta('lastBackupAt', null);
}

export async function daysSinceBackup() {
  const at = await lastBackupAt();
  if (!at) return null;
  const ms = Date.now() - new Date(at).getTime();
  return Math.floor(ms / 86400000);
}

/**
 * 未バックアップの警告を出すべきか。
 * 一度も取っていない場合は、記録が1件でもあれば警告する。
 */
export async function backupWarning() {
  if (!state.games.length && !state.players.length && !state.personal.length) return null;
  const days = await daysSinceBackup();
  const limit = Number(state.settings.backupWarnDays) || 7;
  if (days == null) return { level: 'never', message: 'まだ一度もバックアップしていません' };
  if (days >= limit) return { level: 'stale', days, message: `最後のバックアップから${days}日経過しています` };
  return null;
}
