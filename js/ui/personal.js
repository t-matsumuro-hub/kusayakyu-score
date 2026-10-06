/* 個人成績モード。
   チームのスコアを付けなくても、選手ひとりぶんの成績だけを残せる。
   入力は2通り用意する：
     打席ごとに入力 … スコア入力と同じ感覚で1打席ずつ積む
     合計を直接入力 … 「4打数2安打」のようにまとめて書く
   投手成績は結果だけの簡易入力。 */

import {
  html, raw, esc, render, on, toast, sheet, formSheet, readFields,
  wireSegments, segment, confirmSheet, pickPlayer
} from './common.js';
import {
  state, saveSettings, playersSorted, playerName, personalById, personalOf,
  savePersonal, removePersonal, addPersonalPA, updatePersonalPA, removePersonalPA
} from '../store.js';
import {
  RESULTS, RESULT_BY_CODE, DIRECTIONS, DIRECTION_LAYOUT, directionLabel,
  formatDate, seasonOf, todayISO, newPersonalGame,
  PERSONAL_SOURCES, PITCH_INPUT_FIELDS
} from '../model.js';
import {
  personalBatting, personalPitching, aggregatePersonal, personalSeasons,
  rates, fmtRate, formatIP, pitchRates, fmtNum, summarizeLine, LEGACY_FIELDS,
  aggregatePlayerAll, playedIn, personalLinkStatus, gameBatting, gamePitching
} from '../stats.js';
import { go, rerender, back, backTo } from './router.js';

/* ---------------- 選手の選択 ---------------- */

function currentPlayer() {
  const id = state.settings.personalPlayerId;
  return state.players.find((p) => p.id === id) || null;
}

async function choosePlayer() {
  const list = playersSorted({ includeRetired: true });
  if (!list.length) { toast('先にメンバーを登録してください', { danger: true }); return null; }
  const pid = await pickPlayer(
    list.map((p) => ({ id: p.id, name: p.name, sub: p.retired ? '引退' : (p.number ? `背番号 ${p.number}` : '') })),
    { title: '成績を入力するメンバー' });
  if (!pid) return null;
  await saveSettings({ personalPlayerId: pid });
  return pid;
}

/** モード切替（チームのスコア入力 ⇄ 個人成績入力） */
export function modeSwitchHTML(mode) {
  return `<div class="seg" data-appmode style="margin-bottom:12px">
    <button class="${mode === 'team' ? 'is-on' : ''}" data-mode="team">試合のスコア</button>
    <button class="${mode === 'personal' ? 'is-on' : ''}" data-mode="personal">個人成績</button>
  </div>`;
}

export function wireModeSwitch(view) {
  on(view, 'click', '[data-mode]', async (e, b) => {
    const m = b.dataset.mode;
    if (m === state.settings.appMode) return;
    await saveSettings({ appMode: m });
    go(m === 'personal' ? 'personal' : 'games', {}, { resetTo: true });
  });
}

/* ==================== 一覧画面 ==================== */

