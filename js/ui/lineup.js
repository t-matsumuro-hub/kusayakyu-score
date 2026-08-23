/* 打順と守備配置。
   草野球の「全員打ち」に対応するため打順は可変長（9人固定にしない）。
   守備はイニングごとにスナップショットを持ち、以降のイニングへ引き継ぐ。 */

import {
  html, raw, esc, render, on, toast, sheet, formSheet, readFields, confirmSheet, pickPlayer
} from './common.js';
import {
  state, saveGame, gameById, setDefense, setRole, playerName,
  setOppFixed, saveOppLineup, setPitcher, firstSeqOfInning, oppBattedCount
} from '../store.js';
import {
  POSITIONS, POSITION_LAYOUT, POSITION_BY_CODE,
  defenseAt, rolesAt, roleOf, activeLineup, lineupSorted, formatDate,
  oppLineup, oppOrderMax, ROLE_DH, ROLE_BENCH, ROLE_LABEL, ROLE_FULL
} from '../model.js';
import { go, rerender } from './router.js';

/** 編集中の守備イニング（画面ローカル） */
let defInning = 1;

export default {
  title: () => '打順・守備',

  async render(view, params) {
    const g = gameById(params.id);
    if (!g) { render(view, html`<div class="empty">試合が見つかりません</div>`); return; }

    if (!defInning || defInning < 1) defInning = g.cur?.inning || 1;
    defInning = Math.min(defInning, Math.max(g.innings, g.cur?.inning || 1));

    const lineup = lineupSorted(g);
    const dmap = defenseAt(g, defInning);
    const assigned = new Set(Object.values(dmap).filter(Boolean));

    render(view, html`
      <div class="card card-pad small muted" style="margin-bottom:12px">
        vs ${g.opponent || '相手'} ・ ${formatDate(g.date)} ・ ${g.innings}回制
      </div>

      <h2 class="section">打順（${lineup.length}人）</h2>
      <div class="card">
        ${lineup.length === 0
          ? html`<div class="empty small">まだ登録されていません。<br>下の「＋ 打者を追加」から全員を入れてください。</div>`
          : raw(`<ul class="list">${lineup.map((e) => lineupRow(g, e, dmap)).join('')}</ul>`)}
      </div>
      <button class="btn btn-block" data-add-batter>＋ 打者を追加</button>
      <p class="small muted" style="margin-top:8px">
        守備につかない打者もそのまま追加してください（全員打ち対応）。
      </p>

      <h2 class="section">守備配置</h2>
      <div class="card card-pad">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <button class="mini" data-inn="-1">‹</button>
          <div style="flex:1;text-align:center;font-weight:700">${defInning}回 の守備</div>
          <button class="mini" data-inn="1">›</button>
        </div>
        ${raw(diamondHTML(g, dmap))}
        <p class="tiny muted center" style="margin:10px 0 0">
          位置をタップして選手を割り当てます。${defInning}回以降のイニングに引き継がれます。
        </p>
      </div>

      ${raw(benchHTML(g, lineup, assigned))}

      <div class="btn-row">
        <button class="btn" data-copy-prev>直近の試合の守備をコピー</button>
        <button class="btn" data-clear-def>この回の配置をクリア</button>
      </div>

      ${raw(oppSectionHTML(g))}

      <button class="btn btn-primary btn-block" data-goscore style="margin-top:10px">打席入力へ</button>
    `);

    on(view, 'click', '[data-inn]', async (e, b) => {
      const next = defInning + Number(b.dataset.inn);
      defInning = Math.max(1, Math.min(Math.max(g.innings, g.cur?.inning || 1) + 3, next));
      rerender();
    });

    on(view, 'click', '[data-add-batter]', () => addBatter(g));
    on(view, 'click', '[data-opp-add]', () => addOppBatter(g));
    on(view, 'click', '[data-opp-entry]', (e, b) => oppEntryMenu(g, Number(b.dataset.oppEntry)));
    on(view, 'click', '[data-opp-fix]', async () => {
      const next = !g.oppFixed;
      if (next && oppOrderMax(g) < 1) { toast('先に相手打者を追加してください', { danger: true }); return; }
      await setOppFixed(g, next);
      const fresh = gameById(g.id);
      toast(next ? `相手の打順を${oppOrderMax(fresh)}人で確定しました` : '確定を解除しました');
      rerender();
    });
    on(view, 'click', '[data-entry]', (e, b) => entryMenu(g, b.dataset.entry));
    on(view, 'click', '[data-pos]', (e, b) => assignPosition(g, b.dataset.pos));
    on(view, 'click', '[data-goscore]', () => {
      if (!lineup.length) { toast('先に打順を登録してください', { danger: true }); return; }
      go('score', { id: g.id }, { replace: true });
    });
    on(view, 'click', '[data-copy-prev]', () => copyPreviousDefense(g));
    on(view, 'click', '[data-clear-def]', async () => {
      const ok = await confirmSheet(`${defInning}回の守備配置をクリアしますか？`, { okLabel: 'クリア', danger: true });
      if (!ok) return;
      await setDefense(g, defInning, Object.fromEntries(POSITIONS.map((p) => [p.code, ''])));
      toast('クリアしました');
      rerender();
    });
  }
};

