/* 成績表を単体 HTML ファイルとして書き出す。
   外部ファイルを一切参照しないので、LINE などで送れば受け取った人が
   タップするだけでブラウザで見られる（サーバ不要）。 */

import { state } from './store.js';
import {
  aggregate, rates, fmtRate, qualifiedPA, seasonsOf,
  aggregatePitching, aggregateFielding, pitchRates, formatIP, fmtNum
} from './stats.js';
import { POSITION_BY_CODE } from './model.js';
import {
  seasonOf, formatDate, totalRuns, gameOutcome, OUTCOME_LABEL, teamName
} from './model.js';
import { shareOrDownload } from './backup.js';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const COLUMNS = [
  { key: 'G', label: '試合' },
  { key: 'PA', label: '打席' },
  { key: 'AB', label: '打数' },
  { key: 'H', label: '安打' },
  { key: 'H2', label: '二' },
  { key: 'H3', label: '三' },
  { key: 'HR', label: '本' },
  { key: 'RBI', label: '打点' },
  { key: 'R', label: '得点' },
  { key: 'BB', label: '四球' },
  { key: 'HBP', label: '死球' },
  { key: 'SO', label: '三振' },
  { key: 'SH', label: '犠打' },
  { key: 'SF', label: '犠飛' },
  { key: 'SB', label: '盗塁' },
  { key: 'E', label: '失策' }
];

function tableHTML(rows, qual) {
  if (!rows.length) return '<p class="empty">データがありません</p>';
  return `<div class="scroll"><table>
    <thead><tr><th class="name">選手</th>
      ${COLUMNS.map((c) => `<th>${c.label}</th>`).join('')}
      <th>打率</th><th>出塁</th><th>長打</th><th>OPS</th></tr></thead>
    <tbody>
      ${rows.map(({ name, bat, note }) => {
        const rt = rates(bat);
        const dim = qual > 0 && bat.PA < qual;
        return `<tr class="${dim ? 'dim' : ''}">
          <td class="name">${esc(name)}${note ? `<span class="tag">${esc(note)}</span>` : ''}</td>
          ${COLUMNS.map((c) => `<td>${bat[c.key] || 0}</td>`).join('')}
          <td class="hl">${fmtRate(rt.avg)}</td><td>${fmtRate(rt.obp)}</td>
          <td>${fmtRate(rt.slg)}</td><td>${fmtRate(rt.ops)}</td>
        </tr>`;
      }).join('')}
    </tbody></table></div>`;
}

function rankingHTML(rows, qual) {
  const cards = [];

  const rateRank = (label, pick, minPA) => {
    const list = rows
      .filter((r) => (minPA ? r.bat.PA >= qual : true))
      .map((r) => ({ name: r.name, v: pick(rates(r.bat), r.bat) }))
      .filter((r) => r.v != null)
      .sort((a, b) => b.v - a.v).slice(0, 5);
    if (!list.length) return '';
    return `<div class="rank"><h3>${label}</h3><ol>
      ${list.map((r) => `<li><span>${esc(r.name)}</span><b>${fmtRate(r.v)}</b></li>`).join('')}
    </ol></div>`;
  };

  const countRank = (label, key) => {
    const list = rows.map((r) => ({ name: r.name, v: r.bat[key] || 0 }))
      .filter((r) => r.v > 0).sort((a, b) => b.v - a.v).slice(0, 5);
    if (!list.length) return '';
    return `<div class="rank"><h3>${label}</h3><ol>
      ${list.map((r) => `<li><span>${esc(r.name)}</span><b>${r.v}</b></li>`).join('')}
    </ol></div>`;
  };

  cards.push(rateRank('打率', (rt) => rt.avg, true));
  cards.push(countRank('本塁打', 'HR'));
  cards.push(countRank('打点', 'RBI'));
  cards.push(countRank('安打', 'H'));
  cards.push(rateRank('OPS', (rt) => rt.ops, true));
  cards.push(countRank('盗塁', 'SB'));

  const body = cards.filter(Boolean).join('');
  if (!body) return '';
  return `<div class="ranks">${body}</div>
    ${qual > 0 ? `<p class="note">打率・OPS は規定打席 ${qual} 打席以上が対象です。</p>` : ''}`;
}