export const personalScreen = {
  title: () => '個人成績',
  action: () => ({ label: '＋ 記録', run: () => createRecord() }),

  async render(view) {
    const p = currentPlayer();
    const records = p ? personalOf(p.id) : [];
    const teamGames = p && linked() ? state.games.filter((g) => playedIn(g, p.id)) : [];
    const thisYear = seasonOf(todayISO());
    const career = p ? playerAgg(p.id, null) : null;
    const yearAgg = p ? playerAgg(p.id, thisYear) : null;

    // チームの試合と個人記録を日付順に1本の一覧にする
    const items = [
      ...records.map((r) => ({ kind: 'personal', date: r.date, at: r.createdAt || '', r })),
      ...teamGames.map((g) => ({ kind: 'team', date: g.date, at: g.createdAt || '', g }))
    ].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.at.localeCompare(a.at));

    render(view, html`
      ${raw(modeSwitchHTML('personal'))}

      <div class="card">
        <button class="row" data-pick>
          <div class="row-main">
            <div class="row-title">${p ? esc(p.name) : '選手を選ぶ'}</div>
            <div class="row-sub">${p
              ? `個人記録 ${records.length}件${linked() ? ` ・ チームの試合 ${teamGames.length}件` : ''}`
              : 'メンバーから選択してください'}</div>
          </div><span class="chev">›</span>
        </button>
      </div>

      ${!p ? html`
        <div class="card"><div class="empty">
          上のボタンからメンバーを選ぶと、その人の成績を入力できます。
        </div></div>
      ` : html`
        <h2 class="section">${thisYear}年 / 通算</h2>
        <div class="card card-pad">
          ${raw(summaryHTML('今年', yearAgg))}
          <div style="height:10px"></div>
          ${raw(summaryHTML('通算', career))}
          ${linked() ? raw(`<div class="tiny muted" style="margin-top:8px">${sourceNote(career)}</div>`) : ''}
        </div>

        <div class="btn-row">
          <button class="btn" data-stats>年度別の成績を見る</button>
        </div>

        <h2 class="section">試合の記録（${items.length}件）</h2>
        <div class="card">
          ${items.length === 0
            ? html`<div class="empty small">
                まだありません。右上の「＋ 記録」から追加してください。
              </div>`
            : raw(`<ul class="list">${items.map((it) =>
                it.kind === 'team' ? teamRow(it.g, p.id) : recordRow(it.r)).join('')}</ul>`)}
        </div>

        <p class="small muted" style="margin-top:10px">
          ${linked()
            ? '「チーム」の行はチームのスコア入力で記録した試合です（ここからは閲覧のみ）。同じ試合を個人記録にも入れた場合は、自動でチーム側だけを数えます。'
            : 'チームの成績との連携はオフです（設定タブで変更できます）。'}
        </p>
      `}
    `);

    wireModeSwitch(view);
    on(view, 'click', '[data-pick]', async () => { if (await choosePlayer()) rerender(); });
    on(view, 'click', '[data-rec]', (e, b) => go('personalGame', { id: b.dataset.rec }));
    on(view, 'click', '[data-team-game]', (e, b) => go('gameDetail', { id: b.dataset.teamGame }));
    on(view, 'click', '[data-stats]', () => go('personalStats', {}));
  }
};

/* ---------------- チームの成績との連携 ---------------- */

function linked() { return state.settings.linkPersonal !== false; }

/** 選手1人の成績。連携オンならチームの試合と過去成績も合算する。 */
function playerAgg(playerId, season) {
  if (!linked()) return aggregatePersonal(personalOf(playerId), { season });
  return aggregatePlayerAll(playerId, {
    games: state.games, personal: state.personal, players: state.players, season
  });
}

/** 選手に記録がある年度（チームの試合・個人記録・過去成績の和集合） */
function playerSeasons(p) {
  const set = new Set(personalSeasons(personalOf(p.id)));
  if (linked()) {
    for (const g of state.games) if (playedIn(g, p.id)) set.add(seasonOf(g.date));
    for (const r of p.legacy || []) set.add(Number(r.season));
  }
  return [...set].filter(Number.isFinite).sort((a, b) => b - a);
}

function sourceNote(agg) {
  if (!agg) return '';
  const parts = [];
  if (agg.teamGames) parts.push(`チームの試合 ${agg.teamGames}`);
  if (agg.personalGames) parts.push(`個人記録 ${agg.personalGames}`);
  if (agg.legacyGames) parts.push(`過去成績 ${agg.legacyGames}`);
  return parts.length ? `内訳（試合数）：${parts.join(' ／ ')}` : '';
}

function teamRow(g, playerId) {
  const bat = gameBatting(g).get(playerId);
  const pitch = gamePitching(g).get(playerId);
  return `<li><button class="row" data-team-game="${esc(g.id)}">
    <div class="row-main">
      <div class="row-title">${esc(formatDate(g.date))}${g.opponent ? ` vs ${esc(g.opponent)}` : ''}</div>
      <div class="row-sub mono">${esc(summarizeLine(bat) || '打席なし')}${pitch && pitch.outs ? ` ／ 投 ${formatIP(pitch.outs)}回` : ''}</div>
    </div>
    <span class="badge badge-our">チーム</span>
    <span class="chev">›</span>
  </button></li>`;
}

