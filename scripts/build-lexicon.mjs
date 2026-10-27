#!/usr/bin/env node
// 把 lexicon/entries/*.json + lexicon/meta.json 合并成 lexicon/zh-cn.v1.json。
//
//   node scripts/build-lexicon.mjs          构建（源有变化才写盘）
//   node scripts/build-lexicon.mjs --check  只检查产物是否最新，不写盘（CI / pre-commit 用）
//   node scripts/build-lexicon.mjs --lint   只跑校验，不构建
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLexicon, staleReason, validateSources, SOURCE_DIR } from '../lib/lexicon.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

const { errors, warnings, stats } = validateSources(ROOT);
for (const w of warnings) console.log('  · ' + w);
if (errors.length) {
  for (const e of errors) console.log('  ✕ ' + e);
  console.log('\n✕ 校验没过，先改 ' + SOURCE_DIR + '/ 或 meta.json。');
  process.exit(1);
}

if (argv.includes('--lint')) {
  console.log('✓ ' + stats.files + ' 个文件 / ' + stats.entries + ' 条词条 / ' + stats.categories + ' 类，结构正确');
  process.exit(0);
}

if (argv.includes('--check')) {
  const why = staleReason(ROOT);
  if (why) {
    console.log('✕ ' + why);
    console.log('  → 跑一次 node scripts/build-lexicon.mjs');
    process.exit(1);
  }
  console.log('✓ 产物与源一致（' + stats.entries + ' 条）');
  process.exit(0);
}

const r = buildLexicon(ROOT);
console.log('✓ ' + stats.files + ' 个文件 / ' + stats.entries + ' 条词条 → lexicon/zh-cn.v1.json'
  + '（' + Math.round(r.bytes / 1024) + ' KB' + (r.changed ? '，已更新' : '，无需改动') + '）');
