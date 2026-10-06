/* 試合一覧・新規作成・試合詳細。 */

import {
  html, raw, esc, render, on, toast, formSheet, readFields,
  wireSegments, segment, confirmSheet, sheet
} from './common.js';
import { state, saveGame, removeGame, gameById, setPitcherStat } from '../store.js';
import {
  newGame, formatDate, seasonOf, totalRuns, gameOutcome, OUTCOME_LABEL,
  battingSide, halfLabel, PITCH_MODES, teamName, lineupSorted, pasSorted,
  RESULT_BY_CODE, directionLabel, defenseAt, POSITION_BY_CODE
} from '../model.js';
import {
  gameBatting, gamePitching, rates, fmtRate, summarizeLine,
  pitchRates, formatIP, fmtNum
} from '../stats.js';
import { go, rerender, backTo } from './router.js';
import { exportGameFile, exportGameReport } from '../backup.js';
import { buildBox, battingTableHTML } from '../boxscore.js';
import { modeSwitchHTML, wireModeSwitch } from './personal.js';

/* ==================== 一覧 ==================== */

export const gamesScreen = {
  title: () => '試合',
  action: () => ({ label: '＋ 新規', run: () => createGame() }),

  async render(view) {
    const games = state.games;
    const bySeason = new Map();
    for (const g of games) {
      const s = seasonOf(g.date);
      if (!bySeason.has(s)) bySeason.set(s, []);
      bySeason.get(s).push(g);
    }
    const seasons = [...bySeason.keys()].sort((a, b) => b - a);

    render(view, html`
      ${raw(modeSwitchHTML('team'))}
      ${games.length === 0 ? html`
        <div class="card"><div class="empty">
          まだ試合がありません。<br>右上の「＋ 新規」から作成してください。
        </div></div>
        <p class="small muted">先に「メンバー」タブで選手を登録しておくと、打順の設定がスムーズです。</p>
        <button class="btn btn-block" data-help>📖 使い方を見る</button>
      ` : raw(seasons.map((s) => {
        const list = bySeason.get(s);
        const w = list.filter((g) => gameOutcome(g) === 'win').length;
        const l = list.filter((g) => gameOutcome(g) === 'lose').length;
        const d = list.filter((g) => gameOutcome(g) === 'draw').length;
        return `
          <h2 class="section">${s}年 ・ ${list.length}試合 ・ ${w}勝${l}敗${d}分</h2>
          <div class="card"><ul class="list">
            ${list.map((g) => gameRow(g)).join('')}
          </ul></div>`;
      }).join(''))}
    `);

    wireModeSwitch(view);
    on(view, 'click', '[data-help]', () => go('help', {}));
    on(view, 'click', '[data-game]', (e, b) => go('gameDetail', { id: b.dataset.game }));
  }
};

function gameRow(g) {
  const our = totalRuns(g, 'our');
  const opp = totalRuns(g, 'opp');
  const oc = gameOutcome(g);
  const live = g.status !== 'final';
  const badge = live
    ? '<span class="badge badge-live">記録中</span>'
    : oc ? `<span class="badge ${oc === 'win' ? 'badge-our' : 'badge-opp'}">${OUTCOME_LABEL[oc]}</span>` : '';
  const paCount = (g.pas || []).length;
  return `<li><button class="row" data-game="${esc(g.id)}">
    <div class="row-main">
      <div class="row-title">vs ${esc(g.opponent || '（相手未設定）')} ${badge}</div>
      <div class="row-sub">${esc(formatDate(g.date))}${g.time ? ' ' + esc(g.time) : ''}${g.venue ? ' ・ ' + esc(g.venue) : ''}${paCount ? ` ・ ${paCount}打席` : ''}</div>
    </div>
    <span class="row-aside mono" style="font-size:15px;font-weight:700;color:var(--text)">${our} - ${opp}</span>
    <span class="chev">›</span>
  </button></li>`;
}

/* ==================== 新規作成・基本情報の編集 ==================== */

export async function createGame() {
  const g = newGame(state.settings);
  const saved = await gameInfoSheet(g, { isNew: true });
  if (saved) go('lineup', { id: saved.id });
}