/* ---------------- 部品 ---------------- */

function lineupRow(g, e, dmap) {
  // 守備位置に就いていなければ DH（既定）か控え。長音記号だと「一塁」と紛らわしいので使わない。
  const role = roleOf(g, defInning, e.playerId);
  const posLabel = role.label;
  const isOut = e.out != null && e.out <= defInning;
  const notYet = (e.in || 1) > defInning;
  const range = [];
  if ((e.in || 1) > 1) range.push(`${e.in}回から`);
  if (e.out != null) range.push(`${e.out}回まで`);

  return `<li><button class="row lineup-item ${isOut || notYet ? 'is-out' : ''}" data-entry="${esc(e.playerId)}">
    <span class="ord">${e.order}</span>
    <span class="nm">${esc(playerName(e.playerId))}</span>
    ${range.length ? `<span class="tiny muted nowrap">${range.join(' ')}</span>` : ''}
    <span class="pos-tag ${role.kind === 'pos' ? '' : `role-${role.kind}`}">${posLabel}</span>
    <span class="chev">›</span>
  </button></li>`;
}

function diamondHTML(g, dmap) {
  const cells = POSITIONS.map((p) => {
    const pid = dmap[p.code];
    const { x, y } = POSITION_LAYOUT[p.code];
    const who = pid ? playerName(pid) : '';
    return `<button class="pos ${pid ? '' : 'empty'}" style="left:${x}%;top:${y}%" data-pos="${p.code}">
      ${p.label}${who ? `<span class="who">${esc(shortName(who))}</span>` : ''}
    </button>`;
  }).join('');
  return `<div class="diamond">${cells}</div>`;
}

function benchHTML(g, lineup, assigned) {
  const onField = lineup.filter((e) =>
    !assigned.has(e.playerId) && (e.in || 1) <= defInning && (e.out == null || e.out > defInning));
  if (!onField.length) return '';
  const dh = onField.filter((e) => roleOf(g, defInning, e.playerId).kind === 'dh');
  const bn = onField.filter((e) => roleOf(g, defInning, e.playerId).kind === 'bench');

  return `<div class="card card-pad">
    ${dh.length ? `<div class="small muted" style="margin-bottom:4px">DH・守備につかない打者（${defInning}回時点）</div>
      <div class="small" style="margin-bottom:${bn.length ? '8px' : '0'}">${dh.map((e) => esc(playerName(e.playerId))).join('、')}</div>` : ''}
    ${bn.length ? `<div class="small muted" style="margin-bottom:4px">控え（ベンチ）</div>
      <div class="small">${bn.map((e) => esc(playerName(e.playerId))).join('、')}</div>` : ''}
  </div>`;
}

/* ---------------- 相手チームの打順 ---------------- */

function oppSectionHTML(g) {
  const list = oppLineup(g);
  const n = oppOrderMax(g);
  const rows = list.map((e) => {
    const range = [];
    if ((e.in || 1) > 1) range.push(`${e.in}回から`);
    if (e.out != null) range.push(`${e.out}回まで`);
    const gone = e.out != null && e.out <= defInning;
    const notYet = (e.in || 1) > defInning;
    return `<li><button class="row lineup-item ${gone || notYet ? 'is-out' : ''}" data-opp-entry="${e.order}">
      <span class="ord">${e.order}</span>
      <span class="nm">${e.name ? esc(e.name) : `<span class="muted">名前未登録</span>`}</span>
      ${range.length ? `<span class="tiny muted nowrap">${range.join(' ')}</span>` : ''}
      <span class="chev">›</span>
    </button></li>`;
  }).join('');

  const batted = oppBattedCount(g);
  const fixCount = batted > 0 ? batted : n;

  return `<h2 class="section">相手の打順（${n}人）
    ${g.oppFixed ? '<span class="badge badge-our">確定</span>' : '<span class="badge badge-warn">未確定</span>'}</h2>
  <div class="card">
    ${rows ? `<ul class="list">${rows}</ul>` : '<div class="empty small">まだ登録がありません</div>'}
  </div>
  <div class="btn-row">
    <button class="btn" data-opp-add>＋ 相手打者を追加</button>
    <button class="btn ${g.oppFixed ? '' : 'btn-primary'}" data-opp-fix>
      ${g.oppFixed ? '確定を解除' : `打順を確定（${fixCount}人）`}</button>
  </div>
  <p class="small muted" style="margin-top:4px">
    ${g.oppFixed
      ? '確定後は打順が巡回します。人数が変わったら解除して直してください。'
      : `未確定のうちは、打席が進むたびに相手打者が自動で増えていきます。1番に戻るところで「打順を確定」を押してください。
         まだ打席に立っていない打者（名前未登録のもの）は確定時に取り除かれます。`}
  </p>`;
}

