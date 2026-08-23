/* メンバー管理。削除は原則せず「引退」で隠す（通算成績を失わないため）。
   併せて、アプリ導入以前の年度別成績を手入力する画面も持つ。 */

import {
  html, raw, esc, render, on, toast, sheet, formSheet, readFields,
  wireSegments, segment, confirmSheet
} from './common.js';
import { state, playersSorted, savePlayer, removePlayer, saveLegacy, removeLegacy } from '../store.js';
import { LEGACY_FIELDS, normalizeLegacy, rates, fmtRate } from '../stats.js';
import { rerender } from './router.js';

let showRetired = false;

export default {
  title: () => 'メンバー',
  action: () => ({ label: '＋ 追加', run: () => editPlayer(null) }),

  async render(view) {
    const list = playersSorted({ includeRetired: showRetired });
    const retiredCount = state.players.filter((p) => p.retired).length;

    render(view, html`
      ${list.length === 0
        ? html`<div class="card"><div class="empty">
             メンバーが登録されていません。<br>右上の「＋ 追加」から登録してください。
           </div></div>`
        : html`<div class="card"><ul class="list">
            ${raw(list.map((p) => {
              const legacyYears = (p.legacy || []).length;
              const sub = [
                p.number ? `背番号 ${esc(p.number)}` : '',
                p.bats ? `${esc(p.bats)}打` : '',
                p.throws ? `${esc(p.throws)}投` : '',
                legacyYears ? `過去成績 ${legacyYears}年分` : ''
              ].filter(Boolean).join(' ・ ');
              return `<li><button class="row" data-edit="${esc(p.id)}">
                <div class="row-main">
                  <div class="row-title">${esc(p.name)}${p.retired ? ' <span class="badge">引退</span>' : ''}</div>
                  ${sub ? `<div class="row-sub">${sub}</div>` : ''}
                </div>
                <span class="chev">›</span>
              </button></li>`;
            }).join(''))}
          </ul></div>`}

      ${retiredCount > 0 ? html`
        <button class="btn btn-block" data-toggle-retired>
          ${showRetired ? '引退したメンバーを隠す' : `引退したメンバーも表示 (${retiredCount})`}
        </button>` : ''}

      <p class="small muted" style="margin-top:14px">
        メンバーを削除すると通算成績も失われます。試合の記録がある人は削除せず「引退」で一覧から隠す仕様です。
      </p>
    `);

    on(view, 'click', '[data-edit]', (e, b) => editPlayer(b.dataset.edit));
    on(view, 'click', '[data-toggle-retired]', () => { showRetired = !showRetired; rerender(); });
  }
};

/* ---------------- 選手の追加・編集 ---------------- */

async function editPlayer(id) {
  const p = id ? state.players.find((x) => x.id === id) : null;
  const isNew = !p;

  const body = html`
    <div class="card" style="margin:0 0 12px">
      <label class="field"><span>名前 <span style="color:var(--danger)">*</span></span>
        <input name="name" type="text" value="${p?.name || ''}" placeholder="山田 太郎" autocomplete="off"></label>
      <div class="field-row">
        <label class="field"><span>背番号</span>
          <input name="number" type="text" inputmode="numeric" value="${p?.number || ''}" placeholder="10"></label>
      </div>
      <div class="field"><span>打席</span>${segment('bats', [
        { value: '', label: '未設定' }, { value: '右', label: '右' }, { value: '左', label: '左' }, { value: '両', label: '両' }
      ], p?.bats || '')}</div>
      <div class="field"><span>投球</span>${segment('throws', [
        { value: '', label: '未設定' }, { value: '右', label: '右' }, { value: '左', label: '左' }
      ], p?.throws || '')}</div>
      <label class="field"><span>メモ</span>
        <input name="note" type="text" value="${p?.note || ''}" placeholder="任意"></label>
      ${!isNew ? html`<label class="field switch">
        <span style="margin:0">引退（一覧から隠す。成績は残る）</span>
        <input name="retired" type="checkbox" ${raw(p.retired ? 'checked' : '')}>
      </label>` : ''}
    </div>

    ${!isNew ? legacySection(p) : html`
      <p class="small muted">過去の年度別成績は、登録後にこの画面から取り込めます。</p>`}
  `;

  const { action, values } = await formSheet({
    title: isNew ? 'メンバーを追加' : 'メンバーを編集',
    body,
    okLabel: '保存',
    extraActions: isNew ? [] : [{ label: '削除', value: 'delete', kind: 'danger' }],
    read: readFields,
    onMount(modal, close) {
      wireSegments(modal);
      on(modal, 'click', '[data-legacy-add]', async () => { close('reopen'); await editLegacy(p.id, null); editPlayer(p.id); });
      on(modal, 'click', '[data-legacy-edit]', async (e, b) => {
        close('reopen');
        await editLegacy(p.id, b.dataset.legacyEdit);
        editPlayer(p.id);
      });
    }
  });

  if (action === 'delete') {
    const ok = await confirmSheet(
      `${p.name} を削除しますか？\n試合の記録や過去成績がある場合は削除せず「引退」に切り替えます。`,
      { title: '削除の確認', okLabel: '削除', danger: true });
    if (ok) {
      const r = await removePlayer(id);
      toast(r.retired ? '記録があるため引退に変更しました' : '削除しました');
      rerender();
    }
    return;
  }

  if (action !== 'ok' || !values) return;

  const name = (values.name || '').trim();
  if (!name) { toast('名前を入力してください', { danger: true }); return; }

  await savePlayer({
    ...(p || {}),
    id: p?.id,
    name,
    number: values.number || '',
    bats: values.bats || '',
    throws: values.throws || '',
    note: values.note || '',
    retired: !!values.retired,
    legacy: p?.legacy || []
  });
  toast(isNew ? '追加しました' : '保存しました');
  rerender();
}

