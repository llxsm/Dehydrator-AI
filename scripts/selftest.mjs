#!/usr/bin/env node
// 一条命令证明这个仓库是活的：不需要装依赖、不需要 key。
// 用法: node scripts/selftest.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dehydrate } from '../lib/pipeline.mjs';
import { hasLLM, describeConfig } from '../lib/llm.mjs';
import { loadDotEnv } from '../lib/env.mjs';

// 先把 .env.local 读进 process.env，否则第 7 步永远显示「未配置」
const envLoaded = loadDotEnv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = (p) => path.join(ROOT, p);
const node = process.execPath;

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m, hint) => { failed++; console.log('  ✕ ' + m); if (hint) console.log('     → ' + hint); };
const step = (n, t) => console.log('\n[' + n + '] ' + t);

console.log('Dehydrator AI · 自检');
console.log('Node ' + process.version + '  目录 ' + ROOT);

step('1/8', '环境');
ok('Node 版本 ' + process.version + (Number(process.versions.node.split('.')[0]) >= 18 ? '（≥18，支持 fetch）' : '（偏低，L2 需要 18+）'));

step('2/8', '词典与规则');
try {
  const lex = JSON.parse(fs.readFileSync(R('lexicon/zh-cn.v1.json'), 'utf8'));
  const rules = JSON.parse(fs.readFileSync(R('lexicon/rules.zh-cn.v1.json'), 'utf8'));
  ok('词条 ' + lex.entries.length + ' 条，规则 ' + rules.rules.length + ' 条');
} catch (e) { bad('词典解析失败：' + e.message); }

step('3/8', '单元测试（Node 内置 runner，零依赖）');
try {
  execFileSync(node, ['--test', R('tests/engine.test.mjs')], { cwd: ROOT, stdio: 'pipe' });
  ok('13 项断言全部通过');
} catch (e) {
  bad('单元测试失败', '单独跑一次看细节：node --test tests/engine.test.mjs');
}

step('4/8', '构建离线版');
try {
  execFileSync(node, [R('scripts/build-offline.mjs')], { cwd: ROOT, stdio: 'pipe' });
  const size = fs.statSync(R('docs/index.html')).size;
  ok('docs/index.html 生成成功（' + (size / 1024).toFixed(1) + ' KB）');
} catch (e) { bad('构建失败', e.message); }

step('5/8', 'Gold 集评测');
try {
  execFileSync(node, [R('scripts/eval.mjs')], { cwd: ROOT, stdio: 'pipe' });
  ok('corpus/gold.tsv 跑通');
} catch { bad('评测脚本失败'); }

step('6/8', '端到端（离线模式，无需 key）');
try {
  const sample = '您接受并同意本协议的行为即视为您同意并接受本服务条款。本服务有权随时变更本协议内容，恕不另行通知。因用户账号被泄露而造成的任何损失，本公司不承担任何责任。用户应在收到通知后10日内提出申诉，逾期未提出视为放弃申诉权。';
  const r = await dehydrate(sample, { stance: 'user', topN: 5, useLLM: false });
  if (!r.picks.length) bad('没有产出任何清单项');
  else {
    ok('产出 ' + r.picks.length + ' 条清单，模式 ' + r.mode);
    console.log('     第一条：' + (r.picks[0].title || '').slice(0, 40));
  }
} catch (e) { bad('端到端失败：' + e.message, '看 lib/pipeline.mjs'); }

step('7/8', '模型传输自检（本地 mock，不需要 key）');
{
  const http = await import('node:http');
  const payload = '{"picks":[{"id":"mock","title":"t","plain":"p"}]}';
  const mock = http.createServer((req, res) => {
    let buf = '';
    req.on('data', (c) => { buf += c; });
    req.on('end', () => {
      if (req.url.endsWith('/v1/messages')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content: [{ type: 'text', text: payload }] }));
      } else if (req.url.endsWith('/chat/completions')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: payload } }] }));
      } else {
        res.writeHead(404); res.end('no');
      }
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + mock.address().port;
  try {
    const { chatJSON } = await import('../lib/llm.mjs');
    const a = await chatJSON({ system: 's', user: 'u', env: { LLM_BASE_URL: base, LLM_API_KEY: 'k', LLM_MODEL: 'm', LLM_FORMAT: 'openai' } });
    const b = await chatJSON({ system: 's', user: 'u', env: { LLM_BASE_URL: base + '/anthropic', LLM_API_KEY: 'k', LLM_MODEL: 'm' } });
    if (a?.picks && b?.picks) ok('两种传输格式都通了：openai /chat/completions、anthropic /v1/messages');
    else bad('传输解析结果异常');
  } catch (e) {
    bad('传输自检失败：' + e.message);
  } finally {
    mock.close();
  }
}

step('8/8', '模型配置');
console.log('  – ' + (envLoaded ? '.env.local 已读取' : '没有 .env.local 文件，只读环境变量'));
console.log('  – ' + describeConfig());
if (hasLLM()) {
  ok('检测到 key，L2 排序可用');
} else {
  console.log('  – 没有 key：L2 会走离线降级，报告依然完整（这是设计，不是故障）');
  console.log('  – 想启用：复制 .env.example 为 .env.local，填入你自己的 key');
}

console.log('\n' + (failed ? '✕ ' + failed + ' 项未通过' : '✓ 全部通过。这个仓库可以跑。'));
process.exit(failed ? 1 : 0);
