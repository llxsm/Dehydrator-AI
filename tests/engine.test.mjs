// 纯函数单元测试。零依赖，用 Node 内置 test runner：
//   node --test tests/engine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalize, splitSentences, matchRules, cluster, waterIndex,
  candidates, missingFields, detectRegister,
} from '../lib/engine.mjs';
import { consequenceOf, dedupeCandidates, bigrams, jaccard } from '../lib/pipeline.mjs';
import { loadRules } from '../lib/match.mjs';

const RULES = loadRules();

// ───────────────────────── 输入归一化 ─────────────────────────
test('normalize：CRLF、全角空格、连续空行都压掉', () => {
  assert.equal(normalize('第一行\r\n\r\n\r\n\r\n第二行\u3000\u3000结束'), '第一行\n\n第二行 结束');
  assert.equal(normalize('  前后有空格  '), '前后有空格');
});

test('splitSentences：中文断句符和换行都要断开', () => {
  const s = splitSentences('甲。乙！丙？丁；戊\n己');
  assert.equal(s.length, 6);
  assert.equal('甲。乙！丙？丁；戊\n己'.slice(s[0].start, s[0].end), '甲。');
});

// ───────────────────────── 相似度 ─────────────────────────
test('jaccard：相同文本为 1，无关文本接近 0', () => {
  const a = bigrams('实现中华民族伟大复兴');
  assert.equal(jaccard(a, a), 1);
  assert.ok(jaccard(bigrams('今天天气很好'), a) < 0.1);
  assert.equal(jaccard(new Set(), new Set()), 0); // 空集合不能除零
});

test('dedupeCandidates：措辞几乎相同的两条合并成一条', () => {
  const mk = (text, kind) => ({ text, weight: 3, consequence: { kind, requiresAction: false } });
  const out = dedupeCandidates([
    mk('自处理、处分或者复查决定书送达之日起，学生在申诉期内未提出申诉的视为放弃申诉。', 'lose_right'),
    mk('自处理、处分或者复查决定书送达之日起，学生在申诉期内未提出申诉的视为放弃申诉，学校不再受理。', 'lose_right'),
    mk('学生无故缺课累计达到该门课程学期总学时数三分之一的，取消其该课程的考核资格。', 'lose_qualification'),
  ]);
  assert.equal(out.length, 2, '前两条应合并，第三条不同不应合并');
  assert.equal(out.find((c) => c.text.includes('缺课')).text.includes('缺课'), true);
});

// ───────────────────────── 代价判定 ─────────────────────────
test('consequenceOf：要求你行动 / 失去资格 / 花钱，要分得开', () => {
  assert.equal(consequenceOf('学生应在 10 日内提交申诉材料', 'student').kind, 'requirement');
  assert.equal(consequenceOf('无故不缴纳或拖欠学费者，取消其评优和奖学金资格', 'student').kind, 'lose_qualification');
  assert.equal(consequenceOf('因不可抗力导致的延误，双方互不承担责任', 'user').kind, 'lose_money');
});

test('consequenceOf：要求行动必须是「读者」做，学校做的不算', () => {
  assert.equal(consequenceOf('学校应当在 10 日内提交处理结果', 'student').kind, 'other');
});

// ───────────────────────── 规则匹配 ─────────────────────────
test('matchRules：动作词后面跟「时」是时间状语，不算命中', () => {
  const time = matchRules(RULES, '甲方有权在租赁期间届满或者本合同终止时，要求乙方及时返还该房屋。');
  assert.equal(time.filter((h) => h.id === 'R3').length, 0);

  const real = matchRules(RULES, '甲方有权随时变更本协议内容。');
  assert.ok(real.some((h) => h.id === 'R3'), '「有权随时变更」应命中 R3');
});

test('matchRules：同句出现「表格/格式」时，排版说明不该被判成单方裁量', () => {
  const hits = matchRules(RULES, '经营者使用合同示范文本应完整体现表格内容，格式可自行调整。');
  assert.equal(hits.filter((h) => h.id === 'R3').length, 0);
});

test('matchRules：返回的 matched 必须是原文里真实存在的片段', () => {
  const text = '乙方逾期未整改或整改后验收仍不合格的，甲方有权拒付相应款项直至解除合同。';
  for (const h of matchRules(RULES, text)) {
    assert.ok(text.includes(h.matched), 'matched 必须能逐字在原文找到：' + h.matched);
  }
});

// ───────────────────────── 统计与边界 ─────────────────────────
test('cluster：重叠的命中合并成一簇', () => {
  const spans = [
    { start: 0, end: 6, id: 'a', category: 'unilateral', label: 'A', weight: 2 },
    { start: 3, end: 9, id: 'b', category: 'unilateral', label: 'B', weight: 3 },
    { start: 20, end: 24, id: 'c', category: 'unilateral', label: 'C', weight: 1 },
  ];
  const c = cluster(spans);
  assert.equal(c.length, 2);
  assert.equal(c[0].end, 9);
  assert.equal(c[0].primary.weight, 3, '主条目应取权重最高的那条');
});

test('waterIndex / candidates：空输入不能崩', () => {
  assert.equal(waterIndex('', []).pct, 0);
  assert.equal(waterIndex('abc', []).pct, 0);
  assert.equal(candidates('', []).total, 0);
  assert.equal(candidates('', []).list.length, 0);
});

test('missingFields：文本太短或语域不明时跳过，不能硬套清单', () => {
  assert.equal(missingFields('很短的片段', 'contract').skipped, true);
  assert.equal(missingFields('x'.repeat(800), 'unknown').skipped, true);
});

test('detectRegister：语域识别不出来时要敢于返回 unknown', () => {
  assert.equal(detectRegister('先做一版看看效果，预算我们后面再谈。').register, 'unknown');
  assert.equal(detectRegister('本协议自签署之日起生效，双方就费用与支付方式约定如下，争议由甲方所在地法院管辖。').register, 'contract');
});
