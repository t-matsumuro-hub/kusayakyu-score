/* 1試合の結果表（ボックススコア）。
   プロ野球の速報ページと同じく、打者ごとに各回の打席結果を
   「左安」「二ゴロ」「中飛」のような短い表記で並べ、一目で試合の流れが分かる形にする。
   試合詳細画面と、書き出す HTML の両方で同じ組み立てを使う。 */

import {
  RESULT_BY_CODE, battingSide, lineupSorted, roleOf, totalRuns, teamName,
  formatDate, oppLineup, pitcherAt, seasonOf, gameOutcome, OUTCOME_LABEL
} from './model.js';
import {
  gameBatting, gamePitching, aggregate, aggregatePitching,
  rates, fmtRate, formatIP, pitchRates, fmtNum
} from './stats.js';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------------- 打席結果の短い表記 ---------------- */

const DIR_SHORT = {
  1: '投', 2: '捕', 3: '一', 4: '二', 5: '三', 6: '遊', 7: '左', 8: '中', 9: '右',
  LC: '左中', RC: '右中'
};

/** 「左安」「中２」「二ゴロ」のような表記にする。方向が無ければ結果名だけ。 */
export function paNote(pa) {
  const d = pa.dir ? (DIR_SHORT[pa.dir] || '') : '';
  const withDir = (suffix, plain) => (d ? d + suffix : plain);
  switch (pa.result) {
    case '1B': return withDir('安', '安打');
    case '2B': return withDir('２', '二塁打');
    case '3B': return withDir('３', '三塁打');
    case 'HR': return withDir('本', '本塁打');
    case 'GO': return withDir('ゴロ', 'ゴロ');
    case 'FO': return withDir('飛', '飛球');
    case 'LO': return withDir('直', 'ライナー');
    case 'DP': return withDir('併打', '併殺打');
    case 'SH': return withDir('犠打', '犠打');
    case 'SF': return withDir('犠飛', '犠飛');
    case 'E': return withDir('失', '失策');
    case 'FC': return withDir('野選', '野選');
    case 'SO': return '三振';
    case 'BB': return '四球';
    case 'IBB': return '敬遠';
    case 'HBP': return '死球';
    case 'CI': return '打撃妨害';
    default: return RESULT_BY_CODE[pa.result]?.label || pa.result;
  }
}

/** 表示の色分け用 */
function noteKind(pa) {
  const r = RESULT_BY_CODE[pa.result];
  if (!r) return '';
  if (r.code === 'HR') return 'hr';
  if (r.tb > 0) return 'hit';
  if (r.kind === 'walk') return 'walk';
  return '';
}

/* ---------------- スコアボード ---------------- */

function lastPlayedInning(g, side) {
  let last = 0;
  for (const pa of g.pas || []) if (battingSide(g, pa.half) === side) last = Math.max(last, pa.inning);
  const runs = g.runs?.[side] || [];
  for (let i = 0; i < runs.length; i++) if (runs[i] != null) last = Math.max(last, i + 1);
  if (g.status !== 'final') {
    const cur = g.cur || { inning: 1, half: 'top' };
    if (battingSide(g, cur.half) === side) last = Math.max(last, cur.inning);
    else last = Math.max(last, cur.inning - (cur.half === 'bottom' ? 0 : 1));
  }
  return last;
}

/** そのチームの安打数 */
export function teamHits(g, side) {
  return (g.pas || []).filter((pa) => pa.side === side && (RESULT_BY_CODE[pa.result]?.tb || 0) > 0).length;
}

/** そのチームが守備で犯した失策数 */
export function teamErrors(g, fieldingSide) {
  const count = (item) => {
    if (item.errors && item.errors.length) return item.errors.length;
    return RESULT_BY_CODE[item.result]?.isError ? 1 : 0;
  };
  let n = 0;
  for (const pa of g.pas || []) if (pa.side !== fieldingSide) n += count(pa);
  for (const ev of g.runnerEvents || []) if (ev.side !== fieldingSide) n += (ev.errors || []).length;
  return n;
}

function inningCount(g) {
  const maxPA = (g.pas || []).reduce((m, p) => Math.max(m, p.inning || 0), 0);
  return Math.max(g.innings || 0, maxPA, (g.runs?.our || []).length, (g.runs?.opp || []).length);
}

