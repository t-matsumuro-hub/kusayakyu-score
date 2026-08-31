/* ドメイン定義（純粋なデータとロジックのみ。DOM に触れない）。 */

/* ---------------- 打席結果 ----------------
   ab      : 打数に数えるか
   onBase  : 出塁したか（出塁率の分子）
   outs    : 記録されるアウト数の既定値
   kind    : ボタンの色分け用
*/
export const RESULTS = [
  { code: '1B',  label: '安打',     short: '安',   kind: 'hit',  ab: true,  onBase: true,  tb: 1, outs: 0, needsDir: true },
  { code: '2B',  label: '二塁打',   short: '二',   kind: 'hit',  ab: true,  onBase: true,  tb: 2, outs: 0, needsDir: true },
  { code: '3B',  label: '三塁打',   short: '三',   kind: 'hit',  ab: true,  onBase: true,  tb: 3, outs: 0, needsDir: true },
  { code: 'HR',  label: '本塁打',   short: '本',   kind: 'hit',  ab: true,  onBase: true,  tb: 4, outs: 0, needsDir: true, minRbi: 1 },

  { code: 'BB',  label: '四球',     short: '四',   kind: 'walk', ab: false, onBase: true,  tb: 0, outs: 0 },
  { code: 'IBB', label: '敬遠',     short: '敬',   kind: 'walk', ab: false, onBase: true,  tb: 0, outs: 0 },
  { code: 'HBP', label: '死球',     short: '死',   kind: 'walk', ab: false, onBase: true,  tb: 0, outs: 0 },

  { code: 'SO',  label: '三振',     short: '三振', kind: 'out',  ab: true,  onBase: false, tb: 0, outs: 1 },
  { code: 'GO',  label: 'ゴロ',     short: 'ゴ',   kind: 'out',  ab: true,  onBase: false, tb: 0, outs: 1, needsDir: true },
  { code: 'FO',  label: 'フライ',   short: '飛',   kind: 'out',  ab: true,  onBase: false, tb: 0, outs: 1, needsDir: true },
  { code: 'LO',  label: 'ライナー', short: '直',   kind: 'out',  ab: true,  onBase: false, tb: 0, outs: 1, needsDir: true },
  { code: 'DP',  label: '併殺打',   short: '併',   kind: 'out',  ab: true,  onBase: false, tb: 0, outs: 2, needsDir: true,
    requires: { runner: true, maxOuts: 1 } },

  { code: 'SH',  label: '犠打',     short: '犠打', kind: 'etc',  ab: false, onBase: false, tb: 0, outs: 1, needsDir: true,
    requires: { runner: true, maxOuts: 1 } },
  { code: 'SF',  label: '犠飛',     short: '犠飛', kind: 'etc',  ab: false, onBase: false, tb: 0, outs: 1, needsDir: true,
    requires: { third: true, maxOuts: 1 } },
  { code: 'E',   label: '失策',     short: '失',   kind: 'etc',  ab: true,  onBase: false, tb: 0, outs: 0, needsDir: true, isError: true },
  { code: 'FC',  label: '野選',     short: '野選', kind: 'etc',  ab: true,  onBase: false, tb: 0, outs: 0, needsDir: true,
    requires: { runner: true } },
  { code: 'CI',  label: '打撃妨害', short: '妨',   kind: 'etc',  ab: false, onBase: true,  tb: 0, outs: 0 }
];

export const RESULT_BY_CODE = Object.fromEntries(RESULTS.map((r) => [r.code, r]));

export function resultLabel(code) {
  return RESULT_BY_CODE[code]?.label ?? code;
}

/* ---------------- 守備位置 ---------------- */
export const POSITIONS = [
  { code: '1', label: '投', full: '投手' },
  { code: '2', label: '捕', full: '捕手' },
  { code: '3', label: '一', full: '一塁手' },
  { code: '4', label: '二', full: '二塁手' },
  { code: '5', label: '三', full: '三塁手' },
  { code: '6', label: '遊', full: '遊撃手' },
  { code: '7', label: '左', full: '左翼手' },
  { code: '8', label: '中', full: '中堅手' },
  { code: '9', label: '右', full: '右翼手' }
];
export const POSITION_BY_CODE = Object.fromEntries(POSITIONS.map((p) => [p.code, p]));