async function gameInfoSheet(g, { isNew = false } = {}) {
  const body = html`
    <div class="card" style="margin:0 0 12px">
      <div class="field-row is-datetime">
        <label class="field"><span>日付</span>
          <input name="date" type="date" value="${g.date}"></label>
        <label class="field"><span>開始時刻</span>
          <input name="time" type="time" value="${g.time || ''}"></label>
      </div>
      <label class="field"><span>対戦相手</span>
        <input name="opponent" type="text" value="${g.opponent || ''}" placeholder="○○クラブ" autocomplete="off"></label>
      <label class="field"><span>球場</span>
        <input name="venue" type="text" value="${g.venue || ''}" placeholder="市営第2グラウンド" autocomplete="off"></label>
      <div class="field-row">
        <label class="field"><span>イニング数</span>
          <input name="innings" type="number" inputmode="numeric" min="1" max="15" value="${g.innings}"></label>
        <label class="field"><span>相手の打順人数<span class="tiny"> 分かる範囲で</span></span>
          <input name="oppOrderCount" type="number" inputmode="numeric" min="1" max="30" value="${g.oppOrderCount || 9}"></label>
      </div>
      <div class="field"><span>先攻 / 後攻</span>${segment('isHome', [
        { value: '0', label: '先攻（表に攻撃）' }, { value: '1', label: '後攻（裏に攻撃）' }
      ], g.isHome ? '1' : '0')}</div>
      <div class="field"><span>球数の記録</span>${segment('pitchMode',
        PITCH_MODES.map((m) => ({ value: m.code, label: m.label })), g.pitchMode)}</div>
      <label class="field"><span>メモ</span>
        <input name="memo" type="text" value="${g.memo || ''}" placeholder="任意"></label>
    </div>
    <p class="small muted">
      球数の記録方法は試合ごとに変えられます。迷ったら「記録しない」で始めてください。<br>
      相手の打順人数は目安で構いません。試合中は打席が進むたびに自動で増え、
      1番に戻ったところで「打順を確定」を押せば以降は巡回します。
    </p>
  `;

  const { action, values } = await formSheet({
    title: isNew ? '新しい試合' : '試合情報を編集',
    body,
    okLabel: isNew ? '作成' : '保存',
    read: readFields,
    onMount: (modal) => wireSegments(modal)
  });
  if (action !== 'ok' || !values) return null;

  const rec = {
    ...g,
    date: values.date || g.date,
    time: values.time || '',
    opponent: (values.opponent || '').trim(),
    venue: (values.venue || '').trim(),
    innings: Math.max(1, Math.min(15, Number(values.innings) || 7)),
    oppOrderCount: Math.max(1, Math.min(20, Number(values.oppOrderCount) || 9)),
    isHome: values.isHome === '1',
    pitchMode: values.pitchMode || 'none',
    memo: values.memo || ''
  };
  const out = await saveGame(rec);
  toast(isNew ? '試合を作成しました' : '保存しました');
  return out;
}

/* ==================== 試合詳細 ==================== */

