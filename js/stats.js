/* 成績集計。
   アプリで記録した打席（games）と、導入以前の手入力成績（player.legacy）の
   両方を同じ形に正規化してから合算する。 */

import { RESULT_BY_CODE, battingSide, fielderAt, seasonOf, pitcherAt } from './model.js';

/**
 * そのプレーで失策を記録された自チーム選手の一覧。
 * 複数の失策が重なった場合はその数だけ返す。
 */
export function errorFielders(game, item) {
  const out = [];
  if (item.errors && item.errors.length) {
    for (const e of item.errors) {
      const pid = e.playerId || fielderAt(game, item.inning, e.pos);
      if (pid) out.push(pid);
    }
    return out;
  }
  // 失策を個別に持たせる前の形式：打席結果が「失策」なら打球方向の野手に付ける
  const r = RESULT_BY_CODE[item.result];
  if (r && r.isError) {
    const pid = item.errorBy || fielderAt(game, item.inning, item.dir);
    if (pid) out.push(pid);
  }
  return out;
}

/** 集計項目。手入力フォームもこの並びを流用する。 */
export const BAT_FIELDS = [
  'G', 'PA', 'AB', 'H', 'H1', 'H2', 'H3', 'HR', 'TB',
  'RBI', 'R', 'BB', 'IBB', 'HBP', 'SO', 'SH', 'SF', 'CI',
  'SB', 'CS', 'GIDP', 'ROE', 'E'
];

/** 過去成績として手入力してもらう項目（H1 と TB は自動計算するので除く） */
export const LEGACY_FIELDS = [
  { key: 'G',   label: '試合' },
  { key: 'PA',  label: '打席', hint: '空欄なら自動計算' },
  { key: 'AB',  label: '打数' },
  { key: 'H',   label: '安打' },
  { key: 'H2',  label: '二塁打' },
  { key: 'H3',  label: '三塁打' },
  { key: 'HR',  label: '本塁打' },
  { key: 'RBI', label: '打点' },
  { key: 'R',   label: '得点' },
  { key: 'BB',  label: '四球' },
  { key: 'HBP', label: '死球' },
  { key: 'SO',  label: '三振' },
  { key: 'SH',  label: '犠打' },
  { key: 'SF',  label: '犠飛' },
  { key: 'SB',  label: '盗塁' },
  { key: 'CS',  label: '盗塁死' },
  { key: 'GIDP', label: '併殺打' },
  { key: 'E',   label: '失策' }
];

export function emptyBat() {
  const o = {};
  for (const f of BAT_FIELDS) o[f] = 0;
  return o;
}

export function addBat(a, b) {
  for (const f of BAT_FIELDS) a[f] += b[f] || 0;
  return a;
}

/* ---------------- 打席から積み上げる ---------------- */

function applyPA(acc, pa) {
  const r = RESULT_BY_CODE[pa.result];
  if (!r) return;
  acc.PA += 1;
  if (r.ab) acc.AB += 1;
  acc.TB += r.tb || 0;
  if (r.tb > 0) {
    acc.H += 1;
    if (r.code === '1B') acc.H1 += 1;
    else if (r.code === '2B') acc.H2 += 1;
    else if (r.code === '3B') acc.H3 += 1;
    else if (r.code === 'HR') acc.HR += 1;
  }
  if (r.code === 'BB') acc.BB += 1;
  if (r.code === 'IBB') { acc.BB += 1; acc.IBB += 1; }
  if (r.code === 'HBP') acc.HBP += 1;
  if (r.code === 'SO') acc.SO += 1;
  if (r.code === 'SH') acc.SH += 1;
  if (r.code === 'SF') acc.SF += 1;
  if (r.code === 'CI') acc.CI += 1;
  if (r.code === 'DP') acc.GIDP += 1;
  if (r.code === 'E') acc.ROE += 1;
  acc.RBI += pa.rbi || 0;
}

/**
 * 1試合分を選手ごとの成績に積む。
 * @param {Map<string,object>} into playerId -> bat
 */