/** グラウンド図上の配置（%）。打球方向の選択と守備配置の両方で使う。 */
export const POSITION_LAYOUT = {
  '1': { x: 50, y: 62 },
  '2': { x: 50, y: 88 },
  '3': { x: 74, y: 58 },
  '4': { x: 64, y: 45 },
  '5': { x: 26, y: 58 },
  '6': { x: 36, y: 45 },
  '7': { x: 17, y: 20 },
  '8': { x: 50, y: 12 },
  '9': { x: 83, y: 20 }
};

/** 打球方向は守備位置9つに左中間・右中間を加えたもの */
export const DIRECTIONS = [
  ...POSITIONS.map((p) => ({ code: p.code, label: p.label })),
  { code: 'LC', label: '左中間' },
  { code: 'RC', label: '右中間' }
];
export const DIRECTION_LAYOUT = {
  ...POSITION_LAYOUT,
  LC: { x: 31, y: 12 },
  RC: { x: 69, y: 12 }
};
export function directionLabel(code) {
  if (!code) return '';
  if (code === 'LC') return '左中間';
  if (code === 'RC') return '右中間';
  return POSITION_BY_CODE[code]?.label ?? code;
}

/* ---------------- 失策 ----------------
   1つのプレーで失策が重なることがある（捕球ミスのあと送球ミス、など）ため
   打席・走塁イベントのどちらにも失策を複数ぶら下げられるようにしている。
   暴投・捕逸は記録上の失策ではないので、その場合は失策を追加しない。 */
export const ERROR_TYPES = [
  { v: 'catch', label: '捕球' },
  { v: 'throw', label: '送球' },
  { v: 'other', label: 'その他' }
];
export const ERROR_TYPE_LABEL = Object.fromEntries(ERROR_TYPES.map((t) => [t.v, t.label]));

/* ---------------- 球数の記録モード ---------------- */
export const PITCH_MODES = [
  { code: 'none',    label: '記録しない', hint: '最速。結果だけを入れる' },
  { code: 'pitches', label: '球数のみ',   hint: '＋ボタンで投球数を数える' },
  { code: 'count',   label: '最終カウント', hint: '打席が終わった時のB-Sを選ぶ' }
];

export const COUNT_CHOICES = [
  '0-0', '0-1', '0-2',
  '1-0', '1-1', '1-2',
  '2-0', '2-1', '2-2',
  '3-0', '3-1', '3-2'
];

/* ---------------- 試合まわりのヘルパ ---------------- */

/** そのハーフイニングで攻撃しているのはどちらか。isHome=後攻。 */
export function battingSide(game, half) {
  const homeIsOur = !!game.isHome;
  if (half === 'top') return homeIsOur ? 'opp' : 'our';
  return homeIsOur ? 'our' : 'opp';
}

/** 自チームが守っているハーフイニングか（＝失策を自チーム選手に紐付ける側） */
export function isOurDefense(game, half) {
  return battingSide(game, half) === 'opp';
}

export function halfLabel(half) {
  return half === 'top' ? '表' : '裏';
}

export function teamName(game, side, settings) {
  if (side === 'our') return (settings && settings.teamName) || 'わがチーム';
  return game.opponent || '相手';
}

/* ---------------- 守備につかない選手の区分 ----------------
   全員打ちなので、守備に就かない打者は通常 DH 扱い。
   その日ベンチにいるだけの選手と区別できるよう「控え」も選べる。 */
export const ROLE_DH = 'DH';
export const ROLE_BENCH = 'BN';
export const ROLE_LABEL = { DH: 'DH', BN: '控' };
export const ROLE_FULL = { DH: 'DH（守備につかない）', BN: '控え（ベンチ）' };

/** 指定イニング時点の区分（DH / 控え）。守備位置は別で持つ。 */
export function rolesAt(game, inning) {
  const changes = (game.defense || []).filter((d) => d.inning <= inning)
    .sort((a, b) => a.inning - b.inning);
  const roles = {};
  for (const c of changes) Object.assign(roles, c.roles || {});
  for (const k of Object.keys(roles)) if (!roles[k]) delete roles[k];
  return roles;
}

/**
 * その回のその選手の立場。
 * 守備位置に就いていれば位置、就いていなければ DH（既定）か控え。
 */
export function roleOf(game, inning, playerId) {
  const dmap = defenseAt(game, inning);
  const pos = Object.keys(dmap).find((k) => dmap[k] === playerId);
  if (pos) return { kind: 'pos', code: pos, label: POSITION_BY_CODE[pos].label, full: POSITION_BY_CODE[pos].full };
  const roles = rolesAt(game, inning);
  if (roles[playerId] === ROLE_BENCH) return { kind: 'bench', code: ROLE_BENCH, label: ROLE_LABEL.BN, full: ROLE_FULL.BN };
  return { kind: 'dh', code: ROLE_DH, label: ROLE_LABEL.DH, full: ROLE_FULL.DH };
}

