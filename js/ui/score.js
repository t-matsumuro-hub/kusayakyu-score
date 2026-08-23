/* 打席入力。自チーム・相手チーム両方の攻撃を記録する。
   走者が塁上にいない間は「結果 → 打球方向」の2タップで確定する。
   走者がいる場合だけ進塁パネルが出て、既定の進塁でよければ「確定」を押すだけ。 */

import {
  html, raw, esc, render, on, toast, sheet, confirmSheet, pickPlayer, keepAwake
} from './common.js';
import {
  state, gameById, saveGame, addPA, undoLast, undoLastPA, updatePA, deletePA,
  addRun, applyRunnerMove, setOuts, setBases, forceHalfChange,
  currentBatter, playerName, batterRef, setOppFixed, ensureOppOrder, setPitcher,
  oppBattedCount
} from '../store.js';
import {
  RESULTS, RESULT_BY_CODE, DIRECTIONS, DIRECTION_LAYOUT, directionLabel,
  battingSide, halfLabel, totalRuns, activeLineup, pasSorted,
  COUNT_CHOICES, teamName, fielderAt, POSITIONS, POSITION_BY_CODE,
  ERROR_TYPES, ERROR_TYPE_LABEL,
  oppLineup, activeOppLineup, oppOrderMax, oppBatterLabel, pitcherAt
} from '../model.js';
import {
  defaultPlan, applyPlan, defaultRbi, destChoices, outAtChoices,
  runnerCount, basesLabel, cloneBases, emptyBases, movesOf,
  defaultCredit, CREDIT_ADVANCE, CREDIT_OUT, resultBlockReason, defaultOutAt,
  HOLD, HOME, OUT, BASE_LABEL, BASE_SHORT, OUT_AT_LABEL
} from '../runners.js';
import { gameBatting, summarizeLine } from '../stats.js';
import { go, rerender, back } from './router.js';
import { linescoreHTML } from './games.js';

/** 走者の表示名。自チームは選手名、相手は打順番号（名前が分かっていれば添える）。 */
function refLabel(game, half, ref) {
  if (!ref) return '';
  if (battingSide(game, half) === 'our') return playerName(ref);
  const e = oppLineup(game).find((x) => String(x.order) === String(ref));
  return e && e.name ? `${ref}番 ${e.name}` : `${ref}番`;
}

