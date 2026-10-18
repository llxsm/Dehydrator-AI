#!/usr/bin/env node
// 把引擎 + 词典 + 规则 + 界面，打包成一个完全自包含的 HTML。
// 产物不联网、不依赖任何服务，双击即可打开。
// 用法: node scripts/build-offline.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = (p) => path.join(ROOT, p);

const lex = JSON.parse(fs.readFileSync(R('lexicon/zh-cn.v1.json'), 'utf8'));
const rules = JSON.parse(fs.readFileSync(R('lexicon/rules.zh-cn.v1.json'), 'utf8'));
const engineSrc = fs.readFileSync(R('lib/engine.mjs'), 'utf8');
const tpl = fs.readFileSync(R('ui/offline.template.html'), 'utf8');

// 去掉 ES module 的 export 关键字，包成 IIFE 挂到 window.DH
const stripped = engineSrc.replace(/^export\s+/gm, '');
const names = ['normalize', 'splitSentences', 'matchLexicon', 'matchRules', 'cluster', 'waterIndex',
  'candidates', 'detectRegister', 'missingFields', 'scanText', 'segments', 'CHECKLISTS',
  'bearingOfSentence', 'relationTo', 'PARTY_NAMES'];
const engineBundle = '(function(){\n' + stripped + '\nwindow.DH={' + names.join(',') + '};\n})();';

const presets = [
  {
    name: '学生手册·会挂科的那几条',
    text: '新生保留入学资格期满前应向学校申请入学，经学校审查合格后，办理入学手续。审查不合格的，取消入学资格；逾期不办理入学手续且无因不可抗力延迟等正当理由的，视为放弃入学资格。在全程考勤情况下，学生无故缺课累计达到或超过该门课程学期总学时数的1/3时，取消其该课程的考核资格。在随机抽查考勤的情况下，抽查三次无故缺课者，取消其该门课程的考核资格。学生对学校作出的涉及处理或处分决定存有异议的，须自决定送达之日起10日内提出申诉。学生在申诉期内未提出申诉的，视为放弃申诉，学校或者省级教育行政部门不再受理。',
  },
  {
    name: '用户协议·视为同意',
    text: '您接受并同意本协议的行为即视为您同意并接受哔哩哔哩服务条款，您接受并同意任一哔哩哔哩服务条款的行为亦视为您接受并同意本协议。请您确保您在使用哔哩哔哩服务前已仔细阅读、充分理解并毫无保留地接受本协议所有条款。哔哩哔哩有权随时变更本协议内容，变更后的协议将在网站公布，恕不另行通知。您继续使用本服务，即视为接受更新后的协议。因用户账号被泄露或被盗而造成的任何损失，哔哩哔哩不承担任何责任。除非另有声明，哔哩哔哩无法对第三方网站之服务进行控制。',
  },
  {
    name: '甲方·先做一版看看',
    text: '先做一版看看效果，预算我们后面再谈，这个项目跑通了后面量很大，我们还有很多类似需求。整体挺好的，就是感觉不太对，你再优化一下，明天想看新版本。顺便再加个小功能，对你来说就一句话的事。报个有竞争力的价格，我们是长期合作。',
  },
];

// 有真实语料就覆盖第 2 个预设：够长才能演示「缺口检测」
try {
  const real = fs.readFileSync(R('corpus/raw/bilibili用户协议.txt'), 'utf8').replace(/\s+/g, ' ').trim();
  if (real.length > 900) presets[1] = { name: '用户协议（真实节选 1400 字）', text: real.slice(0, 1400) };
} catch { /* 没语料就用手写那段 */ }

const out = tpl
  .replace('__LEXICON__', () => JSON.stringify(lex))
  .replace('__RULES__', () => JSON.stringify(rules))
  .replace('__PRESETS__', () => JSON.stringify(presets))
  .replace('__ENGINE__', () => engineBundle)
  .replace('__LEXVER__', String(lex.entries.length))
  .replace('__RULEVER__', String(rules.rules.length));

const distDir = R('dist');
fs.mkdirSync(distDir, { recursive: true });
const outFile = path.join(distDir, 'dehydrator-offline.html');
fs.writeFileSync(outFile, out, 'utf8');

// 顺便产出一份 docs/index.html：GitHub Pages 选 /docs 目录就能直接上线，不用手动复制
const docsDir = R('docs');
fs.mkdirSync(docsDir, { recursive: true });
fs.writeFileSync(path.join(docsDir, 'index.html'), out, 'utf8');

const kb = (fs.statSync(outFile).size / 1024).toFixed(1);
console.log('已生成 ' + path.relative(ROOT, outFile) + '  (' + kb + ' KB)');
console.log('已生成 docs/index.html  ← GitHub Pages 用这个（Settings → Pages → /docs）');
console.log('  词条 ' + lex.entries.length + ' 条 / 规则 ' + rules.rules.length + ' 条 / 预设 ' + presets.length + ' 个');
console.log('  双击即可打开，不需要服务器、不需要网络、不需要 key。');
