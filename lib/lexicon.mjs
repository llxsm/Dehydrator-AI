// 词库的读写层：源（meta.json + entries/*.json）⇄ 产物（zh-cn.v1.json）。
//
// 为什么要有产物：运行时只读一个文件，不用反复打开 8 个；
// 为什么源是多个文件：两个人在不同类别上加词条，不会在同一行附近打架。
//
// 规矩只有一条：**改源，不改产物**。产物由 buildLexicon() 生成，
// check-all 会比对二者，改了源忘了构建会被拦下来。
import fs from 'node:fs';
import path from 'node:path';

export const SOURCE_META = 'lexicon/meta.json';
export const SOURCE_DIR = 'lexicon/entries';
export const BUNDLE_PATH = 'lexicon/zh-cn.v1.json';

const CATEGORY_ORDER = (meta) => Object.keys(meta.categories || {});

/** 读 meta.json。 */
export function readMeta(root) {
  return JSON.parse(fs.readFileSync(path.join(root, SOURCE_META), 'utf8'));
}

/** 读 entries/ 下所有 .json，返回 { 文件名: 内容 }。 */
export function readEntryFiles(root) {
  const dir = path.join(root, SOURCE_DIR);
  if (!fs.existsSync(dir)) throw new Error('找不到 ' + SOURCE_DIR);
  const out = {};
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    out[name] = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  }
  return out;
}

/** 源 → 产物对象。entries 的顺序按 meta.categories 的声明顺序，和文件名无关。 */
export function composeLexicon(root) {
  const meta = readMeta(root);
  const files = readEntryFiles(root);
  const byCategory = new Map();
  for (const [name, doc] of Object.entries(files)) {
    if (!doc || typeof doc.category !== 'string') throw new Error(name + ' 缺 category 字段');
    if (byCategory.has(doc.category)) {
      throw new Error('类别 ' + doc.category + ' 同时出现在 ' + byCategory.get(doc.category).file + ' 和 ' + name);
    }
    byCategory.set(doc.category, { file: name, doc });
  }
  const entries = [];
  for (const category of CATEGORY_ORDER(meta)) {
    const hit = byCategory.get(category);
    if (hit) entries.push(...(hit.doc.entries || []));
  }
  const bundle = {
    version: meta.version,
    locale: meta.locale,
    name: meta.name,
    license: meta.license,
    disclaimer: meta.disclaimer,
    design_rules: meta.design_rules,
    categories: meta.categories,
    entries,
  };
  return { bundle, meta, files };
}

export function serialize(lexicon) {
  return JSON.stringify(lexicon, null, 2) + '\n';
}

/** 产物与源不一致时返回差异摘要，一致返回 null。 */
export function staleReason(root) {
  const { bundle } = composeLexicon(root);
  const target = path.join(root, BUNDLE_PATH);
  if (!fs.existsSync(target)) return '产物 ' + BUNDLE_PATH + ' 不存在';
  const actual = fs.readFileSync(target, 'utf8');
  const expect = serialize(bundle);
  if (actual === expect) return null;

  const old = JSON.parse(actual);
  const oldEntries = old.entries || [];
  if (oldEntries.length !== bundle.entries.length) {
    return '产物与源条数不符（产物 ' + oldEntries.length + ' / 源 ' + bundle.entries.length + '）';
  }
  // 指出第一处具体差异，比「不一致」三个字有用
  const want = new Map(bundle.entries.map((e) => [e.id, e]));
  for (const e of oldEntries) {
    const src = want.get(e.id);
    if (!src) return '产物里的词条 ' + e.id + ' 在源里找不到';
    const key = Object.keys(src).find((k) => JSON.stringify(src[k]) !== JSON.stringify(e[k]));
    if (key) return '词条 ' + e.id + ' 的 ' + key + ' 与源不一致';
  }
  for (const id of want.keys()) {
    if (!oldEntries.some((e) => e.id === id)) return '源里的词条 ' + id + ' 不在产物里';
  }
  return '产物与源不一致（词条内容相同但顺序或元信息不同）';
}

/** 写产物。返回 { changed, bytes }。 */
export function buildLexicon(root) {
  const { bundle } = composeLexicon(root);
  const text = serialize(bundle);
  const target = path.join(root, BUNDLE_PATH);
  const before = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  if (before !== text) fs.writeFileSync(target, text);
  return { changed: before !== text, bytes: Buffer.byteLength(text), count: bundle.entries.length };
}