export function accumulateGame(into, game) {
  const seen = new Set();
  const get = (pid) => {
    if (!into.has(pid)) into.set(pid, emptyBat());
    return into.get(pid);
  };

  for (const pa of game.pas || []) {
    const side = battingSide(game, pa.half);
    if (side === 'our') {
      // 自チームの打撃
      if (!pa.playerId) continue;
      const acc = get(pa.playerId);
      applyPA(acc, pa);
      seen.add(pa.playerId);
    } else {
      // 相手の打撃＝自チームが守備。失策は守っていた選手に付ける
      for (const pid of errorFielders(game, pa)) get(pid).E += 1;
    }
  }

  // 走塁中の失策（送球エラーで進塁されたなど）も自チームの守備時のみ数える
  for (const ev of game.runnerEvents || []) {
    if (ev.side === 'opp') for (const pid of errorFielders(game, ev)) get(pid).E += 1;
  }

  // 得点（走者が本塁に到達したときに自動記録される）
  for (const s of game.scorers || []) {
    if (s.side === 'our' && s.playerId) { get(s.playerId).R += 1; seen.add(s.playerId); }
  }

  // 盗塁・盗塁死（走者ごとの記録区分で判定する）
  for (const ev of game.runnerEvents || []) {
    if (ev.side !== 'our') continue;
    if (ev.moves) {
      for (const mv of ev.moves) {
        if (!mv.ref) continue;
        if (mv.credit === 'SB') { get(mv.ref).SB += 1; seen.add(mv.ref); }
        else if (mv.credit === 'CS') { get(mv.ref).CS += 1; seen.add(mv.ref); }
      }
      continue;
    }
    // 走者ごとの区分を持たせる前の形式
    if (!ev.ref) continue;
    if (ev.kind === 'SB') { get(ev.ref).SB += 1; seen.add(ev.ref); }
    else if (ev.kind === 'CS') { get(ev.ref).CS += 1; seen.add(ev.ref); }
  }

  // 旧形式（走者管理を入れる前に記録した盗塁）
  for (const s of game.steals || []) {
    if (!s.playerId) continue;
    const acc = get(s.playerId);
    if (s.kind === 'CS') acc.CS += 1; else acc.SB += 1;
    seen.add(s.playerId);
  }

  // 出場試合数：打席に立った選手に加え、打順に入っていた選手も出場扱いにする
  for (const e of game.lineup || []) if (e.playerId) seen.add(e.playerId);
  for (const pid of seen) get(pid).G += 1;

  return into;
}

/* ---------------- 手入力の過去成績 ---------------- */

/** 手入力レコードを集計フォーマットに正規化する（欠損は補完） */
export function normalizeLegacy(rec) {
  const o = emptyBat();
  for (const f of BAT_FIELDS) o[f] = Number(rec[f]) || 0;
  // 単打と塁打は入力させず自動計算
  o.H1 = Math.max(0, o.H - o.H2 - o.H3 - o.HR);
  o.TB = o.H1 + o.H2 * 2 + o.H3 * 3 + o.HR * 4;
  // 打席が空欄なら打数＋四死球＋犠打犠飛から補う
  if (!o.PA) o.PA = o.AB + o.BB + o.HBP + o.SH + o.SF + o.CI;
  return o;
}

/* ==================== 個人成績モード ==================== */

/** 打席の配列から打撃成績を作る（走者管理を持たない個人記録用） */
export function battingFromPAs(pas) {
  const acc = emptyBat();
  for (const pa of pas || []) applyPA(acc, pa);
  return acc;
}

/** 個人記録1件ぶんの打撃成績。入力方式の違いを吸収する。 */
export function personalBatting(rec) {
  if (!rec) return emptyBat();
  const bat = rec.source === 'manual'
    ? normalizeLegacy(rec.bat || {})
    : battingFromPAs(rec.pas);
  // 得点・盗塁など打席から出せないものは記録側の値を足す
  const extra = rec.extra || {};
  for (const k of ['R', 'SB', 'CS', 'E']) bat[k] += Number(extra[k]) || 0;
  bat.G = 1;
  return bat;
}

/** 個人記録の簡易投手成績を集計フォーマットに直す */
export function personalPitching(rec) {
  const p = emptyPitch();
  const src = rec && rec.pitch;
  if (!src) return null;
  p.outs = (Number(src.ipWhole) || 0) * 3 + (Number(src.ipThird) || 0);
  for (const k of ['BF', 'H', 'HR', 'SO', 'BB', 'HBP', 'R', 'ER']) p[k] = Number(src[k]) || 0;
  if (!p.outs && !p.BF && !p.H && !p.SO && !p.R) return null;   // 実質未入力
  p.AB = Math.max(0, p.BF - p.BB - p.HBP);
  if (src.decision === 'W') p.W = 1;
  else if (src.decision === 'L') p.L = 1;
  else if (src.decision === 'SV') p.SV = 1;
  p.G = 1;
  return p;
}