async function addOppBatter(g) {
  const next = oppOrderMax(g) + 1;
  const list = [...oppLineup(g), { order: next, in: defInning, out: null, name: '' }];
  await saveOppLineup(g, list);
  toast(`${next}番を追加しました`);
  rerender();
}

async function oppEntryMenu(g, order) {
  const list = oppLineup(g);
  const e = list.find((x) => x.order === order);
  if (!e) return;

  const v = await sheet({
    title: `相手 ${order}番`,
    body: html`<div class="card"><ul class="list">
      <li><button class="row" data-v="name"><div class="row-main">名前・背番号を入力</div>
        <div class="row-sub">${e.name ? esc(e.name) : '未登録'}</div></button></li>
      <li><button class="row" data-v="range"><div class="row-main">出場イニングを設定</div>
        <div class="row-sub">途中参加・途中交代</div></button></li>
      <li><button class="row" data-v="remove"><div class="row-main" style="color:var(--danger)">この打者を削除</div></button></li>
    </ul></div>`,
    onMount(modal, close) {
      modal.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-v]');
        if (b) close(b.dataset.v);
      });
    }
  });
  if (!v) return;

  if (v === 'name') {
    const { action, values } = await formSheet({
      title: `相手 ${order}番の名前`,
      body: html`<div class="card" style="margin:0">
        <label class="field"><span>名前・背番号など（任意）</span>
          <input name="name" type="text" value="${e.name || ''}" placeholder="例: 背番号7 / 山田"></label>
      </div>`,
      read: readFields
    });
    if (action !== 'ok' || !values) return;
    await saveOppLineup(g, list.map((x) => (x.order === order ? { ...x, name: (values.name || '').trim() } : x)));
    rerender();
    return;
  }

  if (v === 'range') {
    const { action, values } = await formSheet({
      title: `相手 ${order}番の出場イニング`,
      body: html`
        <div class="card" style="margin:0 0 12px">
          <div class="field-row">
            <label class="field"><span>参加イニング</span>
              <input name="in" type="number" inputmode="numeric" min="1" max="30" value="${e.in || 1}"></label>
            <label class="field"><span>離脱イニング</span>
              <input name="out" type="number" inputmode="numeric" min="1" max="30" value="${e.out ?? ''}" placeholder="最後まで"></label>
          </div>
        </div>
        <p class="small muted">代打・代走で入れ替わった場合は、離脱イニングを入れて新しい打者を追加してください。</p>`,
      read: readFields
    });
    if (action !== 'ok' || !values) return;
    await saveOppLineup(g, list.map((x) => (x.order === order
      ? { ...x, in: Math.max(1, Number(values.in) || 1), out: values.out === '' ? null : Math.max(1, Number(values.out) || 1) }
      : x)));
    toast('保存しました');
    rerender();
    return;
  }

  if (v === 'remove') {
    const used = (g.pas || []).some((pa) => pa.side === 'opp' && pa.order === order);
    if (used) {
      await confirmSheet(`相手 ${order}番は既に打席の記録があるため削除できません。\n途中で交代した場合は「出場イニングを設定」で離脱イニングを入れてください。`,
        { title: '削除できません', okLabel: 'わかりました' });
      return;
    }
    const ok = await confirmSheet(`相手 ${order}番を削除しますか？`, { okLabel: '削除', danger: true });
    if (!ok) return;
    // 番号を詰め直す
    const next = list.filter((x) => x.order !== order)
      .sort((a, b) => a.order - b.order)
      .map((x, i) => ({ ...x, order: i + 1 }));
    await saveOppLineup(g, next);
    rerender();
  }
}

function shortName(name) {
  const s = String(name).replace(/\s+/g, '');
  return s.length > 4 ? s.slice(0, 4) : s;
}

/* ---------------- 操作 ---------------- */