export default {
  title: (p) => {
    const g = gameById(p.id);
    return g ? `vs ${g.opponent || '相手'}` : '打席入力';
  },
  hideTabs: true,
  action: () => ({ label: '完了', run: () => back() }),

  async render(view, params) {
    const g = gameById(params.id);
    if (!g) { render(view, html`<div class="empty">試合が見つかりません</div>`); return; }

    if (state.settings.keepAwake) keepAwake(true);

    const { half, inning, outs } = g.cur;
    const bases = g.cur.bases || emptyBases();
    const side = battingSide(g, half);
    const batter = currentBatter(g);
    const batting = gameBatting(g);
    const ourName = teamName(g, 'our', state.settings);
    const oppName = g.opponent || '相手';
    const attacking = side === 'our' ? ourName : oppName;
    const lineupEmpty = activeLineup(g, inning).length === 0;

    render(view, html`
      <div class="score-head">
        <div class="inning">${inning}回${halfLabel(half)}</div>
        <div style="flex:1;text-align:center">
          <div class="sc">${totalRuns(g, 'our')} - ${totalRuns(g, 'opp')}</div>
          <div class="tiny muted">${esc(ourName)} / ${esc(oppName)}</div>
        </div>
        <div class="outs" data-outs role="button" title="タップでアウト数を変更">
          ${raw([0, 1, 2].map((i) => `<span class="out-dot ${i < outs ? 'on' : ''}"></span>`).join(''))}
        </div>
      </div>

      <div class="bases-strip">
        ${raw([3, 2, 1].map((b) => {
          const ref = bases[b];
          return `<button class="base-chip ${ref ? 'on' : ''}" data-base="${b}">
            <span>${BASE_LABEL[b]}</span>
            ${ref ? `<span class="who">${esc(refLabel(g, half, ref))}</span>`
                  : '<span class="empty-mark">−</span>'}
          </button>`;
        }).join(''))}
      </div>

      <div class="card card-pad" style="padding:8px">
        ${raw(linescoreHTML(g, { highlightCur: true }))}
        <div class="btn-row" style="margin:8px 0 0">
          <button class="btn btn-sm" data-run="1">${esc(attacking)}に +1点</button>
          <button class="btn btn-sm" data-run="-1">−1点</button>
        </div>
        <p class="tiny muted" style="margin:6px 0 0">
          得点は走者が本塁に到達した時点で自動計上されます。ここは記録漏れの補正用です。
        </p>
      </div>

      ${side === 'our' && lineupEmpty ? html`
        <div class="card card-pad">
          <p class="small" style="margin:0 0 10px">打順が登録されていません。</p>
          <button class="btn btn-primary btn-block" data-tolineup>打順を登録する</button>
        </div>
      ` : html`
        <div class="batter-strip" data-batter role="button">
          <span class="ord">${batter.order}</span>
          <span class="nm">${side === 'our'
            ? esc(playerName(batter.entry?.playerId))
            : esc(oppBatterLabel(g, batter.order))}</span>
          <span class="today">${side === 'our'
            ? esc(summarizeLine(batting.get(batter.entry?.playerId)) || '')
            : '打者を変更'}</span>
        </div>

        ${side === 'opp' && !g.oppFixed ? html`
          <div class="card card-pad" style="padding:10px 12px;margin-bottom:10px">
            <div class="small muted" style="margin-bottom:8px">
              相手の打順は未確定です（ここまで ${oppBattedCount(g)}人が打席に立ちました）。
              打席が進むたびに打者が増えます。1番に戻るところで確定してください。
            </div>
            <button class="btn btn-primary btn-block btn-sm" data-opp-fix
              ${raw(oppBattedCount(g) < 1 ? 'disabled' : '')}>
              相手の打順を確定（${Math.max(1, oppBattedCount(g))}人）
            </button>
          </div>` : ''}

        <div class="result-grid">
          ${raw(RESULTS.map((r) => {
            const blocked = resultBlockReason(r, bases, outs);
            return `<button class="rbtn k-${r.kind} ${blocked ? 'is-blocked' : ''}"
              data-res="${r.code}" ${blocked ? `data-blocked="${esc(blocked)}"` : ''}>${esc(r.label)}</button>`;
          }).join(''))}
        </div>
      `}

      <div class="btn-row" style="margin-top:12px">
        <button class="btn" data-undo>↩ 取り消し</button>
        <button class="btn" data-runner>走塁</button>
        <button class="btn" data-change>チェンジ</button>
      </div>

      ${side === 'opp' ? html`
        <div class="card card-pad" style="padding:10px 12px">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="flex:1;min-width:0">
              <div class="tiny muted">投手</div>
              <div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                ${esc(playerName(pitcherAt(g, (g.pas || []).reduce((m, p) => Math.max(m, p.seq || 0), 0) + 1, inning)))}
              </div>
            </div>
            <button class="btn btn-sm" data-pitcher>投手交代</button>
          </div>
        </div>` : ''}

      <h2 class="section">直近の記録</h2>
      <div class="card">
        ${(g.pas || []).length === 0 && (g.runnerEvents || []).length === 0
          ? html`<div class="empty small">まだ記録がありません</div>`
          : raw(`<ul class="list pa-log">${logHTML(g, 12)}</ul>`)}
      </div>

      <div class="btn-row" style="margin-top:14px">
        <button class="btn" data-tolineup>打順・守備</button>
        <button class="btn ${g.status === 'final' ? '' : 'btn-primary'}" data-finish>
          ${g.status === 'final' ? '確定済み（詳細へ）' : '試合終了'}
        </button>
      </div>
    `);

    /* ---- 操作 ---- */

    on(view, 'click', '[data-res]', async (e, b) => {
      if (b.dataset.blocked) { toast(b.dataset.blocked, { danger: true }); return; }
      if (side === 'our' && !batter.entry) { toast('打順を登録してください', { danger: true }); return; }
      await handleResult(g, b.dataset.res, batter, side, bases);
    });

    on(view, 'click', '[data-batter]', () => changeBatter(g, side));
    on(view, 'click', '[data-opp-fix]', async () => {
      if (oppBattedCount(g) < 1) { toast('まだ相手打者が打席に立っていません', { danger: true }); return; }
      await setOppFixed(g, true);
      const fresh = gameById(g.id);
      toast(`相手の打順を${oppOrderMax(fresh)}人で確定しました`);
      rerender();
    });
    on(view, 'click', '[data-base]', (e, b) => baseMenu(g, Number(b.dataset.base)));
    on(view, 'click', '[data-outs]', async () => {
      await setOuts(g, ((g.cur.outs || 0) + 1) % 3);
      rerender();
    });

    on(view, 'click', '[data-run]', async (e, b) => {
      const n = Number(b.dataset.run);
      if (n > 0 && side === 'our') {
        const act = activeLineup(g, inning);
        const pid = await pickPlayer(
          act.map((x) => ({ id: x.playerId, name: `${x.order}. ${playerName(x.playerId)}` })),
          { title: '得点した選手', allowNone: true, noneLabel: '選手を記録しない' });
        if (pid == null) return;
        await addRun(g, side, inning, 1, pid || null);
      } else {
        await addRun(g, side, inning, n, null);
      }
      rerender();
    });

    on(view, 'click', '[data-undo]', async () => {
      const r = await undoLast(g);
      if (!r) { toast('取り消せる記録がありません'); return; }
      if (r.type === 'pa') {
        const res = RESULT_BY_CODE[r.item.result];
        toast(`取り消しました（${res ? res.label : r.item.result}）`);
      } else {
        toast('走塁の記録を取り消しました');
      }
      rerender();
    });

    on(view, 'click', '[data-change]', async () => { await forceHalfChange(g); rerender(); });

    on(view, 'click', '[data-pitcher]', async () => {
      const act = activeLineup(g, inning);
      if (!act.length) { toast('先に打順を登録してください', { danger: true }); return; }
      const cur = pitcherAt(g, (g.pas || []).reduce((m, p) => Math.max(m, p.seq || 0), 0) + 1, inning);
      const pid = await pickPlayer(
        act.map((e) => ({
          id: e.playerId,
          name: `${e.order}. ${playerName(e.playerId)}`,
          sub: e.playerId === cur ? '現在の投手' : ''
        })),
        { title: '次の投手' });
      if (!pid) return;
      await setPitcher(g, pid, inning);
      toast(`投手を ${playerName(pid)} に交代しました`);
      rerender();
    });
    on(view, 'click', '[data-runner]', () => runnerMenu(g, side));
    on(view, 'click', '[data-tolineup]', () => go('lineup', { id: g.id }));
    on(view, 'click', '[data-pa]', (e, li) => editPA(g, li.dataset.pa));

    on(view, 'click', '[data-finish]', async () => {
      if (g.status === 'final') { go('gameDetail', { id: g.id }, { replace: true }); return; }
      const ok = await confirmSheet(
        `試合を確定しますか？\n${ourName} ${totalRuns(g, 'our')} - ${totalRuns(g, 'opp')} ${oppName}\n` +
        `（${inning}回${halfLabel(half)}まで記録済み）`,
        { title: '試合終了', okLabel: '確定する' });
      if (!ok) return;
      g.status = 'final';
      await saveGame(g);
      keepAwake(false);
      toast('試合を確定しました');
      go('gameDetail', { id: g.id }, { replace: true });
    });
  }
};

