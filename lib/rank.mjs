// 纯函数排序层：没有任何 import、不碰文件系统、不联网。
// 浏览器（离线版）、命令行、接口三处共用同一套「挑哪 10 条」的判断。
// 责任边界：只决定「哪些句子该看、按什么顺序、标题怎么写」，不编造原文里的字。

// ---------- L1.5 代价门槛 ----------
const ACTION = ['申请', '提交', '办理', '报名', '报到', '申诉', '复核', '备案', '提出', '续期', '反馈', '确认', '回复', '逾期', '日内', '期限内', '截止'];
const IRREV = ['取消资格', '视为放弃', '不予受理', '不再受理', '作废', '退学', '开除', '失效', '不再享有', '取消其', '注销'];
const MONEY = ['承担', '费用', '违约金', '押金', '扣除', '赔偿', '支付', '补足', '不退'];
// 只留真正的个人信息词。早先写的 '数据' '授权' '收集' 太泛：
// 「寝室电话线、数据线视情节扣分」「不进入未经授权的计算机」都被算成了「交出数据」。
const DATA = ['个人信息', '隐私', '个人数据', '数据收集', '信息收集', '共享给第三方', '对外提供', '设备信息', '位置信息'];
const PROC = ['送达', '通知', '公告', '格式', '表格', '联系地址', '联系人'];

const SUBJ_BY_STANCE = {
  student: ['学生', '本人'],
  user: ['用户', '您'],
  b: ['乙方', '丙方'],
  a: ['甲方'],
};
const ADMIN_TOKENS = ['学校', '学院', '校方', '甲方', '平台', '本公司', '公司', '经营者', '教师', '辅导员', '医院', '机构'];

export const CONSEQUENCE_NAMES = {
  lose_qualification: '失去资格',
  requirement: '要你动手',
  lose_money: '涉及钱',
  lose_data: '交出数据',
  procedural: '只是程序',
  other: '其他',
};

export const RANK = { lose_qualification: 5, requirement: 4, lose_money: 3, lose_data: 3, procedural: 1, other: 2 };
export const rankOf = (kind) => RANK[kind] ?? 2;

function subjectNear(text, verbs, readerTokens, adminTokens) {
  let best = -1;
  let who = null;
  for (const v of verbs) {
    const i = text.indexOf(v);
    if (i < 0) continue;
    let pos = -1;
    let tag = null;
    for (const [list, t] of [[readerTokens, 'reader'], [adminTokens, 'admin']]) {
      for (const s of list) {
        const j = text.lastIndexOf(s, i);
        if (j >= 0 && j > pos) { pos = j; tag = t; }
      }
    }
    if (pos > best) { best = pos; who = tag; }
  }
  return who;
}

export function consequenceOf(text, stance = 'user') {
  const readerTokens = SUBJ_BY_STANCE[stance] || ['您'];
  if (PROC.some((w) => text.includes(w)) && !IRREV.some((w) => text.includes(w)) && !ACTION.some((w) => text.includes(w))) {
    return { kind: 'procedural', requiresAction: false, irreversible: false };
  }
  if (IRREV.some((w) => text.includes(w))) {
    return { kind: 'lose_qualification', requiresAction: false, irreversible: true };
  }
  if (ACTION.some((w) => text.includes(w))) {
    const who = subjectNear(text, ACTION, readerTokens, ADMIN_TOKENS);
    if (who === 'reader') return { kind: 'requirement', requiresAction: true, irreversible: false };
  }
  if (MONEY.some((w) => text.includes(w))) return { kind: 'lose_money', requiresAction: false, irreversible: false };
  if (DATA.some((w) => text.includes(w))) return { kind: 'lose_data', requiresAction: false, irreversible: false };
  return { kind: 'other', requiresAction: false, irreversible: false };
}

// ---------- 相似度与去重 ----------
export function bigrams(s) {
  const t = String(s).replace(/[^\u4e00-\u9fff]/g, '');
  const set = new Set();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}

export function jaccard(a, b) {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
}

// 后果短语：同一件事的不同写法（「视为放弃入学资格」出现两次）靠它归并
const CONS_PATTERNS = [
  /取消[^，。；：、]{0,14}/,
  /视为(?:自动)?放弃[^，。；：、]{0,14}/,
  /不予[^，。；：、]{0,12}/,
  /不再受理[^，。；：、]{0,10}/,
  /(?:开除学籍|退学|作废|失效)/,
  /由[^，。；：、]{0,10}?(?:承担|负担)[^，。；：、]{0,8}/,
  /(?:扣|罚)[^，。；：、]{0,8}分/,
  /给予[^，。；：、]{0,12}(?:处分|警告)/,
];

export function consequenceKey(text) {
  for (const re of CONS_PATTERNS) {
    const m = String(text).match(re);
    if (m) return m[0].replace(/\s+/g, '');
  }
  return null;
}