function summaryHTML(label, agg) {
  const rt = rates(agg.bat);
  const b = agg.bat;
  const pt = agg.pitch;
  const prt = pitchRates(pt, state.settings.eraInnings || 9);
  return `<div class="small muted">${label}</div>
    <div style="font-weight:700;margin-top:2px">
      ${agg.games}試合 ${b.PA}打席 ${b.AB}打数 ${b.H}安打 <span class="mono">打率 ${fmtRate(rt.avg)}</span>
    </div>
    <div class="small mono" style="margin-top:2px">
      出塁 ${fmtRate(rt.obp)}　長打 ${fmtRate(rt.slg)}　OPS ${fmtRate(rt.ops)}
    </div>
    <div class="small muted mono" style="margin-top:2px">
      二${b.H2} 三${b.H3} 本${b.HR} 点${b.RBI} 得点${b.R} 四球${b.BB} 死球${b.HBP} 三振${b.SO}
    </div>
    <div class="small muted mono" style="margin-top:2px">
      犠打${b.SH} 犠飛${b.SF} 併殺${b.GIDP} 盗塁${b.SB} 盗塁死${b.CS} 失策${b.E}
    </div>
    ${agg.pitchGames ? `<div class="small muted mono" style="margin-top:2px">
      投手 ${agg.pitchGames}登板 ${formatIP(pt.outs)}回 防御率 ${fmtNum(prt.era)} ${pt.W}勝${pt.L}敗
    </div>` : ''}`;
}

function recordRow(r) {
  const bat = personalBatting(r);
  const pitch = personalPitching(r);
  const src = r.source === 'manual' ? '直接入力' : `${(r.pas || []).length}打席`;
  const st = linked() ? personalLinkStatus(r, state.games) : null;
  return `<li><button class="row" data-rec="${esc(r.id)}">
    <div class="row-main">
      <div class="row-title">${esc(formatDate(r.date))}${r.opponent ? ` vs ${esc(r.opponent)}` : ''}
        ${st && !st.counted ? '<span class="badge badge-warn">集計外</span>' : ''}</div>
      <div class="row-sub mono">${esc(summarizeLine(bat) || '記録なし')}${pitch ? ` ／ 投 ${formatIP(pitch.outs)}回` : ''}</div>
      ${st && st.duplicate && !st.counted ? '<div class="row-sub">チームの試合と重複しているため、チーム側を採用</div>' : ''}
    </div>
    <span class="row-aside">${src}</span>
    <span class="chev">›</span>
  </button></li>`;
}

/* ==================== 記録の作成・基本情報 ==================== */

async function createRecord() {
  let p = currentPlayer();
  if (!p) {
    const pid = await choosePlayer();
    if (!pid) return;
    p = state.players.find((x) => x.id === pid);
  }
  const rec = newPersonalGame(p.id);
  const saved = await recordInfoSheet(rec, { isNew: true });
  if (saved) go('personalGame', { id: saved.id });
}

async function recordInfoSheet(rec, { isNew = false } = {}) {
  const body = html`
    <div class="card" style="margin:0 0 12px">
      <label class="field"><span>日付</span>
        <input name="date" type="date" value="${rec.date}"></label>
      <label class="field"><span>対戦相手</span>
        <input name="opponent" type="text" value="${rec.opponent || ''}" placeholder="○○クラブ"></label>
      <label class="field"><span>球場</span>
        <input name="venue" type="text" value="${rec.venue || ''}" placeholder="任意"></label>
      <div class="field"><span>入力方式</span>${segment('source',
        PERSONAL_SOURCES.map((s) => ({ value: s.v, label: s.label })), rec.source)}</div>
      <label class="field"><span>メモ</span>
        <input name="memo" type="text" value="${rec.memo || ''}" placeholder="任意"></label>
    </div>
    <p class="small muted">
      ${raw(PERSONAL_SOURCES.map((s) => `<b>${esc(s.label)}</b>：${esc(s.hint)}`).join('<br>'))}
    </p>`;

  const { action, values } = await formSheet({
    title: isNew ? '個人記録を追加' : '記録の基本情報',
    body,
    okLabel: isNew ? '作成' : '保存',
    read: readFields,
    onMount: (modal) => wireSegments(modal)
  });
  if (action !== 'ok' || !values) return null;

  const out = await savePersonal({
    ...rec,
    date: values.date || rec.date,
    opponent: (values.opponent || '').trim(),
    venue: (values.venue || '').trim(),
    source: values.source || 'pa',
    memo: values.memo || ''
  });
  toast(isNew ? '記録を作成しました' : '保存しました');
  return out;
}

/* ==================== 1試合ぶんの記録 ==================== */

