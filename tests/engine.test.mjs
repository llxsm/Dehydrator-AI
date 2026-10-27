// 纯函数单元测试。零依赖，用 Node 内置 test runner：
//   node --test tests/engine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalize, splitSentences, matchRules, cluster, waterIndex,
  candidates, missingFields, detectRegister,
} from '../lib/engine.mjs';
import { consequenceOf, dedupeCandidates, bigrams, jaccard, titleOf, pickTop, sortPool } from '../lib/pipeline.mjs';
import { loadRules } from '../lib/match.mjs';

const RULES = loadRules();

// ───────────────────────── 输入归一化 ─────────────────────────
test('normalize：CRLF、全角空格、连续空行都压掉', () => {
  assert.equal(normalize('第一行\r\n\r\n\r\n\r\n第二行'), '第一行\n\n第二行');
  assert.equal(normalize('  前后有空格  '), '前后有空格');
});

test('normalize：汉字之间被 PDF 插进来的单空格要压掉，英文之间保留', () => {
  assert.equal(normalize('未请 假或者请假逾期'), '未请假或者请假逾期');
  assert.equal(normalize('取消其 该门课程的考核资格'), '取消其该门课程的考核资格');
  assert.equal(normalize('see the doc'), 'see the doc', '英文单词之间的空格不能动');
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

// ───────────────────────── 排序层（浏览器与命令行共用同一份） ─────────────────────────
test('titleOf：标题要从原文里摘出后果，不能只回一个词条名', () => {
  const t = titleOf({ text: '未请假或者请假逾期的，除因不可抗力等正当事由以外，视为放弃入学资格。', label: '视为放弃' });
  assert.ok(t.includes('放弃入学资格'), '标题要说出后果：' + t);
  assert.ok(t.length <= 30, '标题不能超过 30 字：' + t);
});

test('titleOf：紧挨后果的主语不是条件，不能拼进标题', () => {
  const t = titleOf({ text: '逾期者，学校不再受理成绩核查。', label: '逾期视为放弃' });
  assert.equal(t, '不再受理成绩核查');
});

test('pickTop：同一种后果最多占 maxPerKind 格，Top 10 不能全是「取消资格」', () => {
  const mk = (i, kind) => ({ id: 'c' + i, text: 'x' + i, weight: 3, consequence: { kind, requiresAction: false } });
  const list = [
    ...Array.from({ length: 8 }, (_, i) => mk(i, 'lose_qualification')),
    mk(8, 'requirement'), mk(9, 'lose_money'), mk(10, 'lose_data'),
  ];
  const picked = pickTop(list, { topN: 5, maxPerKind: 2 });
  assert.equal(picked.length, 5);
  assert.equal(picked.filter((c) => c.consequence.kind === 'lose_qualification').length, 2);
  assert.ok(new Set(picked.map((c) => c.consequence.kind)).size >= 3, '清单要跨后果种类');
});

test('dedupeCandidates：后果短语太短就不合并（「不予受理」背后是不同的事）', () => {
  const mk = (text) => ({ text, weight: 2, consequence: { kind: 'lose_qualification' } });
  const out = dedupeCandidates([
    mk('成绩变更期限是开课学期至下一学期的第一周内，逾期不予受理。'),
    mk('材料提交不全的，经审核后不予受理。'),
  ]);
  assert.equal(out.length, 2, '两种不同的「不予受理」不能压成一条');
});

test('consequenceOf：数据线、未经授权的软件，都不算「交出个人信息」', () => {
  assert.equal(consequenceOf('破坏教室教学设备、寝室电话线、数据线视情节扣2—20分。', 'student').kind !== 'lose_data', true);
  assert.equal(consequenceOf('不在网上使用可能引发病毒传染的各种来历不明的软件。', 'student').kind !== 'lose_data', true);
});
