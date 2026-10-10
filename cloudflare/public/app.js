const $ = (id) => document.getElementById(id);
let token = sessionStorage.getItem('piEdgeToken') || '';
let busy = false;
let polls = 0;
let pollTimer;
let currentModel = { api: 'faux', hasKey: false };
$('token').value = token;
$('selfcheck').disabled = !token;

function feedback(message) { $('feedback').textContent = message; }
function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className || '';
  node.textContent = text || '';
  return node;
}
async function api(path, options = {}) {
  if (!token) throw new Error('请先输入 ACCESS_TOKEN');
  const response = await fetch(path, {
    ...options,
    headers: { Authorization: 'Bearer ' + token, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'HTTP ' + response.status);
  return data;
}
function render(state) {
  const messages = $('messages');
  messages.replaceChildren();
  for (const msg of state.messages || []) {
    const bubble = element('div', 'bubble ' + (msg.role === 'user' ? 'user' : ''), msg.text);
    bubble.prepend(element('span', 'label', msg.role === 'user' ? '你' : 'Pi Durable · ' + (currentModel.api === 'faux' ? 'faux' : currentModel.model || 'AI')));
    messages.append(bubble);
  }
  if (!messages.children.length) messages.append(element('div', 'muted', '尚无聊天记录。'));
  messages.scrollTop = messages.scrollHeight;
  const pending = state.pending || [];
  $('pending').textContent = pending.length ? '未完成任务：' + pending.length + '（后台执行中；无需保持网页打开）' : '当前没有未完成任务。';
  const reminders = $('reminders');
  reminders.replaceChildren();
  for (const item of state.reminders || []) {
    const when = new Date(item.dueAt).toLocaleString('zh-CN');
    const row = element('div', 'reminder', item.text + ' · ' + when);
    row.append(element('span', 'tag', item.status === 'fired' ? '已触发' : item.status === 'scheduled' ? '待触发' : '失败'));
    reminders.append(row);
  }
  if (!reminders.children.length) reminders.textContent = '暂无提醒。';
  // Avoid indefinite polling and unnecessary free-tier consumption.
  const scheduled = (state.reminders || []).some((item) => item.status === 'scheduled');
  if ((pending.length || scheduled) && polls < 35) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => refresh(true), 2500);
    polls += 1;
  } else if (polls >= 35) {
    $('pending').textContent += ' 自动刷新已停止，请手动刷新。';
  }
}
async function refresh(quiet = false) {
  try {
    const state = await api('/api/state');
    render(state);
    if (!quiet) feedback('已连接。状态来自 Cloudflare SQLite-backed Durable Object。');
  } catch (error) { feedback(error.message); }
}
$('connect').addEventListener('click', () => {
  token = $('token').value.trim();
  sessionStorage.setItem('piEdgeToken', token);
  polls = 0;
  $('selfcheck').disabled = !token;
  refresh();
  loadModelSettings();
});
$('refresh').addEventListener('click', () => { polls = 0; refresh(); });
$('prompt').addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('send').click(); } });
$('send').addEventListener('click', async () => {
  if (busy) return;
  const text = $('prompt').value.trim() || (currentModel.api === 'faux' ? '执行一次 12 秒的 Pi Durable 任务恢复演示' : '你好，请介绍一下你自己。');
  busy = true; $('send').disabled = true;
  try {
    const operationId = crypto.randomUUID();
    const result = await api('/api/chat', { method: 'POST', body: JSON.stringify({ text, operationId }) });
    $('prompt').value = '';
    polls = 0;
    feedback('已持久提交：' + result.operationId + '；刷新或关闭页面不会撤销任务。');
    await refresh(true);
  } catch (error) { feedback(error.message); }
  finally { busy = false; $('send').disabled = false; }
});
$('remind').addEventListener('click', async () => {
  const seconds = Number($('seconds').value);
  const text = $('reminder-text').value.trim() || '站起来活动一下';
  try {
    await api('/api/reminders', { method: 'POST', body: JSON.stringify({ text, seconds }) });
    $('reminder-text').value = '';
    feedback('定时提醒已保存。到期由 Cloudflare 自动唤醒。');
    await refresh(true);
  } catch (error) { feedback(error.message); }
});
if (token) { refresh(); loadModelSettings(); }

/**
 * Visible smoke test: creates its own unique chat operation and reminder.
 * This tests the deployed API and persistent state but NOT forced eviction.
 */