// 归并用的键：后果短语太短（「不予受理」只有 4 个字）就说明不了「这是同一件事」，
// 拿它合并会把「逾期不予受理」和「材料不全不予受理」压成一条。低于 6 个汉字不合并。
function mergeKey(text) {
  const k = consequenceKey(text);
  if (!k) return null;
  return k.replace(/[^\u4e00-\u9fff]/g, '').length >= 6 ? k : null;
}

// 同一件事只留一条：先按「后果短语」合并，再按字面相似度兜底。
// 合并后保留后果最重的那条；同等后果取最短的表述，并记下出现了几次。
export function dedupeCandidates(list, threshold = 0.62) {
  const groups = [];
  for (const c of list) {
    const g = bigrams(c.text);
    const key = mergeKey(c.text);
    let hit = null;
    for (const grp of groups) {
      if (key && grp.key === key) { hit = grp; break; }
      if (jaccard(g, grp.grams) >= threshold) { hit = grp; break; }
    }
    if (hit) hit.items.push(c);
    else groups.push({ grams: g, key, items: [c] });
  }
  return groups.map((grp) => {
    const sorted = [...grp.items].sort((a, b) =>
      (rankOf(b.consequence.kind) - rankOf(a.consequence.kind)) || (a.text.length - b.text.length));
    return { ...sorted[0], occurrences: grp.items.length };
  });
}

// ---------- 标题：从原文里摘「条件 + 后果」，不自己编 ----------
const ACTORS = /^(?:学校|学院|校方|平台|公司|本公司|甲方|乙方|丙方|经营者|商家|教师|辅导员|医院|机构|我们|他们)$/;

function conditionOf(text, cutAt) {
  let head = text.slice(0, cutAt)
    .replace(/^第[一二三四五六七八九十百零〇\d]+条\s*/, '')
    .replace(/^[（(][一二三四五六七八九十\d]+[)）]\s*/, '')
    .replace(/^[、，。；：\s]+/, '')
    .trim();
  const parts = head.split(/[，。；：、]/).map((s) => s.trim()).filter(Boolean);
  let cond = parts.length ? parts[parts.length - 1] : head;
  cond = cond.replace(/^(?:如果|若|如|凡是|对于|对|在)/, '').replace(/[时后]$/, '');
  // 「逾期者，学校不再受理成绩核查」——紧挨后果的主语不是条件，扔掉
  if (ACTORS.test(cond)) return '';
  if (cond.length > 2) cond = cond.replace(/者$/, '');
  if (cond.length > 12) {
    const cut = Math.max(cond.lastIndexOf('且', 12), cond.lastIndexOf('或', 12), cond.lastIndexOf('以及', 12), cond.lastIndexOf('并', 12));
    cond = cut >= 4 ? cond.slice(0, cut) : cond.slice(0, 12) + '…';
  }
  return cond.trim();
}

export function titleOf(c) {
  const text = String(c.text || '').replace(/\s+/g, '');
  const key = consequenceKey(text);
  if (!key) return (c.label || c.categoryName || '这条要看').slice(0, 30);
  const cons = key.replace(/^取消其/, '取消').replace(/^视为放弃其/, '视为放弃');
  const at = text.indexOf(key);
  const cond = at > 0 ? conditionOf(text, at) : '';
  let out = cond ? cond + '，' + cons : cons;
  if (out.length > 30) out = cons;
  return out.slice(0, 30);
}

export function plainOf(c) {
  const raw = c.advice || c.why || '';
  if (raw) return raw.length > 46 ? raw.slice(0, 44) + '…' : raw;
  switch (c.consequence.kind) {
    case 'lose_qualification': return '这一步做错，资格就没了，事后补不回来。';
    case 'requirement': return '这件事得你做，而且有截止时间。';
    case 'lose_money': return '这件事最后会花你的钱。';
    case 'lose_data': return '这里涉及你的个人信息。';
    case 'procedural': return '只是流程要求，但漏了会卡住。';
    default: return '原文这么说，具体影响要看你处在哪一方。';
  }
}