function linescore(g, names) {
  const n = inningCount(g);
  const first = g.isHome ? 'opp' : 'our';
  const second = g.isHome ? 'our' : 'opp';
  const row = (side) => {
    const last = lastPlayedInning(g, side);
    const arr = g.runs?.[side] || [];
    const cells = [];
    for (let i = 1; i <= n; i++) cells.push(i <= last ? String(arr[i - 1] || 0) : '');
    return {
      side, name: names[side], cells,
      R: totalRuns(g, side), H: teamHits(g, side), E: teamErrors(g, side)
    };
  };
  const top = row(first);
  const bottom = row(second);
  // 後攻が勝っていて最終回の裏を行っていなければ「X」
  if (g.status === 'final') {
    const lastTop = lastPlayedInning(g, first);
    const lastBottom = lastPlayedInning(g, second);
    if (lastBottom < lastTop && bottom.R > top.R) bottom.cells[lastTop - 1] = 'X';
  }
  return { innings: n, rows: [top, bottom] };
}

/* ---------------- 自チームの打撃 ---------------- */

const ROLE_SHORT = { DH: '指', BN: '控' };

/** 守備位置の移り変わり。先発は「(遊)」、途中で替わったら「(遊)二」のように続ける。 */
function positionTrail(g, entry, lastInning) {
  const from = entry.in || 1;
  const to = entry.out != null ? Math.min(entry.out - 1, lastInning) : lastInning;
  const seq = [];
  for (let i = from; i <= Math.max(from, to); i++) {
    const r = roleOf(g, i, entry.playerId);
    const label = r.kind === 'pos' ? r.label : (ROLE_SHORT[r.code] || r.label);
    if (seq[seq.length - 1] !== label) seq.push(label);
  }
  if (!seq.length) return '';
  const head = from === 1 ? `(${seq[0]})` : seq[0];
  return head + seq.slice(1).join('');
}

/** 打者ごとに各回の打席を並べる */
function inningCells(g, n, match) {
  const cells = Array.from({ length: n }, () => []);
  const pas = [...(g.pas || [])].filter(match).sort((a, b) => a.seq - b.seq);
  for (const pa of pas) {
    const i = (pa.inning || 1) - 1;
    if (i >= 0 && i < n) cells[i].push({ text: paNote(pa), kind: noteKind(pa) });
  }
  return cells;
}

/** その試合までのシーズン成績（打率・防御率の表示用。チームの試合だけで数える） */
function seasonToDate(game, ctx) {
  const season = seasonOf(game.date);
  const upto = (ctx.games || []).filter((x) =>
    seasonOf(x.date) === season
    && ((x.date || '') < (game.date || '') || x.id === game.id
      || ((x.date || '') === (game.date || '') && (x.createdAt || '') <= (game.createdAt || ''))));
  return {
    bat: aggregate(upto, ctx.players || [], { includeLegacy: false }),
    pitch: aggregatePitching(upto, ctx.players || [], { includeLegacy: false })
  };
}

function ourBatting(g, n, ctx) {
  const bat = gameBatting(g);
  const std = seasonToDate(g, ctx);
  const last = Math.max(1, lastPlayedInning(g, 'our'));
  const name = (pid) => (ctx.players || []).find((p) => p.id === pid)?.name || '(不明)';

  return lineupSorted(g).map((e) => {
    const b = bat.get(e.playerId) || {};
    const s = std.bat.get(e.playerId);
    return {
      order: e.order,
      pos: positionTrail(g, e, last),
      name: name(e.playerId),
      avg: s ? fmtRate(rates(s.bat).avg) : '-',
      stats: {
        AB: b.AB || 0, R: b.R || 0, H: b.H || 0, RBI: b.RBI || 0, SO: b.SO || 0,
        BB: b.BB || 0, HBP: b.HBP || 0, SH: b.SH || 0, SB: b.SB || 0, E: b.E || 0, HR: b.HR || 0
      },
      cells: inningCells(g, n, (pa) => pa.side === 'our' && pa.playerId === e.playerId)
    };
  });
}

