/* 成績（年度別・通算）。手入力の過去成績も合算して表示する。 */

import { html, raw, esc, render, on, toast, sheet } from './common.js';
import { state, linkedPersonal } from '../store.js';
import {
  aggregate, rates, fmtRate, qualifiedPA, seasonsOf, emptyBat, addBat, normalizeLegacy,
  aggregatePitching, aggregateFielding, pitchRates, formatIP, fmtNum
} from '../stats.js';
import { POSITION_BY_CODE } from '../model.js';
import { seasonOf } from '../model.js';
import { exportReport } from '../report.js';
import { rerender } from './router.js';

/** null = 通算 */
let season = null;
let sortKey = 'avg';
/** 'bat' | 'pitch' | 'field' */
let mode = 'bat';

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

export default {
  title: () => '成績',
  action: () => ({ label: '書き出し', run: () => exportMenu() }),

  async render(view) {
    const seasons = seasonsOf(state.games, state.players, linkedPersonal());
    if (season != null && !seasons.includes(season)) season = null;

    const map = aggregate(state.games, state.players, { season, personal: linkedPersonal() });
    const games = season == null ? state.games : state.games.filter((g) => seasonOf(g.date) === season);
    const qual = qualifiedPA(state.settings, games.length);
    const rows = buildRows(map);

    render(view, html`
      <div class="seg" data-mode style="margin-bottom:10px">
        <button class="${mode === 'bat' ? 'is-on' : ''}" data-m="bat">打撃</button>
        <button class="${mode === 'pitch' ? 'is-on' : ''}" data-m="pitch">投手</button>
        <button class="${mode === 'field' ? 'is-on' : ''}" data-m="field">守備</button>
      </div>

      <div class="seg" data-season style="margin-bottom:12px">
        <button class="${season == null ? 'is-on' : ''}" data-s="">通算</button>
        ${raw(seasons.slice(0, 4).map((s) =>
          `<button class="${season === s ? 'is-on' : ''}" data-s="${s}">${s}</button>`).join(''))}
      </div>
      ${seasons.length > 4 ? html`
        <div class="btn-row" style="margin-top:-4px">
          <button class="btn btn-sm" data-more-seasons>他の年度を選ぶ</button>
        </div>` : ''}

      <div class="card card-pad" style="margin-bottom:12px">
        <div class="small muted">
          ${season == null ? '通算（全年度＋手入力の過去成績）' : `${season}年`}
          ・ ${games.length}試合
          ${mode === 'bat' && qual > 0 ? html` ・ 規定打席 ${qual}` : ''}
          ${mode === 'pitch' ? html` ・ 防御率は${state.settings.eraInnings || 9}回換算` : ''}
        </div>
      </div>

      ${mode === 'bat' ? battingTableHTML(rows, qual)
        : mode === 'pitch' ? raw(pitchingTableHTML(season))
        : raw(fieldingTableHTML(season))}
    `);

    on(view, 'click', '[data-m]', (e, b) => { mode = b.dataset.m; rerender(); });
    on(view, 'click', '[data-s]', (e, b) => { season = b.dataset.s === '' ? null : Number(b.dataset.s); rerender(); });
    on(view, 'click', '[data-sort]', (e, b) => { sortKey = b.dataset.sort; rerender(); });
    on(view, 'click', '[data-player]', (e, tr) => playerDetail(tr.dataset.player));
    on(view, 'click', '[data-more-seasons]', async () => {
      const v = await sheet({
        title: '年度を選ぶ',
        body: html`<div class="pick-grid">
          <button data-v="">通算</button>
          ${raw(seasons.map((s) => `<button data-v="${s}">${s}年</button>`).join(''))}
        </div>`,
        onMount(modal, close) {
          modal.addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-v]');
            if (b) close(b.dataset.v);
          });
        }
      });
      if (v == null) return;
      season = v === '' ? null : Number(v);
      rerender();
    });
  }
};

/* ---------------- 打撃 ---------------- */

function battingTableHTML(rows, qual) {
  if (rows.length === 0) {
    return html`<div class="card"><div class="empty">
      成績がありません。<br>試合を記録するか、メンバー画面から過去成績を取り込んでください。
    </div></div>`;
  }
  return html`
    <div class="card">
      <div class="table-wrap"><table class="stats">
        <thead><tr>
          <th class="name">選手</th>
          ${raw(COLUMNS.map((c) => `<th data-sort="${c.key}">${c.label}</th>`).join(''))}
          <th data-sort="avg">打率</th><th data-sort="obp">出塁</th>
          <th data-sort="slg">長打</th><th data-sort="ops">OPS</th>
        </tr></thead>
        <tbody>
          ${raw(rows.map((r) => {
            const rt = rates(r.bat);
            const dim = qual > 0 && r.bat.PA < qual;
            return `<tr class="${dim ? 'is-dim' : ''}" data-player="${esc(r.id)}">
              <td class="name">${esc(r.name)}${r.note ? ` <span class="badge">${esc(r.note)}</span>` : ''}</td>
              ${COLUMNS.map((c) => `<td>${r.bat[c.key] || 0}</td>`).join('')}
              <td style="font-weight:700">${fmtRate(rt.avg)}</td>
              <td>${fmtRate(rt.obp)}</td><td>${fmtRate(rt.slg)}</td><td>${fmtRate(rt.ops)}</td>
            </tr>`;
          }).join(''))}
        </tbody>
      </table></div>
    </div>
    <p class="small muted">
      列見出しをタップすると並べ替えできます。薄い行は規定打席に達していない選手です。
      選手名をタップすると年度別の内訳を表示します。
    </p>`;
}