export const gameDetailScreen = {
  title: (p) => {
    const g = gameById(p.id);
    return g ? `vs ${g.opponent || '相手'}` : '試合';
  },
  action: (p) => ({ label: '編集', run: async () => {
    const g = gameById(p.id);
    if (g && await gameInfoSheet(g)) rerender();
  } }),

  async render(view, params) {
    const g = gameById(params.id);
    if (!g) { render(view, html`<div class="empty">試合が見つかりません</div>`); return; }

    const live = g.status !== 'final';
    const batting = gameBatting(g);
    const pitching = gamePitching(g);
    const box = buildBox(g, { games: state.games, players: state.players, settings: state.settings });
    const lineup = lineupSorted(g);
    const oc = gameOutcome(g);

    render(view, html`
      <div class="card card-pad">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <div style="flex:1">
            <div style="font-weight:700">${formatDate(g.date)}${g.time ? ' ' + g.time : ''}</div>
            <div class="small muted">${g.venue || '球場未設定'} ・ ${g.innings}回制 ・ ${g.isHome ? '後攻' : '先攻'}</div>
          </div>
          ${live ? raw('<span class="badge badge-live">記録中</span>')
                 : oc ? raw(`<span class="badge ${oc === 'win' ? 'badge-our' : 'badge-opp'}">${OUTCOME_LABEL[oc]}</span>`) : ''}
        </div>
        ${raw(linescoreHTML(g))}
      </div>

      <div class="btn-row">
        <button class="btn btn-primary" data-score>${live ? '打席入力を続ける' : '記録を見る・修正'}</button>
        <button class="btn" data-lineup>打順・守備</button>
      </div>

      <h2 class="section">打撃成績（この試合）</h2>
      <div class="card">
        ${lineup.length === 0
          ? html`<div class="empty small">打順が未設定です。「打順・守備」から設定してください。</div>`
          : raw(battingTableHTML(box.our, box.innings, { cls: 'stats box' }))}
      </div>
      ${lineup.length ? html`<p class="small muted">打率はこの試合までのシーズン成績です。赤字は安打。</p>` : ''}

      <h2 class="section">投手成績（この試合）</h2>
      <div class="card">
        ${pitching.size === 0
          ? html`<div class="empty small">投手の記録がありません。守備配置で投手を割り当ててください。</div>`
          : raw(`<div class="table-wrap"><table class="stats">
              <thead><tr>
                <th class="name">投手</th><th>回</th><th>打者</th><th>被安打</th><th>被本</th>
                <th>奪三振</th><th>与四球</th><th>与死球</th><th>失点</th><th>自責</th><th>防御率</th><th>勝敗</th>
              </tr></thead>
              <tbody>
                ${[...pitching].map(([pid, p]) => {
                  const rt = pitchRates(p, state.settings.eraInnings || 9);
                  const dec = (g.pitching || {})[pid]?.decision;
                  const decLabel = dec === 'W' ? '勝' : dec === 'L' ? '敗' : dec === 'SV' ? 'S' : '';
                  return `<tr data-pitcher="${esc(pid)}">
                    <td class="name">${esc(state.players.find((x) => x.id === pid)?.name || '(不明)')}</td>
                    <td>${formatIP(p.outs)}</td><td>${p.BF}</td><td>${p.H}</td><td>${p.HR}</td>
                    <td>${p.SO}</td><td>${p.BB}</td><td>${p.HBP}</td><td>${p.R}</td><td>${p.ER}</td>
                    <td>${fmtNum(rt.era)}</td><td>${decLabel}</td></tr>`;
                }).join('')}
              </tbody></table></div>`)}
      </div>
      ${pitching.size ? html`<p class="small muted">
        投手名をタップすると自責点と勝敗を入力できます。自責点は未入力なら失点と同じ値になります。
      </p>` : ''}

      <h2 class="section">打席の記録（${(g.pas || []).length}打席）</h2>
      <div class="card">
        ${(g.pas || []).length === 0
          ? html`<div class="empty small">まだ記録がありません</div>`
          : raw(`<ul class="list pa-log" style="max-height:none">${paLogHTML(g)}</ul>`)}
      </div>

      ${g.memo ? html`<h2 class="section">メモ</h2><div class="card card-pad small">${g.memo}</div>` : ''}

      <div class="btn-row" style="margin-top:18px">
        <button class="btn btn-primary" data-export-html>試合結果を書き出す（HTML）</button>
      </div>
      <button class="btn btn-block" data-export style="margin-bottom:10px">試合データを書き出す（取り込み用）</button>
      <button class="btn btn-block ${live ? 'btn-primary' : ''}" data-finalize style="margin-bottom:10px">
        ${live ? '試合を確定する' : '記録中に戻す'}
      </button>
      <button class="btn btn-danger btn-block" data-delete>この試合を削除</button>
      <p class="small muted" style="margin-top:10px">
        削除するとこの試合の打席記録は元に戻せません。念のため先に書き出しておくことをおすすめします。
      </p>
    `);

    on(view, 'click', '[data-pitcher]', async (e, tr) => {
      const pid = tr.dataset.pitcher;
      const p = pitching.get(pid);
      const cur = (g.pitching || {})[pid] || {};
      const { action, values } = await formSheet({
        title: `${state.players.find((x) => x.id === pid)?.name || '投手'} の記録`,
        body: html`
          <div class="card card-pad small muted" style="margin:0 0 12px">
            ${formatIP(p.outs)}回 ・ 被安打${p.H} ・ 奪三振${p.SO} ・ 与四死球${p.BB + p.HBP} ・ 失点${p.R}
          </div>
          <div class="card" style="margin:0 0 12px">
            <label class="field"><span>自責点<span class="tiny"> 空欄なら失点と同じ（${p.R}）</span></span>
              <input name="er" type="number" inputmode="numeric" min="0" max="99"
                     value="${cur.er ?? ''}" placeholder="${p.R}"></label>
            <div class="field"><span>勝敗</span>${segment('decision', [
              { value: '', label: 'なし' }, { value: 'W', label: '勝' },
              { value: 'L', label: '敗' }, { value: 'SV', label: 'S' }
            ], cur.decision || '')}</div>
          </div>
          <p class="small muted">
            失策がからんだ得点は自責点に入りません。該当する場合はここで減らしてください。
          </p>`,
        read: readFields,
        onMount: (modal) => wireSegments(modal)
      });
      if (action !== 'ok' || !values) return;
      await setPitcherStat(g, pid, {
        er: values.er === '' ? null : Math.max(0, Number(values.er) || 0),
        decision: values.decision || null
      });
      toast('保存しました');
      rerender();
    });

    on(view, 'click', '[data-score]', () => go('score', { id: g.id }));
    on(view, 'click', '[data-lineup]', () => go('lineup', { id: g.id }));
    on(view, 'click', '[data-export]', () => exportGameFile(g));
    on(view, 'click', '[data-export-html]', async () => {
      const r = await exportGameReport(g);
      if (r !== 'cancelled') toast('試合結果を書き出しました');
    });

    on(view, 'click', '[data-finalize]', async () => {
      g.status = live ? 'final' : 'in_progress';
      await saveGame(g);
      toast(live ? '試合を確定しました' : '記録中に戻しました');
      rerender();
    });

    on(view, 'click', '[data-delete]', async () => {
      const ok = await confirmSheet(
        `vs ${g.opponent || '相手'}（${formatDate(g.date)}）を削除しますか？\nこの試合の${(g.pas || []).length}打席の記録が失われます。`,
        { title: '試合の削除', okLabel: '削除する', danger: true });
      if (!ok) return;
      await removeGame(g.id);
      toast('削除しました');
      backTo('games');
    });
  }
};