function pitchingHTML(games, eraIn) {
  const map = aggregatePitching(games, { season: null });
  const rows = [...map]
    .map(([pid, p]) => ({ name: state.players.find((x) => x.id === pid)?.name || '(不明)', p }))
    .filter((r) => r.p.outs > 0 || r.p.BF > 0)
    .sort((a, b) => b.p.outs - a.p.outs);
  if (!rows.length) return '';

  return `<h2>投手成績</h2><div class="card"><div class="scroll"><table>
    <thead><tr><th class="name">投手</th><th>登板</th><th>回</th><th>打者</th><th>被安打</th><th>被本</th>
      <th>奪三振</th><th>与四球</th><th>与死球</th><th>失点</th><th>自責</th>
      <th>勝</th><th>敗</th><th>S</th><th>防御率</th><th>WHIP</th><th>被打率</th></tr></thead>
    <tbody>${rows.map(({ name, p }) => {
      const rt = pitchRates(p, eraIn);
      return `<tr><td class="name">${esc(name)}</td>
        <td>${p.G}</td><td>${formatIP(p.outs)}</td><td>${p.BF}</td><td>${p.H}</td><td>${p.HR}</td>
        <td>${p.SO}</td><td>${p.BB}</td><td>${p.HBP}</td><td>${p.R}</td><td>${p.ER}</td>
        <td>${p.W}</td><td>${p.L}</td><td>${p.SV}</td>
        <td class="hl">${fmtNum(rt.era)}</td><td>${fmtNum(rt.whip)}</td><td>${fmtRate(rt.avg)}</td></tr>`;
    }).join('')}</tbody></table></div></div>
    <p class="note">防御率は${eraIn}回換算です。</p>`;
}

function fieldingHTML(games) {
  const map = aggregateFielding(games, { season: null });
  const rows = [...map]
    .map(([pid, f]) => ({ name: state.players.find((x) => x.id === pid)?.name || '(不明)', f }))
    .filter((r) => r.f.E > 0)
    .sort((a, b) => b.f.E - a.f.E);
  if (!rows.length) return '';
  const total = rows.reduce((n, r) => n + r.f.E, 0);

  return `<h2>守備（失策）</h2><div class="card"><div class="scroll"><table>
    <thead><tr><th class="name">選手</th><th>失策</th><th>捕球</th><th>送球</th><th>その他</th>
      <th class="name">位置別</th></tr></thead>
    <tbody>${rows.map(({ name, f }) => {
      const byPos = Object.entries(f.byPos).sort((a, b) => b[1] - a[1])
        .map(([pos, n]) => `${POSITION_BY_CODE[pos]?.label || pos}${n}`).join(' ');
      return `<tr><td class="name">${esc(name)}</td>
        <td class="hl">${f.E}</td><td>${f.catch}</td><td>${f.throw}</td><td>${f.other}</td>
        <td class="name">${esc(byPos)}</td></tr>`;
    }).join('')}</tbody></table></div></div>
    <p class="note">チーム失策 合計 ${total}</p>`;
}