/* ---------------- 相手チームの打撃（打順単位） ---------------- */

function oppBatting(g, n) {
  const rows = [];
  for (const e of oppLineup(g)) {
    const key = String(e.order);
    const pas = (g.pas || []).filter((pa) => pa.side === 'opp' && pa.order === e.order);
    if (!pas.length) continue;
    const st = { AB: 0, R: 0, H: 0, RBI: 0, SO: 0, BB: 0, HBP: 0, SH: 0, SB: 0, E: 0, HR: 0 };
    for (const pa of pas) {
      const r = RESULT_BY_CODE[pa.result];
      if (!r) continue;
      if (r.ab) st.AB += 1;
      if (r.tb > 0) st.H += 1;
      if (r.code === 'HR') st.HR += 1;
      if (r.code === 'SO') st.SO += 1;
      if (r.code === 'BB' || r.code === 'IBB') st.BB += 1;
      if (r.code === 'HBP') st.HBP += 1;
      if (r.code === 'SH') st.SH += 1;
      st.RBI += pa.rbi || 0;
    }
    for (const src of [...(g.pas || []), ...(g.runnerEvents || [])]) {
      if (src.side !== 'opp') continue;
      for (const run of src.runsOnPlay || []) if (String(run.ref) === key) st.R += 1;
    }
    for (const ev of g.runnerEvents || []) {
      if (ev.side !== 'opp') continue;
      for (const mv of ev.moves || []) if (String(mv.ref) === key && mv.credit === 'SB') st.SB += 1;
    }
    rows.push({
      order: e.order, pos: '', name: e.name || '', avg: '-', stats: st,
      cells: inningCells(g, n, (pa) => pa.side === 'opp' && pa.order === e.order)
    });
  }
  return rows;
}

/* ---------------- 自チームの投手 ---------------- */

function ourPitching(g, ctx) {
  const pm = gamePitching(g);
  const std = seasonToDate(g, ctx);
  const eraIn = (ctx.settings && ctx.settings.eraInnings) || 9;
  const name = (pid) => (ctx.players || []).find((p) => p.id === pid)?.name || '(不明)';
  const dec = { W: '勝', L: '敗', SV: 'S' };

  return [...pm].map(([pid, p]) => {
    let pitches = 0;
    let hasPitches = false;
    for (const pa of g.pas || []) {
      if (pa.side !== 'opp' || pa.pitches == null) continue;
      if (pitcherAt(g, pa.seq, pa.inning) !== pid) continue;
      pitches += pa.pitches;
      hasPitches = true;
    }
    const season = std.pitch.get(pid);
    return {
      name: name(pid),
      decision: dec[(g.pitching || {})[pid]?.decision] || '',
      era: season ? fmtNum(pitchRates(season, eraIn).era) : '-',
      ip: formatIP(p.outs),
      pitches: hasPitches ? String(pitches) : '-',
      BF: p.BF, H: p.H, HR: p.HR, SO: p.SO, BB: p.BB, HBP: p.HBP, R: p.R, ER: p.ER
    };
  });
}

/* ---------------- まとめ ---------------- */

/**
 * 1試合ぶんの結果表データを組み立てる。
 * @param {object} ctx { games, players, settings } シーズン打率などの計算に使う
 */
export function buildBox(g, ctx = {}) {
  const names = {
    our: teamName(g, 'our', ctx.settings),
    opp: g.opponent || '相手'
  };
  const n = inningCount(g);
  return {
    game: g,
    names,
    innings: n,
    linescore: linescore(g, names),
    our: ourBatting(g, n, ctx),
    opp: oppBatting(g, n),
    pitchers: ourPitching(g, ctx)
  };
}

/* ---------------- 表の HTML ---------------- */

const BAT_COLS = [
  ['AB', '打数'], ['R', '得点'], ['H', '安打'], ['RBI', '打点'], ['SO', '三振'],
  ['BB', '四球'], ['HBP', '死球'], ['SH', '犠打'], ['SB', '盗塁'], ['E', '失策'], ['HR', '本塁打']
];

