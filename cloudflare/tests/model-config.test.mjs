import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, validateModelConfig, sealKey, openKey, configuredProvider } from '../src/model-config.js';

const access = 'test-only-access-token-with-at-least-24-characters';
const example = {
  api: 'openai-completions', baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4.1-mini', reasoning: false, contextWindow: 128000, maxTokens: 4096,
};

test('faux config remains free and requires no API key', () => {
  assert.deepEqual(validateModelConfig({ api: 'faux' }), DEFAULT_CONFIG);
});
test('valid OpenAI and Anthropic configurations', () => {
  assert.equal(validateModelConfig(example).model, 'gpt-4.1-mini');
  assert.equal(validateModelConfig({ ...example, api: 'openai-responses' }).api, 'openai-responses');
  assert.equal(validateModelConfig({ ...example, api: 'anthropic-messages', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5' }).api, 'anthropic-messages');
});
test('refuse SSRF-prone and non-HTTPS model endpoints', () => {
  for (const baseUrl of ['http://evil.example/v1', 'https://localhost/v1', 'https://169.254.169.254/v1', 'https://10.0.0.1/v1', 'https://internal.local/v1', 'https://u:password@example.com/v1']) {
    assert.throws(() => validateModelConfig({ ...example, baseUrl }), /Base URL/);
  }
});
test('reject malformed tokens and unsupported APIs', () => {
  assert.throws(() => validateModelConfig({ ...example, contextWindow: 2 }), /上下文窗口/);
  assert.throws(() => validateModelConfig({ ...example, api: 'openai-unknown' }), /仅支持/);
  assert.throws(() => validateModelConfig({ ...example, maxTokens: 999999 }), /最大输出/);
});
test('AES-GCM API keys are not stored as plaintext and require matching deployment secret', async () => {
  const raw = 'sk-live-testing-placeholder-do-not-use';
  const sealed = await sealKey(raw, access);
  assert.equal(sealed.startsWith('v1.'), true);
  assert.equal(sealed.includes(raw), false);
  assert.equal(await openKey(sealed, access), raw);
  await assert.rejects(() => openKey(sealed, access + '-changed'));
});
test('provider custom auth uses the encrypted key resolver', async () => {
  const { provider, model } = configuredProvider(example, async () => 'sk-test');
  assert.equal(model.provider, 'edge-configured');
  assert.equal(model.id, 'gpt-4.1-mini');
  assert.equal(provider.id, 'edge-configured');
});