async function addBatter(g) {
  const already = new Set((g.lineup || []).map((e) => e.playerId));
  const candidates = state.players
    .filter((p) => !p.retired && !already.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, sub: p.number ? `背番号 ${p.number}` : '' }));

  if (!candidates.length) {
    toast(state.players.length ? '追加できる選手がいません' : '先にメンバーを登録してください', { danger: true });
    return;
  }
  const pid = await pickPlayer(candidates, { title: '打順に追加する選手' });
  if (!pid) return;

  const maxOrder = (g.lineup || []).reduce((m, e) => Math.max(m, e.order), 0);
  g.lineup = [...(g.lineup || []), { playerId: pid, order: maxOrder + 1, in: g.cur?.inning || 1, out: null }];
  // 1回開始前に追加した場合は最初から出場扱いにする
  if ((g.pas || []).length === 0) g.lineup[g.lineup.length - 1].in = 1;
  await saveGame(g);
  rerender();
}

async function entryMenu(g, playerId) {
  const e = (g.lineup || []).find((x) => x.playerId === playerId);
  if (!e) return;
  const name = playerName(playerId);

  const v = await sheet({
    title: `${e.order}番 ${name}`,
    body: html`
      <div class="card"><ul class="list">
        <li><button class="row" data-v="up"><div class="row-main">打順を上げる</div></button></li>
        <li><button class="row" data-v="down"><div class="row-main">打順を下げる</div></button></li>
        <li><button class="row" data-v="pos"><div class="row-main">守備位置・DH・控えを変更</div><div class="row-sub">${defInning}回から</div></button></li>
        <li><button class="row" data-v="range"><div class="row-main">出場イニングを設定</div><div class="row-sub">途中参加・途中離脱</div></button></li>
        <li><button class="row" data-v="remove"><div class="row-main" style="color:var(--danger)">打順から外す</div></button></li>
      </ul></div>`,
    onMount(modal, close) {
      modal.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-v]');
        if (b) close(b.dataset.v);
      });
    }
  });
  if (!v) return;

  if (v === 'up' || v === 'down') {
    const list = lineupSorted(g);
    const i = list.findIndex((x) => x.playerId === playerId);
    const j = v === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) { toast('これ以上動かせません'); return; }
    const a = list[i].order; list[i].order = list[j].order; list[j].order = a;
    g.lineup = list;
    await saveGame(g);
    rerender();
    return;
  }

  if (v === 'pos') { await assignPlayerToPosition(g, playerId); return; }

  if (v === 'range') {
    const { action, values } = await formSheet({
      title: `${name} の出場イニング`,
      body: html`
        <div class="card" style="margin:0 0 12px">
          <div class="field-row">
            <label class="field"><span>参加イニング</span>
              <input name="in" type="number" inputmode="numeric" min="1" max="30" value="${e.in || 1}"></label>
            <label class="field"><span>離脱イニング</span>
              <input name="out" type="number" inputmode="numeric" min="1" max="30" value="${e.out ?? ''}" placeholder="最後まで"></label>
          </div>
        </div>
        <p class="small muted">「離脱イニング」を空欄にすると最後まで出場します。3回から合流した場合は参加イニングに 3 を入れてください。</p>`,
      read: readFields
    });
    if (action !== 'ok' || !values) return;
    e.in = Math.max(1, Number(values.in) || 1);
    e.out = values.out === '' ? null : Math.max(1, Number(values.out) || 1);
    g.lineup = [...g.lineup];
    await saveGame(g);
    toast('保存しました');
    rerender();
    return;
  }

  if (v === 'remove') {
    const hasPA = (g.pas || []).some((pa) => pa.playerId === playerId);
    if (hasPA) {
      await confirmSheet(`${name} はこの試合で既に打席の記録があるため打順から外せません。\n途中で帰った場合は「出場イニングを設定」で離脱イニングを入れてください。`,
        { title: '外せません', okLabel: 'わかりました' });
      return;
    }
    const ok = await confirmSheet(`${name} を打順から外しますか？`, { okLabel: '外す', danger: true });
    if (!ok) return;
    g.lineup = lineupSorted(g).filter((x) => x.playerId !== playerId)
      .map((x, i) => ({ ...x, order: i + 1 }));
    // 守備配置からも外す
    g.defense = (g.defense || []).map((d) => ({
      inning: d.inning,
      map: Object.fromEntries(Object.entries(d.map).map(([k, val]) => [k, val === playerId ? '' : val]))
    }));
    await saveGame(g);
    rerender();
  }
}