/* ==================== 打席結果の入力 ==================== */

/** @returns {Promise<boolean>} 記録したら true、途中でやめたら false */
async function handleResult(g, code, batter, side, bases) {
  const r = RESULT_BY_CODE[code];
  if (!r) return false;

  const bRef = batterRef(side, batter.order, batter.entry?.playerId);
  const hasRunners = runnerCount(bases) > 0;
  const needsSheet = hasRunners || r.needsDir || g.pitchMode !== 'none';

  if (!needsSheet) {
    await commit(g, { result: code, order: batter.order, playerId: batter.entry?.playerId });
    return true;
  }

  const detail = await detailSheet(g, r, bases, bRef, batter, side);
  if (!detail) return false;

  await commit(g, {
    result: code,
    dir: detail.dir,
    rbi: detail.rbi,
    plan: detail.plan || undefined,   // null なら結果からの既定の進塁を使う
    errors: detail.errors,
    pitches: detail.pitches,
    count: detail.count,
    order: batter.order,
    playerId: batter.entry?.playerId
  });
  return true;
}

async function commit(g, data) {
  const pa = await addPA(g, data);
  const r = RESULT_BY_CODE[pa.result];
  const dir = pa.dir ? directionLabel(pa.dir) : '';
  const runs = (pa.runsOnPlay || []).length;
  toast(`${dir}${r ? r.label : pa.result}${runs ? ` ${runs}点` : ''}${pa.rbi ? ` 打点${pa.rbi}` : ''}`);
  rerender();
}

/* ---------------- 進塁パネルの組み立て ---------------- */

function runnerRowsHTML(g, half, bases, batterRefV, batterName, plan, { showCredit = false } = {}) {
  const rows = [];

  const rowFor = (key, from, label, name) => {
    const isBatter = key === 'B';
    const dest = plan.dest[key];
    const choices = destChoices(isBatter, from);
    const outSelected = dest === OUT;
    const moved = dest !== HOLD;
    const atChoices = outAtChoices(isBatter, from);
    const creditChoices = outSelected ? CREDIT_OUT : CREDIT_ADVANCE;

    return `<div class="runner-row" data-row="${key}">
      <div class="runner-head">
        <span class="tag">${label}</span>
        <span class="nm">${esc(name)}</span>
      </div>
      <div class="dest-row">
        ${choices.map((c) => `<button type="button" data-dest="${c.v}"
          class="${String(dest) === String(c.v) ? 'is-on' : ''} ${c.v === OUT ? 'out-btn' : ''}">${c.label}</button>`).join('')}
      </div>
      ${outSelected ? `<div class="outat-row">
        <span class="lbl">アウトの塁</span>
        ${atChoices.map((c) => `<button type="button" data-outat="${c.v}"
          class="${String(plan.outAt[key]) === String(c.v) ? 'is-on' : ''}">${c.label}</button>`).join('')}
      </div>` : ''}
      ${showCredit && !isBatter && moved ? `<div class="credit-row">
        <span class="lbl">記録</span>
        ${creditChoices.map((c) => `<button type="button" data-credit="${c.v}"
          class="${plan.credit?.[key] === c.v ? 'is-on' : ''}">${c.label}</button>`).join('')}
      </div>` : ''}
    </div>`;
  };

  for (const b of [3, 2, 1]) {
    if (bases[b]) rows.push(rowFor(String(b), b, BASE_LABEL[b], refLabel(g, half, bases[b])));
  }
  if (batterRefV) rows.push(rowFor('B', 0, '打者', batterName));
  return rows.join('');
}

/* ---------------- 失策の記録 ----------------
   1つのプレーで失策が重なることがある（捕球ミス→送球ミスなど）ので配列で持つ。
   守っているのが自チームの時だけ、守備位置から選手を割り出して成績に付ける。 */

function fieldingIsOurs(side) {
  return side === 'opp';   // 相手の攻撃＝自チームが守備
}

function errorChipsHTML(g, inning, side, errors) {
  if (!errors.length) return '<div class="tiny muted">記録なし</div>';
  return `<div class="err-chips">${errors.map((e, i) => {
    const pos = POSITION_BY_CODE[e.pos];
    const who = fieldingIsOurs(side) ? playerName(fielderAt(g, inning, e.pos)) : '';
    return `<span class="err-chip">${esc(pos ? pos.full : e.pos)}
      ${who && who !== '(不明)' ? `<b>${esc(who)}</b>` : ''}
      ${esc(ERROR_TYPE_LABEL[e.type] || '')}
      <button type="button" data-err-del="${i}">✕</button></span>`;
  }).join('')}</div>`;
}

function errorSectionHTML(g, inning, side, errors) {
  return `<h2 class="section" style="margin-top:14px">
    失策（${fieldingIsOurs(side) ? '自チームの守備' : '相手の守備'}）</h2>
  <div class="card card-pad" data-errors>
    ${errorChipsHTML(g, inning, side, errors)}
    <button type="button" class="btn btn-sm btn-block" style="margin-top:8px" data-err-add>＋ 失策を追加</button>
    <p class="tiny muted" style="margin:6px 0 0">
      重なった失策はいくつでも追加できます。暴投・捕逸は記録上の失策ではないので追加しません。
    </p>
  </div>`;
}

