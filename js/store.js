/* データアクセス層。メモリ上にキャッシュを持ち、変更のたびに IndexedDB へ書き戻す。 */

import {
  STORE_PLAYERS, STORE_GAMES, STORE_META, STORE_PERSONAL,
  dbGetAll, dbGet, dbPut, dbDelete, uid
} from './db.js';
import {
  DEFAULT_SETTINGS, activeLineup, battingSide, RESULT_BY_CODE,
  oppLineup, activeOppLineup, oppOrderMax
} from './model.js';
import { emptyBases, cloneBases, defaultPlan, applyPlan, defaultRbi, movesOf, HOME, OUT } from './runners.js';

export const state = {
  players: [],
  games: [],
  personal: [],
  settings: { ...DEFAULT_SETTINGS },
  loaded: false
};

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) fn(); }

export async function loadAll() {
  const [players, games, personal, meta] = await Promise.all([
    dbGetAll(STORE_PLAYERS),
    dbGetAll(STORE_GAMES),
    dbGetAll(STORE_PERSONAL),
    dbGet(STORE_META, 'settings')
  ]);
  state.players = players || [];
  state.games = games || [];
  state.personal = personal || [];
  state.settings = { ...DEFAULT_SETTINGS, ...((meta && meta.v) || {}) };
  state.loaded = true;
  sortGames();
  sortPersonal();
  return state;
}

function byDateDesc(a, b) {
  return (b.date || '').localeCompare(a.date || '')
    || (b.createdAt || '').localeCompare(a.createdAt || '');
}

function sortGames() { state.games.sort(byDateDesc); }
function sortPersonal() { state.personal.sort(byDateDesc); }

/* ---------------- 設定 ---------------- */

export async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await dbPut(STORE_META, { k: 'settings', v: state.settings });
  emit();
  return state.settings;
}

export async function getMeta(key, fallback = null) {
  const r = await dbGet(STORE_META, key);
  return r ? r.v : fallback;
}

export async function setMeta(key, v) {
  await dbPut(STORE_META, { k: key, v });
  return v;
}

/* ---------------- 選手 ---------------- */

export function playerById(id) {
  return state.players.find((p) => p.id === id) || null;
}

export function playerName(id) {
  const p = playerById(id);
  return p ? p.name : '(不明)';
}

/** 表示用に並べ替えた選手一覧。既定では引退者を除く。 */
export function playersSorted({ includeRetired = false } = {}) {
  return state.players
    .filter((p) => includeRetired || !p.retired)
    .sort((a, b) => {
      if (!!a.retired !== !!b.retired) return a.retired ? 1 : -1;
      const an = Number(a.number), bn = Number(b.number);
      const aHas = a.number !== '' && a.number != null && isFinite(an);
      const bHas = b.number !== '' && b.number != null && isFinite(bn);
      if (aHas && bHas && an !== bn) return an - bn;
      if (aHas !== bHas) return aHas ? -1 : 1;
      return (a.name || '').localeCompare(b.name || '', 'ja');
    });
}