/* ---------------- 投手 ---------------- */

function pitchingTableHTML(season) {
  const map = aggregatePitching(state.games, state.players, { season, personal: linkedPersonal() });
  const eraIn = state.settings.eraInnings || 9;
  const rows = [...map]
    .map(([pid, p]) => ({ id: pid, name: state.players.find((x) => x.id === pid)?.name || '(不明)', p }))
    .filter((r) => r.p.outs > 0 || r.p.BF > 0)
    .sort((a, b) => b.p.outs - a.p.outs);

  if (!rows.length) {
    return `<div class="card"><div class="empty">
      投手の記録がありません。<br>試合の「打順・守備」で投手を割り当てると集計されます。
    </div></div>`;
  }

  return `<div class="card">
    <div class="table-wrap"><table class="stats">
      <thead><tr>
        <th class="name">投手</th><th>登板</th><th>回</th><th>打者</th><th>被安打</th><th>被本</th>
        <th>奪三振</th><th>与四球</th><th>与死球</th><th>失点</th><th>自責</th>
        <th>勝</th><th>敗</th><th>S</th><th>防御率</th><th>WHIP</th><th>被打率</th>
      </tr></thead>
      <tbody>
        ${rows.map(({ id, name, p }) => {
          const rt = pitchRates(p, eraIn);
          return `<tr>
            <td class="name">${esc(name)}</td>
            <td>${p.G}</td><td>${formatIP(p.outs)}</td><td>${p.BF}</td><td>${p.H}</td><td>${p.HR}</td>
            <td>${p.SO}</td><td>${p.BB}</td><td>${p.HBP}</td><td>${p.R}</td><td>${p.ER}</td>
            <td>${p.W}</td><td>${p.L}</td><td>${p.SV}</td>
            <td style="font-weight:700">${fmtNum(rt.era)}</td><td>${fmtNum(rt.whip)}</td>
            <td>${fmtRate(rt.avg)}</td></tr>`;
        }).join('')}
      </tbody>
    </table></div>
  </div>
  <p class="small muted">
    投球回は 1/3 単位です。自責点は試合詳細の投手成績から手で直せます（未入力なら失点と同じ値）。
    防御率の基準イニングは設定タブで変えられます。
    メンバー画面で入力した過去の投手成績も合算しています。
  </p>`;
}

/* ---------------- 守備 ---------------- */

function fieldingTableHTML(season) {
  const map = aggregateFielding(state.games, state.players, { season, personal: linkedPersonal() });
  const rows = [...map]
    .map(([pid, f]) => ({ id: pid, name: state.players.find((x) => x.id === pid)?.name || '(不明)', f }))
    .filter((r) => r.f.E > 0)
    .sort((a, b) => b.f.E - a.f.E);

  const total = rows.reduce((n, r) => n + r.f.E, 0);

  if (!rows.length) {
    return `<div class="card"><div class="empty">失策の記録はありません。</div></div>`;
  }

  return `<div class="card card-pad" style="margin-bottom:12px">
    <div class="small muted">チーム失策 合計 <b style="color:var(--text);font-size:15px">${total}</b></div>
  </div>
  <div class="card">
    <div class="table-wrap"><table class="stats">
      <thead><tr>
        <th class="name">選手</th><th>失策</th><th>捕球</th><th>送球</th><th>その他</th><th class="name">位置別</th>
      </tr></thead>
      <tbody>
        ${rows.map(({ name, f }) => {
          const byPos = Object.entries(f.byPos)
            .sort((a, b) => b[1] - a[1])
            .map(([pos, n]) => `${POSITION_BY_CODE[pos]?.label || pos}${n}`).join(' ');
          return `<tr>
            <td class="name">${esc(name)}</td>
            <td style="font-weight:700">${f.E}</td><td>${f.catch}</td><td>${f.throw}</td><td>${f.other}</td>
            <td class="name" style="position:static">${esc(byPos)}</td></tr>`;
        }).join('')}
      </tbody>
    </table></div>
  </div>
  <p class="small muted">
    失策は自チームが守っている間のものだけを数えます。打席中・走塁中の両方が対象です。
  </p>`;
}