export function linescoreTableHTML(box, cls = 'box-ls') {
  const ls = box.linescore;
  return `<table class="${cls}">
    <thead><tr><th class="team"></th>
      ${Array.from({ length: ls.innings }, (_, i) => `<th>${i + 1}</th>`).join('')}
      <th class="tot">計</th><th class="tot">安</th><th class="tot">失</th></tr></thead>
    <tbody>${ls.rows.map((r) => `<tr>
      <td class="team">${esc(r.name)}</td>
      ${r.cells.map((c) => `<td>${esc(c)}</td>`).join('')}
      <td class="tot b">${r.R}</td><td class="tot">${r.H}</td><td class="tot">${r.E}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

/**
 * 打撃の表。各回の列に打席結果を並べる。
 * @param {Array} rows ourBatting / oppBatting の結果
 */
/** 打撃の表本体（位置・選手名・成績・各回の打席） */
function batTable(rows, innings, { cls, showAvg, orderLabel }) {
  const total = {};
  for (const [k] of BAT_COLS) total[k] = rows.reduce((s, r) => s + (r.stats[k] || 0), 0);

  return `<table class="${cls}">
    <thead><tr>
      <th class="pos">位置</th><th class="name">選手名</th>
      ${showAvg ? '<th>打率</th>' : ''}
      ${BAT_COLS.map(([, l]) => `<th>${l}</th>`).join('')}
      ${Array.from({ length: innings }, (_, i) => `<th class="inn">${i + 1}回</th>`).join('')}
    </tr></thead>
    <tbody>
      ${rows.map((r) => `<tr>
        <td class="pos">${esc(orderLabel ? `${r.order}番` : r.pos)}</td>
        <td class="name">${esc(r.name || '')}</td>
        ${showAvg ? `<td>${esc(r.avg)}</td>` : ''}
        ${BAT_COLS.map(([k]) => `<td>${r.stats[k] || 0}</td>`).join('')}
        ${r.cells.map((list) => `<td class="inn">${list.map((c) =>
          `<span class="${c.kind}">${esc(c.text)}</span>`).join('<br>')}</td>`).join('')}
      </tr>`).join('')}
      <tr class="total">
        <td class="pos"></td><td class="name">計</td>
        ${showAvg ? '<td></td>' : ''}
        ${BAT_COLS.map(([k]) => `<td>${total[k]}</td>`).join('')}
        ${Array.from({ length: innings }, () => '<td class="inn"></td>').join('')}
      </tr>
    </tbody>
  </table>`;
}

/**
 * 打撃の表。成績と各回を1枚に並べ、入り切らない分は横にスクロールさせる。
 * 選手名の列は固定するので、スクロールしても誰の行かが分かる。
 */
export function battingTableHTML(rows, innings, { cls = 'box-bat', showAvg = true, orderLabel = false } = {}) {
  if (!rows.length) return '';
  return `<div class="bx-scroll">${batTable(rows, innings, { cls, showAvg, orderLabel })}</div>`;
}

export function pitchingTableHTML(rows, { cls = 'box-pit' } = {}) {
  if (!rows.length) return '';
  return `<table class="${cls}">
    <thead><tr>
      <th class="name">投手</th><th></th><th>防御率</th><th>投球回</th><th>投球数</th><th>打者</th>
      <th>被安打</th><th>被本塁打</th><th>奪三振</th><th>与四球</th><th>与死球</th><th>失点</th><th>自責点</th>
    </tr></thead>
    <tbody>${rows.map((p) => `<tr>
      <td class="name">${esc(p.name)}</td><td class="dec">${esc(p.decision)}</td>
      <td>${p.era}</td><td>${p.ip}</td><td>${p.pitches}</td><td>${p.BF}</td>
      <td>${p.H}</td><td>${p.HR}</td><td>${p.SO}</td><td>${p.BB}</td><td>${p.HBP}</td>
      <td>${p.R}</td><td>${p.ER}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

/* ---------------- 書き出し用の単体 HTML ---------------- */

export function buildGameReportHTML(g, ctx = {}) {
  const box = buildBox(g, ctx);
  const oc = gameOutcome(g);
  const our = totalRuns(g, 'our');
  const opp = totalRuns(g, 'opp');
  const title = `${box.names.our} vs ${box.names.opp}（${formatDate(g.date, false)}）`;

  return `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root{--bg:#f4f6f8;--card:#fff;--line:#c9d2da;--text:#14181c;--muted:#5b6874;--accent:#0f5132;--soft:#e8f2ec;--hit:#c0392b}
  @media (prefers-color-scheme:dark){:root{--bg:#11151a;--card:#1a2027;--line:#38424e;--text:#eef2f6;--muted:#9dabb8;--accent:#2ea36a;--soft:#16311f;--hit:#ff7b6e}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",system-ui,sans-serif;-webkit-text-size-adjust:100%}
  .wrap{max-width:1100px;margin:0 auto;padding:14px 12px 40px}
  header{background:var(--accent);color:#fff;border-radius:12px;padding:16px 14px;margin-bottom:14px}
  header .t{font-size:13px;opacity:.9}
  header .s{font-size:26px;font-weight:800;margin-top:4px;font-variant-numeric:tabular-nums}
  header .s small{font-size:14px;font-weight:700;margin-left:8px;padding:2px 8px;border-radius:99px;background:rgba(255,255,255,.2)}
  h2{font-size:15px;margin:22px 0 8px;padding-left:8px;border-left:4px solid var(--accent)}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
  table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}
  th,td{padding:6px 7px;border-bottom:1px solid var(--line);text-align:center;white-space:nowrap}
  th{background:var(--soft);color:var(--muted);font-size:12px}
  td.name,th.name{text-align:left;position:sticky;left:0;background:var(--card);min-width:88px}
  th.name{background:var(--soft)}
  td.pos,th.pos{color:var(--muted)}
  td.team{text-align:left;font-weight:700}
  td.tot,th.tot{background:var(--soft)}
  td.b{font-weight:800}
  td.inn{min-width:54px;font-size:12px;line-height:1.5}
  .hit{color:var(--hit);font-weight:700}
  .hr{color:var(--hit);font-weight:800}
  .walk{color:var(--muted)}
  td.dec{color:var(--hit);font-weight:700}
  tr.total td{font-weight:700;background:var(--soft)}
  tr:last-child td{border-bottom:0}
  .note{color:var(--muted);font-size:12px;margin-top:6px}
  footer{margin-top:24px;color:var(--muted);font-size:12px;text-align:center}
  .bx-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
  @media (max-width:640px){
    table{font-size:12px}
    th,td{padding:5px 5px}
    td.inn{min-width:42px;font-size:11px}
    header .s{font-size:22px}
  }
</style></head>
<body><div class="wrap">
<header>
  <div class="t">${esc(formatDate(g.date))}${g.time ? ' ' + esc(g.time) : ''}${g.venue ? ' ・ ' + esc(g.venue) : ''}</div>
  <div class="s">${esc(box.names.our)} ${our} - ${opp} ${esc(box.names.opp)}${oc ? `<small>${OUTCOME_LABEL[oc]}</small>` : ''}</div>
</header>

<div class="card"><div class="scroll">${linescoreTableHTML(box, 'ls')}</div></div>

<h2>${esc(box.names.our)} 打撃成績</h2>
<div class="card">${battingTableHTML(box.our, box.innings, { cls: 'bat' })}</div>
<div class="note">打率はこの試合までのシーズン成績です。赤字は安打。</div>

${box.pitchers.length ? `<h2>${esc(box.names.our)} 投手成績</h2>
<div class="card"><div class="scroll">${pitchingTableHTML(box.pitchers, { cls: 'pit' })}</div></div>
<div class="note">防御率はこの試合までのシーズン成績（${(ctx.settings && ctx.settings.eraInnings) || 9}回換算）です。</div>` : ''}

${box.opp.length ? `<h2>${esc(box.names.opp)} 打撃成績</h2>
<div class="card">${battingTableHTML(box.opp, box.innings, { cls: 'bat', showAvg: false, orderLabel: true })}</div>` : ''}

${g.memo ? `<h2>メモ</h2><div class="card" style="padding:12px;font-size:14px">${esc(g.memo)}</div>` : ''}

<footer>草野球スコア　${esc(new Date().toLocaleString('ja-JP'))} 作成</footer>
</div></body></html>`;
}