/** 失策を1つ選ぶ（守備位置＋種類） */
function pickError(g, inning, side) {
  const ours = fieldingIsOurs(side);
  const body = html`
    <div class="small muted" style="margin-bottom:6px">失策の種類</div>
    <div class="seg" data-seg="etype" style="margin-bottom:12px">
      ${raw(ERROR_TYPES.map((t, i) =>
        `<button type="button" data-val="${t.v}" class="${i === 1 ? 'is-on' : ''}">${esc(t.label)}</button>`).join(''))}
    </div>
    <div class="small muted" style="margin-bottom:6px">失策した守備位置をタップ</div>
    <div class="pick-grid">
      ${raw(POSITIONS.map((p) => {
        const who = ours ? playerName(fielderAt(g, inning, p.code)) : '';
        return `<button data-pos="${p.code}">${esc(p.full)}
          ${who && who !== '(不明)' ? `<span class="sub">${esc(who)}</span>` : ''}</button>`;
      }).join(''))}
    </div>`;

  return sheet({
    title: '失策を追加',
    body,
    onMount(modal, close) {
      let type = 'throw';
      modal.addEventListener('click', (e) => {
        const seg = e.target.closest('[data-seg="etype"] button');
        if (seg) {
          type = seg.dataset.val;
          for (const b of modal.querySelectorAll('[data-seg="etype"] button')) b.classList.toggle('is-on', b === seg);
          return;
        }
        const p = e.target.closest('[data-pos]');
        if (p) close({ pos: p.dataset.pos, type });
      });
    }
  });
}

/** 失策セクションの操作を配線する（再描画つき） */
function wireErrors(modal, g, inning, side, errors, afterChange) {
  const refresh = () => {
    const host = modal.querySelector('[data-errors]');
    if (!host) return;
    const chips = host.querySelector('.err-chips') || host.querySelector('.tiny.muted');
    if (chips) chips.outerHTML = errorChipsHTML(g, inning, side, errors);
    if (afterChange) afterChange();
  };
  modal.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-err-del]');
    if (del) { errors.splice(Number(del.dataset.errDel), 1); refresh(); return; }
    const add = e.target.closest('[data-err-add]');
    if (add) {
      const r = await pickError(g, inning, side);
      if (r) { errors.push(r); refresh(); }
    }
  });
}

/** 進塁計画から得点・アウトの要約を作る */
function planSummary(bases, batterRefV, plan) {
  const applied = applyPlan(bases, batterRefV, plan);
  const parts = [];
  parts.push(`${applied.runs.length}点`);
  parts.push(`${applied.outs.length}アウト`);
  const on = [1, 2, 3].filter((b) => applied.bases[b]);
  parts.push(on.length ? `打席後：${on.map((b) => BASE_SHORT[b]).join('')}塁` : '打席後：走者なし');
  return { text: parts.join(' ・ '), applied };
}

/**
 * 打球方向・打点・球数・走者の進塁をまとめて入力するシート。
 * 走者がいない場合は方向タップで即確定（従来どおりの速さ）。
 */