function buildRows(map) {
  const rows = [];
  for (const [pid, entry] of map) {
    const p = state.players.find((x) => x.id === pid);
    if (!p) continue;
    rows.push({
      id: pid,
      name: p.name,
      bat: entry.bat,
      note: [entry.fromLegacy ? '手入力' : '', entry.fromPersonal ? '個人記録' : ''].filter(Boolean).join('・') + (entry.fromApp && (entry.fromLegacy || entry.fromPersonal) ? '含' : '')
    });
  }

  const rateKeys = ['avg', 'obp', 'slg', 'ops'];
  rows.sort((a, b) => {
    if (rateKeys.includes(sortKey)) {
      const ra = rates(a.bat)[sortKey], rb = rates(b.bat)[sortKey];
      if (ra == null && rb == null) return b.bat.PA - a.bat.PA;
      if (ra == null) return 1;
      if (rb == null) return -1;
      if (rb !== ra) return rb - ra;
      return b.bat.PA - a.bat.PA;
    }
    const d = (b.bat[sortKey] || 0) - (a.bat[sortKey] || 0);
    return d !== 0 ? d : (a.name || '').localeCompare(b.name || '', 'ja');
  });
  return rows;
}

/* ---------------- 選手別の年度内訳 ---------------- */

async function playerDetail(playerId) {
  const p = state.players.find((x) => x.id === playerId);
  if (!p) return;

  const years = new Set();
  for (const g of state.games) if ((g.pas || []).some((pa) => pa.playerId === playerId)) years.add(seasonOf(g.date));
  for (const r of p.legacy || []) years.add(Number(r.season));
  const list = [...years].filter(Number.isFinite).sort((a, b) => b - a);

  const rowsHTML = list.map((y) => {
    const m = aggregate(state.games, state.players, { season: y, personal: linkedPersonal() });
    const e = m.get(playerId);
    const bat = e ? e.bat : emptyBat();
    const rt = rates(bat);
    const isLegacy = (p.legacy || []).some((r) => Number(r.season) === y);
    return `<tr>
      <td class="name">${y}${isLegacy ? ' <span class="badge">手入力</span>' : ''}</td>
      <td>${bat.G}</td><td>${bat.PA}</td><td>${bat.AB}</td><td>${bat.H}</td>
      <td>${bat.HR}</td><td>${bat.RBI}</td><td style="font-weight:700">${fmtRate(rt.avg)}</td>
      <td>${fmtRate(rt.ops)}</td></tr>`;
  }).join('');

  const career = aggregate(state.games, state.players, { season: null, personal: linkedPersonal() }).get(playerId);
  const cb = career ? career.bat : emptyBat();
  const crt = rates(cb);

  await sheet({
    title: `${p.name} の成績`,
    body: html`
      <div class="card card-pad" style="margin:0 0 12px">
        <div class="small muted">生涯通算</div>
        <div style="font-size:15px;font-weight:700;margin-top:2px">
          ${cb.G}試合 ${cb.AB}打数 ${cb.H}安打
        </div>
        <div class="small mono" style="margin-top:4px">
          打率 ${fmtRate(crt.avg)}　出塁 ${fmtRate(crt.obp)}　長打 ${fmtRate(crt.slg)}　OPS ${fmtRate(crt.ops)}
        </div>
        <div class="small muted mono" style="margin-top:4px">
          本${cb.HR} 点${cb.RBI} 得点${cb.R} 四死${cb.BB + cb.HBP} 三振${cb.SO} 盗塁${cb.SB} 失策${cb.E}
        </div>
      </div>
      <div class="card">
        <div class="table-wrap"><table class="stats">
          <thead><tr><th class="name">年度</th><th>試合</th><th>打席</th><th>打数</th>
            <th>安打</th><th>本</th><th>点</th><th>打率</th><th>OPS</th></tr></thead>
          <tbody>${raw(rowsHTML || '<tr><td class="name" colspan="9">記録がありません</td></tr>')}</tbody>
        </table></div>
      </div>`,
    actions: [{ label: '閉じる', value: true, kind: 'primary' }]
  });
}

/* ---------------- 書き出し ---------------- */

async function exportMenu() {
  const seasons = seasonsOf(state.games, state.players, linkedPersonal());
  const v = await sheet({
    title: '成績表を書き出す',
    body: html`
      <p class="small muted" style="margin:0 0 10px">
        1つの HTML ファイルとして書き出します。LINE などで送れば、受け取った人はタップするだけで閲覧できます。
      </p>
      <div class="pick-grid">
        <button data-v="">通算成績</button>
        ${raw(seasons.map((s) => `<button data-v="${s}">${s}年</button>`).join(''))}
      </div>`,
    onMount(modal, close) {
      modal.addEventListener('click', (e) => {
        const b = e.target.closest('[data-v]');
        if (b) close(b.dataset.v);
      });
    }
  });
  if (v == null) return;
  try {
    const r = await exportReport({ season: v === '' ? null : Number(v) });
    if (r !== 'cancelled') toast('成績表を書き出しました');
  } catch (err) {
    toast('書き出しに失敗しました', { danger: true });
  }
}
