// Node 侧薄封装：读词典文件 + 复用纯函数引擎。
// 浏览器端不要 import 这个文件（它带 node:fs），用 lib/engine.mjs。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as engine from './engine.mjs';

export * from './engine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEX_DIR = path.join(ROOT, 'lexicon');

export function loadLexicon(dir = LEX_DIR) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'zh-cn.v1.json'), 'utf8'));
}
export function loadRules(dir = LEX_DIR) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'rules.zh-cn.v1.json'), 'utf8'));
}

export function scan(raw, { lex, rules } = {}) {
  const L = lex ?? loadLexicon();
  const R = rules ?? loadRules();
  const r = engine.scanText(L, R, raw);
  return { ...r, lexicon: L, rulebook: R };
}
