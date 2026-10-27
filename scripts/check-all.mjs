#!/usr/bin/env node
// 一键体检：词库（结构 + 产物同步）+ 密钥 + 构建 + 产物一致性 + 页面自检。
// 用法:
//   node scripts/check-all.mjs          完整检查（提交前跑）
//   node scripts/check-all.mjs --fast   只查格式和密钥（pre-commit 用，跳过构建）
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSources, staleReason } from '../lib/lexicon.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = (p) => path.join(ROOT, p);
const fast = process.argv.includes('--fast');

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m, hint) => { failed++; console.log('  ✕ ' + m); if (hint) console.log('     → ' + hint); };

// ---------- 1. 词库 ----------
console.log('\n[1/5] 词库（源结构 + 产物同步）');
const rulesPath = R('lexicon/rules.zh-cn.v1.json');
let rules;
try {
  const v = validateSources(ROOT);
  for (const w of v.warnings) console.log('  · ' + w);
  if (v.errors.length) for (const e of v.errors) bad(e);
  else ok(v.stats.files + ' 个词条文件 / ' + v.stats.entries + ' 条 / ' + v.stats.categories + ' 类，字段完整、id 唯一、category 与文件一致');

  // 只读比对，不写盘，所以 --fast 也能跑（钩子里不允许改工作区）
  const why = staleReason(ROOT);
  if (why) bad(why, '改完词条要跑 node scripts/build-lexicon.mjs，不要手改产物');
  else ok('lexicon/zh-cn.v1.json 与源一致（可放心提交）');
} catch (e) {
  bad('词库读取失败：' + e.message, '看 lexicon/meta.json 与 lexicon/entries/*.json 是不是合法 JSON');
}
try {
  rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  ok('rules.zh-cn.v1.json 是合法 JSON');
} catch (e) {
  bad('rules.zh-cn.v1.json 解析失败：' + e.message);
}

if (rules) {
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
console.log('\n[2/5] 密钥体检');
try {
  execFileSync(process.execPath, [R('scripts/check-secrets.mjs')], { cwd: ROOT, stdio: 'inherit' });
} catch {
  failed++;
  console.log('  ✕ 密钥检查未通过（见上方明细）');
}

// ---------- 3. 构建 ----------
console.log('\n[3/5] 构建离线版');
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
console.log('\n[4/5] 产物一致性');
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

console.log('\n[5/5] 页面自检（产物里的脚本真的跑一遍）');
if (fast) {
  console.log('  – 已跳过（--fast）');
} else {
  try {
    execFileSync(process.execPath, [R('scripts/check-page.mjs')], { cwd: ROOT, stdio: 'inherit' });
  } catch {
    bad('页面跑不起来', '单独跑：node scripts/check-page.mjs');
  }
}

console.log('\n' + (failed ? '✕ 有 ' + failed + ' 项没通过，先修好再提交。' : '✓ 全部通过。'));
process.exit(failed ? 1 : 0);
