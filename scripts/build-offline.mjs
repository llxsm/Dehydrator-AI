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

// 示例卡上的数字与两条要点：构建时从语料真跑一遍，避免写着「真实运行」却对不上
const RANK = { lose_qualification: 5, requirement: 4, lose_money: 3, lose_data: 3, procedural: 1, other: 2 };
// 卡片主条（示例）对应的原文，用来避免下面两条和它撞车
const HERO_PROBE = '从处理、处分决定或者复查决定送达之日起，学生在10日内未提出申诉的视为放弃申诉，学校不再受理其提出的申诉';

// 去掉「第X条」「1.」「（一）」这类编号前缀，压成一行，过长截断
function tidy(s, max = 42) {
  let x = String(s).replace(/\s+/g, '');
  x = x.replace(/^第[一二三四五六七八九十百零〇\d]+条/, '');
  x = x.replace(/^[（(][一二三四五六七八九十\d]+[)）]/, '');
  x = x.replace(/^\d+[.．、]/, '');
  x = x.replace(/^[、，。；：]/, '');
  return x.length > max ? x.slice(0, max) + '…' : x;
}

// 后果键：不同触发条件但后果相同（都是「放弃入学资格」），只算一件事
function consequenceKey(s) {
  const x = String(s).replace(/\s+/g, '');
  const m = x.match(/(取消[^，。；：、]{0,8}|视为放弃[^，。；：、]{0,8}|视为[^，。；：、]{0,8}|不予[^，。；：、]{0,8}|不再受理[^，。；：、]{0,8}|作废|开除学籍|退学)/);
  return m ? m[1] : null;
}

let HC = { chars: '198,931', cand: '123', cons: '33', m1: '重修报名逾期视为自动放弃', m2: '缺考或作弊取消下学期补考资格' };
try {
  const { scan } = await import('../lib/match.mjs');
  const { consequenceOf, dedupeCandidates, bigrams, jaccard } = await import('../lib/pipeline.mjs');
  const rawTxt = fs.readFileSync(R('corpus/raw/学生手册2025.txt'), 'utf8');
  const r = scan(rawTxt);
  const withC = r.candidates.map((c) => ({ ...c, consequence: consequenceOf(c.text, 'student') }));
  const deduped = dedupeCandidates(withC);
  const cons = deduped.filter((c) => c.consequence.kind !== 'other' && c.consequence.kind !== 'procedural').length;

  // 排序：优先「要求你行动」的（读起来最像一句提醒），再按后果轻重
  const heroGrams = bigrams(HERO_PROBE);
  const ranked = deduped
    .filter((c) => c.consequence.kind !== 'other' && c.consequence.kind !== 'procedural')
    .filter((c) => jaccard(bigrams(c.text), heroGrams) < 0.45)   // 不和示例撞车
    .sort((a, b) => (Number(b.consequence.requiresAction) - Number(a.consequence.requiresAction))
      || (RANK[b.consequence.kind] - RANK[a.consequence.kind])
      || (b.weight - a.weight));

  const picked = [];
  const usedKeys = new Set();   // 后果键：后果相同的只留一条
  for (const c of ranked) {
    if (picked.length >= 2) break;
    const key = consequenceKey(c.text);
    if (key && usedKeys.has(key)) continue;
    if (picked.some((p) => jaccard(bigrams(c.text), bigrams(p.text)) >= 0.45)) continue;
    if (key) usedKeys.add(key);
    picked.push(c);
  }

  HC = {
    chars: rawTxt.length.toLocaleString('en-US'),
    cand: String(r.candidates.length),
    cons: String(cons),
    m1: picked[0] ? tidy(picked[0].text) : HC.m1,
    m2: picked[1] ? tidy(picked[1].text) : HC.m2,
  };
  console.log('  示例卡（实测）：' + HC.chars + ' 字 / 候选 ' + HC.cand + ' / 有后果 ' + HC.cons);
  console.log('  要点 1：' + HC.m1);
  console.log('  要点 2：' + HC.m2);
} catch (e) {
  console.log('  ! 语料不可用，示例卡沿用固定内容：' + e.message.slice(0, 60));
}

const out = tpl
  .replace('__LEXICON__', () => JSON.stringify(lex))
  .replace('__RULES__', () => JSON.stringify(rules))
  .replace('__PRESETS__', () => JSON.stringify(presets))
  .replace('__ENGINE__', () => engineBundle)
  .replace('__HC_CHARS__', HC.chars)
  .replace('__HC_CAND__', HC.cand)
  .replace('__HC_CONS__', HC.cons)
  .replace('__HC_M1__', () => HC.m1)
  .replace('__HC_M2__', () => HC.m2)
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
