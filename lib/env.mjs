// 极简 .env.local 读取（零依赖）。没有这个文件也不会报错。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