/* ---------------- 相手チームの打順 ----------------
   草野球では試合前にメンバー表を交換しないため、打席が回るたびに
   打者が増えていく。1番に戻った時点で人数を確定する運用に合わせる。 */

export function oppLineup(game) {
  if (game.oppLineup && game.oppLineup.length) {
    return [...game.oppLineup].sort((a, b) => a.order - b.order);
  }
  const n = game.oppOrderCount || 9;
  return Array.from({ length: n }, (_, i) => ({ order: i + 1, in: 1, out: null, name: '' }));
}

export function activeOppLineup(game, inning) {
  return oppLineup(game)
    .filter((e) => (e.in || 1) <= inning && (e.out == null || e.out > inning));
}

export function oppOrderMax(game) {
  const l = oppLineup(game);
  return l.length ? Math.max(...l.map((e) => e.order)) : 0;
}

/** 相手打者の表示名。名前が分かっていれば添える。 */
export function oppBatterLabel(game, order) {
  const e = oppLineup(game).find((x) => x.order === order);
  return e && e.name ? `${order}番 ${e.name}` : `${order}番`;
}

/** 指定イニング時点で有効な守備配置を返す（直近の変更を引き継ぐ） */
export function defenseAt(game, inning) {
  const changes = (game.defense || []).filter((d) => d.inning <= inning)
    .sort((a, b) => a.inning - b.inning);
  const map = {};
  for (const c of changes) Object.assign(map, c.map);
  // 空文字（守備から外れた）は削除して未配置に戻す
  for (const k of Object.keys(map)) if (!map[k]) delete map[k];
  return map;
}

/** 指定イニングで、その守備位置を守っている選手 ID */
export function fielderAt(game, inning, pos) {
  return defenseAt(game, inning)[pos] || null;
}

/**
 * その打席を投げていた投手。
 * イニング途中の交代に対応するため、交代時点（打席の通し番号）を記録した
 * pitcherLog を優先し、無ければそのイニングの守備配置の投手を使う。
 */
export function pitcherAt(game, seq, inning) {
  const log = [...(game.pitcherLog || [])].sort((a, b) => a.seq - b.seq);
  let pid = null;
  for (const e of log) {
    if (e.seq <= seq) pid = e.playerId || null;
    else break;
  }
  return pid || fielderAt(game, inning, '1');
}

/** その試合で登板した投手（登板順） */
export function pitchersOf(game) {
  const seen = [];
  const push = (pid) => { if (pid && !seen.includes(pid)) seen.push(pid); };
  for (const pa of [...(game.pas || [])].sort((a, b) => a.seq - b.seq)) {
    if (pa.side === 'opp') push(pitcherAt(game, pa.seq, pa.inning));
  }
  if (!seen.length) push(fielderAt(game, 1, '1'));
  return seen.filter(Boolean);
}

/** 指定イニングに出場している打順（途中参加・離脱を反映） */
export function activeLineup(game, inning) {
  return (game.lineup || [])
    .filter((e) => (e.in || 1) <= inning && (e.out == null || e.out > inning))
    .sort((a, b) => a.order - b.order);
}

export function lineupSorted(game) {
  return [...(game.lineup || [])].sort((a, b) => a.order - b.order);
}

/** 打席の通し番号順に並べ替えた配列 */
export function pasSorted(game) {
  return [...(game.pas || [])].sort((a, b) => a.seq - b.seq);
}

export function inningRuns(game, side) {
  const arr = (game.runs && game.runs[side]) || [];
  return arr;
}

export function totalRuns(game, side) {
  return inningRuns(game, side).reduce((a, b) => a + (b || 0), 0);
}

/** 表示用の試合結果（勝敗）。試合中は null。 */
export function gameOutcome(game) {
  if (game.status !== 'final') return null;
  const o = totalRuns(game, 'our');
  const p = totalRuns(game, 'opp');
  if (o > p) return 'win';
  if (o < p) return 'lose';
  return 'draw';
}

export const OUTCOME_LABEL = { win: '勝', lose: '敗', draw: '分' };

/* ---------------- 日付ヘルパ ---------------- */
export function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function seasonOf(dateISO) {
  return Number(String(dateISO).slice(0, 4));
}

