// 纯函数引擎：没有任何 import、不碰文件系统、不碰网络。
// 浏览器、Node、Cloudflare Workers 都能直接跑。
// 责任边界：只做「候选召回」和「确定性统计」，不做立场判断。

const SENT_END = '。！？；\n';

export function normalize(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/\u3000/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function splitSentences(text) {
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (SENT_END.includes(text[i])) {
      if (i + 1 > start) out.push({ start, end: i + 1 });
      start = i + 1;
    }
  }
  if (start < text.length) out.push({ start, end: text.length });
  return out;
}

export function matchLexicon(lex, text) {
  const spans = [];
  for (const e of lex.entries) {
    for (const t of e.terms || []) {
      let i = 0;
      while ((i = text.indexOf(t, i)) !== -1) {
        spans.push({ start: i, end: i + t.length, id: e.id, category: e.category, label: e.label, weight: e.weight, matched: t, layer: 'dict' });
        i += 1;
      }
    }
    if (e.regex) {
      const re = new RegExp(e.regex, 'g');
      let m;
      while ((m = re.exec(text)) !== null) {
        spans.push({ start: m.index, end: m.index + m[0].length, id: e.id, category: e.category, label: e.label, weight: e.weight, matched: m[0], layer: 'dict' });
        if (m[0].length === 0) break;
      }
    }
  }
  return spans;
}

export function matchRules(rules, text) {
  const spans = [];
  for (const sen of splitSentences(text)) {
    const seg = text.slice(sen.start, sen.end);
    for (const r of rules.rules) {
      // 同句里出现排除词，整条规则本句失效（例如「格式可自行调整」是排版说明）
      if (r.excludeWords && r.excludeWords.some((w) => seg.includes(w))) continue;
      let best = null;
      for (const a of r.groups[0]) {
        let ia = seg.indexOf(a);
        while (ia >= 0) {
          for (const b of r.groups[1]) {
            let ib = seg.indexOf(b);
            while (ib >= 0) {
              const gap = ib > ia ? ib - ia : ia - ib;
              // 动作词后面紧跟「时/后/前/之日起」，说明是时间状语不是动作
              const after = seg[ib + b.length];
              const timeAdverbial = r.excludeAfter && r.excludeAfter.includes(after);
              if (gap <= r.gap && !timeAdverbial) {
                const s = Math.min(ia, ib);
                const e = Math.max(ia + a.length, ib + b.length);
                if (!best || e - s < best.e - best.s) best = { s, e };
              }
              ib = seg.indexOf(b, ib + 1);
            }
          }
          ia = seg.indexOf(a, ia + 1);
        }
      }
      if (best) {
        spans.push({
          start: sen.start + best.s, end: sen.start + best.e,
          id: r.id, category: r.category, label: r.label, weight: r.weight,
          matched: text.slice(sen.start + best.s, sen.start + best.e),
          needsStance: r.needsStance === true, layer: 'rule',
        });
      }
    }
  }
  return spans;
}

export function cluster(spans) {
  if (!spans.length) return [];
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.weight - a.weight);
  const out = [];
  let cur = { start: sorted[0].start, end: sorted[0].end, hits: [sorted[0]] };
  for (const s of sorted.slice(1)) {
    if (s.start < cur.end) {
      cur.end = Math.max(cur.end, s.end);
      cur.hits.push(s);
    } else {
      out.push(cur);
      cur = { start: s.start, end: s.end, hits: [s] };
    }
  }
  out.push(cur);
  return out.map((c) => {
    const primary = c.hits.reduce((a, b) => (b.weight > a.weight ? b : a), c.hits[0]);
    return { start: c.start, end: c.end, hits: c.hits, primary, needsStance: c.hits.some((h) => h.needsStance) };
  });
}

export function waterIndex(text, clusters) {
  const cov = new Uint8Array(text.length);
  for (const c of clusters) for (let k = c.start; k < c.end; k++) cov[k] = 1;
  let n = 0;
  for (const c of cov) n += c;
  return { covered: n, total: text.length, pct: Math.round((n / text.length) * 100) };
}

export function candidates(text, spans) {
  const sents = splitSentences(text);
  const list = [];
  for (const sen of sents) {
    const hits = spans.filter((s) => s.start >= sen.start && s.end <= sen.end);
    if (!hits.length) continue;
    list.push({ start: sen.start, end: sen.end, text: text.slice(sen.start, sen.end).trim(), hits });
  }
  return { total: sents.length, list };
}

// 语域识别：靠必备字段的命中密度投票，粗但可解释
export const CHECKLISTS = {
  recruit: {
    name: '招聘 / 招募',
    items: [
      { key: '薪资区间', terms: ['薪', '工资', '元/天', '元/月', 'K/', '待遇', '报酬'] },
      { key: '工作时间', terms: ['工作时间', '每周', '出勤', '天/周', '小时'] },
      { key: '试用期 / 实习期', terms: ['试用期', '实习期', '试用'] },
      { key: '转正 / 留用条件', terms: ['转正', '留用', '录用', '择优'] },
      { key: '社保 / 福利', terms: ['社保', '五险一金', '公积金', '保险', '补贴'] },
      { key: '合同期限', terms: ['合同', '期限', '签订'] },
    ],
  },
  contract: {
    name: '协议 / 条款',
    items: [
      { key: '费用与支付', terms: ['费用', '收费', '价格', '支付', '付款'] },
      { key: '生效与期限', terms: ['生效', '有效期', '期限'] },
      { key: '终止 / 解除方式', terms: ['终止', '解除', '退出', '注销'] },
      { key: '争议解决 / 管辖', terms: ['管辖', '争议', '仲裁', '诉讼'] },
      { key: '通知与送达', terms: ['通知', '送达'] },
      { key: '责任与赔偿', terms: ['责任', '赔偿', '损失'] },
      { key: '个人信息处理', terms: ['个人信息', '隐私', '数据'] },
    ],
  },
  policy: {
    name: '制度 / 规章',
    items: [
      { key: '生效日期', terms: ['生效', '施行', '自'] },
      { key: '适用范围', terms: ['适用', '范围', '对象'] },
      { key: '申诉 / 救济渠道', terms: ['申诉', '复议', '投诉', '救济'] },
      { key: '责任主体', terms: ['负责', '主体', '部门', '委员会'] },
      { key: '期限与时限', terms: ['日内', '期限', '截止'] },
    ],
  },
};