/** グラウンド図の位置をタップ → 選手を選ぶ */
async function assignPosition(g, pos) {
  const act = activeLineup(g, defInning);
  if (!act.length) { toast('先に打順を登録してください', { danger: true }); return; }
  const dmap = defenseAt(g, defInning);
  const label = POSITION_BY_CODE[pos].full;

  const candidates = act.map((e) => {
    const cur = Object.keys(dmap).find((k) => dmap[k] === e.playerId);
    return {
      id: e.playerId,
      name: `${e.order}. ${playerName(e.playerId)}`,
      sub: cur ? `現在 ${POSITION_BY_CODE[cur].label}` : '守備なし'
    };
  });

  const pid = await pickPlayer(candidates, { title: `${defInning}回 ${label}`, allowNone: true, noneLabel: '空にする' });
  if (pid == null) return; // キャンセル。'' は「空にする」なので通す

  // 投手は登板記録にも残す（成績をイニング途中の交代まで正しく帰属させるため）
  if (pos === '1' && pid) {
    await setPitcher(g, pid, defInning, { atSeq: firstSeqOfInning(g, defInning) });
    rerender();
    return;
  }

  const next = { ...dmap };
  // 同じ選手が別の位置にいたら外す（重複配置を防ぐ）
  if (pid) for (const k of Object.keys(next)) if (next[k] === pid) next[k] = '';
  next[pos] = pid || '';
  for (const p of POSITIONS) if (!(p.code in next)) next[p.code] = '';

  await setDefense(g, defInning, next);
  rerender();
}

/** 打順メニューから「守備位置を割り当て」。DH・控えもここで選べる。 */
async function assignPlayerToPosition(g, playerId) {
  const dmap = defenseAt(g, defInning);
  const cur = roleOf(g, defInning, playerId);

  const v = await sheet({
    title: `${playerName(playerId)} の守備（${defInning}回から）`,
    body: html`
      <div class="small muted" style="margin-bottom:6px">現在：${cur.full}</div>
      <div class="pick-grid">
        ${raw(POSITIONS.map((p) => {
          const who = dmap[p.code];
          return `<button data-v="${p.code}" class="${cur.code === p.code ? 'is-on' : ''}">${p.full}
            ${who && who !== playerId ? `<span class="sub">現在 ${esc(playerName(who))}</span>` : ''}</button>`;
        }).join(''))}
      </div>
      <div class="pick-grid" style="margin-top:10px">
        <button data-v="${ROLE_DH}" class="${cur.kind === 'dh' ? 'is-on' : ''}">DH
          <span class="sub">打つが守備につかない</span></button>
        <button data-v="${ROLE_BENCH}" class="${cur.kind === 'bench' ? 'is-on' : ''}">控え
          <span class="sub">ベンチ</span></button>
      </div>`,
    onMount(modal, close) {
      modal.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-v]');
        if (b) close(b.dataset.v);
      });
    }
  });
  if (v == null) return;

  if (v === ROLE_DH || v === ROLE_BENCH) {
    await setRole(g, defInning, playerId, v);
    rerender();
    return;
  }

  if (v === '1') {
    await setPitcher(g, playerId, defInning, { atSeq: firstSeqOfInning(g, defInning) });
    rerender();
    return;
  }

  const next = { ...dmap };
  for (const k of Object.keys(next)) if (next[k] === playerId) next[k] = '';
  next[v] = playerId;
  for (const p of POSITIONS) if (!(p.code in next)) next[p.code] = '';

  // 守備位置に就いたら控えフラグは外す
  const roles = rolesAt(g, defInning);
  delete roles[playerId];
  await setDefense(g, defInning, next, roles);
  rerender();
}

/** 直近（この試合より前）の試合の最終守備配置をコピーする */
async function copyPreviousDefense(g) {
  const prev = state.games
    .filter((x) => x.id !== g.id && (x.defense || []).length)
    .filter((x) => (x.date || '') <= (g.date || ''))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];

  if (!prev) { toast('コピーできる試合がありません', { danger: true }); return; }

  const lastInning = Math.max(...prev.defense.map((d) => d.inning));
  const src = defenseAt(prev, lastInning);
  const inLineup = new Set((g.lineup || []).map((e) => e.playerId));
  const next = {};
  let hit = 0;
  for (const p of POSITIONS) {
    const pid = src[p.code];
    if (pid && inLineup.has(pid)) { next[p.code] = pid; hit += 1; } else next[p.code] = '';
  }
  if (!hit) { toast('この試合の打順に一致する選手がいません', { danger: true }); return; }

  await setDefense(g, defInning, next);
  toast(`${formatDate(prev.date, false)} の配置から ${hit}人 をコピーしました`);
  rerender();
}

export function resetDefenseInning(n) { defInning = n; }
