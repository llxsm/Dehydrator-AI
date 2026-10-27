// 三级漏斗：L1 候选 → L1.5 代价门槛 → L2 排序。
// 排序判断全在 lib/rank.mjs（纯函数，浏览器离线版共用同一套）；
// 这里只负责「读提示词文件 + 调模型 + 任何一环失败就降级」。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from './match.mjs';
import {
  consequenceOf, dedupeCandidates, bigrams, jaccard, RANK, rankOf,
  preparePool, buildOfflineReport, sortPool, pickTop, titleOf, plainOf,
  consequenceKey, CONSEQUENCE_NAMES,
} from './rank.mjs';
import { chatJSON, hasLLM, getConfig } from './llm.mjs';

export {
  consequenceOf, dedupeCandidates, bigrams, jaccard, RANK, rankOf,
  preparePool, buildOfflineReport, sortPool, pickTop, titleOf, plainOf,
  consequenceKey, CONSEQUENCE_NAMES,
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const READER_OF = { student: '学生', user: '用户', a: '甲方', b: '乙方' };

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
  const prep = preparePool(L, { stance, lexicon: L.lexicon, rulebook: L.rulebook });

  // ---- 降级路径：没有任何模型也能出完整报告 ----
  // 排序、去重、标题生成全在纯函数层，和离线版是同一条路径
  const report = buildOfflineReport(prep, { stance, topN, documentName, mode: 'fallback' });
  if (!useLLM || !hasLLM(env)) return report;

  try {
    const cfg = getConfig(env);
    const system = loadSystemPrompt();
    const pool = report.pool;
    const user = buildUserMessage({ documentName, totalChars: report.stats.chars, stance, candidates: pool, topN });
    // temperature 0：同样的输入给同样的输出，评委重跑结果一致
    const out = await chatJSON({ system, user, maxTokens: 2400, temperature: 0, env });
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
        title: String(p.title || '').slice(0, 40) || titleOf(c),
        plain: String(p.plain || '').slice(0, 60) || plainOf(c),
        label: c.label,
        categoryName: c.categoryName,
        consequence: p.consequence || c.consequence.kind,
        consequenceName: CONSEQUENCE_NAMES[p.consequence] || CONSEQUENCE_NAMES[c.consequence.kind] || c.consequence.kind,
        requiresAction: p.requiresAction === true,
        occurrences: c.occurrences || 1,
        bearing: c.bearing,
        bearingKind: c.bearingKind,
        bearingHolder: c.bearingHolder,
        favorsReader: c.favorsReader,
        surprise: p.surprise || null,
      });
    }
    if (!picks.length) return report;

    // 模型仍然可能把同一条规则拆成两条（它在措辞层面看不出「这是同一件事」）。
    // 这里在代码层强制再合一次：宁可少于 topN，也不重复。
    const kept = [];
    const keptGrams = [];
    let merged = 0;
    for (const p of picks) {
      const g = bigrams(p.text);
      if (keptGrams.some((s) => jaccard(g, s) >= 0.62)) { merged += 1; continue; }
      keptGrams.push(g);
      kept.push({ ...p, rank: kept.length + 1 });
    }

    const usedIds = new Set(kept.map((p) => p.id));
    const stats = report.stats;
    return {
      mode: 'live',
      model: cfg.model,
      stance,
      documentName,
      stats,
      gaps: report.gaps,
      clusters: report.clusters,
      merged,
      summary: '这份 ' + stats.chars.toLocaleString() + ' 字的文件里，有 ' + stats.consequential
        + ' 处会影响到你。以下是其中最该看的 ' + kept.length + ' 处。',
      picks: kept,
      rest: pool.filter((c) => !usedIds.has(c.id)).map((c) => ({ id: c.id, text: c.text, categoryName: c.categoryName })),
    };
  } catch (e) {
    return { ...report, mode: 'fallback_error', error: String(e.message || e).slice(0, 120) };
  }
}
