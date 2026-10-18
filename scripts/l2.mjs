#!/usr/bin/env node
// 跑一次真实的 L2（会调用模型）。需要一个可用的 API key。
//
// 用法:
//   node scripts/l2.mjs corpus/raw/城镇房屋租赁合同.txt
//   node scripts/l2.mjs corpus/raw/学生手册2025.txt --stance=student --top=10
//   node scripts/l2.mjs 某文件.txt --chars=8000     ← 只取前 8000 字，省钱
//
// 参数:
//   --stance=student|user|a|b   立场（默认 auto：招聘/协议类猜 user，制度类猜 student）
//   --top=N                     输出几条（默认 10）
//   --chars=N                   只取前 N 字
//   --offline                   强制不调模型，只看 L1 结果
import fs from 'node:fs';
import path from 'node:path';
import { loadDotEnv, resolveInput } from '../lib/env.mjs';
import { dehydrate } from '../lib/pipeline.mjs';
import { PARTY_NAMES } from '../lib/engine.mjs';

const CONS = {
  lose_qualification: '失去资格/身份',
  lose_right: '失去权利/救济',
  lose_money: '失去钱',
  lose_data: '交出数据',
  requirement: '要你动手',
  procedural: '程序性',
  other: '其他',
};
import { hasLLM, describeConfig } from '../lib/llm.mjs';

loadDotEnv();

const args = process.argv.slice(2);
const file = resolveInput(args.find((a) => !a.startsWith('--')));
const opt = Object.fromEntries(
  args.filter((a) => a.startsWith('--')).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  }),
);

if (!file) {
  console.error('用法: node scripts/l2.mjs <文件路径> [--stance=student] [--top=10] [--chars=8000]');
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error('找不到文件: ' + file);
  process.exit(1);
}

let text = fs.readFileSync(file, 'utf8');
const totalLen = text.length;
if (opt.chars && Number(opt.chars) < text.length) text = text.slice(0, Number(opt.chars));

const isContract = /(合同|协议)/.test(path.basename(file)) && !/(章程|手册|细则|规定)/.test(file);
const explicitStance = !!opt.stance;
const stance = opt.stance || (/(手册|章程|细则|规定)/.test(file) ? 'student' : (isContract ? 'b' : 'user'));
const topN = Number(opt.top || 10);
const useLLM = !opt.offline;

console.log('─'.repeat(64));
console.log('文件    ' + path.basename(file) + '（全文 ' + totalLen.toLocaleString() + ' 字'
  + (text.length < totalLen ? '，本次只取前 ' + text.length.toLocaleString() + ' 字' : '') + '）');
console.log('立场    ' + stance + '    条目 ' + topN + '    模型 ' + describeConfig());
console.log('─'.repeat(64));

if (isContract && !explicitStance) {
  console.log('');
  console.log('⚠ 这是一份合同。合同必须有立场才有意义——同一句「风险由乙方承担」，');
  console.log('  你是乙方就是坑，你是甲方就是保护。');
  console.log('  现在默认按「乙方」算（较弱势的一方）。要改就加 --stance=a');
  console.log('');
}

if (!useLLM) console.log('（--offline：不调用模型）');
else if (!hasLLM()) {
  console.log('');
  console.log('⚠ 没有检测到 key，会自动走离线降级。');
  console.log('  在项目根目录建 .env.local，写入其中一种：');
  console.log('    LLM_BASE_URL=https://api.deepseek.com');
  console.log('    LLM_API_KEY=<粘贴你的 key>');
  console.log('    LLM_MODEL=deepseek-chat');
  console.log('  或者只写一行：DEEPSEEK_API_KEY=sk-你的key');
  console.log('');
}

const t0 = Date.now();
const r = await dehydrate(text, {
  stance,
  documentName: path.basename(file),
  topN,
  useLLM,
});
const ms = Date.now() - t0;

console.log('');
console.log('模式    ' + r.mode + (r.model ? '（' + r.model + '）' : ''));
console.log('耗时    ' + ms + ' ms');
console.log('漏斗    ' + r.stats.chars.toLocaleString() + ' 字 → 候选 ' + r.stats.candidatesRaw + ' 条'
  + (r.stats.duplicates ? '（去重 ' + r.stats.duplicates + ' 条）' : '')
  + ' → ' + r.stats.candidates + ' 组 → 有后果 ' + r.stats.consequential + ' 条 → 输出 ' + r.picks.length + ' 条');
if (r.error) console.log('错误    ' + r.error);
console.log('');
console.log(r.summary);
console.log('');

if (!r.picks.length) {
  console.log('（没有产出条目）');
} else {
  for (const p of r.picks) {
    const badge = p.rank === 1 ? '【如果只看一条】' : '';
    const flags = [];
    if (p.requiresAction) flags.push('⚑要求你行动');
    if (p.surprise === 'high') flags.push('意外度:高');
    if (p.bearing) {
      flags.push(p.bearingKind === 'power'
        ? PARTY_NAMES[p.bearingHolder] + ' 有权'
        : '后果由 ' + PARTY_NAMES[p.bearing] + ' 承担');
    }
    if (p.favorsReader) flags.push('↑ 这条对你是保护');
    console.log(badge + p.rank + '. ' + p.title + (flags.length ? '   [' + flags.join(' · ') + ']' : ''));
    if (p.plain) console.log('   ' + p.plain);
    console.log('   「' + p.text.replace(/\s+/g, ' ').slice(0, 70) + (p.text.length > 70 ? '…' : '') + '」');
    console.log('   ' + (CONS[p.consequence] || p.consequence)
      + (p.occurrences > 1 ? '　·　这条规则在文中出现 ' + p.occurrences + ' 次' : ''));
    console.log('');
  }
}

if (r.rest && r.rest.length) {
  console.log('另有 ' + r.rest.length + ' 条命中，未进入清单。');
}
if (r.gaps && !r.gaps.skipped) {
  console.log('他没写：' + (r.gaps.missing.length ? r.gaps.missing.join('、') : '（必备项齐全）'));
} else if (r.gaps) {
  console.log('缺口检查：跳过（' + r.gaps.reason + '）');
}
console.log('');
console.log('─'.repeat(64));
console.log(r.mode === 'live' ? '✓ 这是真实 L2 结果，可以复制给协作者调提示词。' : '⚠ 这不是模型结果（' + r.mode + '）。检查上面的配置提示。');
