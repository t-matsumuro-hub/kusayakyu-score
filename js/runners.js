/* 走者（ランナー）の管理と進塁の計算。
   打点・得点・盗塁を正確に出すには塁上の状態が必要なため、
   打席ごとに「誰がどの塁にいて、どこへ進んだか」を保持する。

   走者の識別子（ref）
     自チームの攻撃 : 選手 ID
     相手の攻撃     : 打順番号を文字列にしたもの（'1'〜'9'）
   ハーフイニングでどちらの攻撃かは決まるので、ref だけで一意になる。 */

/** 行き先。0=その塁に留まる, 1/2/3=その塁へ, 4=本塁（得点）, 'out'=アウト */
export const HOLD = 0;
export const HOME = 4;
export const OUT = 'out';

export const BASE_LABEL = { 1: '一塁', 2: '二塁', 3: '三塁', 4: '本塁' };
export const BASE_SHORT = { 0: '留', 1: '一', 2: '二', 3: '三', 4: '本' };

/** アウトになった場所。0 は打席（三振・フライなど塁を選ばないもの） */
export const OUT_AT_LABEL = { 0: '打席', 1: '一塁', 2: '二塁', 3: '三塁', 4: '本塁' };

export function emptyBases() {
  return { 1: null, 2: null, 3: null };
}

export function cloneBases(b) {
  return { 1: b?.[1] ?? null, 2: b?.[2] ?? null, 3: b?.[3] ?? null };
}

export function runnerCount(b) {
  return [1, 2, 3].filter((n) => b && b[n]).length;
}

export function basesLabel(b) {
  const on = [1, 2, 3].filter((n) => b && b[n]);
  if (!on.length) return '走者なし';
  if (on.length === 3) return '満塁';
  return on.map((n) => BASE_LABEL[n]).join('・');
}

/**
 * 打席結果から既定の進塁を組み立てる。
 * ここで出すのはあくまで「よくある形」で、実際と違えば入力画面で直せるようにする。
 *
 * @param {string} result 打席結果コード
 * @param {object} bases  打席開始時の塁状況
 * @returns {{dest:object, outAt:object}} dest は B/1/2/3 をキーに行き先を持つ
 */
export function defaultPlan(result, bases) {
  const on = (n) => !!(bases && bases[n]);
  const dest = { B: HOLD, 1: HOLD, 2: HOLD, 3: HOLD };
  const outAt = { B: 0, 1: 2, 2: 3, 3: 4 };

  /** 四死球などの押し出し。詰まっている走者だけが進む。 */
  const forced = () => {
    dest.B = 1;
    if (on(1)) {
      dest[1] = 2;
      if (on(2)) {
        dest[2] = 3;
        if (on(3)) dest[3] = HOME;
      }
    }
  };

  switch (result) {
    case '1B':
    case 'E':
      dest.B = 1;
      if (on(1)) dest[1] = 2;
      if (on(2)) dest[2] = 3;
      if (on(3)) dest[3] = HOME;
      break;

    case '2B':
      dest.B = 2;
      if (on(1)) dest[1] = 3;
      if (on(2)) dest[2] = HOME;
      if (on(3)) dest[3] = HOME;
      break;

    case '3B':
      dest.B = 3;
      for (const b of [1, 2, 3]) if (on(b)) dest[b] = HOME;
      break;

    case 'HR':
      dest.B = HOME;
      for (const b of [1, 2, 3]) if (on(b)) dest[b] = HOME;
      break;

    case 'BB':
    case 'IBB':
    case 'HBP':
    case 'CI':
      forced();
      break;

    case 'SO':
    case 'FO':
    case 'LO':
      dest.B = OUT;
      outAt.B = 0;
      break;

    case 'GO':
      dest.B = OUT;
      outAt.B = 1;
      break;

    case 'SH':
      dest.B = OUT;
      outAt.B = 1;
      for (const b of [3, 2, 1]) if (on(b)) dest[b] = b + 1;
      break;

    case 'SF':
      dest.B = OUT;
      outAt.B = 0;
      if (on(3)) dest[3] = HOME;
      break;

    case 'DP': {
      // 打者はアウト。詰まっている先頭の走者も封殺されるのが典型
      dest.B = OUT;
      outAt.B = 1;
      const lead = on(1) ? 1 : on(2) ? 2 : on(3) ? 3 : null;
      if (lead) { dest[lead] = OUT; outAt[lead] = lead + 1; }
      break;
    }

    case 'FC': {
      // 打者は生きて、走者が封殺される
      dest.B = 1;
      const lead = on(1) ? 1 : on(2) ? 2 : on(3) ? 3 : null;
      if (lead) { dest[lead] = OUT; outAt[lead] = lead + 1; }
      break;
    }

    default:
      dest.B = 1;
  }

  return { dest, outAt };
}

/**
 * 進塁計画を適用して、打席後の塁状況・アウト・得点を求める。
 *
 * @param {object} bases     打席開始時の塁状況
 * @param {string} batterRef 打者の ref
 * @param {object} plan      {dest, outAt}
 */