export const personalGameScreen = {
  title: () => '個人記録',
  action: (p) => ({ label: '編集', run: async () => {
    const rec = personalById(p.id);
    if (rec && await recordInfoSheet(rec)) rerender();
  } }),

  async render(view, params) {
    const rec = personalById(params.id);
    if (!rec) { render(view, html`<div class="empty">記録が見つかりません</div>`); return; }
    const bat = personalBatting(rec);
    const rt = rates(bat);
    const pitch = personalPitching(rec);
    const extra = rec.extra || {};

    render(view, html`
      <div class="card card-pad">
        <div style="font-weight:700">${esc(playerName(rec.playerId))}</div>
        <div class="small muted">
          ${formatDate(rec.date)}${rec.opponent ? ` ・ vs ${rec.opponent}` : ''}${rec.venue ? ` ・ ${rec.venue}` : ''}
        </div>
        <div class="small mono" style="margin-top:8px">
          ${bat.PA}打席 ${bat.AB}打数 ${bat.H}安打
        </div>
        <div class="small mono" style="margin-top:2px">
          打率 ${fmtRate(rt.avg)}　出塁 ${fmtRate(rt.obp)}　長打 ${fmtRate(rt.slg)}　OPS ${fmtRate(rt.ops)}
        </div>
      </div>

      ${raw(linkCardHTML(rec))}

      <h2 class="section">打撃（${rec.source === 'manual' ? '合計を直接入力' : '打席ごとに入力'}）</h2>

      ${rec.source === 'manual' ? html`
        <div class="card card-pad">
          ${raw(manualSummaryHTML(bat))}
        </div>
        <button class="btn btn-primary btn-block" data-edit-manual>合計を入力・修正</button>
      ` : html`
        <div class="card">
          ${(rec.pas || []).length === 0
            ? html`<div class="empty small">まだ打席がありません</div>`
            : raw(`<ul class="list">${[...rec.pas].sort((a, b) => a.seq - b.seq).map((pa) => `
                <li><button class="row" data-pa="${esc(pa.id)}">
                  <span class="ord">${pa.seq}</span>
                  <div class="row-main">
                    <div class="row-title">${pa.dir ? esc(directionLabel(pa.dir)) : ''}${esc(RESULT_BY_CODE[pa.result]?.label || pa.result)}</div>
                    ${pa.rbi ? `<div class="row-sub">打点 ${pa.rbi}</div>` : ''}
                  </div>
                  <span class="chev">›</span>
                </button></li>`).join('')}</ul>`)}
        </div>
        <button class="btn btn-primary btn-block" data-add-pa>＋ 打席を追加</button>
      `}

      <h2 class="section">打席から出せない項目</h2>
      <div class="card">
        <button class="row" data-edit-extra>
          <div class="row-main">
            <div class="row-title">得点・盗塁・失策</div>
            <div class="row-sub mono">得点${extra.R || 0} 盗塁${extra.SB || 0} 盗塁死${extra.CS || 0} 失策${extra.E || 0}</div>
          </div><span class="chev">›</span>
        </button>
      </div>

      <h2 class="section">投手成績（登板した場合）</h2>
      <div class="card">
        <button class="row" data-edit-pitch>
          <div class="row-main">
            <div class="row-title">${pitch ? '登板あり' : '登板なし'}</div>
            ${pitch ? html`<div class="row-sub mono">
              ${formatIP(pitch.outs)}回 被安${pitch.H} 三振${pitch.SO} 与四死${pitch.BB + pitch.HBP} 失点${pitch.R} 自責${pitch.ER}
              ${pitch.W ? ' 勝' : ''}${pitch.L ? ' 敗' : ''}${pitch.SV ? ' S' : ''}
            </div>` : html`<div class="row-sub">タップして入力</div>`}
          </div><span class="chev">›</span>
        </button>
      </div>

      ${rec.memo ? html`<h2 class="section">メモ</h2><div class="card card-pad small">${rec.memo}</div>` : ''}

      <button class="btn btn-primary btn-block" style="margin-top:20px" data-done>
        入力完了（一覧に戻る）
      </button>
      <p class="tiny muted center" style="margin:6px 0 0">
        入力した内容は自動で保存されています。
      </p>

      <button class="btn btn-danger btn-block" style="margin-top:18px" data-delete>この記録を削除</button>
    `);

    on(view, 'click', '[data-done]', async () => {
      toast('保存しました');
      // 履歴に一覧が無い場合（直接開いた場合）でも一覧へ移動する
      const moved = await backTo('personal');
      if (!moved) go('personal', {}, { resetTo: true });
    });

    on(view, 'click', '[data-link]', async (e, b) => {
      await savePersonal({ ...rec, link: b.dataset.link });
      rerender();
    });
    on(view, 'click', '[data-open-team]', (e, b) => go('gameDetail', { id: b.dataset.openTeam }));
    on(view, 'click', '[data-add-pa]', () => editPA(rec, null));
    on(view, 'click', '[data-pa]', (e, b) => editPA(rec, b.dataset.pa));
    on(view, 'click', '[data-edit-manual]', () => editManual(rec));
    on(view, 'click', '[data-edit-extra]', () => editExtra(rec));
    on(view, 'click', '[data-edit-pitch]', () => editPitch(rec));
    on(view, 'click', '[data-delete]', async () => {
      const ok = await confirmSheet(
        `${formatDate(rec.date)} の記録を削除しますか？`, { okLabel: '削除', danger: true });
      if (!ok) return;
      await removePersonal(rec.id);
      toast('削除しました');
      back();
    });
  }
};

