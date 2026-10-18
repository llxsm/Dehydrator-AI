// 极简 .env.local 读取（零依赖）。没有这个文件也不会报错。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export { ROOT };

// 用户传进来的路径：先按当前目录找，找不到再按项目根目录找。
// 这样无论从哪个目录运行脚本都能工作。
export function resolveInput(p) {
  if (!p) return p;
  if (fs.existsSync(p)) return path.resolve(p);
  const alt = path.join(ROOT, p);
  return fs.existsSync(alt) ? alt : path.resolve(p);
}

// 项目内部路径（corpus/、lexicon/ 之类）：永远从项目根目录算。
export function resolveRoot(p) {
  return path.join(ROOT, p);
}

export function loadDotEnv(dir = ROOT) {
  const p = path.join(dir, '.env.local');
  if (!fs.existsSync(p)) return false;
  for (const raw of fs.readFileSync(p, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const val = m[2].replace(/^["']|["']$/g, '').trim();
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
  return true;
}