/**
 * 校验源。返回 { errors, warnings, stats }。
 * errors 会让 check-all 失败；warnings 只提示。
 */
export function validateSources(root) {
  const errors = [];
  const warnings = [];
  let meta;
  let files;
  try {
    meta = readMeta(root);
    files = readEntryFiles(root);
  } catch (e) {
    return { errors: [e.message], warnings, stats: {} };
  }

  for (const k of ['version', 'locale', 'name', 'license', 'design_rules', 'categories', 'registers']) {
    if (meta[k] === undefined) errors.push('meta.json 缺 ' + k);
  }
  if (!Object.keys(meta.categories || {}).length) errors.push('meta.json 的 categories 为空');

  const seenIds = new Map();
  const seenTerms = new Map();
  const covered = new Set();
  const REQUIRED = ['id', 'category', 'label', 'weight', 'why', 'advice', 'example'];
  let entryCount = 0;
  let withEvidence = 0;

  for (const [name, doc] of Object.entries(files)) {
    const cat = doc.category;
    if (!meta.categories?.[cat]) {
      errors.push(name + ' 的 category「' + cat + '」不在 meta.categories 里');
      continue;
    }
    covered.add(cat);
    const declared = [...(doc.registers || [])].sort().join(',');
    const canonical = [...(meta.categories[cat].register || [])].sort().join(',');
    if (declared !== canonical) {
      errors.push(name + ' 的 registers（' + declared + '）与 meta.categories.' + cat + '.register（' + canonical + '）不一致');
    }
    if (!doc.note) warnings.push(name + ' 缺 note（说明这个文件负责哪块，方便别人认领）');

    for (const e of doc.entries || []) {
      entryCount++;
      const where = name + ' / ' + (e.id || '?');
      for (const k of REQUIRED) {
        if (e[k] === undefined || e[k] === '') errors.push(where + ' 缺字段 ' + k);
      }
      if (e.category !== cat) errors.push(where + ' 的 category「' + e.category + '」与文件声明的「' + cat + '」不一致');
      if (!Number.isInteger(e.weight) || e.weight < 1 || e.weight > 3) errors.push(where + ' 的 weight 必须是 1-3 的整数');
      if (seenIds.has(e.id)) {
        errors.push(seenIds.get(e.id) === name
          ? where + ' 的 id 在同一文件里重复'
          : '词条 id 重复：' + e.id + '（' + seenIds.get(e.id) + ' 与 ' + name + '）');
      }
      seenIds.set(e.id, name);

      if (!Array.isArray(e.terms) || !e.terms.length) {
        errors.push(where + ' 的 terms 为空');
      } else {
        const local = new Set();
        for (const t of e.terms) {
          if (typeof t !== 'string' || !t.trim()) { errors.push(where + ' 的 terms 里有空值'); continue; }
          if (local.has(t)) errors.push(where + ' 的 terms 重复：' + t);
          local.add(t);
          // 同一个词挂在两个词条上，命中权重会互相打架
          if (seenTerms.has(t) && seenTerms.get(t) !== e.id) {
            warnings.push('词「' + t + '」同时属于 ' + seenTerms.get(t) + ' 和 ' + e.id);
          }
          seenTerms.set(t, e.id);
        }
      }

      if (e.regex !== undefined) {
        try {
          const re = new RegExp('(?:' + e.regex + ')');
          if (re.test('')) errors.push(where + ' 的正则能匹配空串，会产生零长度命中');
        } catch (err) {
          errors.push(where + ' 的正则有语法错误：' + err.message);
        }
      }
      if (e.evidence) withEvidence++;
    }
  }

  for (const cat of CATEGORY_ORDER(meta)) {
    if (!covered.has(cat)) warnings.push('类别 ' + cat + ' 还没有词条文件（' + SOURCE_DIR + '/）');
  }

  const stats = {
    files: Object.keys(files).length,
    entries: entryCount,
    categories: covered.size,
    withEvidence,
  };
  if (entryCount !== seenIds.size) errors.push('词条数与唯一 id 数不符');
  if (withEvidence < entryCount) {
    warnings.push('evidence 覆盖 ' + withEvidence + '/' + entryCount + '（design_rules 要求新增词条必须带，存量待补）');
  }
  return { errors, warnings, stats };
}

/** 运行时读取：只读产物，不碰源目录。root 是仓库根目录。 */
export function loadBundle(root) {
  return JSON.parse(fs.readFileSync(path.join(root, BUNDLE_PATH), 'utf8'));
}