function detailSheet(g, r, bases, batterRefV, batter, side) {
  const half = g.cur.half;
  const hasRunners = runnerCount(bases) > 0;
  const showDir = !!r.needsDir;
  const showCount = g.pitchMode === 'count';
  const showPitches = g.pitchMode === 'pitches';
  const batterName = side === 'our' ? playerName(batter.entry?.playerId) : `${batter.order}番`;

  const plan = defaultPlan(r.code, bases);
  const initial = planSummary(bases, batterRefV, plan);

  const dirCells = DIRECTIONS.map((d) => {
    const { x, y } = DIRECTION_LAYOUT[d.code];
    return `<button class="pos ${d.code === 'LC' || d.code === 'RC' ? 'gap' : ''}"
      style="left:${x}%;top:${y}%" data-dir="${d.code}">${esc(d.label)}</button>`;
  }).join('');

  const body = html`
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
      <div style="font-weight:700;font-size:17px">${r.label}</div>
      <div style="flex:1"></div>
      <div class="small muted">打点</div>
      <div class="stepper">
        <button type="button" class="mini" data-rbi="-1">−</button>
        <span class="val" data-rbi-val>${defaultRbi(r.code, initial.applied.runs)}</span>
        <button type="button" class="mini" data-rbi="1">＋</button>
      </div>
    </div>

    ${showPitches ? html`
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
        <div class="small muted" style="flex:1">この打席の球数</div>
        <div class="stepper">
          <button type="button" class="mini" data-pit="-1">−</button>
          <span class="val" data-pit-val>0</span>
          <button type="button" class="mini" data-pit="1">＋</button>
        </div>
      </div>` : ''}

    ${showCount ? html`
      <div class="small muted" style="margin-bottom:6px">最終カウント（B-S）</div>
      <div class="count-grid" style="margin-bottom:12px">
        ${raw(COUNT_CHOICES.map((c) => `<button type="button" data-count="${c}">${c}</button>`).join(''))}
      </div>` : ''}

    ${showDir ? html`
      <div class="small muted" style="margin-bottom:6px" data-dirnote>
        打球方向${hasRunners ? '' : '（タップすると確定します）'}
      </div>
      ${raw(`<div class="diamond">${dirCells}</div>`)}
    ` : ''}

    <div data-detail ${raw(hasRunners ? '' : 'hidden')}>
      <h2 class="section" style="margin-top:14px">
        進塁${hasRunners ? `（${basesLabel(bases)}）` : '（打者）'}
      </h2>
      <div class="card card-pad" style="padding:4px 12px" data-runners>
        ${raw(runnerRowsHTML(g, half, bases, batterRefV, batterName, plan))}
      </div>
      <div class="small muted center" style="margin:8px 0" data-summary>${initial.text}</div>
      ${raw(errorSectionHTML(g, g.cur.inning, side, []))}
      <button class="btn btn-primary btn-block" style="margin-top:12px" data-commit>確定</button>
    </div>

    <div data-quick ${raw(hasRunners ? 'hidden' : '')}>
      <button class="btn btn-block" style="margin-top:10px" data-expand>
        ＋ 詳細を入力（打者の進塁・失策）
      </button>
      ${showDir
        ? html`<button class="btn btn-block" style="margin-top:8px" data-dir="">方向を記録しない（確定）</button>`
        : html`<button class="btn btn-primary btn-block" style="margin-top:8px" data-commit>確定</button>`}
    </div>
  `;

  return sheet({
    title: '打席結果',
    body,
    onMount(modal, close) {
      let rbi = defaultRbi(r.code, initial.applied.runs);
      let rbiTouched = false;
      let pitches = 0;
      let count = null;
      let dir = null;
      let expanded = hasRunners;
      const errors = [];

      wireErrors(modal, g, g.cur.inning, side, errors);

      const expand = () => {
        expanded = true;
        modal.querySelector('[data-detail]').hidden = false;
        modal.querySelector('[data-quick]').hidden = true;
        const note = modal.querySelector('[data-dirnote]');
        if (note) note.textContent = '打球方向';
      };

      const refreshRunners = () => {
        const host = modal.querySelector('[data-runners]');
        if (host) host.innerHTML = runnerRowsHTML(g, half, bases, batterRefV, batterName, plan);
        const s = planSummary(bases, batterRefV, plan);
        const sum = modal.querySelector('[data-summary]');
        if (sum) sum.textContent = s.text;
        if (!rbiTouched) {
          rbi = defaultRbi(r.code, s.applied.runs);
          modal.querySelector('[data-rbi-val]').textContent = String(rbi);
        }
      };

      const finish = () => close({
        dir,
        rbi,
        plan: expanded ? plan : null,   // 詳細を触っていなければ既定の進塁に任せる
        errors,
        pitches: showPitches ? pitches : null,
        count: showCount ? count : null
      });

      modal.addEventListener('click', (e) => {
        if (e.target.closest('[data-expand]')) { expand(); return; }
        const rb = e.target.closest('[data-rbi]');
        if (rb) {
          rbiTouched = true;
          rbi = Math.max(0, Math.min(4, rbi + Number(rb.dataset.rbi)));
          modal.querySelector('[data-rbi-val]').textContent = String(rbi);
          return;
        }
        const pb = e.target.closest('[data-pit]');
        if (pb) {
          pitches = Math.max(0, Math.min(30, pitches + Number(pb.dataset.pit)));
          modal.querySelector('[data-pit-val]').textContent = String(pitches);
          return;
        }
        const cb = e.target.closest('[data-count]');
        if (cb) {
          count = cb.dataset.count === count ? null : cb.dataset.count;
          for (const b of modal.querySelectorAll('[data-count]')) b.classList.toggle('is-on', b.dataset.count === count);
          return;
        }
        const destB = e.target.closest('[data-dest]');
        if (destB) {
          const key = destB.closest('[data-row]').dataset.row;
          const v = destB.dataset.dest;
          plan.dest[key] = v === OUT ? OUT : Number(v);
          // アウトにした走者は、打球が捕られた結果なら「帰塁できず」を既定にする
          if (plan.dest[key] === OUT && key !== 'B') {
            plan.outAt[key] = defaultOutAt(r.code, Number(key));
          }
          refreshRunners();
          return;
        }
        const atB = e.target.closest('[data-outat]');
        if (atB) {
          const key = atB.closest('[data-row]').dataset.row;
          plan.outAt[key] = Number(atB.dataset.outat);
          refreshRunners();
          return;
        }
        const db = e.target.closest('[data-dir]');
        if (db) {
          dir = db.dataset.dir || null;
          if (!expanded) return finish();            // 詳細未展開なら方向タップで確定
          for (const x of modal.querySelectorAll('[data-dir]')) x.classList.toggle('is-on', x === db);
          return;
        }
        if (e.target.closest('[data-commit]')) finish();
      });
    }
  });
}

/* ==================== 走塁（打席によらない動き） ==================== */

async function runnerMenu(g, side) {
  const bases = g.cur.bases || emptyBases();
  if (runnerCount(bases) === 0) { toast('塁上に走者がいません'); return; }

  const intent = await sheet({
    title: `走塁の記録（${basesLabel(bases)}）`,
    body: html`
      <p class="small muted" style="margin:0 0 10px">
        どれを選んでも、塁上の走者すべての行き先を指定できます。
        走者ごとに「盗塁」か「進塁」かを選べるので、ホームスチールに他の走者が便乗した場合も記録できます。
      </p>
      <div class="pick-grid">
        ${raw(RUNNER_CAUSES.map((c) =>
          `<button data-v="${c.v}">${esc(c.label)}<span class="sub">${esc(c.sub)}</span></button>`).join(''))}
      </div>`,
    onMount(modal, close) {
      modal.addEventListener('click', (e) => {
        const b = e.target.closest('[data-v]');
        if (b) close(b.dataset.v);
      });
    }
  });
  if (!intent) return;
  await runnerPanel(g, intent);
}

/** 走塁の原因。失策かどうかで成績への付き方が変わる。 */
const RUNNER_CAUSES = [
  { v: 'steal', label: '盗塁', sub: '重盗・ホームスチールを含む' },
  { v: 'wp', label: '暴投', sub: 'ワイルドピッチ' },
  { v: 'pb', label: '捕逸', sub: 'パスボール' },
  { v: 'error', label: '失策', sub: '牽制悪送球・送球エラー など' },
  { v: 'other', label: 'その他の進塁', sub: 'タッチアップ・走塁死 など' }
];
const CAUSE_LABEL = Object.fromEntries(RUNNER_CAUSES.map((c) => [c.v, c.label]));