function gamesHTML(games) {
  if (!games.length) return '';
  return `<div class="scroll"><table class="games">
    <thead><tr><th class="name">日付</th><th class="name">対戦相手</th><th>結果</th><th>スコア</th><th class="name">球場</th></tr></thead>
    <tbody>${games.map((g) => {
      const oc = gameOutcome(g);
      return `<tr>
        <td class="name">${esc(formatDate(g.date))}</td>
        <td class="name">${esc(g.opponent || '-')}</td>
        <td class="${oc === 'win' ? 'win' : oc === 'lose' ? 'lose' : ''}">${oc ? OUTCOME_LABEL[oc] : '—'}</td>
        <td>${totalRuns(g, 'our')} - ${totalRuns(g, 'opp')}</td>
        <td class="name">${esc(g.venue || '')}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

function buildRows(map) {
  const rows = [];
  for (const [pid, entry] of map) {
    const p = state.players.find((x) => x.id === pid);
    if (!p) continue;
    rows.push({
      name: p.name,
      bat: entry.bat,
      note: entry.fromLegacy && !entry.fromApp ? '手入力' : (entry.fromLegacy ? '手入力含む' : '')
    });
  }
  rows.sort((a, b) => {
    const ra = rates(a.bat).avg, rb = rates(b.bat).avg;
    if (ra == null && rb == null) return b.bat.PA - a.bat.PA;
    if (ra == null) return 1;
    if (rb == null) return -1;
    return rb - ra;
  });
  return rows;
}

/**
 * 成績表 HTML を組み立てる。
 * @param {object} opts { season: number|null }
 */
export function buildReportHTML({ season = null } = {}) {
  const team = teamName(null, 'our', state.settings);
  const games = season == null ? state.games : state.games.filter((g) => seasonOf(g.date) === season);
  const sorted = [...games].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const seasonMap = aggregate(state.games, state.players, { season });
  const careerMap = aggregate(state.games, state.players, { season: null });

  const seasonRows = buildRows(seasonMap);
  const careerRows = buildRows(careerMap);

  const qualSeason = qualifiedPA(state.settings, games.length);
  const qualCareer = qualifiedPA(state.settings, state.games.length);

  const w = sorted.filter((g) => gameOutcome(g) === 'win').length;
  const l = sorted.filter((g) => gameOutcome(g) === 'lose').length;
  const d = sorted.filter((g) => gameOutcome(g) === 'draw').length;

  const title = `${team} 成績表${season == null ? '（通算）' : `（${season}年）`}`;
  const generated = new Date().toLocaleString('ja-JP');

  return `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root{--bg:#f4f6f8;--card:#fff;--line:#c9d2da;--text:#14181c;--muted:#5b6874;--accent:#0f5132;--accent-soft:#d9ece2;--win:#0f5132;--lose:#b3261e}
  @media (prefers-color-scheme:dark){
    :root{--bg:#11151a;--card:#1a2027;--line:#38424e;--text:#eef2f6;--muted:#9dabb8;--accent:#2ea36a;--accent-soft:#16311f;--win:#4ade80;--lose:#ff6b60}
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",system-ui,sans-serif;line-height:1.5;-webkit-text-size-adjust:100%}
  .wrap{max-width:960px;margin:0 auto;padding:16px 12px 48px}
  header{background:var(--accent);color:#fff;padding:18px 14px;border-radius:12px;margin-bottom:16px}
  header h1{margin:0 0 4px;font-size:19px}
  header .sub{font-size:13px;opacity:.9}
  h2{font-size:15px;margin:26px 0 8px;padding-left:8px;border-left:4px solid var(--accent)}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
  table{border-collapse:collapse;width:100%;font-size:13px}
  th,td{padding:7px 8px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  th{background:var(--accent-soft);color:var(--muted);font-size:12px;position:sticky;top:0}
  td.name,th.name{text-align:left;position:sticky;left:0;background:var(--card);min-width:96px}
  th.name{background:var(--accent-soft)}
  tr.dim td{color:var(--muted)}
  td.hl{font-weight:700}
  td.win{color:var(--win);font-weight:700}
  td.lose{color:var(--lose);font-weight:700}
  .tag{display:inline-block;margin-left:6px;padding:0 6px;border-radius:99px;background:var(--accent-soft);color:var(--muted);font-size:10px;font-weight:700}
  .ranks{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
  .rank{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px}
  .rank h3{margin:0 0 6px;font-size:13px;color:var(--muted)}
  .rank ol{margin:0;padding-left:18px;font-size:13px}
  .rank li{display:flex;justify-content:space-between;gap:8px;padding:2px 0}
  .rank li span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .rank li b{font-variant-numeric:tabular-nums}
  .note,.empty{color:var(--muted);font-size:12px}
  .empty{padding:20px;text-align:center}
  footer{margin-top:28px;color:var(--muted);font-size:12px;text-align:center}
</style></head>
<body><div class="wrap">
<header>
  <h1>${esc(title)}</h1>
  <div class="sub">${sorted.length}試合　${w}勝 ${l}敗 ${d}分</div>
</header>

${seasonRows.length ? `<h2>ランキング${season == null ? '（通算）' : ''}</h2>${rankingHTML(seasonRows, season == null ? qualCareer : qualSeason)}` : ''}

<h2>個人成績${season == null ? '（通算）' : `（${season}年）`}</h2>
<div class="card">${tableHTML(seasonRows, season == null ? qualCareer : qualSeason)}</div>

${season != null && careerRows.length ? `
<h2>通算成績（全年度＋手入力分）</h2>
<div class="card">${tableHTML(careerRows, qualCareer)}</div>` : ''}

${pitchingHTML(sorted, state.settings.eraInnings || 9)}
${fieldingHTML(sorted)}

<h2>試合一覧${season == null ? '' : `（${season}年）`}</h2>
<div class="card">${gamesHTML(sorted) || '<p class="empty">試合がありません</p>'}</div>

<footer>草野球スコア　${esc(generated)} 作成</footer>
</div></body></html>`;
}

export async function exportReport({ season = null } = {}) {
  const htmlText = buildReportHTML({ season });
  const team = (state.settings.teamName || 'team').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 20);
  const name = `成績表-${team}-${season == null ? '通算' : season}.html`;
  return shareOrDownload(htmlText, name, 'text/html', '成績表');
}

export { seasonsOf };