/* ---------------- 過去成績（手入力） ---------------- */

function legacySection(p) {
  const rows = [...(p.legacy || [])].sort((a, b) => b.season - a.season);
  return html`
    <h2 class="section">過去成績（アプリ導入前の年間成績）</h2>
    <div class="card">
      ${rows.length === 0
        ? html`<div class="empty small">まだ登録されていません</div>`
        : html`<ul class="list">${raw(rows.map((r) => {
            const n = normalizeLegacy(r);
            const rt = rates(n);
            return `<li><button class="row" data-legacy-edit="${esc(r.id)}">
              <div class="row-main">
                <div class="row-title">${esc(r.season)}年</div>
                <div class="row-sub mono">${n.G}試合 ${n.AB}打数${n.H}安打 本${n.HR} 点${n.RBI}</div>
              </div>
              <span class="row-aside mono">${fmtRate(rt.avg)}</span>
              <span class="chev">›</span>
            </button></li>`;
          }).join(''))}</ul>`}
    </div>
    <button type="button" class="btn btn-block" data-legacy-add>＋ 年度を追加</button>
    <p class="small muted" style="margin-top:8px">
      ここで入れた成績は通算成績に合算されます。単打と塁打は安打・二塁打・三塁打・本塁打から自動計算します。
    </p>`;
}

async function editLegacy(playerId, legacyId) {
  const p = state.players.find((x) => x.id === playerId);
  if (!p) return;
  const rec = legacyId ? (p.legacy || []).find((r) => r.id === legacyId) : null;
  const isNew = !rec;
  const defaultSeason = rec?.season || (new Date().getFullYear() - 1);

  const body = html`
    <div class="card" style="margin:0 0 12px">
      <label class="field"><span>年度 <span style="color:var(--danger)">*</span></span>
        <input name="season" type="number" inputmode="numeric" value="${defaultSeason}" min="1900" max="2999"></label>
    </div>
    <div class="card">
      ${raw(chunk(LEGACY_FIELDS, 3).map((group) => `
        <div class="field-row">
          ${group.map((f) => `
            <label class="field"><span>${esc(f.label)}${f.hint ? `<span class="tiny"> ${esc(f.hint)}</span>` : ''}</span>
              <input name="${f.key}" type="number" inputmode="numeric" min="0"
                     value="${rec ? esc(rec[f.key] ?? '') : ''}" placeholder="0"></label>`).join('')}
        </div>`).join(''))}
    </div>
    <p class="small muted" style="margin-top:10px">
      分かる項目だけで構いません。空欄は 0 として扱います。
    </p>`;

  const { action, values } = await formSheet({
    title: isNew ? `${p.name} の過去成績を追加` : `${p.name} ${rec.season}年の成績`,
    body,
    okLabel: '保存',
    extraActions: isNew ? [] : [{ label: '削除', value: 'delete', kind: 'danger' }],
    read: readFields
  });

  if (action === 'delete') {
    const ok = await confirmSheet(`${rec.season}年の成績を削除しますか？`, { title: '削除の確認', okLabel: '削除', danger: true });
    if (ok) { await removeLegacy(playerId, legacyId); toast('削除しました'); }
    return;
  }
  if (action !== 'ok' || !values) return;

  const season = Number(values.season);
  if (!season || season < 1900 || season > 2999) { toast('年度を正しく入力してください', { danger: true }); return; }

  const row = { id: rec?.id, season };
  for (const f of LEGACY_FIELDS) {
    const v = values[f.key];
    row[f.key] = v === '' || v == null ? 0 : Math.max(0, Number(v) || 0);
  }
  await saveLegacy(playerId, row);
  toast('保存しました');
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