/** チームの成績との連携状態。重複が見つかったときは採否を選べる。 */
function linkCardHTML(rec) {
  if (!linked()) return '';
  const st = personalLinkStatus(rec, state.games);
  const mode = rec.link || 'auto';
  const opt = (v, label) =>
    `<button type="button" data-link="${v}" class="${mode === v ? 'is-on' : ''}">${label}</button>`;

  if (!st.duplicate && mode === 'auto') {
    return `<div class="card card-pad small muted">
      この記録はチームの成績にも合算されます。
    </div>`;
  }
  return `<div class="card card-pad">
    ${st.duplicate ? `<div class="small" style="margin-bottom:8px;color:var(--warn);font-weight:700">
      同じ日のチームの試合（vs ${esc(st.game.opponent || '相手')}）に記録があります
    </div>
    <button class="btn btn-sm btn-block" style="margin-bottom:10px" data-open-team="${esc(st.game.id)}">チームの試合を開く</button>` : ''}
    <div class="small muted" style="margin-bottom:6px">この記録を成績に数えるか</div>
    <div class="seg">
      ${opt('auto', '自動')}${opt('include', '数える')}${opt('exclude', '数えない')}
    </div>
    <div class="tiny muted" style="margin-top:6px">
      現在：<b>${st.counted ? '数えている' : '数えていない'}</b>。
      「自動」は、同じ試合がチーム側にあればそちらを優先して二重に数えません。
      ダブルヘッダーなど別の試合なら「数える」にしてください。
    </div>
  </div>`;
}

function manualSummaryHTML(bat) {
  const rows = [
    ['打席', bat.PA], ['打数', bat.AB], ['安打', bat.H], ['二塁打', bat.H2],
    ['三塁打', bat.H3], ['本塁打', bat.HR], ['塁打', bat.TB], ['打点', bat.RBI],
    ['四球', bat.BB], ['死球', bat.HBP], ['三振', bat.SO], ['犠打', bat.SH],
    ['犠飛', bat.SF], ['併殺', bat.GIDP]
  ];
  return `<div class="mono small" style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px 10px">
    ${rows.map(([k, v]) => `<div><span class="muted">${k}</span> ${v}</div>`).join('')}
  </div>`;
}

/* ---------------- 打席の入力 ---------------- */

async function editPA(rec, paId) {
  const pa = paId ? (rec.pas || []).find((p) => p.id === paId) : null;
  const isNew = !pa;

  const code = await sheet({
    title: isNew ? '打席の結果' : '結果を選び直す',
    body: html`<div class="result-grid">
      ${raw(RESULTS.map((r) => `<button class="rbtn k-${r.kind} ${pa && pa.result === r.code ? 'is-on' : ''}"
        data-v="${r.code}">${esc(r.label)}</button>`).join(''))}
    </div>
    ${!isNew ? raw('<button class="btn btn-danger btn-block" style="margin-top:12px" data-v="__del">この打席を削除</button>') : ''}`,
    onMount(modal, close) {
      modal.addEventListener('click', (e) => {
        const b = e.target.closest('[data-v]');
        if (b) close(b.dataset.v);
      });
    }
  });
  if (!code) return;

  if (code === '__del') {
    const ok = await confirmSheet('この打席を削除しますか？', { okLabel: '削除', danger: true });
    if (!ok) return;
    await removePersonalPA(rec, paId);
    toast('削除しました');
    rerender();
    return;
  }

  const r = RESULT_BY_CODE[code];
  const detail = await paDetailSheet(r, pa);
  if (!detail) return;

  if (isNew) await addPersonalPA(rec, { result: code, ...detail });
  else await updatePersonalPA(rec, paId, { result: code, ...detail });
  toast(`${detail.dir ? directionLabel(detail.dir) : ''}${r.label}${detail.rbi ? ` 打点${detail.rbi}` : ''}`);
  rerender();
}