/**
 * 塁上の全走者を動かすパネル。
 * 走者ごとに行き先・アウトになった塁・記録区分（盗塁／進塁／盗塁死／走塁死）を選べる。
 */
async function runnerPanel(g, intent) {
  const bases = cloneBases(g.cur.bases);
  const half = g.cur.half;
  const side = battingSide(g, half);
  const inning = g.cur.inning;
  const plan = {
    dest: { B: HOLD, 1: HOLD, 2: HOLD, 3: HOLD },
    outAt: { B: 0, 1: 2, 2: 3, 3: 4 },
    credit: {}
  };
  const opts = { showCredit: true };
  const errors = [];

  const initial = planSummary(bases, null, plan);
  const result = await sheet({
    title: `${CAUSE_LABEL[intent] || '走塁'}（${basesLabel(bases)}）`,
    body: html`
      <p class="small muted" style="margin:0 0 8px">
        動かす走者の行き先をタップしてください。動かさない走者は「留」のままで構いません。
      </p>
      <div class="card card-pad" style="padding:4px 12px" data-runners>
        ${raw(runnerRowsHTML(g, half, bases, null, '', plan, opts))}
      </div>
      <div class="small muted center" style="margin:8px 0" data-summary>${initial.text}</div>
      ${raw(errorSectionHTML(g, inning, side, errors))}
      <button class="btn btn-primary btn-block" style="margin-top:12px" data-commit>確定</button>`,
    onMount(modal, close) {
      wireErrors(modal, g, inning, side, errors);
      const refresh = () => {
        modal.querySelector('[data-runners]').innerHTML =
          runnerRowsHTML(g, half, bases, null, '', plan, opts);
        modal.querySelector('[data-summary]').textContent = planSummary(bases, null, plan).text;
      };
      modal.addEventListener('click', (e) => {
        const destB = e.target.closest('[data-dest]');
        if (destB) {
          const key = destB.closest('[data-row]').dataset.row;
          const v = destB.dataset.dest;
          plan.dest[key] = v === OUT ? OUT : Number(v);
          // 行き先に応じて記録区分の既定値を入れ直す
          if (plan.dest[key] === HOLD) delete plan.credit[key];
          else plan.credit[key] = defaultCredit(intent, plan.dest[key]);
          refresh();
          return;
        }
        const atB = e.target.closest('[data-outat]');
        if (atB) {
          plan.outAt[atB.closest('[data-row]').dataset.row] = Number(atB.dataset.outat);
          refresh();
          return;
        }
        const crB = e.target.closest('[data-credit]');
        if (crB) {
          plan.credit[crB.closest('[data-row]').dataset.row] = crB.dataset.credit;
          refresh();
          return;
        }
        if (e.target.closest('[data-commit]')) close(plan);
      });
    }
  });
  if (!result) return;

  const moves = movesOf(bases, result);
  if (!moves.length && !errors.length) { toast('動かした走者がありません'); return; }

  await applyRunnerMove(g, {
    dest: result.dest, outAt: result.outAt, credit: result.credit,
    cause: intent, errors
  });

  const sb = moves.filter((m) => m.credit === 'SB').length;
  const cs = moves.filter((m) => m.credit === 'CS').length;
  const parts = [CAUSE_LABEL[intent] || '走塁'];
  if (sb) parts.push(`盗塁${sb}`);
  if (cs) parts.push(`盗塁死${cs}`);
  const runs = moves.filter((m) => m.to === HOME).length;
  if (runs) parts.push(`${runs}点`);
  if (errors.length) parts.push(`失策${errors.length}`);
  toast(parts.join(' '));
  rerender();
}

/** 塁のチップをタップしたときのメニュー（記録漏れの補正用） */
async function baseMenu(g, base) {
  const bases = cloneBases(g.cur.bases);
  const ref = bases[base];
  const side = battingSide(g, g.cur.half);

  if (!ref) {
    // 空いている塁に走者を置く
    if (side !== 'our') {
      const pick = await pickPlayer(
        activeOppLineup(g, g.cur.inning).map((e) => ({
          id: String(e.order), name: e.name ? `${e.order}番 ${e.name}` : `${e.order}番`
        })),
        { title: `${BASE_LABEL[base]}に置く走者` });
      if (!pick) return;
      bases[base] = pick;
    } else {
      const act = activeLineup(g, g.cur.inning);
      const pick = await pickPlayer(
        act.map((e) => ({ id: e.playerId, name: `${e.order}. ${playerName(e.playerId)}` })),
        { title: `${BASE_LABEL[base]}に置く走者` });
      if (!pick) return;
      bases[base] = pick;
    }
    await setBases(g, bases);
    rerender();
    return;
  }

  const v = await sheet({
    title: `${BASE_LABEL[base]}：${refLabel(g, g.cur.half, ref)}`,
    body: html`<div class="card"><ul class="list">
      <li><button class="row" data-v="clear"><div class="row-main">この走者を消す</div>
        <div class="row-sub">記録間違いの取り消し</div></button></li>
      <li><button class="row" data-v="swap"><div class="row-main">別の選手に入れ替える</div>
        <div class="row-sub">代走など</div></button></li>
    </ul></div>
    <p class="small muted" style="margin-top:10px">
      進塁やアウトは「走塁」ボタンから記録してください。ここは記録漏れの補正用です。
    </p>`,
    onMount(modal, close) {
      modal.addEventListener('click', (e) => {
        const b = e.target.closest('[data-v]');
        if (b) close(b.dataset.v);
      });
    }
  });
  if (!v) return;

  if (v === 'clear') { bases[base] = null; await setBases(g, bases); rerender(); return; }

  if (v === 'swap') {
    const act = activeLineup(g, g.cur.inning);
    const list = side === 'our'
      ? act.map((e) => ({ id: e.playerId, name: `${e.order}. ${playerName(e.playerId)}` }))
      : activeOppLineup(g, g.cur.inning).map((e) => ({
          id: String(e.order), name: e.name ? `${e.order}番 ${e.name}` : `${e.order}番`
        }));
    const pick = await pickPlayer(list, { title: `${BASE_LABEL[base]}の走者` });
    if (!pick) return;
    bases[base] = pick;
    await setBases(g, bases);
    rerender();
  }
}

