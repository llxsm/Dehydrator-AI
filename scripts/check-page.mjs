#!/usr/bin/env node
// 页面自检：把构建产物里的整段脚本放进一个假 DOM 里真的跑一遍。
// 只验证「构建成功」是不够的——页面脚本里一个错名字，用户点下去就是白屏。
// 用法: node scripts/check-page.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'docs/index.html');

if (!fs.existsSync(FILE)) {
  console.error('找不到 docs/index.html，先跑 node scripts/build-offline.mjs');
  process.exit(1);
}

const html = fs.readFileSync(FILE, 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const problems = [];
const check = (ok, msg) => { if (!ok) problems.push(msg); console.log((ok ? '  ✓ ' : '  ✕ ') + msg); };

// ---- 假 DOM：只做页面脚本用到的那几个 API ----
const els = new Map();
const mk = (id) => ({
  id, value: '', textContent: '', innerHTML: '', disabled: false, className: '', dataset: {},
  classList: { add() {}, remove() {}, contains() { return false; } },
  addEventListener() {}, onclick: null,
});
const doc = {
  getElementById(id) {
    if (!els.has(id)) els.set(id, mk(id));
    return els.get(id);
  },
  querySelectorAll() { return []; },
};
const nav = { clipboard: { writeText: () => Promise.resolve() } };
const win = {};
const raf = (fn) => fn();
const fetchStub = () => Promise.reject(new Error('no api'));

check(scripts.length === 1, '产物里有且只有一段内联脚本');

try {
  new Function('document', 'window', 'navigator', 'requestAnimationFrame', 'fetch', 'console', scripts[0])(
    doc, win, nav, raf, fetchStub, console,
  );
  check(true, '页面脚本执行无异常');
} catch (e) {
  check(false, '页面脚本执行失败：' + e.message);
  process.exit(1);
}

const DH = win.DH || {};
const need = ['scanText', 'preparePool', 'buildOfflineReport', 'titleOf', 'PARTY_NAMES'];
check(need.every((n) => DH[n]), 'window.DH 暴露了页面要用的函数（' + Object.keys(DH).length + ' 个）');

// ---- 点一次「开始脱水」，看渲染真的发生了 ----
doc.getElementById('input').value = '未请假或者请假逾期的，除因不可抗力等正当事由以外，视为放弃入学资格。'
  + '逾期者，学校不再受理成绩核查。因用户账号被泄露而造成的任何损失，本公司不承担任何责任。'
  + '用户应在收到通知后10日内提出申诉，逾期未提出视为放弃申诉权。';
doc.getElementById('stance').value = 'student';
doc.getElementById('reg').value = 'auto';

try {
  doc.getElementById('run').onclick();
} catch (e) {
  check(false, '点击「开始脱水」抛错：' + e.message);
  process.exit(1);
}

const cards = doc.getElementById('cards').innerHTML;
const count = (cards.match(/class="card/g) || []).length;
check(count > 0, '清单渲染出 ' + count + ' 张卡片');
check(cards.includes('如果只看一条'), '第一条标注了「如果只看一条」');
check((doc.getElementById('stats').innerHTML.match(/<div class="stat">/g) || []).length === 6, '统计区 6 个数字');
check(doc.getElementById('stanceNote').textContent.includes('学生'), '页脚写明了按谁的角度判断');
check(doc.getElementById('doc').innerHTML.includes('<mark'), '原文命中处有高亮');
check(!/undefined|\[object Object\]|NaN/.test(cards + doc.getElementById('stats').innerHTML), '渲染结果里没有 undefined / NaN');

try { doc.getElementById('copy').onclick(); check(true, '复制报告不报错'); } catch (e) { check(false, '复制报告抛错：' + e.message); }

if (problems.length) {
  console.log('\n✕ 页面自检有 ' + problems.length + ' 项没过');
  process.exit(1);
}
console.log('\n✓ 页面自检通过：构建产物里的脚本真的能跑。');