/**
 * 打球方向と打点を入力するシート（走者は扱わない）。
 * 方向をタップした時点では確定せず、打点を入れてから「確定」を押す。
 * 方向タップで即確定にすると、打点を入れる前に閉じてしまうため。
 */
function paDetailSheet(r, pa) {
  const startRbi = pa ? (pa.rbi || 0) : (r.minRbi || 0);
  const startDir = pa ? (pa.dir || null) : null;
  const dirCells = DIRECTIONS.map((d) => {
    const { x, y } = DIRECTION_LAYOUT[d.code];
    return `<button class="pos ${d.code === startDir ? 'is-on' : ''}"
      style="left:${x}%;top:${y}%" data-dir="${d.code}">${esc(d.label)}</button>`;
  }).join('');

  return sheet({
    title: r.label,
    body: html`
      <div style="font-weight:700;font-size:17px;margin-bottom:10px">${r.label}</div>

      ${r.needsDir ? html`
        <div class="small muted" style="margin-bottom:6px">打球方向（任意）</div>
        ${raw(`<div class="diamond">${dirCells}</div>`)}
        <button class="btn btn-sm btn-block" style="margin-top:8px" data-dir-clear>方向を記録しない</button>
      ` : ''}

      <div style="display:flex;align-items:center;gap:12px;margin:14px 0 12px">
        <div style="flex:1;font-weight:600">打点</div>
        <div class="stepper">
          <button type="button" class="mini" data-rbi="-1">−</button>
          <span class="val" data-rbi-val>${startRbi}</span>
          <button type="button" class="mini" data-rbi="1">＋</button>
        </div>
      </div>

      <button class="btn btn-primary btn-block" data-commit>確定</button>`,
    onMount(modal, close) {
      let rbi = startRbi;
      let dir = startDir;
      modal.addEventListener('click', (e) => {
        const rb = e.target.closest('[data-rbi]');
        if (rb) {
          rbi = Math.max(r.minRbi || 0, Math.min(4, rbi + Number(rb.dataset.rbi)));
          modal.querySelector('[data-rbi-val]').textContent = String(rbi);
          return;
        }
        const db = e.target.closest('[data-dir]');
        if (db) {
          dir = db.dataset.dir;
          for (const x of modal.querySelectorAll('[data-dir]')) x.classList.toggle('is-on', x === db);
          return;
        }
        if (e.target.closest('[data-dir-clear]')) {
          dir = null;
          for (const x of modal.querySelectorAll('[data-dir]')) x.classList.remove('is-on');
          return;
        }
        if (e.target.closest('[data-commit]')) close({ dir, rbi });
      });
    }
  });
}

/* ---------------- 合計の直接入力 ---------------- */

async function editManual(rec) {
  const cur = rec.bat || {};
  const body = html`
    <div class="card">
      ${raw(chunk(LEGACY_FIELDS.filter((f) => f.key !== 'G'), 3).map((group) => `
        <div class="field-row">
          ${group.map((f) => `
            <label class="field"><span>${esc(f.label)}${f.hint ? `<span class="tiny"> ${esc(f.hint)}</span>` : ''}</span>
              <input name="${f.key}" type="number" inputmode="numeric" min="0"
                     value="${cur[f.key] ?? ''}" placeholder="0"></label>`).join('')}
        </div>`).join(''))}
    </div>
    <p class="small muted" style="margin-top:10px">
      分かる項目だけで構いません。単打と塁打は自動計算します。
      打席を空欄にすると、打数＋四死球＋犠打犠飛から補います。
    </p>`;

  const { action, values } = await formSheet({
    title: 'この試合の合計',
    body,
    read: readFields
  });
  if (action !== 'ok' || !values) return;

  const bat = {};
  for (const f of LEGACY_FIELDS) {
    if (f.key === 'G') continue;
    const v = values[f.key];
    bat[f.key] = v === '' || v == null ? 0 : Math.max(0, Number(v) || 0);
  }
  await savePersonal({ ...rec, bat });
  toast('保存しました');
  rerender();
}

