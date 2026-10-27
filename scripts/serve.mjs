#!/usr/bin/env node
// 零依赖本地服务器：把 docs/index.html 服务出去，并暴露 /api/dehydrate。
// 用法:
//   node scripts/serve.mjs             纯离线（不需要 key）
//   node scripts/serve.mjs --port=3000
// 有 .env.local 或环境变量里的 key 时，/api/dehydrate 自动启用 L2。
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dehydrate } from '../lib/pipeline.mjs';
import { hasLLM, describeConfig } from '../lib/llm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = (p) => path.join(ROOT, p);

// 极简 .env.local 读取（不引依赖）
const envFile = R('.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith('--' + k + '='));
  return hit ? hit.split('=')[1] : d;
};
const PORT = Number(arg('port', process.env.PORT || 3000));
const MAX_CHARS = Number(process.env.MAX_INPUT_CHARS || arg('maxchars', 20000));
const DAILY_LIMIT = Number(process.env.DAILY_GLOBAL_LIMIT || 300);

// 内存限流：不上数据库，重启即清零
const hits = { day: new Date().toISOString().slice(0, 10), count: 0, byIp: new Map() };
function rateLimited(ip) {
  const today = new Date().toISOString().slice(0, 10);
  if (hits.day !== today) { hits.day = today; hits.count = 0; hits.byIp.clear(); }
  if (hits.count >= DAILY_LIMIT) return 'daily';
  const n = hits.byIp.get(ip) || 0;
  if (n >= 20) return 'ip';
  hits.count++; hits.byIp.set(ip, n + 1);
  return null;
}

const readBody = (req) => new Promise((resolve, reject) => {
  let buf = '';
  req.on('data', (c) => { buf += c; if (buf.length > 2_000_000) { reject(new Error('TOO_LARGE')); req.destroy(); } });
  req.on('end', () => resolve(buf));
  req.on('error', reject);
});

const send = (res, code, type, body) => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));

  if (req.method === 'POST' && url.pathname === '/api/dehydrate') {
    // 只服务同源的页面：别的网站不能借用户的浏览器 POST 过来烧 key。
    // curl / 脚本没有 Origin 头，照常可用。
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) {
          return send(res, 403, 'application/json', JSON.stringify({ error: '跨源请求已拒绝' }));
        }
      } catch {
        return send(res, 400, 'application/json', JSON.stringify({ error: 'Origin 不合法' }));
      }
    }

    const ip = req.socket.remoteAddress || '?';
    const limited = rateLimited(ip);
    if (limited) {
      // 超限不报错，降级继续跑 —— 用户看不到失败，你也花不到钱
      console.log('[限流] ' + limited + ' 触发，降级为离线模式');
    }
    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const text = String(payload.text || '');
      if (text.length < 40) return send(res, 400, 'application/json', JSON.stringify({ error: '文本太短（至少 40 字）' }));
      if (text.length > MAX_CHARS) return send(res, 413, 'application/json', JSON.stringify({ error: '超过 ' + MAX_CHARS + ' 字上限，请分段' }));

      const out = await dehydrate(text, {
        stance: payload.stance || 'user',
        documentName: payload.name || '未命名文档',
        topN: Number(payload.topN || 10),
        useLLM: !limited,
      });
      // pool 是内部候选池，页面用不到，别往网络上送
      const { pool, ...wire } = out;
      send(res, 200, 'application/json', JSON.stringify(wire));
    } catch (e) {
      send(res, 500, 'application/json', JSON.stringify({ error: String(e.message || e) }));
    }
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const p = R('docs/index.html');
    if (!fs.existsSync(p)) return send(res, 500, 'text/plain; charset=utf-8', '还没构建。先跑：node scripts/build-offline.mjs');
    return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(p));
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send(res, 200, 'application/json', JSON.stringify({
      ok: true, llm: hasLLM(), config: describeConfig(), maxChars: MAX_CHARS, usedToday: hits.count,
    }));
  }

  send(res, 404, 'text/plain; charset=utf-8', 'not found');
});

server.listen(PORT, () => {
  console.log('Dehydrator AI 已启动');
  console.log('  页面  http://localhost:' + PORT + '/');
  console.log('  接口  POST http://localhost:' + PORT + '/api/dehydrate');
  console.log('  健康  http://localhost:' + PORT + '/api/health');
  console.log('  模型  ' + describeConfig());
  console.log('  限流  单日 ' + DAILY_LIMIT + ' 次 / 单IP 20 次，超限自动降级不报错');
});
