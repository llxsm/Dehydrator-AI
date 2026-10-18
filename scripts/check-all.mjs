#!/usr/bin/env node
// 一键体检：数据格式 + 密钥 + 构建 + 产物一致性。
// 用法:
//   node scripts/check-all.mjs          完整检查（提交前跑）
//   node scripts/check-all.mjs --fast   只查格式和密钥（pre-commit 用，跳过构建）
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = (p) => path.join(ROOT, p);
const fast = process.argv.includes('--fast');

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m, hint) => { failed++; console.log('  ✕ ' + m); if (hint) console.log('     → ' + hint); };

// ---------- 1. 词典结构 ----------
console.log('\n[1/4] 词典结构');
const lexPath = R('lexicon/zh-cn.v1.json');
const rulesPath = R('lexicon/rules.zh-cn.v1.json');
let lex, rules;
try {
  lex = JSON.parse(fs.readFileSync(lexPath, 'utf8'));
  ok('zh-cn.v1.json 是合法 JSON');
} catch (e) {
  bad('zh-cn.v1.json 解析失败：' + e.message, '最常见原因是少一个逗号或多了个逗号');
}
try {
  rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  ok('rules.zh-cn.v1.json 是合法 JSON');
} catch (e) {
  bad('rules.zh-cn.v1.json 解析失败：' + e.message);
}

if (lex && rules) {
  const cats = new Set(Object.keys(lex.categories));
  const ids = new Set();
  const NEED = ['id', 'category', 'label', 'weight', 'why', 'advice', 'example'];
  let entryIssues = 0;
  for (const e of lex.entries) {
    for (const k of NEED) if (e[k] === undefined || e[k] === '') { bad('词条 ' + (e.id || '?') + ' 缺字段 ' + k); entryIssues++; }
    if (e.category && !cats.has(e.category)) { bad('词条 ' + e.id + ' 的 category「' + e.category + '」不在 categories 里'); entryIssues++; }
    if (!Array.isArray(e.terms) || !e.terms.length) { bad('词条 ' + e.id + ' 的 terms 为空'); entryIssues++; }
    if (ids.has(e.id)) { bad('词条 id 重复：' + e.id); entryIssues++; }
    ids.add(e.id);
  }
  if (!entryIssues) ok(lex.entries.length + ' 条词条，字段完整、id 唯一、category 合法');

  const rids = new Set();
  let ruleIssues = 0;
  for (const r of rules.rules) {
    if (!Array.isArray(r.groups) || r.groups.length !== 2) { bad('规则 ' + r.id + ' 必须有两组词'); ruleIssues++; }
    if (typeof r.gap !== 'number') { bad('规则 ' + r.id + ' 缺 gap（数字）'); ruleIssues++; }
    if (rids.has(r.id)) { bad('规则 id 重复：' + r.id); ruleIssues++; }
    rids.add(r.id);
  }
  if (!ruleIssues) ok(rules.rules.length + ' 条规则，结构正确');
}

// ---------- 2. 密钥 ----------
console.log('\n[2/4] 密钥体检');
try {
  execFileSync(process.execPath, [R('scripts/check-secrets.mjs')], { cwd: ROOT, stdio: 'inherit' });
} catch {
  failed++;
  console.log('  ✕ 密钥检查未通过（见上方明细）');
}

// ---------- 3. 构建 ----------
console.log('\n[3/4] 构建离线版');
if (fast) {
  console.log('  – 已跳过（--fast）');
} else {
  try {
    execFileSync(process.execPath, [R('scripts/build-offline.mjs')], { cwd: ROOT, stdio: 'inherit' });
  } catch {
    bad('构建失败', '通常是 engine.mjs 或模板里有语法错误');
  }
}

// ---------- 4. 产物一致性 ----------
console.log('\n[4/4] 产物一致性');
if (fast) {
  console.log('  – 已跳过（--fast）');
} else {
  try {
    const a = fs.readFileSync(R('dist/dehydrator-offline.html'), 'utf8');
    const b = fs.readFileSync(R('docs/index.html'), 'utf8');
    if (a === b) ok('dist 与 docs 内容一致（' + Math.round(a.length / 1024) + 'K 字符）');
    else bad('dist 与 docs 不一致', '跑一次 node scripts/build-offline.mjs 重新生成');
    if (!a.includes('window.DH')) bad('产物里找不到引擎，可能占位符没替换成功');
  } catch (e) {
    bad('读不到产物：' + e.message);
  }
}

console.log('\n' + (failed ? '✕ 有 ' + failed + ' 项没通过，先修好再提交。' : '✓ 全部通过。'));
process.exit(failed ? 1 : 0);
