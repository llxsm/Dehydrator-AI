#!/usr/bin/env node
// 用法: node scripts/scan.mjs <文件> [--top=6] [--show=8]
import fs from 'node:fs';
import { scan } from '../lib/match.mjs';

const file = process.argv[2];
if (!file) { console.error('用法: node scripts/scan.mjs <文件>'); process.exit(1); }
const opt = Object.fromEntries(process.argv.slice(3).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const TOP = Number(opt.top ?? 6);
const SHOW = Number(opt.show ?? 8);

const raw = fs.readFileSync(file, 'utf8');
const r = scan(raw);
const cat = r.lexicon.categories;

const pct = (a, b) => Math.round((a / b) * 100);
const ruleCount = r.rule.length;
const dictCount = r.dict.length;

console.log('文件  ' + file);
console.log('字数  ' + r.text.length + ' | 句数 ' + r.sentences + ' | 候选句 ' + r.candidates.length
  + ' (' + pct(r.candidates.length, r.sentences) + '% 的句子要给人看)');
console.log('命中  固定短语 ' + dictCount + ' 处 / 共现规则 ' + ruleCount + ' 处 / 合并后 ' + r.clusters.length + ' 簇');
console.log('水份  ' + r.water.pct + '%（覆盖 ' + r.water.covered + ' 字）');

const byCat = {};
for (const c of r.clusters) byCat[c.primary.category] = (byCat[c.primary.category] || 0) + 1;
console.log('类别  ' + Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => cat[k].name + '×' + v).join('  '));

const byEntry = {};
for (const s of r.spans) byEntry[s.id] = (byEntry[s.id] || 0) + 1;
console.log('高频词条');
for (const [id, n] of Object.entries(byEntry).sort((a, b) => b[1] - a[1]).slice(0, 6)) {
  const meta = r.lexicon.entries.find((e) => e.id === id) || r.rulebook.rules.find((x) => x.id === id);
  console.log('   ' + id.padEnd(6) + '×' + String(n).padEnd(3) + cat[meta.category].name + '｜' + meta.label);
}

// 段落密度：哪几段最该读
const paras = [];
let pos = 0;
for (const line of r.text.split('\n')) {
  const start = pos; pos += line.length + 1;
  if (line.trim().length < 40) continue;
  const inP = r.spans.filter((s) => s.start >= start && s.end <= start + line.length);
  if (!inP.length) continue;
  const score = inP.reduce((a, s) => a + s.weight, 0) / Math.sqrt(line.length / 100);
  paras.push({ score, text: line.trim(), hits: inP.length });
}
paras.sort((a, b) => b.score - a.score);
console.log('\n最该读的 ' + TOP + ' 段');
for (const p of paras.slice(0, TOP)) {
  console.log('   [' + p.hits + '处] ' + p.text.slice(0, 62).replace(/\n/g, ' ') + '…');
}

// 需要 L2 判立场的样本
const stance = r.clusters.filter((c) => c.needsStance);
console.log('\n需要模型判立场（关键词分不清主语）共 ' + stance.length + ' 处，示例:');
const seen = new Set();
for (const c of stance) {
  if (seen.has(c.primary.id)) continue;
  seen.add(c.primary.id);
  console.log('   [' + c.primary.id + '] 「' + r.text.slice(c.start, Math.min(c.end, c.start + 52)).replace(/\n/g, ' ') + '」');
  if (seen.size >= SHOW) break;
}