export function detectRegister(text, checklists = CHECKLISTS) {
  const scores = {};
  for (const [id, def] of Object.entries(checklists)) {
    let hit = 0;
    for (const it of def.items) for (const t of it.terms) if (text.includes(t)) { hit += 1; break; }
    scores[id] = hit;
  }
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  // 命中字段太少就承认不知道，不要硬套一个语域去检查缺口
  if (!best || best[1] < 3) return { register: 'unknown', scores };
  return { register: best[0], scores };
}

// 缺口检测只对完整文档有意义：片段和陌生语域一律跳过，并说明原因
export function missingFields(text, register, checklists = CHECKLISTS) {
  if (!register || register === 'unknown') {
    return { register: 'unknown', name: '未识别', present: [], missing: [], skipped: true, reason: '这份文本的语域我没认出来，跳过缺口检查' };
  }
  if (text.length < 600) {
    return { register, name: (checklists[register] || CHECKLISTS.contract).name, present: [], missing: [], skipped: true, reason: '片段太短，不能拿它判断「没写什么」' };
  }
  const def = checklists[register] || CHECKLISTS.contract;
  const present = [];
  const missing = [];
  for (const it of def.items) {
    const hit = it.terms.some((t) => text.includes(t));
    (hit ? present : missing).push(it.key);
  }
  return { register, name: def.name, present, missing, skipped: false };
}

export function scanText(lex, rules, raw) {
  const text = normalize(raw);
  const dict = matchLexicon(lex, text);
  const rule = matchRules(rules, text);
  const spans = [...dict, ...rule];
  const clusters = cluster(spans);
  const cand = candidates(text, spans);
  const reg = detectRegister(text);
  return {
    text, dict, rule, spans, clusters,
    water: waterIndex(text, clusters),
    sentences: cand.total,
    candidates: cand.list,
    register: reg.register,
    registerScores: reg.scores,
    gaps: missingFields(text, reg.register),
  };
}

// ---------- 立场判定 ----------
// 中文合同/规章里，谁吃亏通常由「谁承担」和「谁有权」两个动词决定。
// 这是确定性的：找到动词，再往前找最近的主语。
const PARTY_TOKENS = [
  ['a', ['甲方']],
  ['b', ['乙方', '丙方']],
  ['student', ['学生']],
  ['school', ['学校', '学院']],
  ['user', ['用户', '您']],
  ['platform', ['平台', '本公司']],
  ['operator', ['经营者', '商家']],
];
const OPPOSITE = { a: 'b', b: 'a', student: 'school', school: 'student', user: 'platform', platform: 'user', operator: 'user' };
export const PARTY_NAMES = { a: '甲方', b: '乙方', student: '学生', school: '学校', user: '用户', platform: '平台', operator: '经营者' };
const BURDEN_VERBS = ['自行承担', '承担', '负责', '赔偿', '支付', '补足', '负担'];
const POWER_VERBS = ['有权', '可自行', '有权要求'];

function subjectBefore(seg, pos) {
  let best = null;
  let bestPos = -1;
  for (const [party, toks] of PARTY_TOKENS) {
    for (const t of toks) {
      const i = seg.lastIndexOf(t, pos);
      if (i >= 0 && i > bestPos) { best = party; bestPos = i; }
    }
  }
  return best;
}

// 返回这句话里「不利后果落在谁身上」
export function bearingOfSentence(seg) {
  const hits = [];
  for (const t of BURDEN_VERBS) {
    let i = seg.indexOf(t);
    while (i >= 0) { hits.push({ i, kind: 'burden', verb: t }); i = seg.indexOf(t, i + 1); }
  }
  for (const t of POWER_VERBS) {
    let i = seg.indexOf(t);
    while (i >= 0) { hits.push({ i, kind: 'power', verb: t }); i = seg.indexOf(t, i + 1); }
  }
  hits.sort((x, y) => x.i - y.i);
  for (const h of hits) {
    const subj = subjectBefore(seg, h.i);
    if (!subj) continue;
    return { bearing: h.kind === 'burden' ? subj : OPPOSITE[subj] || null, holder: subj, kind: h.kind, verb: h.verb };
  }
  return { bearing: null, holder: null, kind: null, verb: null };
}

// 站在 stance 这一方看，这句话是「对你不利」「对你有利」还是「说不清」
export function relationTo(stance, bearing) {
  if (!stance || !bearing) return 'unclear';
  return bearing === stance ? 'against' : 'for';
}
export function segments(text, clusters) {
  const out = [];
  let pos = 0;
  for (const c of clusters) {
    if (c.start > pos) out.push({ type: 'text', text: text.slice(pos, c.start) });
    out.push({ type: 'hit', text: text.slice(c.start, c.end), category: c.primary.category, label: c.primary.label, weight: c.primary.weight });
    pos = c.end;
  }
  if (pos < text.length) out.push({ type: 'text', text: text.slice(pos) });
  return out;
}