export function applyPlan(bases, batterRef, plan) {
  const next = emptyBases();
  const outs = [];
  const runs = [];
  const conflicts = [];

  // 前の走者から順に処理する（塁の取り合いを避けるため）
  const movers = [
    { key: '3', ref: bases?.[3] || null, from: 3 },
    { key: '2', ref: bases?.[2] || null, from: 2 },
    { key: '1', ref: bases?.[1] || null, from: 1 },
    { key: 'B', ref: batterRef, from: 0 }
  ];

  for (const m of movers) {
    if (!m.ref) continue;
    const d = plan.dest[m.key];

    if (d === OUT) {
      outs.push({ ref: m.ref, at: plan.outAt?.[m.key] ?? (m.from === 0 ? 1 : m.from + 1), from: m.from });
      continue;
    }
    if (d === HOME) { runs.push({ ref: m.ref, from: m.from }); continue; }

    const target = d === HOLD ? m.from : d;
    if (target === 0) continue;          // 打者が「留まる」＝ありえないので無視
    if (next[target]) conflicts.push(target);
    next[target] = m.ref;
  }

  return { bases: next, outs, runs, conflicts };
}

/**
 * 打点の既定値。
 * 失策による得点と併殺打の間の得点には打点が付かない、という規則に合わせる。
 */
export function defaultRbi(result, runs) {
  if (result === 'E' || result === 'DP' || result === 'FC') return 0;
  return runs.length;
}

/* ---------------- 走塁の記録区分 ----------------
   同じプレーでも、走者ごとに「盗塁」なのか単なる「進塁」なのかが変わる。
   （三塁走者のホームスチールに一塁走者が便乗した場合など）           */

export const CREDIT_ADVANCE = [
  { v: 'SB', label: '盗塁' },
  { v: 'ADV', label: '進塁' }
];
export const CREDIT_OUT = [
  { v: 'CS', label: '盗塁死' },
  { v: 'OUT', label: '走塁死' }
];

/** 走者ごとの既定の記録区分。intent は 'steal'（盗塁企図）か 'other'。 */
export function defaultCredit(intent, dest) {
  if (dest === OUT) return intent === 'steal' ? 'CS' : 'OUT';
  return intent === 'steal' ? 'SB' : 'ADV';
}

/** 進塁計画から、動いた走者の一覧を作る */
export function movesOf(bases, plan) {
  const moves = [];
  for (const b of [3, 2, 1]) {
    const ref = bases?.[b];
    if (!ref) continue;
    const d = plan.dest[b];
    if (d === HOLD) continue;
    moves.push({
      ref,
      from: b,
      to: d,
      at: d === OUT ? (plan.outAt?.[b] ?? b + 1) : null,
      credit: plan.credit?.[b] || null
    });
  }
  return moves;
}

/**
 * その場面でその結果を選べるか。選べない場合は理由を返す。
 * 併殺打・犠打・犠飛・野選は走者がいないと成立しない。
 * @returns {string|null} 選べない理由。選べるなら null
 */
export function resultBlockReason(result, bases, outs) {
  const req = result && result.requires;
  if (!req) return null;
  if (req.runner && runnerCount(bases) === 0) return '塁上に走者がいません';
  if (req.third && !(bases && bases[3])) return '三塁に走者がいません';
  if (req.maxOuts != null && outs > req.maxOuts) {
    return `${req.maxOuts + 1}アウトでは記録できません`;
  }
  return null;
}

/** その打席で選べる行き先（打者は「留まる」を選べない） */
export function destChoices(isBatter, from) {
  const list = [];
  if (!isBatter) list.push({ v: HOLD, label: `留(${BASE_SHORT[from]})` });
  for (const b of [1, 2, 3]) {
    if (!isBatter && b <= from) continue;      // 走者は戻らない
    list.push({ v: b, label: BASE_SHORT[b] });
  }
  list.push({ v: HOME, label: '本' });
  list.push({ v: OUT, label: 'アウト' });
  return list;
}

/**
 * アウトの位置として選べる塁。
 * 走者は「元いた塁」も選べる必要がある。ライナーやフライを捕られて
 * 飛び出した走者が帰塁できずアウトになる（離塁アウト）ため。
 */
export function outAtChoices(isBatter, from) {
  if (isBatter) return [0, 1, 2, 3, 4].map((v) => ({ v, label: OUT_AT_LABEL[v] }));
  const list = [{ v: from, label: `${OUT_AT_LABEL[from]}(帰塁)` }];
  for (let b = from + 1; b <= 4; b++) list.push({ v: b, label: OUT_AT_LABEL[b] });
  return list;
}

/**
 * 走者をアウトにしたときの、アウトになった塁の既定値。
 * 打球を捕られた場合は元の塁（帰塁できず）、それ以外は進もうとした塁（封殺）。
 */
export function defaultOutAt(result, from) {
  const caught = result === 'FO' || result === 'LO' || result === 'SF';
  return caught ? from : Math.min(4, from + 1);
}