/**
 * 個人記録をまとめる。
 * @param {Array} records 対象選手の個人記録
 * @param {object} opts { season: number|null }
 */
export function aggregatePersonal(records, opts = {}) {
  const { season = null } = opts;
  const bat = emptyBat();
  const pitch = emptyPitch();
  let games = 0;
  let pitchGames = 0;

  for (const r of records) {
    if (season != null && seasonOf(r.date) !== season) continue;
    addBat(bat, personalBatting(r));
    games += 1;
    const p = personalPitching(r);
    if (p) { addPitch(pitch, p); pitchGames += 1; }
  }
  bat.G = games;
  pitch.G = pitchGames;
  return { bat, pitch, games, pitchGames };
}

/** 個人記録がある年度の一覧（新しい順） */
export function personalSeasons(records) {
  const set = new Set();
  for (const r of records) set.add(seasonOf(r.date));
  return [...set].filter(Number.isFinite).sort((a, b) => b - a);
}

/* ---------------- チームの試合と個人記録の結び付け ----------------
   同じ選手の成績が「チームのスコア」と「個人記録」の両方にあるとき、
   同じ試合を二重に数えないための判定。チーム側の方が詳しい（走者・投手まで
   持つ）ので、重複していればチーム側を採り、個人記録は集計から外す。 */

function normTeam(s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); }

/** その選手がそのチームの試合に出場したか */
export function playedIn(game, playerId) {
  return (game.lineup || []).some((e) => e.playerId === playerId)
    || (game.pas || []).some((p) => p.playerId === playerId);
}

/** 個人記録と同じ試合と思われるチームの試合（日付が同じで、相手名が食い違わないもの） */
export function matchingTeamGame(rec, games) {
  return (games || []).find((g) =>
    g.date === rec.date && playedIn(g, rec.playerId)
    && (!rec.opponent || !g.opponent || normTeam(rec.opponent) === normTeam(g.opponent))) || null;
}

/**
 * 個人記録を集計に入れるかどうか。
 * rec.link: 'auto'（既定。重複なら外す）| 'include'（常に数える）| 'exclude'（数えない）
 */
export function personalLinkStatus(rec, games) {
  const game = matchingTeamGame(rec, games);
  const mode = rec.link || 'auto';
  const counted = mode === 'include' ? true : mode === 'exclude' ? false : !game;
  return { counted, duplicate: !!game, game, mode };
}

/** 集計に入れる個人記録だけを返す */
export function countedPersonal(personal, games) {
  return (personal || []).filter((r) => personalLinkStatus(r, games).counted);
}

/**
 * 1人の選手の成績を、チームの試合・個人記録・手入力の過去成績から合算する。
 * 個人成績画面とチームの成績画面で同じ数字になるよう、同じ規則で数える。
 */
export function aggregatePlayerAll(playerId, opts = {}) {
  const {
    games = [], personal = [], players = [],
    season = null, includeTeam = true, includeLegacy = true
  } = opts;
  const bat = emptyBat();
  const pitch = emptyPitch();
  let teamGames = 0;
  let personalGames = 0;
  let legacyGames = 0;
  let pitchGames = 0;

  if (includeTeam) {
    for (const g of games) {
      if (season != null && seasonOf(g.date) !== season) continue;
      if (!playedIn(g, playerId)) continue;
      const bm = new Map();
      accumulateGame(bm, g);
      const b = bm.get(playerId);
      if (b) addBat(bat, b);
      teamGames += 1;
      const pm = new Map();
      accumulatePitching(pm, g);
      const p = pm.get(playerId);
      if (p) { addPitch(pitch, p); pitchGames += 1; }
    }
  }

  const mine = (personal || []).filter((r) => r.playerId === playerId);
  for (const r of includeTeam ? countedPersonal(mine, games) : mine) {
    if (season != null && seasonOf(r.date) !== season) continue;
    addBat(bat, personalBatting(r));
    personalGames += 1;
    const p = personalPitching(r);
    if (p) { addPitch(pitch, p); pitchGames += 1; }
  }

  if (includeLegacy) {
    const pl = (players || []).find((x) => x.id === playerId);
    for (const rec of (pl && pl.legacy) || []) {
      if (season != null && Number(rec.season) !== season) continue;
      const n = normalizeLegacy(rec);
      addBat(bat, n);
      legacyGames += n.G;
      const p = normalizeLegacyPitch(rec);
      if (p) { addPitch(pitch, p); pitchGames += p.G; }
    }
  }

  const gamesN = teamGames + personalGames + legacyGames;
  bat.G = gamesN;
  pitch.G = pitchGames;
  return { bat, pitch, games: gamesN, pitchGames, teamGames, personalGames, legacyGames };
}

