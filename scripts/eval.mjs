#!/usr/bin/env node
// 评测：拿 corpus/gold.tsv 当标准答案，算精确率 / 漏报 / 边界率。
// 用法: node scripts/eval.mjs [--detail]
import fs from 'node:fs';
import path from 'node:path';
import { scan } from '../lib/match.mjs';
import { resolveInput, resolveRoot } from '../lib/env.mjs';

const detail = process.argv.includes('--detail');
const goldPath = resolveInput('corpus/gold.tsv');
const raw = fs.readFileSync(goldPath, 'utf8');

const rows = raw.split('\n')
  .filter((l) => l.trim() && !l.trim().startsWith('#'))
  .map((l) => {
    const [id, doc, label, myCategory, prefix] = l.split('\t');
    return { id, doc, label, myCategory, prefix };
  });

const dir = resolveRoot('corpus/raw');
const cache = new Map();

// 去掉所有空白后的副本 + 位置映射，用来对抗 PDF 转换插入的空格
const stripMap = (text) => {
  let s = '';
  const map = [];
  for (let i = 0; i < text.length; i++) {
    if (!/\s/.test(text[i])) { s += text[i]; map.push(i); }
  }
  return { s, map };
};

const getScan = (doc) => {
  if (!cache.has(doc)) {
    const p = path.join(dir, doc + '.txt');
    if (!fs.existsSync(p)) return null;
    const sc = scan(fs.readFileSync(p, 'utf8'));
    sc.flat = stripMap(sc.text);
    cache.set(doc, sc);
  }
  return cache.get(doc);
};

const sentRange = (text, idx) => {
  const END = '。！？；\n';
  let s = idx;
  while (s > 0 && !END.includes(text[s - 1])) s--;
  let e = idx;
  while (e < text.length && !END.includes(text[e])) e++;
  return { start: s, end: Math.min(e + 1, text.length) };
};

const results = [];
for (const r of rows) {
  const sc = getScan(r.doc);
  if (!sc) { results.push({ ...r, status: '缺文档' }); continue; }
  const flatIdx = sc.flat.s.indexOf(r.prefix.replace(/\s+/g, ''));
  if (flatIdx < 0) { results.push({ ...r, status: '定位失败' }); continue; }
  const idx = sc.flat.map[flatIdx];
  const sr = sentRange(sc.text, idx);
  const flagged = sc.clusters.some((c) => c.start < sr.end && c.end > sr.start);
  const cluster = sc.clusters.find((c) => c.start < sr.end && c.end > sr.start);
  results.push({
    ...r, flagged, status: 'ok',
    sentence: sc.text.slice(sr.start, sr.end).replace(/\s+/g, ''),
    hit: cluster ? cluster.primary.label : null,
  });
}

const ok = results.filter((r) => r.status === 'ok');
const A = ok.filter((r) => Number(r.id) <= 18);
const B = ok.filter((r) => Number(r.id) > 18);

const count = (arr, label) => arr.filter((r) => r.label === label).length;

const aTrap = A.filter((r) => r.label === '会');
const aSafe = A.filter((r) => r.label === '不会');
const aEdge = A.filter((r) => r.label === '边界');
const bTrap = B.filter((r) => r.label === '会');
const bEdge = B.filter((r) => r.label === '边界');

// A 组：我没标记的算漏（但 A 组本来就是抽"标记过的"，漏报在这里没有统计意义）
const aTrapFlagged = aTrap.filter((r) => r.flagged).length;
const aSafeFlagged = aSafe.filter((r) => r.flagged);
const aEdgeFlagged = aEdge.filter((r) => r.flagged).length;

// B 组：抽的是"没标记过的"，这里的"会"才是真漏报
const bTrapFlagged = bTrap.filter((r) => r.flagged).length;

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—');

console.log('Gold 集：' + ok.length + ' 条可用' + (results.length !== ok.length ? '（' + (results.length - ok.length) + ' 条异常）' : ''));
results.filter((r) => r.status !== 'ok').forEach((r) => console.log('  ! #' + r.id + ' ' + r.status + ' — ' + r.doc));

console.log('\n── A 组：我标记过的 ' + A.length + ' 条（测误报）');
console.log('  我标了，你判"会"     ' + aTrapFlagged + ' 条   ← 命中');
console.log('  我标了，你判"不会"   ' + aSafeFlagged.length + ' 条   ← 硬误报');
console.log('  我标了，你判"边界"   ' + aEdgeFlagged + ' 条   ← 边界样本');
console.log('  精确率（排除边界）   ' + pct(aTrapFlagged, aTrapFlagged + aSafeFlagged.length));
console.log('  精确率（边界算错）   ' + pct(aTrapFlagged, A.length));

console.log('\n── B 组：我没标记过的 ' + B.length + ' 条（测漏报）');
console.log('  我没标，你判"会"     ' + bTrapFlagged + ' 条   ← 漏报');
console.log('  我没标，你判"边界"   ' + bEdge.length + ' 条');
console.log('  我没标，你判"不会"   ' + (B.length - bTrapFlagged - bEdge.length) + ' 条   ← 正确放过');

const edgeAll = aEdge.length + bEdge.length;
console.log('\n── 总体');
console.log('  边界样本占比         ' + pct(edgeAll, ok.length) + '  （' + edgeAll + '/' + ok.length + '）');

if (aSafeFlagged.length || (detail && aEdge.length)) {
  console.log('\n── 误报明细');
  for (const r of aSafeFlagged) console.log('  ✕ #' + r.id + ' [' + r.hit + '] ' + r.sentence.slice(0, 46) + '…');
}
if (detail) {
  console.log('\n── 边界样本明细（这些是词典和人都定不了的）');
  for (const r of [...aEdge, ...bEdge]) {
    console.log('  ? #' + r.id + (r.flagged ? ' [已标:' + r.hit + ']' : ' [未标]') + ' ' + r.sentence.slice(0, 46) + '…');
  }
}