/* ==================== 打者の変更 ==================== */

async function changeBatter(g, side) {
  if (side === 'our') {
    const act = activeLineup(g, g.cur.inning);
    if (!act.length) { toast('打順が未登録です', { danger: true }); return; }
    const pid = await pickPlayer(
      act.map((e) => ({ id: String(e.order), name: `${e.order}. ${playerName(e.playerId)}` })),
      { title: '打席に立つ選手' });
    if (!pid) return;
    g.cur = { ...g.cur, ourOrder: Number(pid) };
    await saveGame(g);
    rerender();
    return;
  }

  // 相手：登録済みの打順から選ぶ。未確定なら新しい打者も足せる。
  const act = activeOppLineup(g, g.cur.inning);
  const list = act.map((e) => ({
    id: String(e.order),
    name: e.name ? `${e.order}番 ${e.name}` : `${e.order}番`
  }));
  const nextNo = oppOrderMax(g) + 1;
  if (!g.oppFixed) list.push({ id: `new:${nextNo}`, name: `＋ ${nextNo}番を追加`, sub: '新しい打者' });

  const pid = await pickPlayer(list, { title: '相手の打者' });
  if (!pid) return;

  if (pid.startsWith('new:')) {
    const order = Number(pid.slice(4));
    await ensureOppOrder(g, order, g.cur.inning);
    g.cur = { ...g.cur, oppOrder: order };
    await saveGame(g);
    toast(`${order}番を追加しました`);
    rerender();
    return;
  }

  g.cur = { ...g.cur, oppOrder: Number(pid) };
  await saveGame(g);
  rerender();
}

/* ==================== 記録の一覧と修正 ==================== */

/** 打席と走塁イベントを時系列で混ぜて表示する */
function timeline(g) {
  const items = [
    ...(g.pas || []).map((p) => ({ kind: 'pa', seq: p.seq || 0, item: p })),
    ...(g.runnerEvents || []).map((e) => ({ kind: 'ev', seq: e.seq || 0, item: e }))
  ];
  return items.sort((a, b) => a.seq - b.seq);
}

const EVENT_LABEL = { SB: '盗塁', CS: '盗塁死', ADV: '進塁', OUT: '走塁死' };

function logHTML(g, limit) {
  const list = timeline(g).slice(-limit).reverse();
  return list.map((row) => {
    const it = row.item;
    const side = battingSide(g, it.half);
    const color = side === 'our' ? 'var(--our)' : 'var(--opp)';

    if (row.kind === 'ev') {
      const runs = (it.runsOnPlay || []).length;
      if (it.moves && it.moves.length) {
        const who = it.moves.map((m) => refLabel(g, it.half, m.ref)).join('・');
        const detail = it.moves.map((m) => {
          const to = m.to === OUT ? `${OUT_AT_LABEL[m.at] || ''}アウト` : `${BASE_SHORT[m.to]}塁`;
          const cr = { SB: '盗塁', CS: '盗塁死', OUT: '走塁死', ADV: '' }[m.credit] || '';
          return `${BASE_SHORT[m.from]}→${m.to === HOME ? '本塁' : to}${cr ? `(${cr})` : ''}`;
        }).join('　');
        const cause = it.cause && it.cause !== 'steal' && it.cause !== 'other'
          ? `${CAUSE_LABEL[it.cause]} ` : '';
        const errs = (it.errors || []).length ? ` 失策${it.errors.length}` : '';
        return `<li>
          <span class="inn">${it.inning}${halfLabel(it.half)}</span>
          <span class="who" style="color:${color}">${esc(who)}</span>
          <span class="res muted">${esc(cause + detail)}${runs ? ` <b>${runs}点</b>` : ''}${errs}</span>
        </li>`;
      }
      // 旧形式
      const who = it.ref ? refLabel(g, it.half, it.ref) : '走者';
      return `<li>
        <span class="inn">${it.inning}${halfLabel(it.half)}</span>
        <span class="who" style="color:${color}">${esc(who)}</span>
        <span class="res muted">${EVENT_LABEL[it.kind] || '走塁'}${runs ? ` <b>${runs}点</b>` : ''}</span>
      </li>`;
    }

    const pa = it;
    const who = side === 'our'
      ? `${pa.order}. ${esc(playerName(pa.playerId))}`
      : `相手 ${pa.order}番`;
    const r = RESULT_BY_CODE[pa.result];
    const dir = pa.dir ? directionLabel(pa.dir) : '';
    const runs = (pa.runsOnPlay || []).length;
    const extra = [
      runs ? `${runs}点` : '',
      pa.rbi ? `打点${pa.rbi}` : '',
      (pa.errors || []).length ? `失策${pa.errors.length}` : '',
      pa.count || '',
      pa.pitches ? `${pa.pitches}球` : ''
    ].filter(Boolean).join(' ');
    return `<li data-pa="${esc(pa.id)}" role="button">
      <span class="inn">${pa.inning}${halfLabel(pa.half)}</span>
      <span class="who" style="color:${color}">${who}</span>
      <span class="res">${dir}${esc(r ? r.label : pa.result)}${extra ? ` <span class="muted tiny">${extra}</span>` : ''}</span>
    </li>`;
  }).join('');
}