const WD = ['日', '月', '火', '水', '木', '金', '土'];
export function formatDate(dateISO, withWeekday = true) {
  if (!dateISO) return '';
  const [y, m, d] = String(dateISO).split('-').map(Number);
  if (!y || !m || !d) return dateISO;
  const wd = withWeekday ? `(${WD[new Date(y, m - 1, d).getDay()]})` : '';
  return `${y}/${m}/${d}${wd}`;
}

/* ---------------- 既定値 ---------------- */
export const DEFAULT_SETTINGS = {
  teamName: 'わがチーム',
  defaultInnings: 7,
  defaultPitchMode: 'none',
  qualMode: 'factor',   // 'factor' = 試合数×係数, 'fixed' = 固定打席数
  qualFactor: 2.0,
  qualFixed: 30,
  eraInnings: 9,        // 防御率の基準イニング（一般的な定義は9回）
  backupWarnDays: 7,
  keepAwake: true,
  appMode: 'team',        // 'team' = 試合のスコア入力 / 'personal' = 個人成績入力
  personalPlayerId: ''    // 個人成績モードで選んでいる選手
};

/* ---------------- 個人成績モード ----------------
   チームのスコアを付けなくても、各自が自分の成績だけを残せるようにする。
   入力は2通り：打席ごとに積み上げる方式と、1試合の合計を直接書く方式。 */

export const PERSONAL_SOURCES = [
  { v: 'pa', label: '打席ごとに入力', hint: 'スコア入力と同じ感覚で1打席ずつ' },
  { v: 'manual', label: '合計を直接入力', hint: '4打数2安打…とまとめて書く' }
];

/** 過去成績（1年ぶん）として手入力する投手項目。勝敗は年間の合計なので数で持つ。 */
export const LEGACY_PITCH_FIELDS = [
  { key: 'G', label: '登板' },
  { key: 'ipWhole', label: '投球回', hint: '回' },
  { key: 'ipThird', label: '＋1/3', hint: '0〜2' },
  { key: 'BF', label: '打者' },
  { key: 'H', label: '被安打' },
  { key: 'HR', label: '被本塁打' },
  { key: 'SO', label: '奪三振' },
  { key: 'BB', label: '与四球' },
  { key: 'HBP', label: '与死球' },
  { key: 'R', label: '失点' },
  { key: 'ER', label: '自責点' },
  { key: 'W', label: '勝' },
  { key: 'L', label: '敗' },
  { key: 'SV', label: 'セーブ' }
];

/** 簡易投手成績の入力項目（結果だけを記録する） */
export const PITCH_INPUT_FIELDS = [
  { key: 'ipWhole', label: '投球回', hint: '回' },
  { key: 'ipThird', label: '＋1/3', hint: '0〜2' },
  { key: 'BF', label: '打者' },
  { key: 'H', label: '被安打' },
  { key: 'HR', label: '被本塁打' },
  { key: 'SO', label: '奪三振' },
  { key: 'BB', label: '与四球' },
  { key: 'HBP', label: '与死球' },
  { key: 'R', label: '失点' },
  { key: 'ER', label: '自責点' }
];

export function newPersonalGame(playerId, patch = {}) {
  return {
    id: null,
    playerId,
    date: todayISO(),
    opponent: '',
    venue: '',
    teamName: '',       // 自チーム以外で出た試合にも使えるように
    source: 'pa',
    pas: [],
    bat: null,          // source==='manual' のときの合計
    extra: { R: 0, SB: 0, CS: 0, E: 0 },  // 打席からは出せない項目
    pitch: null,        // 登板した場合のみ
    memo: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...patch
  };
}

export function newGame(settings, patch = {}) {
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const innings = patch.innings || s.defaultInnings || 7;
  return {
    id: null,
    date: todayISO(),
    time: '',
    opponent: '',
    venue: '',
    innings,
    isHome: true,
    pitchMode: patch.pitchMode || s.defaultPitchMode || 'none',
    oppOrderCount: 9,
    oppLineup: [],       // 空なら oppOrderCount から自動生成
    oppFixed: false,     // 相手の打順人数が確定したか
    status: 'in_progress',
    lineup: [],
    defense: [],
    pitcherLog: [],      // {seq, playerId} イニング途中の交代に対応
    pitching: {},        // {playerId: {er, decision}} 自責点と勝敗の手入力
    pas: [],
    runs: { our: [], opp: [] },
    scorers: [],
    steals: [],
    cur: { inning: 1, half: 'top', outs: 0, ourOrder: 1, oppOrder: 1, bases: { 1: null, 2: null, 3: null } },
    memo: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...patch
  };
}