export async function savePlayer(p) {
  const rec = {
    id: p.id || uid('p'),
    name: (p.name || '').trim(),
    number: p.number == null ? '' : String(p.number).trim(),
    bats: p.bats || '',
    throws: p.throws || '',
    retired: !!p.retired,
    note: p.note || '',
    legacy: p.legacy || [],
    createdAt: p.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await dbPut(STORE_PLAYERS, rec);
  const i = state.players.findIndex((x) => x.id === rec.id);
  if (i >= 0) state.players[i] = rec; else state.players.push(rec);
  emit();
  return rec;
}

/**
 * 選手を消す。過去の試合で打席が記録されている場合、
 * 通算成績が失われるため物理削除せず引退フラグに切り替える。
 */
export async function removePlayer(id) {
  const used = state.games.some((g) =>
    (g.pas || []).some((pa) => pa.playerId === id) ||
    (g.lineup || []).some((e) => e.playerId === id));
  const hasLegacy = (playerById(id)?.legacy || []).length > 0;

  if (used || hasLegacy) {
    const p = playerById(id);
    await savePlayer({ ...p, retired: true });
    return { deleted: false, retired: true };
  }
  await dbDelete(STORE_PLAYERS, id);
  state.players = state.players.filter((p) => p.id !== id);
  emit();
  return { deleted: true, retired: false };
}

/* ---------------- 過去成績（手入力） ---------------- */

export async function saveLegacy(playerId, rec) {
  const p = playerById(playerId);
  if (!p) throw new Error('選手が見つかりません');
  const legacy = [...(p.legacy || [])];
  const season = Number(rec.season);
  const i = legacy.findIndex((r) => Number(r.season) === season && (rec.id ? r.id === rec.id : true));
  const row = { ...rec, id: rec.id || uid('l'), season };
  if (i >= 0) legacy[i] = row; else legacy.push(row);
  legacy.sort((a, b) => b.season - a.season);
  return savePlayer({ ...p, legacy });
}

export async function removeLegacy(playerId, legacyId) {
  const p = playerById(playerId);
  if (!p) return;
  return savePlayer({ ...p, legacy: (p.legacy || []).filter((r) => r.id !== legacyId) });
}

/* ---------------- 試合 ---------------- */

export function gameById(id) {
  return state.games.find((g) => g.id === id) || null;
}

export async function saveGame(g) {
  const rec = { ...g, id: g.id || uid('g'), updatedAt: new Date().toISOString() };
  await dbPut(STORE_GAMES, rec);
  const i = state.games.findIndex((x) => x.id === rec.id);
  if (i >= 0) state.games[i] = rec; else state.games.push(rec);
  sortGames();
  emit();
  return rec;
}

export async function removeGame(id) {
  await dbDelete(STORE_GAMES, id);
  state.games = state.games.filter((g) => g.id !== id);
  emit();
}

/* ---------------- 個人成績（個人成績モード） ---------------- */

export function personalById(id) {
  return state.personal.find((r) => r.id === id) || null;
}

export function personalOf(playerId) {
  return state.personal.filter((r) => r.playerId === playerId).sort(byDateDesc);
}

export async function savePersonal(rec) {
  const out = { ...rec, id: rec.id || uid('pg'), updatedAt: new Date().toISOString() };
  await dbPut(STORE_PERSONAL, out);
  const i = state.personal.findIndex((x) => x.id === out.id);
  if (i >= 0) state.personal[i] = out; else state.personal.push(out);
  sortPersonal();
  emit();
  return out;
}

export async function removePersonal(id) {
  await dbDelete(STORE_PERSONAL, id);
  state.personal = state.personal.filter((r) => r.id !== id);
  emit();
}

/** 個人記録に打席を1つ足す */
export async function addPersonalPA(rec, data) {
  const seq = (rec.pas || []).reduce((m, p) => Math.max(m, p.seq || 0), 0) + 1;
  const pa = {
    id: uid('ppa'),
    seq,
    result: data.result,
    dir: data.dir || null,
    rbi: data.rbi || 0,
    note: data.note || ''
  };
  rec.pas = [...(rec.pas || []), pa];
  return savePersonal(rec);
}

export async function updatePersonalPA(rec, paId, patch) {
  rec.pas = (rec.pas || []).map((p) => (p.id === paId ? { ...p, ...patch } : p));
  return savePersonal(rec);
}

export async function removePersonalPA(rec, paId) {
  rec.pas = (rec.pas || []).filter((p) => p.id !== paId);
  return savePersonal(rec);
}

/* ---------------- 打席の記録 ---------------- */

/** 次に打つ打順番号を求める（途中参加・離脱を考慮して巡回する） */
export function nextOurOrder(game, inning, fromOrder) {
  const act = activeLineup(game, inning);
  if (!act.length) return 1;
  const orders = act.map((e) => e.order);
  const bigger = orders.filter((o) => o > fromOrder);
  return bigger.length ? Math.min(...bigger) : Math.min(...orders);
}

/**
 * 相手の次の打者。
 * 人数が未確定のうちは打席が回るたびに新しい打者を増やしていく（メンバー表がないため）。
 * 確定後は、途中参加・離脱を考慮して巡回する。
 */
export function nextOppOrder(game, inning, fromOrder) {
  if (!game.oppFixed) return fromOrder + 1;
  const act = activeOppLineup(game, inning);
  if (!act.length) return 1;
  const orders = act.map((e) => e.order);
  const bigger = orders.filter((o) => o > fromOrder);
  return bigger.length ? Math.min(...bigger) : Math.min(...orders);
}

/** 相手打順にその番号の登録がなければ作る（打席が進むたびに増える運用のため） */
export async function ensureOppOrder(game, order, inning = 1) {
  const list = oppLineup(game);
  if (list.some((e) => e.order === order)) {
    game.oppLineup = list;
    return game;
  }
  game.oppLineup = [...list, { order, in: inning, out: null, name: '' }]
    .sort((a, b) => a.order - b.order);
  game.oppOrderCount = Math.max(game.oppOrderCount || 0, order);
  return game;
}

/** 実際に打席に立った相手打者の最大打順（＝確定すべき人数） */
export function oppBattedCount(game) {
  return (game.pas || [])
    .filter((p) => p.side === 'opp')
    .reduce((m, p) => Math.max(m, p.order || 0), 0);
}

/**
 * 相手の打順人数を確定する（1番に戻ったタイミングで押す想定）。
 * 打順が回るたびに次の打者を先に作っているため、確定時には
 * まだ打っていない打者が1人余分に残っている。これを取り除いてから確定する。
 */
export async function setOppFixed(game, fixed) {
  game.oppLineup = oppLineup(game);
  game.oppFixed = !!fixed;

  if (fixed) {
    const batted = oppBattedCount(game);
    if (batted > 0) {
      // 打席の記録も名前の登録もない、自動で先回りして作られた打者を落とす
      game.oppLineup = game.oppLineup.filter((e) => e.order <= batted || (e.name || '').trim());
      game.oppOrderCount = oppOrderMax(game);
      // 次打者が範囲外なら先頭に戻す
      const cur = game.cur || {};
      const orders = activeOppLineup(game, cur.inning || 1).map((e) => e.order);
      if (orders.length && !orders.includes(cur.oppOrder)) {
        game.cur = { ...cur, oppOrder: Math.min(...orders) };
      }
    } else {
      game.oppOrderCount = oppOrderMax(game);
    }
  }

  await saveGame(game);
  return game;
}

export async function saveOppLineup(game, list) {
  game.oppLineup = [...list].sort((a, b) => a.order - b.order);
  game.oppOrderCount = game.oppLineup.length
    ? Math.max(...game.oppLineup.map((e) => e.order)) : 0;
  await saveGame(game);
  return game;
}

/** 現在の打者（自チームなら lineup エントリ、相手なら打順番号） */
export function currentBatter(game) {
  const { inning, half } = game.cur;
  const side = battingSide(game, half);
  if (side === 'our') {
    const act = activeLineup(game, inning);
    if (!act.length) return { side, entry: null, order: null };
    let order = game.cur.ourOrder || 1;
    let entry = act.find((e) => e.order === order);
    if (!entry) {
      // 打者が離脱していたら次の有効な打順へ送る
      order = nextOurOrder(game, inning, order - 1);
      entry = act.find((e) => e.order === order) || act[0];
      order = entry.order;
    }
    return { side, entry, order };
  }
  return { side, entry: null, order: game.cur.oppOrder || 1 };
}

function advanceHalf(cur) {
  if (cur.half === 'top') { cur.half = 'bottom'; } else { cur.half = 'top'; cur.inning += 1; }
  cur.outs = 0;
  cur.bases = emptyBases();  // 攻守交代で走者はいなくなる
}

/** イニング別得点を増減する（0未満にはしない） */
function bumpRuns(game, side, inning, n) {
  if (!n) return;
  const runs = { our: [...(game.runs?.our || [])], opp: [...(game.runs?.opp || [])] };
  const idx = inning - 1;
  while (runs[side].length <= idx) runs[side].push(0);
  runs[side][idx] = Math.max(0, (runs[side][idx] || 0) + n);
  game.runs = runs;
}

/**
 * 本塁に到達した走者から得点を計上する。
 * 打点（rbi）とは独立：打点が付かない得点（失策・暴投など）も正しく数えるため。
 * @param {object} src runs 配列を持つもの（打席 または 走者イベント）
 */
function applyRunsFor(game, src, sign) {
  const runs = src.runsOnPlay || [];
  if (!runs.length) return;
  bumpRuns(game, src.side, src.inning, sign * runs.length);

  if (sign > 0) {
    const add = runs
      .filter((r) => src.side === 'our' && r.ref)
      .map((r) => ({ id: uid('s'), inning: src.inning, side: 'our', playerId: r.ref, auto: true, srcId: src.id }));
    game.scorers = [...(game.scorers || []), ...add];
  } else {
    game.scorers = (game.scorers || []).filter((s) => !(s.auto && s.srcId === src.id));
  }
}

/** 打者の走者識別子。自チームは選手 ID、相手は打順番号。 */
export function batterRef(side, order, playerId) {
  return side === 'our' ? (playerId || null) : String(order);
}

/**
 * 打席結果を追加する。
 * data.plan（進塁計画）が無ければ結果コードから既定の進塁を組み立てる。
 * cur は打席レコードの prevCur から丸ごと復元できるので、取り消しは塁状況まで元に戻る。
 */
export async function addPA(game, data) {
  const cur = { ...game.cur, bases: cloneBases(game.cur?.bases) };
  const side = battingSide(game, cur.half);
  const bRef = batterRef(side, data.order, data.playerId);

  const plan = data.plan || defaultPlan(data.result, cur.bases);
  const applied = applyPlan(cur.bases, bRef, plan);

  const pa = {
    id: uid('pa'),
    seq: nextSeq(game),
    inning: cur.inning,
    half: cur.half,
    side,
    order: data.order,
    playerId: side === 'our' ? (data.playerId || null) : null,
    batterRef: bRef,
    result: data.result,
    dir: data.dir || null,
    pitches: data.pitches != null ? data.pitches : null,
    count: data.count || null,
    errorBy: data.errorBy || null,
    errors: data.errors || [],      // 1プレーで重なった失策すべて
    basesBefore: cloneBases(cur.bases),
    basesAfter: applied.bases,
    plan,
    outsOnPlay: applied.outs,
    runsOnPlay: applied.runs,
    outs: applied.outs.length,
    rbi: data.rbi != null ? data.rbi : defaultRbi(data.result, applied.runs),
    note: data.note || '',
    prevCur: cur,
    createdAt: new Date().toISOString()
  };

  game.pas = [...(game.pas || []), pa];
  applyRunsFor(game, pa, 1);

  // 打順を進める
  const next = { ...cur };
  if (side === 'our') {
    next.ourOrder = nextOurOrder(game, cur.inning, data.order);
  } else {
    await ensureOppOrder(game, data.order, cur.inning);
    next.oppOrder = nextOppOrder(game, cur.inning, data.order);
    await ensureOppOrder(game, next.oppOrder, cur.inning);
  }

  next.bases = applied.bases;
  next.outs = (next.outs || 0) + pa.outs;
  if (next.outs >= 3) advanceHalf(next);
  game.cur = next;

  await saveGame(game);
  return pa;
}

/** 直前の打席を取り消す */
export async function undoLastPA(game) {
  const pas = [...(game.pas || [])].sort((a, b) => a.seq - b.seq);
  const last = pas.pop();
  if (!last) return null;
  game.pas = pas;
  applyRunsFor(game, last, -1);
  // prevCur には塁状況も入っているので、走者ごと打席前の状態に戻る
  if (last.prevCur) game.cur = { ...last.prevCur, bases: cloneBases(last.prevCur.bases) };
  await saveGame(game);
  return last;
}

/** 記録済みの打席を修正する（イニングの進行状態は変更しない） */
export async function updatePA(game, paId, patch) {
  const i = (game.pas || []).findIndex((p) => p.id === paId);
  if (i < 0) return null;
  const before = game.pas[i];
  const after = { ...before, ...patch };

  // 打点や結果が変わった分だけ得点を付け替える
  applyRunsFor(game, before, -1);
  applyRunsFor(game, after, 1);

  game.pas = [...game.pas];
  game.pas[i] = after;
  await saveGame(game);
  return after;
}

export async function deletePA(game, paId) {
  const pas = [...(game.pas || [])].sort((a, b) => a.seq - b.seq);
  const isLast = pas.length && pas[pas.length - 1].id === paId;
  if (isLast) return undoLastPA(game);
  const target = pas.find((p) => p.id === paId);
  game.pas = pas.filter((p) => p.id !== paId);
  if (target) applyRunsFor(game, target, -1);
  await saveGame(game);
  return null;
}

/* ---------------- 得点・イニング操作 ---------------- */

export async function addRun(game, side, inning, n = 1, playerId = null) {
  const runs = { our: [...(game.runs?.our || [])], opp: [...(game.runs?.opp || [])] };
  const idx = inning - 1;
  while (runs[side].length <= idx) runs[side].push(0);
  runs[side][idx] = Math.max(0, (runs[side][idx] || 0) + n);
  game.runs = runs;

  const scorers = [...(game.scorers || [])];
  if (n > 0 && playerId) {
    for (let i = 0; i < n; i++) scorers.push({ id: uid('s'), inning, side, playerId });
  } else if (n < 0) {
    // 直近の得点者記録から取り消す
    for (let i = 0; i < -n; i++) {
      const j = scorers.map((s) => s.side === side && s.inning === inning).lastIndexOf(true);
      if (j >= 0) scorers.splice(j, 1);
    }
  }
  game.scorers = scorers;

  await saveGame(game);
  return game;
}

/* ---------------- 走塁（打席によらない走者の動き） ---------------- */

/** 打席と走塁イベントを通した並び順。取り消しがどちらにも効くようにする。 */
function nextSeq(game) {
  const a = (game.pas || []).reduce((m, p) => Math.max(m, p.seq || 0), 0);
  const b = (game.runnerEvents || []).reduce((m, e) => Math.max(m, e.seq || 0), 0);
  return Math.max(a, b) + 1;
}

/**
 * 打席によらない走者の移動（盗塁・暴投・タッチアップなど）を記録する。
 * 複数の走者が同時に動く場合（重盗、ホームスチールへの便乗）にも対応するため、
 * 進塁計画をそのまま受け取り、走者ごとに記録区分（盗塁／進塁／盗塁死／走塁死）を持つ。
 * @param {object} opts { dest, outAt, credit } いずれも走者の塁番号をキーにする
 */
export async function applyRunnerMove(game, { dest, outAt = {}, credit = {}, cause = 'other', errors = [] }) {
  const cur = { ...game.cur, bases: cloneBases(game.cur?.bases) };
  const plan = { dest: { B: 0, ...dest }, outAt: { B: 0, ...outAt }, credit };
  const applied = applyPlan(cur.bases, null, plan);
  const moves = movesOf(cur.bases, plan);

  const ev = {
    id: uid('re'),
    seq: nextSeq(game),
    inning: cur.inning,
    half: cur.half,
    side: battingSide(game, cur.half),
    kind: 'RUN',
    cause,                       // 盗塁 / 暴投 / 捕逸 / 失策 / その他
    errors,
    moves,
    basesBefore: cloneBases(cur.bases),
    basesAfter: applied.bases,
    outsOnPlay: applied.outs,
    runsOnPlay: applied.runs,
    prevCur: cur,
    createdAt: new Date().toISOString()
  };

  game.runnerEvents = [...(game.runnerEvents || []), ev];
  applyRunsFor(game, ev, 1);

  const next = { ...cur, bases: applied.bases };
  next.outs = (next.outs || 0) + applied.outs.length;
  if (next.outs >= 3) advanceHalf(next);
  game.cur = next;

  await saveGame(game);
  return ev;
}

/** 打席・走塁イベントのうち、最後に記録したものを1つ取り消す */
export async function undoLast(game) {
  const lastPA = [...(game.pas || [])].sort((a, b) => a.seq - b.seq).pop();
  const lastEV = [...(game.runnerEvents || [])].sort((a, b) => a.seq - b.seq).pop();

  if (!lastPA && !lastEV) return null;
  const useEV = lastEV && (!lastPA || (lastEV.seq || 0) > (lastPA.seq || 0));

  if (useEV) {
    game.runnerEvents = (game.runnerEvents || []).filter((e) => e.id !== lastEV.id);
    applyRunsFor(game, lastEV, -1);
    if (lastEV.prevCur) game.cur = { ...lastEV.prevCur, bases: cloneBases(lastEV.prevCur.bases) };
    await saveGame(game);
    return { type: 'runner', item: lastEV };
  }

  const removed = await undoLastPA(game);
  return removed ? { type: 'pa', item: removed } : null;
}

/** 塁の状況を直接置き換える（記録漏れの補正用） */
export async function setBases(game, bases) {
  game.cur = { ...game.cur, bases: cloneBases(bases) };
  await saveGame(game);
  return game;
}

export async function setOuts(game, outs) {
  game.cur = { ...game.cur, outs: Math.max(0, Math.min(2, outs)) };
  await saveGame(game);
  return game;
}

/** 攻守交代（走塁死など打席結果に現れないアウトで交代する場合に使う） */
export async function forceHalfChange(game) {
  const cur = { ...game.cur };
  advanceHalf(cur);
  game.cur = cur;
  await saveGame(game);
  return game;
}

export async function gotoHalf(game, inning, half) {
  game.cur = { ...game.cur, inning, half, outs: 0 };
  await saveGame(game);
  return game;
}

/* ---------------- 守備配置 ---------------- */

/** そのイニングの守備変更を保存する（同一イニングの記録は置き換え） */
export async function setDefense(game, inning, map, roles = null) {
  const rest = (game.defense || []).filter((d) => d.inning !== inning);
  const prev = (game.defense || []).find((d) => d.inning === inning);
  game.defense = [...rest, {
    inning,
    map: { ...map },
    roles: roles ? { ...roles } : (prev?.roles || {})
  }].sort((a, b) => a.inning - b.inning);
  await saveGame(game);
  return game;
}

/* ---------------- 投手 ---------------- */

/**
 * 今この時点から投げる投手を記録する（イニング途中の交代に対応）。
 * 守備配置の投手も併せて入れ替える。
 */
export async function setPitcher(game, playerId, inning, { atSeq = null } = {}) {
  const { defenseAt, rolesAt, pitcherAt } = await import('./model.js');
  const seq = atSeq != null ? atSeq : nextSeq(game);
  const log = [...(game.pitcherLog || [])].filter((e) => e.seq !== seq);

  // 交代前の投手を基準として残しておく。
  // これが無いと、守備配置を書き換えた時点で交代前の打席まで
  // 新しい投手の記録に変わってしまう。
  if (!log.some((e) => e.seq < seq)) {
    const prev = pitcherAt(game, seq - 1, inning);
    if (prev && prev !== playerId) log.push({ seq: 0, playerId: prev, inning: 1 });
  }

  game.pitcherLog = [...log, { seq, playerId, inning }].sort((a, b) => a.seq - b.seq);

  const map = defenseAt(game, inning);
  for (const k of Object.keys(map)) if (map[k] === playerId) map[k] = '';
  map['1'] = playerId;
  const roles = rolesAt(game, inning);
  delete roles[playerId];
  return setDefense(game, inning, map, roles);
}

/** そのイニングで最初の（相手の）打席の通し番号。無ければ null。 */
export function firstSeqOfInning(game, inning) {
  const list = (game.pas || [])
    .filter((p) => p.inning === inning && p.side === 'opp')
    .sort((a, b) => a.seq - b.seq);
  return list.length ? list[0].seq : null;
}

/** 自責点・勝敗の手入力を保存する */
export async function setPitcherStat(game, playerId, patch) {
  const cur = { ...(game.pitching || {}) };
  cur[playerId] = { ...(cur[playerId] || {}), ...patch };
  game.pitching = cur;
  await saveGame(game);
  return game;
}

/** DH / 控え の区分を設定する（守備位置に就いている場合は外す） */
export async function setRole(game, inning, playerId, role) {
  const { defenseAt, rolesAt, ROLE_BENCH } = await import('./model.js');
  const map = defenseAt(game, inning);
  for (const k of Object.keys(map)) if (map[k] === playerId) map[k] = '';
  const roles = rolesAt(game, inning);
  if (role === ROLE_BENCH) roles[playerId] = ROLE_BENCH;
  else delete roles[playerId];   // DH は既定なので記録しない
  return setDefense(game, inning, map, roles);
}
