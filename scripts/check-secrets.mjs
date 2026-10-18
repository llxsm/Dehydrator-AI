#!/usr/bin/env node
// 密钥体检：提交前跑一遍，发现问题就以非零码退出。
// 用法: node scripts/check-secrets.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIR = new Set(['node_modules', '.git', '.next', 'dist', 'out', 'input', '.dsh']);
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.md', '.html', '.yml', '.yaml', '.env', '.txt', '.example']);

const PATTERNS = [
  { name: '疑似 API key 明文', re: /\bsk-[A-Za-z0-9_-]{16,}/, fix: '把 key 移到 .env.local，并立刻到后台轮换这个 key' },
  { name: 'NEXT_PUBLIC_ 里放了密钥', re: /NEXT_PUBLIC_[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)/, fix: '删掉 NEXT_PUBLIC_ 前缀——这个前缀会把变量打进浏览器' },
  { name: '疑似 Bearer 硬编码', re: /Bearer\s+[A-Za-z0-9._-]{20,}/, fix: '改成从环境变量读取' },
  { name: '疑似密钥赋值', re: /(api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9_\-]{20,}["']/i, fix: '改成 process.env 读取' },
];

const problems = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    if (e.name === '.env.example') continue;
    if (e.name.startsWith('.env')) {
      // .env 类文件按设计就要放密钥，跳过内容扫描；
      // 只确认它没有被 git 跟踪（一旦被跟踪才是真事故）
      const rel = path.relative(ROOT, full);
      let tracked = false;
      try {
        execFileSync('git', ['ls-files', '--error-unmatch', rel], { cwd: ROOT, stdio: 'ignore' });
        tracked = true;
      } catch { tracked = false; }
      if (tracked) {
        problems.push({ file: rel, name: '.env 文件已被 git 跟踪', fix: '立刻 git rm --cached 它，并从历史中清除；然后轮换 key' });
      } else {
        console.log('  – ' + rel + ' 存在，但未被 git 跟踪（正确）');
      }
      continue;
    }
    if (!TEXT_EXT.has(path.extname(e.name)) && !e.name.startsWith('.env')) continue;
    if (fs.statSync(full).size > 2_000_000) continue;
    const text = fs.readFileSync(full, 'utf8');
    const lines = text.split('\n');
    for (const p of PATTERNS) {
      lines.forEach((line, i) => {
        if (p.re.test(line)) problems.push({ file: path.relative(ROOT, full) + ':' + (i + 1), name: p.name, fix: p.fix, sample: line.trim().slice(0, 80) });
      });
    }
  }
};

walk(ROOT);

// git 历史检查
let history = [];
try {
  execSync('git rev-parse --is-inside-work-tree', { cwd: ROOT, stdio: 'ignore' });
  const out = execSync('git log -p --all -G "sk-[A-Za-z0-9_-]{16,}" --oneline', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  history = out.split('\n').filter(Boolean);
} catch { /* 不是 git 仓库，跳过 */ }

console.log('扫描目录 ' + ROOT);
console.log('文件问题 ' + problems.length + ' 项 | git 历史可疑提交 ' + history.length + ' 个');
if (problems.length) {
  console.log('\n需要处理：');
  for (const p of problems) {
    console.log('  ✕ ' + p.file);
    console.log('     问题：' + p.name);
    if (p.sample) console.log('     片段：' + p.sample);
    console.log('     怎么改：' + p.fix);
  }
}
if (history.length) {
  console.log('\ngit 历史里出现过 sk- 字样：');
  for (const h of history.slice(0, 10)) console.log('  ! ' + h);
  console.log('  如果那是真 key：立刻轮换，并用 git filter-repo 清理历史（删文件没用）。');
}
if (!problems.length && !history.length) {
  console.log('\n✓ 没有发现明文密钥。提交前再跑一次就行。');
}
process.exit(problems.length ? 1 : 0);