/* ---------------- レート計算 ---------------- */

export function rates(b) {
  const obpDen = b.AB + b.BB + b.HBP + b.SF;
  return {
    avg: b.AB > 0 ? b.H / b.AB : null,
    obp: obpDen > 0 ? (b.H + b.BB + b.HBP) / obpDen : null,
    slg: b.AB > 0 ? b.TB / b.AB : null,
    get ops() { return this.obp == null || this.slg == null ? null : this.obp + this.slg; }
  };
}

/** 野球式の率表記（.333 / 1.000）。null は "-"。 */
export function fmtRate(v) {
  if (v == null || !isFinite(v)) return '-';
  const s = v.toFixed(3);
  return v < 1 ? s.replace(/^0/, '') : s;
}

/* ---------------- まとめ ---------------- */

/**
 * 選手ごとの成績を集計する。
 * @param {Array} games   対象試合
 * @param {Array} players 全選手（legacy を持つ）
 * @param {object} opts   { season: number|null, includeLegacy: boolean }
 * @returns {Map<string,{bat, fromApp, fromLegacy}>}
 */
export function aggregate(games, players, opts = {}) {
  const { season = null, includeLegacy = true, personal = [] } = opts;

  const appMap = new Map();
  for (const g of games) {
    if (season != null && seasonOf(g.date) !== season) continue;
    accumulateGame(appMap, g);
  }

  const out = new Map();
  for (const [pid, bat] of appMap) {
    out.set(pid, { bat: addBat(emptyBat(), bat), fromApp: true, fromLegacy: false });
  }

  if (includeLegacy) {
    for (const p of players) {
      for (const rec of p.legacy || []) {
        if (season != null && Number(rec.season) !== season) continue;
        const norm = normalizeLegacy(rec);
        if (!out.has(p.id)) out.set(p.id, { bat: emptyBat(), fromApp: false, fromLegacy: false });
        const e = out.get(p.id);
        addBat(e.bat, norm);
        e.fromLegacy = true;
      }
    }
  }

  // 個人成績モードの記録（チームの試合と重複するものは除く）
  for (const r of countedPersonal(personal, games)) {
    if (season != null && seasonOf(r.date) !== season) continue;
    if (!out.has(r.playerId)) out.set(r.playerId, { bat: emptyBat(), fromApp: false, fromLegacy: false });
    const e = out.get(r.playerId);
    addBat(e.bat, personalBatting(r));
    e.fromPersonal = true;
  }

  return out;
}

/** データが存在する年度の一覧（新しい順） */
export function seasonsOf(games, players, personal = []) {
  const set = new Set();
  for (const g of games) set.add(seasonOf(g.date));
  for (const p of players) for (const r of p.legacy || []) set.add(Number(r.season));
  for (const r of personal || []) set.add(seasonOf(r.date));
  return [...set].filter((n) => Number.isFinite(n)).sort((a, b) => b - a);
}

/** 規定打席。season が null（通算）の場合は対象試合数から計算する。 */
export function qualifiedPA(settings, gameCount) {
  if (!settings) return 0;
  if (settings.qualMode === 'fixed') return Number(settings.qualFixed) || 0;
  return Math.ceil((Number(settings.qualFactor) || 0) * gameCount);
}

/* ==================== 投手成績 ==================== */

export const PITCH_FIELDS = [
  'G', 'BF', 'outs', 'AB', 'H', 'HR', 'SO', 'BB', 'HBP', 'R', 'ER', 'W', 'L', 'SV'
];

export function emptyPitch() {
  const o = {};
  for (const f of PITCH_FIELDS) o[f] = 0;
  return o;
}

export function addPitch(a, b) {
  for (const f of PITCH_FIELDS) a[f] += b[f] || 0;
  return a;
}