/* ---------------- 得点・盗塁・失策 ---------------- */

async function editExtra(rec) {
  const e = rec.extra || {};
  const fields = [
    { key: 'R', label: '得点' }, { key: 'SB', label: '盗塁' },
    { key: 'CS', label: '盗塁死' }, { key: 'E', label: '失策' }
  ];
  const { action, values } = await formSheet({
    title: '得点・盗塁・失策',
    body: html`
      <div class="card"><div class="field-row">
        ${raw(fields.map((f) => `
          <label class="field"><span>${esc(f.label)}</span>
            <input name="${f.key}" type="number" inputmode="numeric" min="0"
                   value="${e[f.key] ?? 0}"></label>`).join(''))}
      </div></div>
      <p class="small muted" style="margin-top:10px">
        打席の結果からは分からない項目なので、ここで入れてください。
      </p>`,
    read: readFields
  });
  if (action !== 'ok' || !values) return;
  const extra = {};
  for (const f of fields) extra[f.key] = Math.max(0, Number(values[f.key]) || 0);
  await savePersonal({ ...rec, extra });
  toast('保存しました');
  rerender();
}

/* ---------------- 簡易投手成績 ---------------- */

async function editPitch(rec) {
  const p = rec.pitch || {};
  const { action, values } = await formSheet({
    title: '投手成績（この試合）',
    body: html`
      <div class="card">
        ${raw(chunk(PITCH_INPUT_FIELDS, 3).map((group) => `
          <div class="field-row">
            ${group.map((f) => `
              <label class="field"><span>${esc(f.label)}${f.hint ? `<span class="tiny"> ${esc(f.hint)}</span>` : ''}</span>
                <input name="${f.key}" type="number" inputmode="numeric" min="0"
                       ${f.key === 'ipThird' ? 'max="2"' : ''}
                       value="${p[f.key] ?? ''}" placeholder="0"></label>`).join('')}
          </div>`).join(''))}
        <div class="field"><span>勝敗</span>${segment('decision', [
          { value: '', label: 'なし' }, { value: 'W', label: '勝' },
          { value: 'L', label: '敗' }, { value: 'SV', label: 'S' }
        ], p.decision || '')}</div>
      </div>
      <p class="small muted" style="margin-top:10px">
        投球回は「回」と「＋1/3」に分けて入れます（例: 5回2/3 なら 5 と 2）。<br>
        すべて空欄にすると登板なしとして扱います。
      </p>`,
    extraActions: rec.pitch ? [{ label: '登板を消す', value: 'clear', kind: 'danger' }] : [],
    read: readFields,
    onMount: (modal) => wireSegments(modal)
  });

  if (action === 'clear') {
    await savePersonal({ ...rec, pitch: null });
    toast('登板記録を消しました');
    rerender();
    return;
  }
  if (action !== 'ok' || !values) return;

  const pitch = { decision: values.decision || null };
  let any = false;
  for (const f of PITCH_INPUT_FIELDS) {
    const v = values[f.key];
    const n = v === '' || v == null ? 0 : Math.max(0, Number(v) || 0);
    pitch[f.key] = f.key === 'ipThird' ? Math.min(2, n) : n;
    if (n > 0) any = true;
  }
  await savePersonal({ ...rec, pitch: any || pitch.decision ? pitch : null });
  toast('保存しました');
  rerender();
}

/* ==================== 年度別・通算 ==================== */

