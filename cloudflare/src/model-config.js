import { createProvider } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';

export const DEFAULT_CONFIG = Object.freeze({
  api: 'faux', baseUrl: '', model: '', reasoning: false, contextWindow: 128000, maxTokens: 8192,
});
const ENDPOINTS = {
  'openai-completions': 'https://api.openai.com/v1',
  'openai-responses': 'https://api.openai.com/v1',
  'anthropic-messages': 'https://api.anthropic.com',
};
const APIS = {
  'openai-completions': openAICompletionsApi(),
  'openai-responses': openAIResponsesApi(),
  'anthropic-messages': anthropicMessagesApi(),
};
const enc = new TextEncoder();
const dec = new TextDecoder();

function base64(bytes) {
  let s = '';
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s);
}
function unbase64(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

async function cryptoKey(accessToken) {
  if (typeof accessToken !== 'string' || accessToken.length < 24) {
    throw new Error('ACCESS_TOKEN 未配置或长度不足');
  }
  const bits = await crypto.subtle.digest('SHA-256', enc.encode('pi-durable-edge:model-settings:v1:' + accessToken));
  return crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sealKey(apiKey, accessToken) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cryptoKey(accessToken), enc.encode(apiKey));
  return 'v1.' + base64(iv) + '.' + base64(new Uint8Array(encrypted));
}
export async function openKey(sealed, accessToken) {
  const [version, nonce, value] = String(sealed).split('.');
  if (version !== 'v1' || !nonce || !value) throw new Error('无法读取已保存密钥');
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(nonce) }, await cryptoKey(accessToken), unbase64(value));
  return dec.decode(decrypted);
}

export function validateModelConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('模型配置无效');
  const api = String(raw.api || 'faux');
  if (api === 'faux') return { ...DEFAULT_CONFIG };
  if (!(api in ENDPOINTS)) throw new Error('仅支持 OpenAI Completions、OpenAI Responses、Anthropic Messages');
  const model = String(raw.model ?? '').trim();
  if (!model || model.length > 160 || /[\u0000-\u001f]/.test(model)) throw new Error('模型 ID 必须为 1–160 个有效字符');
  const suppliedBaseUrl = String(raw.baseUrl || ENDPOINTS[api]).trim();
  if (suppliedBaseUrl.length > 500) throw new Error('Base URL 长度不能超过 500');
  let url;
  try { url = new URL(suppliedBaseUrl); } catch { throw new Error('Base URL 无效'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Base URL 必须是 HTTPS 地址，不能包含账号、密码、查询参数或 #');
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') || hostname.endsWith('.internal') ||
      hostname === 'metadata.google.internal' ||
      /^(127|10|0|169\.254|192\.168)\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) || hostname === '[::1]') {
    throw new Error('Base URL 不允许访问本地和私有网络地址');
  }
  const contextWindow = Number(raw.contextWindow);
  const maxTokens = Number(raw.maxTokens);
  if (!Number.isInteger(contextWindow) || contextWindow < 4096 || contextWindow > 2000000) throw new Error('上下文窗口需为 4096–2000000');
  if (!Number.isInteger(maxTokens) || maxTokens < 128 || maxTokens > contextWindow) throw new Error('最大输出 Token 需为 128 到上下文窗口大小');
  if (typeof raw.reasoning !== 'boolean') throw new Error('推理能力必须是布尔值');
  return { api, baseUrl: url.toString().replace(/\/$/, ''), model, reasoning: raw.reasoning, contextWindow, maxTokens };
}

export function modelDescriptor(config) {
  return {
    id: config.model, name: config.model, api: config.api,
    provider: 'edge-configured', baseUrl: config.baseUrl,
    reasoning: config.reasoning,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: config.contextWindow,
    maxTokens: config.maxTokens,
    ...(config.api === 'openai-completions' ? { compat: { supportsStore: false, supportsDeveloperRole: false } } : {}),
  };
}

export function configuredProvider(config, getApiKey) {
  const model = modelDescriptor(config);
  const provider = createProvider({
    id: 'edge-configured', name: 'Pi Durable Edge', baseUrl: config.baseUrl,
    auth: { apiKey: { name: 'Pi Durable Edge API Key', resolve: async ({ signal }) => {
      signal?.throwIfAborted();
      const key = await getApiKey();
      signal?.throwIfAborted();
      if (!key) throw new Error('API Key 缺失：请前往模型配置页面');
      return { auth: { apiKey: key }, source: 'encrypted Durable Object setting' };
    } } },
    models: [model], api: APIS[config.api],
  });
  return { provider, model };
}

export function defaultBaseUrl(api) { return ENDPOINTS[api] || ''; }