// ---------- 池子与排序 ----------
export function preparePool(scanned, { stance = 'user', lexicon = null, rulebook = null } = {}) {
  const lex = lexicon || scanned.lexicon || { entries: [], categories: {} };
  const book = rulebook || scanned.rulebook || { rules: [] };
  const entryById = new Map(lex.entries.map((e) => [e.id, e]));
  for (const r of book.rules) entryById.set(r.id, r);

  const raw = (scanned.candidates || []).map((c, i) => {
    const top = c.hits.reduce((a, b) => (b.weight > a.weight ? b : a), c.hits[0]);
    const entry = entryById.get(top.id) || {};
    const kind = consequenceOf(c.text, stance);
    return {
      id: 'c' + (i + 1),
      text: c.text,
      label: top.label,
      categoryName: lex.categories?.[top.category]?.name || top.category,
      advice: entry.advice || '',
      why: entry.why || '',
      weight: top.weight,
      stance,
      consequence: kind,
      // 不利后果落在别人头上 → 这条对读者有利，不该排在前面
      favorsReader: !!(c.bearing && c.bearing.bearing && stance && c.bearing.bearing !== stance),
      bearing: c.bearing ? c.bearing.bearing : null,
      bearingKind: c.bearing ? c.bearing.kind : null,
      bearingHolder: c.bearing ? c.bearing.holder : null,
    };
  });

  const deduped = dedupeCandidates(raw);
  const consequential = deduped.filter((c) => c.consequence.kind !== 'other' && c.consequence.kind !== 'procedural');
  return {
    chars: scanned.rawChars || (scanned.text || '').length,
    sentences: scanned.sentences || 0,
    gaps: scanned.gaps || null,
    clusters: (scanned.clusters || []).length,
    raw,
    deduped,
    consequential,
    pool: consequential,
  };
}

export function sortPool(pool) {
  return [...pool].sort((a, b) =>
    // 「对你是保护」往后放，但要求你行动的除外——不勾就空着，不能不管
    (Number(a.favorsReader && !a.consequence.requiresAction) - Number(b.favorsReader && !b.consequence.requiresAction))
    || (rankOf(b.consequence.kind) - rankOf(a.consequence.kind))
    || (Number(b.consequence.requiresAction) - Number(a.consequence.requiresAction))
    || (b.weight - a.weight)
    || (a.text.length - b.text.length));
}

// 多样性：同一种后果最多占 maxPerKind 格，避免 Top 10 全是「取消资格」。
// 先按配额挑，配额挡住的好东西放 overflow，最后还有空位再按原顺序补回来。
export function pickTop(sorted, { topN = 10, maxPerKind = 3 } = {}) {
  const counts = {};
  const picked = [];
  const overflow = [];
  for (const c of sorted) {
    if (picked.length >= topN) { overflow.push(c); continue; }
    const k = c.consequence.kind;
    if ((counts[k] || 0) >= maxPerKind) { overflow.push(c); continue; }
    counts[k] = (counts[k] || 0) + 1;
    picked.push(c);
  }
  for (const c of overflow) {
    if (picked.length >= topN) break;
    picked.push(c);
  }
  return picked;
}

function cardOf(c, rank) {
  return {
    rank,
    id: c.id,
    text: c.text,
    title: titleOf(c),
    plain: plainOf(c),
    label: c.label,
    categoryName: c.categoryName,
    consequence: c.consequence.kind,
    consequenceName: CONSEQUENCE_NAMES[c.consequence.kind] || c.consequence.kind,
    requiresAction: c.consequence.requiresAction,
    occurrences: c.occurrences || 1,
    bearing: c.bearing,
    bearingKind: c.bearingKind,
    bearingHolder: c.bearingHolder,
    favorsReader: c.favorsReader,
    surprise: null,
  };
}

export function buildOfflineReport(prep, { stance = 'user', topN = 10, documentName = '未命名文档', mode = 'fallback' } = {}) {
  const MIN_POOL = Math.min(topN, 3);
  // 有后果的太少时，退回全部候选，避免「筛没了」
  const fallbackPool = prep.consequential.length < MIN_POOL;
  const pool = fallbackPool ? prep.deduped : prep.consequential;
  const sorted = sortPool(pool);
  const picked = pickTop(sorted, { topN });
  const stats = {
    chars: prep.chars,
    sentences: prep.sentences,
    candidatesRaw: prep.raw.length,
    candidates: prep.deduped.length,
    duplicates: prep.raw.length - prep.deduped.length,
    consequential: prep.consequential.length,
    shown: picked.length,
  };
  const summary = fallbackPool
    // 没有一条能确认为「有后果」时，不许硬编一句结论去凑数
    ? '这份 ' + stats.chars.toLocaleString() + ' 字的文件里，没找到明确有后果的句子。'
      + '下面是命中最重的 ' + stats.shown + ' 条，仅供参考——也可能是我还不认识这类文本。'
    : '这份 ' + stats.chars.toLocaleString() + ' 字的文件里，有 ' + stats.consequential
      + ' 处会影响到你。以下是其中该看的 ' + stats.shown + ' 处'
      + (mode === 'fallback' ? '（离线排序，未经模型）。' : '。');
  return {
    mode,
    stance,
    documentName,
    stats,
    gaps: prep.gaps,
    clusters: prep.clusters,
    summary,
    picks: picked.map((c, i) => cardOf(c, i + 1)),
    rest: sorted.slice(picked.length).map((c) => ({ id: c.id, text: c.text, categoryName: c.categoryName })),
    pool,
  };
}