/* ---------------- 部品 ---------------- */

/**
 * その側が実際に攻撃を終えた（または攻撃中の）最終イニング。
 * 7回制で5回に終わった試合を7回まで 0 で埋めてしまうと
 * 何回で終わったのか判らなくなるため、到達した回までしか表示しない。
 */
function lastPlayedInning(g, side) {
  let last = 0;
  for (const pa of g.pas || []) {
    if (battingSide(g, pa.half) === side) last = Math.max(last, pa.inning);
  }
  const runs = g.runs?.[side] || [];
  for (let i = 0; i < runs.length; i++) if (runs[i] != null) last = Math.max(last, i + 1);

  if (g.status !== 'final') {
    const cur = g.cur || { inning: 1, half: 'top' };
    if (battingSide(g, cur.half) === side) last = Math.max(last, cur.inning);
    else last = Math.max(last, cur.inning - (cur.half === 'bottom' ? 0 : 1));
  }
  return last;
}

export function linescoreHTML(g, { highlightCur = false } = {}) {
  const n = Math.max(g.innings, (g.runs?.our || []).length, (g.runs?.opp || []).length, g.cur?.inning || 1);
  const cells = (side) => {
    const arr = g.runs?.[side] || [];
    const last = lastPlayedInning(g, side);
    let out = '';
    for (let i = 1; i <= n; i++) {
      const isCur = highlightCur && g.cur?.inning === i && battingSide(g, g.cur.half) === side;
      out += `<td class="${isCur ? 'cur' : ''}">${i <= last ? (arr[i - 1] || 0) : ''}</td>`;
    }
    return out;
  };
  const ourName = teamName(g, 'our', state.settings);
  const oppName = g.opponent || '相手';
  // 先攻が上の行
  const first = g.isHome ? 'opp' : 'our';
  const second = g.isHome ? 'our' : 'opp';
  const nameOf = (s) => (s === 'our' ? ourName : oppName);

  return `<div class="linescore-wrap"><table class="linescore">
    <thead><tr><th style="min-width:92px">チーム</th>
      ${Array.from({ length: n }, (_, i) => `<th>${i + 1}</th>`).join('')}
      <th style="min-width:34px">計</th></tr></thead>
    <tbody>
      <tr><td class="team">${esc(nameOf(first))}</td>${cells(first)}<td class="total">${totalRuns(g, first)}</td></tr>
      <tr><td class="team">${esc(nameOf(second))}</td>${cells(second)}<td class="total">${totalRuns(g, second)}</td></tr>
    </tbody></table></div>`;
}

export function paLogHTML(g, { limit = 0 } = {}) {
  let list = pasSorted(g);
  if (limit) list = list.slice(-limit).reverse();
  else list = list.reverse();
  return list.map((pa) => {
    const side = battingSide(g, pa.half);
    const who = side === 'our'
      ? `${pa.order}. ${esc(state.players.find((p) => p.id === pa.playerId)?.name || '(不明)')}`
      : `相手 ${pa.order}番`;
    const r = RESULT_BY_CODE[pa.result];
    const dir = pa.dir ? directionLabel(pa.dir) : '';
    const extra = [
      pa.rbi ? `打点${pa.rbi}` : '',
      pa.count ? `${pa.count}` : '',
      pa.pitches ? `${pa.pitches}球` : ''
    ].filter(Boolean).join(' ');
    return `<li data-pa="${esc(pa.id)}">
      <span class="inn">${pa.inning}${halfLabel(pa.half)}</span>
      <span class="who" style="color:${side === 'our' ? 'var(--our)' : 'var(--opp)'}">${who}</span>
      <span class="res">${dir}${esc(r ? r.label : pa.result)}${extra ? ` <span class="muted tiny">${extra}</span>` : ''}</span>
    </li>`;
  }).join('');
}