async function editPA(g, paId) {
  const pa = (g.pas || []).find((p) => p.id === paId);
  if (!pa) return;
  // 一番新しい記録なら、取り消して入れ直すことで進行状態ごと直せる
  const tl = timeline(g);
  const tail = tl[tl.length - 1];
  const isLatest = !!tail && tail.kind === 'pa' && tail.item.id === paId;
  const r = RESULT_BY_CODE[pa.result];
  const side = battingSide(g, pa.half);
  const who = side === 'our' ? playerName(pa.playerId) : `相手 ${pa.order}番`;
  const errText = (pa.errors && pa.errors.length)
    ? pa.errors.map((e) => {
        const pos = POSITION_BY_CODE[e.pos];
        const who = side === 'opp' ? playerName(fielderAt(g, pa.inning, e.pos)) : '';
        return `${pos ? pos.full : e.pos}${who && who !== '(不明)' ? `（${who}）` : ''}${ERROR_TYPE_LABEL[e.type] || ''}`;
      }).join('、')
    : (r?.isError && side === 'opp' && pa.dir
        ? playerName(pa.errorBy || fielderAt(g, pa.inning, pa.dir))
        : '');

  const outsText = (pa.outsOnPlay || [])
    .map((o) => `${refLabel(g, pa.half, o.ref)}（${OUT_AT_LABEL[o.at] || ''}）`).join('、');
  const runsText = (pa.runsOnPlay || [])
    .map((o) => refLabel(g, pa.half, o.ref)).join('、');

  const v = await sheet({
    title: `${pa.inning}回${halfLabel(pa.half)} ${who}`,
    body: html`
      <div class="card card-pad" style="margin:0 0 12px">
        <div style="font-weight:700">${pa.dir ? directionLabel(pa.dir) : ''}${r ? r.label : pa.result}</div>
        <div class="small muted">
          ${pa.rbi ? `打点 ${pa.rbi}　` : ''}${pa.count ? `カウント ${pa.count}　` : ''}${pa.pitches ? `${pa.pitches}球` : ''}
        </div>
        ${runsText ? html`<div class="small" style="margin-top:6px">得点：${runsText}</div>` : ''}
        ${outsText ? html`<div class="small" style="margin-top:4px">アウト：${outsText}</div>` : ''}
        ${errText ? html`<div class="small" style="margin-top:4px">失策：${errText}</div>` : ''}
      </div>
      <div class="card"><ul class="list">
        <li><button class="row" data-v="result"><div class="row-main">結果を変更</div></button></li>
        <li><button class="row" data-v="rbi"><div class="row-main">打点を変更</div></button></li>
        <li><button class="row" data-v="delete"><div class="row-main" style="color:var(--danger)">この打席を削除</div></button></li>
      </ul></div>
      <p class="small muted" style="margin-top:10px">
        ${isLatest
          ? '最新の記録なので、結果を変えるとアウト数・イニング・塁の状況もやり直しになります。'
          : '過去の記録のため、結果を変えても成績だけが直り、イニングや塁の状況は変わりません。塁がずれた場合は走者の表示をタップして直してください。'}
      </p>`,
    onMount(modal, close) {
      modal.addEventListener('click', (e) => {
        const b = e.target.closest('[data-v]');
        if (b) close(b.dataset.v);
      });
    }
  });
  if (!v) return;

  if (v === 'delete') {
    const ok = await confirmSheet('この打席の記録を削除しますか？', { okLabel: '削除', danger: true });
    if (!ok) return;
    await deletePA(g, paId);
    toast('削除しました');
    rerender();
    return;
  }

  if (v === 'rbi') {
    const picked = await sheet({
      title: '打点',
      body: html`<div class="count-grid">
        ${raw([0, 1, 2, 3, 4].map((n) => `<button data-v="${n}" class="${n === pa.rbi ? 'is-on' : ''}">${n}</button>`).join(''))}
      </div>`,
      onMount(modal, close) {
        modal.addEventListener('click', (e) => {
          const b = e.target.closest('[data-v]');
          if (b) close(Number(b.dataset.v));
        });
      }
    });
    if (picked == null) return;
    await updatePA(g, paId, { rbi: picked });
    toast('打点を変更しました');
    rerender();
    return;
  }

  if (v === 'result') {
    const picked = await sheet({
      title: '結果を選び直す',
      body: html`<div class="result-grid">
        ${raw(RESULTS.map((x) => `<button class="rbtn k-${x.kind} ${x.code === pa.result ? 'is-on' : ''}" data-v="${x.code}">${esc(x.label)}</button>`).join(''))}
      </div>`,
      onMount(modal, close) {
        modal.addEventListener('click', (e) => {
          const b = e.target.closest('[data-v]');
          if (b) close(b.dataset.v);
        });
      }
    });
    if (!picked) return;

    if (isLatest) {
      // 取り消してから入れ直す。こうしないと3アウト目を安打に直しても
      // 攻守交代したままになり、打順も戻らない。
      await undoLastPA(g);
      const fresh = gameById(g.id);
      const side2 = battingSide(fresh, fresh.cur.half);
      const b2 = currentBatter(fresh);
      const done = await handleResult(fresh, picked, b2, side2, fresh.cur.bases || emptyBases());
      if (!done) {
        // 入れ直しをやめた場合は元の記録に戻す
        await addPA(gameById(g.id), {
          result: pa.result, dir: pa.dir, rbi: pa.rbi, plan: pa.plan,
          pitches: pa.pitches, count: pa.count,
          order: pa.order, playerId: pa.playerId
        });
        rerender();
      }
      return;
    }

    await updatePA(g, paId, { result: picked });
    toast('結果を変更しました（成績のみ）');
    rerender();
  }
}
