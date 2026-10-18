// 零依赖 LLM 客户端，只要求 Node 18+（有全局 fetch）。
// 同时支持两种传输格式：
//   openai    → POST {base}/chat/completions      （DeepSeek / 通义 / 月之暗面 / 智谱 等）
//   anthropic → POST {base}/v1/messages           （Claude 原生，以及 DeepSeek 的 anthropic 兼容端点）
//
// 环境变量（优先级从上到下）：
//   LLM_BASE_URL + LLM_API_KEY [+ LLM_MODEL] [+ LLM_FORMAT]   ← 最通用
//   ANTHROPIC_API_KEY                                          ← 自动用 Anthropic 格式
//   DEEPSEEK_API_KEY                                           ← 自动用 DeepSeek 端点
//   OPENAI_API_KEY                                             ← 自动用 OpenAI 端点
//
// LLM_FORMAT 可以强制指定 openai / anthropic；不指定时按 baseUrl 里有没有 "anthropic" 自动判断。

const PRESETS = {
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', format: 'openai' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', format: 'openai' },
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-haiku-latest', format: 'anthropic' },
};

function detectFormat(env, baseUrl) {
  if (env.LLM_FORMAT === 'openai' || env.LLM_FORMAT === 'anthropic') return env.LLM_FORMAT;
  if (/anthropic/i.test(baseUrl || '')) return 'anthropic';
  if (env.LLM_FORMAT) return String(env.LLM_FORMAT);
  return 'openai';
}

export function getConfig(env = process.env) {
  if (env.LLM_BASE_URL && env.LLM_API_KEY) {
    const baseUrl = env.LLM_BASE_URL.replace(/\/$/, '');
    const format = detectFormat(env, baseUrl);
    const model = env.LLM_MODEL || (/deepseek/.test(baseUrl) ? 'deepseek-chat' : PRESETS[format].model);
    return { baseUrl, apiKey: env.LLM_API_KEY, model, format, source: 'LLM_*' };
  }
  if (env.ANTHROPIC_API_KEY) {
    return { ...PRESETS.anthropic, apiKey: env.ANTHROPIC_API_KEY, source: 'ANTHROPIC_API_KEY' };
  }
  if (env.DEEPSEEK_API_KEY) {
    return { ...PRESETS.deepseek, apiKey: env.DEEPSEEK_API_KEY, source: 'DEEPSEEK_API_KEY' };
  }
  if (env.OPENAI_API_KEY) {
    return { ...PRESETS.openai, apiKey: env.OPENAI_API_KEY, source: 'OPENAI_API_KEY' };
  }
  return null;
}

export function hasLLM(env = process.env) {
  return getConfig(env) !== null;
}

function endpointOf(cfg) {
  if (cfg.format === 'anthropic') {
    return cfg.baseUrl.endsWith('/v1') ? cfg.baseUrl + '/messages' : cfg.baseUrl + '/v1/messages';
  }
  return cfg.baseUrl.endsWith('/v1') ? cfg.baseUrl + '/chat/completions' : cfg.baseUrl + '/chat/completions';
}

function buildRequest(cfg, { system, user, maxTokens, temperature, withJsonFormat }) {
  if (cfg.format === 'anthropic') {
    return {
      url: endpointOf(cfg),
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: cfg.model,
        max_tokens: maxTokens,
        temperature,
        system,
        messages: [{ role: 'user', content: user }],
      },
    };
  }
  return {
    url: endpointOf(cfg),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: {
      model: cfg.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature,
      max_tokens: maxTokens,
      ...(withJsonFormat ? { response_format: { type: 'json_object' } } : {}),
    },
  };
}

function extractContent(cfg, data) {
  if (cfg.format === 'anthropic') {
    const blocks = Array.isArray(data?.content) ? data.content : [];
    return blocks.filter((b) => b?.type === 'text').map((b) => b.text).join('');
  }
  return data?.choices?.[0]?.message?.content || '';
}

export async function chatJSON({
  system, user, maxTokens = 2000, temperature = 0.2, timeoutMs = 25000, env = process.env,
}) {
  const cfg = getConfig(env);
  if (!cfg) throw new Error('NO_KEY');

  const attempt = async (withJsonFormat) => {
    const req = buildRequest(cfg, { system, user, maxTokens, temperature, withJsonFormat });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal: ctl.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + text.slice(0, 200));
      const data = JSON.parse(text);
      const content = extractContent(cfg, data);
      if (!content) throw new Error('EMPTY_CONTENT');
      return parseLooseJSON(content);
    } finally {
      clearTimeout(timer);
    }
  };

  // OpenAI 格式先试 response_format，不支持就退回纯提示词；
  // Anthropic 没有这个参数，只跑一次。
  if (cfg.format === 'anthropic') return attempt(false);
  try {
    return await attempt(true);
  } catch (e) {
    return await attempt(false);
  }
}

// 模型有时候还是会裹 Markdown 代码块，剥掉再解析
export function parseLooseJSON(s) {
  let t = String(s).trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const first = t.search(/[[{]/);
  if (first > 0) t = t.slice(first);
  const lastObj = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (lastObj >= 0) t = t.slice(0, lastObj + 1);
  return JSON.parse(t);
}

export function describeConfig(env = process.env) {
  const cfg = getConfig(env);
  if (!cfg) return '未配置（将使用离线降级模式）';
  return cfg.model + ' @ ' + cfg.baseUrl + '  [' + cfg.format + ']（来自 ' + cfg.source + '）';
}
