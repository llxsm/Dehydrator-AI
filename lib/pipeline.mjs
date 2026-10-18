// 三级漏斗：L1 候选 → L1.5 代价门槛 → L2 排序。
// 任何一环失败都自动降级，绝不让整份报告失败。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from './match.mjs';
import { chatJSON, hasLLM, getConfig } from './llm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- L1.5 代价门槛（纯确定性） ----------
const ACTION = ['申请', '提交', '办理', '报名', '报到', '申诉', '复核', '备案', '提出', '续期', '反馈', '确认', '回复', '逾期', '日内', '期限内', '截止'];
const IRREV = ['取消资格', '视为放弃', '不予受理', '不再受理', '作废', '退学', '开除', '失效', '不再享有', '取消其', '注销'];
const MONEY = ['承担', '费用', '违约金', '押金', '扣除', '赔偿', '支付', '补足', '不退'];
const DATA = ['个人信息', '隐私', '数据', '授权', '共享给第三方', '收集'];
const PROC = ['送达', '通知', '公告', '格式', '表格', '联系地址', '联系人'];

const READER_OF = { student: '学生', user: '用户', a: '甲方', b: '乙方' };
const SUBJ_BY_STANCE = {
  student: ['学生', '本人'],
  user: ['用户', '您'],
  b: ['乙方', '丙方'],
  a: ['甲方'],
};

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

const ADMIN_TOKENS = ['学校', '学院', '校方', '甲方', '平台', '本公司', '公司', '经营者', '教师', '辅导员', '医院', '机构'];

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

const RANK = { lose_qualification: 5, requirement: 4, lose_money: 3, lose_data: 3, procedural: 1, other: 2 };

// ---------- L2 提示词 ----------
const PROMPT_PATH = path.join(ROOT, 'prompts/l2-judge.md');
function loadSystemPrompt() {
  const md = fs.readFileSync(PROMPT_PATH, 'utf8');
  const start = md.indexOf('## System');
  const end = md.indexOf('## User');
  if (start < 0) throw new Error('提示词文件缺少 ## System 段');
  return md.slice(start + '## System'.length, end < 0 ? undefined : end).trim();
}

function buildUserMessage({ documentName, totalChars, stance, candidates, topN }) {
  const lines = [];
  lines.push('文件：' + documentName);
  lines.push('全文 ' + totalChars + ' 字，按「' + (READER_OF[stance] || stance) + '」的立场判断。');
  lines.push('');
  lines.push('下面是 L1 筛出的 ' + candidates.length + ' 条有后果的句子，请挑出最重要的 ' + Math.min(topN, candidates.length) + ' 条并排序。');
  lines.push('');
  for (const c of candidates) {
    lines.push('[' + c.id + '] 类别=' + c.categoryName + ' 代价标签=' + c.consequence.kind + ' 要求行动=' + (c.consequence.requiresAction ? '是' : '否'));
    lines.push(c.text);
    lines.push('');
  }
  return lines.join('\n');
}

// ---------- 主流程 ----------
export async function dehydrate(raw, {
  stance = 'user',
  documentName = '未命名文档',
  topN = 10,
  useLLM = true,
  env = process.env,
} = {}) {
  const L = scan(raw);
  const entryById = new Map(L.lexicon.entries.map((e) => [e.id, e]));
  for (const r of L.rulebook.rules) entryById.set(r.id, r);
  const candidates = L.candidates.map((c, i) => {
    const top = c.hits.reduce((a, b) => (b.weight > a.weight ? b : a), c.hits[0]);
    const entry = entryById.get(top.id) || {};
    return {
      id: 'c' + (i + 1),
      text: c.text,
      categoryName: L.lexicon.categories[top.category]?.name || top.category,
      label: top.label,
      advice: entry.advice || '',
      why: entry.why || '',
      weight: top.weight,
      bearing: null,
      consequence: consequenceOf(c.text, stance),
    };
  });

  const consequential = candidates.filter((c) => c.consequence.kind !== 'other' && c.consequence.kind !== 'procedural');
  // 有后果的太少时，退回全部候选，避免"筛没了"
  const pool = consequential.length >= Math.min(topN, 3) ? consequential : candidates;

  const stats = {
    chars: L.text.length,
    sentences: L.sentences,
    candidates: candidates.length,
    consequential: consequential.length,
    shown: Math.min(topN, pool.length),
  };

  const base = {
    stats,
    stance,
    documentName,
    gaps: L.gaps,
    clusters: L.clusters.length,
  };

  // ---- 降级路径：没有任何模型也能出完整报告 ----
  const fallback = () => {
    const sorted = [...pool].sort((a, b) =>
      (RANK[b.consequence.kind] - RANK[a.consequence.kind])
      || (Number(b.consequence.requiresAction) - Number(a.consequence.requiresAction))
      || (b.weight - a.weight));
    return {
      ...base,
      mode: 'fallback',
      summary: '这份 ' + stats.chars.toLocaleString() + ' 字的文件里，有 ' + stats.consequential
        + ' 处会影响到你。以下是其中该看的 ' + stats.shown + ' 处（离线排序，未经模型）。',
      picks: sorted.slice(0, topN).map((c, i) => ({
        rank: i + 1, id: c.id, text: c.text,
        title: c.label || c.categoryName,
        plain: c.advice || c.why || '',
        consequence: c.consequence.kind,
        requiresAction: c.consequence.requiresAction,
        surprise: null,
        categoryName: c.categoryName,
      })),
      rest: sorted.slice(topN).map((c) => ({ id: c.id, text: c.text, categoryName: c.categoryName })),
    };
  };

  if (!useLLM || !hasLLM(env)) return fallback();

  try {
    const cfg = getConfig(env);
    const system = loadSystemPrompt();
    const user = buildUserMessage({ documentName, totalChars: stats.chars, stance, candidates: pool, topN });
    const out = await chatJSON({ system, user, maxTokens: 2400, env });
    const picksRaw = Array.isArray(out?.picks) ? out.picks : [];
    const byId = new Map(pool.map((c) => [c.id, c]));
    const picks = [];
    for (const p of picksRaw) {
      const c = byId.get(p.id);
      if (!c) continue; // 模型编造了不存在的 id，直接丢弃
      picks.push({
        rank: picks.length + 1,
        id: c.id,
        text: c.text,
        title: String(p.title || '').slice(0, 40),
        plain: String(p.plain || '').slice(0, 60),
        consequence: p.consequence || c.consequence.kind,
        requiresAction: p.requiresAction === true,
        surprise: p.surprise || null,
        categoryName: c.categoryName,
      });
    }
    if (!picks.length) return fallback();

    const usedIds = new Set(picks.map((p) => p.id));
    return {
      ...base,
      mode: 'live',
      model: cfg.model,
      summary: '这份 ' + stats.chars.toLocaleString() + ' 字的文件里，有 ' + stats.consequential
        + ' 处会影响到你。以下是其中最该看的 ' + picks.length + ' 处。',
      picks,
      rest: pool.filter((c) => !usedIds.has(c.id)).map((c) => ({ id: c.id, text: c.text, categoryName: c.categoryName })),
    };
  } catch (e) {
    const f = fallback();
    return { ...f, mode: 'fallback_error', error: String(e.message || e).slice(0, 120) };
  }
}