/** 投球回の表示（1/3 単位。例: 5回2/3） */
export function formatIP(outs) {
  const ip = Math.floor(outs / 3);
  const rest = outs % 3;
  if (!rest) return `${ip}`;
  return `${ip}${rest === 1 ? ' 1/3' : ' 2/3'}`;
}

/** 1試合分の投手成績を投手ごとに積む */
export function accumulatePitching(into, game) {
  const get = (pid) => {
    if (!into.has(pid)) into.set(pid, emptyPitch());
    return into.get(pid);
  };
  const appeared = new Set();

  for (const pa of game.pas || []) {
    if (pa.side !== 'opp') continue;          // 自チームが守っている時だけ
    const pid = pitcherAt(game, pa.seq, pa.inning);
    if (!pid) continue;
    const acc = get(pid);
    appeared.add(pid);

    const r = RESULT_BY_CODE[pa.result];
    acc.BF += 1;
    acc.outs += pa.outs || 0;
    acc.R += (pa.runsOnPlay || []).length;
    if (r) {
      if (r.ab) acc.AB += 1;
      if (r.tb > 0) acc.H += 1;
      if (r.code === 'HR') acc.HR += 1;
      if (r.code === 'SO') acc.SO += 1;
      if (r.code === 'BB' || r.code === 'IBB') acc.BB += 1;
      if (r.code === 'HBP') acc.HBP += 1;
    }
  }

  // 走塁でのアウト・得点も投手に付く
  for (const ev of game.runnerEvents || []) {
    if (ev.side !== 'opp') continue;
    const pid = pitcherAt(game, ev.seq, ev.inning);
    if (!pid) continue;
    const acc = get(pid);
    appeared.add(pid);
    acc.outs += (ev.outsOnPlay || []).length;
    acc.R += (ev.runsOnPlay || []).length;
  }

  // 自責点と勝敗は手入力を優先（未入力なら自責点＝失点とみなす）
  for (const pid of appeared) {
    const acc = get(pid);
    const manual = (game.pitching || {})[pid] || {};
    acc.ER = manual.er == null ? acc.R : Number(manual.er) || 0;
    if (manual.decision === 'W') acc.W += 1;
    else if (manual.decision === 'L') acc.L += 1;
    else if (manual.decision === 'SV') acc.SV += 1;
    acc.G += 1;
  }

  return into;
}

/** 防御率・WHIP など */
export function pitchRates(p, eraInnings = 9) {
  const ip = p.outs / 3;
  return {
    era: ip > 0 ? (p.ER * eraInnings) / ip : null,
    whip: ip > 0 ? (p.H + p.BB + p.HBP) / ip : null,
    avg: p.AB > 0 ? p.H / p.AB : null,
    k9: ip > 0 ? (p.SO * eraInnings) / ip : null
  };
}

/** 小数2桁（防御率など）。null は "-"。 */
export function fmtNum(v, digits = 2) {
  if (v == null || !isFinite(v)) return '-';
  return v.toFixed(digits);
}

/** 手入力した過去の投手成績を集計フォーマットに直す */
export function normalizeLegacyPitch(rec) {
  const src = rec && rec.pitch;
  if (!src) return null;
  const p = emptyPitch();
  p.outs = (Number(src.ipWhole) || 0) * 3 + (Number(src.ipThird) || 0);
  for (const k of ['G', 'BF', 'H', 'HR', 'SO', 'BB', 'HBP', 'R', 'ER', 'W', 'L', 'SV']) {
    p[k] = Number(src[k]) || 0;
  }
  // 何も入っていなければ登板なしとみなす
  if (!p.outs && !p.G && !p.BF && !p.H && !p.SO && !p.R) return null;
  p.AB = Math.max(0, p.BF - p.BB - p.HBP);
  return p;
}

/**
 * 投手成績をまとめる。手入力した過去成績（player.legacy[].pitch）も合算する。
 * @param {Array} games   全試合（season で絞る）
 * @param {Array} players 全選手（legacy を持つ）
 */