export const personalStatsScreen = {
  title: () => '個人成績（年度別）',

  async render(view) {
    const p = currentPlayer();
    if (!p) { render(view, html`<div class="empty">先にメンバーを選んでください</div>`); return; }
    const records = personalOf(p.id);
    const seasons = playerSeasons(p);
    const career = playerAgg(p.id, null);
    const legacy = (p.legacy || []).length;

    render(view, html`
      <div class="card card-pad" style="margin-bottom:12px">
        <div style="font-weight:700">${esc(p.name)}</div>
        <div class="small muted">${linked() ? sourceNote(career) : `個人記録 ${records.length}件`}</div>
      </div>

      <h2 class="section">打撃</h2>
      <div class="card">
        <div class="table-wrap"><table class="stats">
          <thead><tr><th class="name">年度</th>
            ${raw(BAT_COLUMNS.map((c) => `<th>${c.label}</th>`).join(''))}
            <th>打率</th><th>出塁率</th><th>長打率</th><th>OPS</th></tr></thead>
          <tbody>
            ${raw(seasons.map((s) => batRow(String(s) + '年', playerAgg(p.id, s))).join(''))}
            ${raw(batRow('通算', career, true))}
          </tbody>
        </table></div>
      </div>
      <p class="small muted">横にスクロールすると全項目を確認できます。</p>

      ${career.pitchGames ? html`
        <h2 class="section">投手</h2>
        <div class="card">
          <div class="table-wrap"><table class="stats">
            <thead><tr><th class="name">年度</th><th>登板</th><th>回</th><th>被安打</th><th>被本</th>
              <th>奪三振</th><th>与四球</th><th>与死球</th><th>失点</th><th>自責</th>
              <th>勝</th><th>敗</th><th>S</th><th>防御率</th><th>WHIP</th></tr></thead>
            <tbody>
              ${raw(seasons
                .map((s) => ({ s, agg: playerAgg(p.id, s) }))
                .filter(({ agg }) => agg.pitchGames > 0)   // 登板のない年度は出さない
                .map(({ s, agg }) => pitchRow(String(s) + '年', agg)).join(''))}
              ${raw(pitchRow('通算', career, true))}
            </tbody>
          </table></div>
        </div>` : ''}

      <p class="small muted" style="margin-top:12px">
        ${linked()
          ? 'チームの試合・個人記録・メンバー画面の過去成績をすべて合算しています。「成績」タブの同じ選手の数字と一致します。'
          : (legacy ? `チームの成績との連携がオフのため、個人記録だけを集計しています（過去成績${legacy}年分は含みません）。` : 'チームの成績との連携がオフのため、個人記録だけを集計しています。')}
      </p>
    `);
  }
};

/** 打撃表の列。試合数だけは集計側から取るので key を持たない。 */
const BAT_COLUMNS = [
  { key: 'G', label: '試合' },
  { key: 'PA', label: '打席' },
  { key: 'AB', label: '打数' },
  { key: 'H', label: '安打' },
  { key: 'H2', label: '二塁打' },
  { key: 'H3', label: '三塁打' },
  { key: 'HR', label: '本塁打' },
  { key: 'TB', label: '塁打' },
  { key: 'RBI', label: '打点' },
  { key: 'R', label: '得点' },
  { key: 'BB', label: '四球' },
  { key: 'HBP', label: '死球' },
  { key: 'SO', label: '三振' },
  { key: 'SH', label: '犠打' },
  { key: 'SF', label: '犠飛' },
  { key: 'GIDP', label: '併殺' },
  { key: 'SB', label: '盗塁' },
  { key: 'CS', label: '盗塁死' },
  { key: 'E', label: '失策' }
];

function batRow(label, agg, strong = false) {
  const b = { ...agg.bat, G: agg.games };
  const rt = rates(b);
  return `<tr${strong ? ' style="font-weight:700"' : ''}>
    <td class="name">${esc(label)}</td>
    ${BAT_COLUMNS.map((c) => `<td>${b[c.key] || 0}</td>`).join('')}
    <td>${fmtRate(rt.avg)}</td><td>${fmtRate(rt.obp)}</td>
    <td>${fmtRate(rt.slg)}</td><td>${fmtRate(rt.ops)}</td></tr>`;
}

function pitchRow(label, agg, strong = false) {
  const p = agg.pitch;
  const rt = pitchRates(p, state.settings.eraInnings || 9);
  return `<tr${strong ? ' style="font-weight:700"' : ''}>
    <td class="name">${esc(label)}</td>
    <td>${agg.pitchGames}</td><td>${formatIP(p.outs)}</td><td>${p.H}</td><td>${p.HR}</td>
    <td>${p.SO}</td><td>${p.BB}</td><td>${p.HBP}</td><td>${p.R}</td><td>${p.ER}</td>
    <td>${p.W}</td><td>${p.L}</td><td>${p.SV}</td>
    <td>${fmtNum(rt.era)}</td><td>${fmtNum(rt.whip)}</td></tr>`;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