$('selfcheck').addEventListener('click', async () => {
  if (!token) return feedback('请先连接 ACCESS_TOKEN。');
  if (currentModel.api !== 'faux') return feedback('一键模拟自检只能在 Faux 模式运行，请切回 Faux。');
  const control = $('selfcheck');
  control.disabled = true;
  const result = $('selfcheck-result');
  const operationId = 'selfcheck-' + crypto.randomUUID().replaceAll('-', '');
  const prompt = 'Pi Durable Edge 自动检查 ' + operationId.slice(-8);
  let reminderId;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    result.textContent = '检测 1/3：提交任务与幂等性…';
    const body = JSON.stringify({ text: prompt, operationId });
    const receipt = await api('/api/chat', { method: 'POST', body });
    if (!receipt.accepted) throw new Error('首次任务未被接受');
    const repeated = await api('/api/chat', { method: 'POST', body });
    if (repeated.accepted !== false) throw new Error('重复提交未按 operationId 去重');

    result.textContent = '检测 2/3：创建 5 秒持久提醒…';
    const reminder = await api('/api/reminders', {
      method: 'POST', body: JSON.stringify({ text: '自动检查提醒', seconds: 5 }),
    });
    reminderId = reminder.id;

    result.textContent = '检测 3/3：等待后台任务完成与提醒唤醒…';
    let passed = false;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const state = await api('/api/state');
      const i = (state.messages || []).findLastIndex((m) => m.role === 'user' && m.text === prompt);
      const replied = i >= 0 && state.messages.slice(i + 1).some(
        (m) => m.role === 'assistant' && m.text.includes('任务完成：Pi Durable')
      );
      const fired = (state.reminders || []).some(
        (m) => m.id === reminderId && m.status === 'fired'
      );
      if (replied && fired) {
        passed = true;
        render(state);
        break;
      }
      await pause(2500);
    }
    if (!passed) throw new Error('60 秒内未完成测试，请检查免费额度或 Workers 日志');
    result.textContent = '基本自检通过：模拟对话、幂等提交、SQLite 状态和持久提醒均正常。真实崩溃恢复尚需单独测试。';
    feedback('Pi Durable Edge 基本自检通过。');
  } catch (error) {
    result.textContent = '自检失败：' + error.message;
    feedback('请按部署文档检查。');
  } finally {
    control.disabled = false;
  }
});

const modelDefaultUrls = {
  faux: '', 'openai-completions': 'https://api.openai.com/v1',
  'openai-responses': 'https://api.openai.com/v1', 'anthropic-messages': 'https://api.anthropic.com',
};
function formModelConfig() {
  return {
    api: $('model-api').value,
    baseUrl: $('model-url').value.trim(),
    model: $('model-id').value.trim(),
    apiKey: $('model-key').value.trim(),
    reasoning: $('model-reasoning').checked,
    contextWindow: Number($('model-context').value),
    maxTokens: Number($('model-max').value),
  };
}
function renderModelConfig(cfg) {
  currentModel = cfg;
  $('model-api').value = cfg.api || 'faux';
  $('model-id').value = cfg.model || '';
  $('model-url').value = cfg.baseUrl || modelDefaultUrls[cfg.api] || '';
  $('model-key').value = '';
  $('model-key').placeholder = cfg.hasKey ? '已保存加密密钥 · 留空保持不变' : '填写 API Key（首次启用必填）';
  $('model-context').value = cfg.contextWindow || 128000;
  $('model-max').value = cfg.maxTokens || 8192;
  $('model-reasoning').checked = Boolean(cfg.reasoning);
  $('model-status').textContent = cfg.api === 'faux' ? 'faux · 免费模拟' : cfg.model + ' · ' + cfg.api;
  $('selfcheck').disabled = !token || cfg.api !== 'faux';
  $('chat-description').textContent = cfg.api === 'faux'
    ? 'Faux 模式：任务执行 12 秒等待并返回固定回复，免费验证断点恢复。'
    : '当前使用 ' + cfg.model + ' 的真实聊天接口。每次提交可能产生模型 API 费用。';
  $('model-feedback').textContent = cfg.api === 'faux' ? '当前未调用外部模型。' :
    '当前配置已保存；' + (cfg.hasKey ? 'API Key 已加密保存（不会返回明文）。' : '尚未配置 API Key。');
}
async function loadModelSettings() {
  if (!token) return;
  try { renderModelConfig(await api('/api/model')); }
  catch (error) { $('model-feedback').textContent = '载入配置失败：' + error.message; }
}
$('model-api').addEventListener('change', () => {
  const nextApi = $('model-api').value;
  const url = $('model-url').value.trim();
  if (!url || Object.values(modelDefaultUrls).includes(url)) {
    $('model-url').value = modelDefaultUrls[nextApi] || '';
  }
  $('model-form').querySelectorAll('input,select').forEach((input) => {
    if (input.id !== 'model-api') input.disabled = nextApi === 'faux';
  });
  if (nextApi !== 'faux') $('model-form').querySelectorAll('input,select').forEach((input) => { input.disabled = false; });
});
$('model-reload').addEventListener('click', () => loadModelSettings());
$('model-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('model-save');
  button.disabled = true;
  try {
    const config = formModelConfig();
    if (config.api !== 'faux' && !config.apiKey && !currentModel.hasKey) {
      throw new Error('首次设置真实模型必须填写 API Key');
    }
    const saved = await api('/api/model', { method: 'PUT', body: JSON.stringify(config) });
    renderModelConfig(saved);
    polls = 0;
    $('model-feedback').textContent = '已保存并切换到 ' + (saved.api === 'faux' ? 'Faux 模拟模式' : saved.model) + '；刷新页面后仍然生效。';
    await refresh(true);
  } catch (error) { $('model-feedback').textContent = '保存失败：' + error.message; }
  finally { button.disabled = false; }
});