export function aggregatePitching(games, players = [], opts = {}) {
  const { season = null, includeLegacy = true, personal = [] } = opts;
  const map = new Map();
  for (const g of games) {
    if (season != null && seasonOf(g.date) !== season) continue;
    accumulatePitching(map, g);
  }

  if (includeLegacy) {
    for (const p of players) {
      for (const rec of p.legacy || []) {
        if (season != null && Number(rec.season) !== season) continue;
        const norm = normalizeLegacyPitch(rec);
        if (!norm) continue;
        if (!map.has(p.id)) map.set(p.id, emptyPitch());
        addPitch(map.get(p.id), norm);
      }
    }
  }

  for (const r of countedPersonal(personal, games)) {
    if (season != null && seasonOf(r.date) !== season) continue;
    const p = personalPitching(r);
    if (!p) continue;
    if (!map.has(r.playerId)) map.set(r.playerId, emptyPitch());
    addPitch(map.get(r.playerId), p);
  }
  return map;
}

/* ==================== 守備（失策） ==================== */

export function emptyField() {
  return { E: 0, catch: 0, throw: 0, other: 0, byPos: {} };
}

/** そのプレーの失策を {playerId, pos, type} の形で列挙する */
function listErrors(game, item) {
  const out = [];
  if (item.errors && item.errors.length) {
    for (const e of item.errors) {
      const pid = e.playerId || fielderAt(game, item.inning, e.pos);
      if (pid) out.push({ playerId: pid, pos: e.pos, type: e.type || 'other' });
    }
    return out;
  }
  const r = RESULT_BY_CODE[item.result];
  if (r && r.isError) {
    const pid = item.errorBy || fielderAt(game, item.inning, item.dir);
    if (pid) out.push({ playerId: pid, pos: item.dir, type: 'other' });
  }
  return out;
}

export function accumulateFielding(into, game) {
  const get = (pid) => {
    if (!into.has(pid)) into.set(pid, emptyField());
    return into.get(pid);
  };
  const apply = (item) => {
    for (const e of listErrors(game, item)) {
      const acc = get(e.playerId);
      acc.E += 1;
      acc[e.type === 'catch' ? 'catch' : e.type === 'throw' ? 'throw' : 'other'] += 1;
      if (e.pos) acc.byPos[e.pos] = (acc.byPos[e.pos] || 0) + 1;
    }
  };

  for (const pa of game.pas || []) if (pa.side === 'opp') apply(pa);
  for (const ev of game.runnerEvents || []) if (ev.side === 'opp') apply(ev);
  return into;
}

/** 守備（失策）をまとめる。手入力の過去成績の失策数も合算する。 */
export function aggregateFielding(games, players = [], opts = {}) {
  const { season = null, includeLegacy = true, personal = [] } = opts;
  const map = new Map();
  for (const g of games) {
    if (season != null && seasonOf(g.date) !== season) continue;
    accumulateFielding(map, g);
  }

  if (includeLegacy) {
    for (const p of players) {
      for (const rec of p.legacy || []) {
        if (season != null && Number(rec.season) !== season) continue;
        const e = Number(rec.E) || 0;
        if (!e) continue;
        if (!map.has(p.id)) map.set(p.id, emptyField());
        const acc = map.get(p.id);
        acc.E += e;
        acc.other += e;   // 手入力は種類・位置の内訳を持たない
        acc.legacy = (acc.legacy || 0) + e;
      }
    }
  }

  for (const r of countedPersonal(personal, games)) {
    if (season != null && seasonOf(r.date) !== season) continue;
    const e = Number((r.extra || {}).E) || 0;
    if (!e) continue;
    if (!map.has(r.playerId)) map.set(r.playerId, emptyField());
    const acc = map.get(r.playerId);
    acc.E += e;
    acc.other += e;
  }
  return map;
}

/** 1試合分の投手成績（試合詳細の表示用） */
export function gamePitching(game) {
  const m = new Map();
  accumulatePitching(m, game);
  return m;
}

/** 1試合分の個人成績（試合詳細の表示用） */
export function gameBatting(game) {
  const m = new Map();
  accumulateGame(m, game);
  return m;
}

/** 打席結果を「4打数2安打」のような1行に要約する */
export function summarizeLine(bat) {
  if (!bat) return '';
  const parts = [`${bat.AB}打数${bat.H}安打`];
  if (bat.HR) parts.push(`本${bat.HR}`);
  if (bat.RBI) parts.push(`点${bat.RBI}`);
  if (bat.BB + bat.HBP) parts.push(`四死${bat.BB + bat.HBP}`);
  if (bat.SO) parts.push(`三振${bat.SO}`);
  return parts.join(' ');
}
