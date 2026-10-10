// 管理页面独立加载，不依赖既有前端的内部状态。
(() => {
  const sheet = document.createElement("style");
  sheet.textContent = "/* v3 管理侧栏：独立于旧版单文件前端，移动端也可操作。 */\n#v3-toggle{position:fixed;right:22px;bottom:22px;z-index:2500;background:#4338ca;color:white;border:0;border-radius:999px;padding:12px 18px;box-shadow:0 6px 24px #1113;cursor:pointer}\n#v3-drawer{position:fixed;z-index:2501;right:16px;bottom:72px;top:16px;width:min(420px,calc(100vw - 32px));background:var(--bg-surface,#fff);color:var(--text-main,#111);border:1px solid var(--border,#ddd);box-shadow:0 18px 48px #0003;border-radius:16px;padding:18px;overflow:auto;font-size:14px}\n#v3-drawer[hidden]{display:none}\n#v3-drawer h2{font-size:18px;margin:0}\n#v3-drawer h3{font-size:14px;margin:18px 0 10px}\n#v3-drawer .v3-head{display:flex;align-items:center;justify-content:space-between}\n#v3-drawer form{display:grid;gap:8px}\n#v3-drawer label{display:grid;gap:4px;color:var(--text-muted,#666)}\n#v3-drawer input,#v3-drawer textarea{background:var(--bg-input,#fff);color:var(--text-main,#111);border:1px solid var(--border,#ddd);border-radius:8px;padding:9px;width:100%}\n#v3-drawer textarea{min-height:72px;resize:vertical}\n#v3-drawer button{border:1px solid var(--border,#ddd);background:var(--bg-subtle,#f6f6f6);color:var(--text-main,#111);border-radius:8px;padding:7px 10px;cursor:pointer}\n#v3-drawer button.v3-primary{background:#4338ca;color:#fff;border:0}\n#v3-drawer button:disabled{opacity:.5;cursor:default}\n#v3-drawer .v3-row{padding:9px 0;border-bottom:1px solid var(--border,#ddd)}\n#v3-drawer .v3-row p{margin:5px 0;overflow-wrap:anywhere}\n#v3-drawer .v3-actions{display:flex;flex-wrap:wrap;gap:7px;align-items:center}\n#v3-drawer .v3-muted{font-size:12px;color:var(--text-muted,#666)}\n#v3-drawer .v3-status{font-size:12px;color:var(--primary,#4338ca)}\n#v3-drawer .v3-duo{display:grid;grid-template-columns:1fr 1fr;gap:8px}\n#v3-drawer pre.v3-preview{white-space:pre-wrap;overflow:auto;max-height:260px;background:var(--bg-subtle,#f6f6f6);border-radius:8px;padding:10px;font-size:12px}\n#v3-feedback{min-height:20px;color:var(--text-muted,#666)}\n@media(max-width:600px){#v3-drawer{top:8px;right:8px;bottom:8px;width:calc(100vw - 16px)}#v3-toggle{bottom:14px;right:14px}}";
  document.head.appendChild(sheet);
  const toggle = document.createElement("button");
  toggle.id = "v3-toggle";
  toggle.textContent = "任务中心";
  toggle.setAttribute("aria-controls", "v3-drawer");
  toggle.setAttribute("aria-expanded", "false");
  const panel = document.createElement("aside");
  panel.id = "v3-drawer";
  panel.hidden = true;
  panel.setAttribute("aria-label", "持久任务管理");
  panel.innerHTML = [
    '<div class="v3-head"><h2>持久任务中心</h2><button type="button" id="v3-close">关闭</button></div>',
    '<p class="v3-muted" id="v3-context"></p>',
    '<form id="v3-schedule-form"><h3>创建计划任务</h3>',
    '<label>任务内容<input name="text" maxlength="1000" required placeholder="例如：检查 Pi 项目更新"></label>',
    '<div class="v3-duo"><label>多少分钟后开始<input name="minutesFromNow" type="number" min="0.25" max="525600" step="any" value="2" required></label>',
    '<label>每隔多少分钟重复（0 为单次）<input name="everyMinutes" type="number" min="0" max="525600" step="any" value="0" required></label></div>',
    '<button class="v3-primary" type="submit">创建任务</button></form>',
    '<form id="v3-background-form"><h3>交给后台子 Agent</h3>',
    '<textarea name="text" maxlength="4000" required placeholder="具体描述需要独立完成的工作"></textarea>',
    '<button class="v3-primary" type="submit">后台执行</button></form>',
    '<p id="v3-feedback" role="status" aria-live="polite"></p>',
    '<div class="v3-actions"><button id="v3-export">导出当前对话为 Markdown</button><button id="v3-refresh">刷新</button></div>',
    '<h3>计划任务</h3><div id="v3-schedules"></div>',
    '<h3>提醒</h3><div id="v3-reminders"></div>',
    '<h3>后台子 Agent</h3><div id="v3-background"></div>',
    '<h3>文件写入审批</h3><p class="v3-muted">仅批准可写工作区内的文件，绝不执行命令。审批前先查看完整内容。</p><div id="v3-approvals"></div>',
    '<h3>工作区文件</h3><div id="v3-files"></div>',
    '<p class="v3-muted">执行采用持久化检查点；周期按固定分钟间隔重复。修改与暂停不会自动清理旧的睡眠任务，但会阻止其过期触发。</p>',
  ].join("");
  document.body.append(toggle, panel);

  const $ = (id) => document.getElementById(id);
  let latestRefresh = 0;
  const currentId = () => {
    const id = location.hash.replace(/^#/, "");
    return /^\d+$/.test(id) ? id : null;
  };
  const base = () => "/api/conversations/" + currentId();
  const say = (msg) => { $("v3-feedback").textContent = msg; };
  const fmt = (time) => time == null ? "—" : new Date(time).toLocaleString();
  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  function addButton(target, label, callback) {
    const button = el("button", label);
    button.type = "button";
    button.addEventListener("click", callback);
    target.append(button);
  }
  async function request(path, body) {
    const res = await fetch(path, body === undefined ? {} : {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    let response;
    try { response = await res.json(); } catch { response = {}; }
    if (!res.ok) throw new Error(response.error || "HTTP " + res.status);
    return response;
  }
  async function run(action) {
    try { say("正在处理…"); await action(); say("操作完成"); await refresh(); }
    catch (e) { say("操作失败：" + e.message); }
  }
  async function refresh() {
    const sequence = ++latestRefresh;
    const id = currentId();
    $("v3-context").textContent = id ? "当前会话 #" + id : "请先在左侧选择一个会话";
    $("v3-schedule-form").querySelector("button[type=submit]").disabled = !id;
    $("v3-background-form").querySelector("button[type=submit]").disabled = !id;
    $("v3-export").disabled = !id;
    if (!id || panel.hidden) return;
    try {
      const [data, actionData, fileData] = await Promise.all([
        request("/api/conversations/" + id + "/management"),
        // 附加面板故障不能拖垮计划任务、提醒和子 Agent 管理。
        request("/api/foundation/actions").catch(() => ({ actions: [], unavailable: true })),
        request("/api/foundation/status").then(x => x.workspace.enabled ?
          request("/api/workspace/files") : { files: [] })
          .catch(() => ({ files: [], unavailable: true })),
      ]);
      if (sequence !== latestRefresh || currentId() !== id || panel.hidden) return;
      const schedules = $("v3-schedules"); schedules.replaceChildren();
      for (const item of data.schedules || []) {
        const row = el("div", "", "v3-row");
        row.append(el("p", item.text), el("span", item.status + " · 已执行 " + item.runs + " 次 · 下次 " + fmt(item.nextAt), "v3-muted"));
        const actions = el("div", "", "v3-actions");
        if (item.status === "active") addButton(actions, "暂停", () => run(() => request(base() + "/schedules/" + item.id + "/pause", {})));
        if (item.status === "paused") addButton(actions, "继续", () => run(() => request(base() + "/schedules/" + item.id + "/resume", {})));
        if (item.status === "active" || item.status === "paused") addButton(actions, "取消", () => run(() => request(base() + "/schedules/" + item.id + "/cancel", {})));
        row.append(actions); schedules.append(row);
      }
      if (!schedules.childElementCount) schedules.append(el("p", "暂无计划任务", "v3-muted"));

      const reminders = $("v3-reminders"); reminders.replaceChildren();
      for (const item of data.reminders || []) {
        const row = el("div", "", "v3-row");
        row.append(el("p", item.text), el("span", item.status + " · " + fmt(item.at), "v3-muted"));
        if (item.status === "scheduled") addButton(row, "取消提醒", () => run(() => request(base() + "/reminders/" + item.id + "/cancel", {})));
        reminders.append(row);
      }
      if (!reminders.childElementCount) reminders.append(el("p", "暂无提醒", "v3-muted"));

      const background = $("v3-background"); background.replaceChildren();
      for (const item of data.background || []) {
        const row = el("div", "", "v3-row");
        row.append(el("p", item.text), el("span", item.status, "v3-status"));
        if (item.result) row.append(el("p", item.result.slice(0, 350), "v3-muted"));
        const actions = el("div", "", "v3-actions");
        if (item.conversationId) addButton(actions, "查看对话", () => { location.hash = "#" + item.conversationId; });
        if (item.status === "running") addButton(actions, "停止", () => run(() => request(base() + "/background/" + item.id + "/stop", {})));
        row.append(actions); background.append(row);
      }
      if (!background.childElementCount) background.append(el("p", "暂无后台任务", "v3-muted"));

      const approvals = $("v3-approvals"); approvals.replaceChildren();
      for (const item of (actionData.actions || []).filter(x => x.state === "pending" || x.state === "failed").slice(-15).reverse()) {
        const row = el("div", "", "v3-row");
        row.append(el("p", item.name), el("p", item.bytes + " 字节 · " + (item.overwrite ? "请求覆盖" : "新增文件"), "v3-muted"));
        addButton(row, item.state === "failed" ? "查看失败并重试" : "查看内容并决定", async () => {
          try {
            const data = await request("/api/foundation/actions/" + item.id);
            const detail = data.action;
            const old = row.querySelector(".v3-preview"); if (old) old.remove();
            const preview = el("pre", detail.content, "v3-preview");
            row.append(preview);
            if (!row.querySelector(".v3-decision")) {
              const actions = el("div", "", "v3-actions v3-decision");
              if (detail.state === "failed") {
                addButton(actions, "重新执行原审批内容", () => {
                  if (!confirm("确认重试这份已批准的原始文件：" + detail.name + "？")) return;
                  run(() => request("/api/foundation/actions/" + item.id + "/retry", {}));
                });
              } else {
                addButton(actions, "批准写入", () => {
                  if (!confirm("确认将文件写入工作区：" + detail.name + "？")) return;
                  run(() => request("/api/foundation/actions/" + item.id + "/approve", {}));
                });
                addButton(actions, "拒绝", () => run(() => request("/api/foundation/actions/" + item.id + "/reject", {})));
              }
              row.append(actions);
            }
          } catch (e) { say("审批读取失败：" + e.message); }
        });
        approvals.append(row);
      }
      if (!approvals.childElementCount) approvals.append(el("p", actionData.unavailable ? "审批服务暂不可用，任务管理不受影响" : "暂无待审批或失败的写入", "v3-muted"));
      const files = $("v3-files"); files.replaceChildren();
      for (const name of (fileData.files || []).slice(0, 40)) {
        const row = el("div", "", "v3-row");
        row.append(el("span", name, "v3-muted"));
        addButton(row, "下载", () => {
          const a = document.createElement("a"); a.href = "/api/workspace/download?name=" + encodeURIComponent(name); a.click();
        });
        files.append(row);
      }
      if (!files.childElementCount) files.append(el("p", fileData.unavailable ? "文件服务暂不可用，任务管理不受影响" : "暂无工作区文件，或尚未启用工作区", "v3-muted"));
    } catch (e) { if (sequence === latestRefresh && currentId() === id && !panel.hidden) say("读取任务失败：" + e.message); }
  }
  function open(state) {
    panel.hidden = !state;
    toggle.setAttribute("aria-expanded", String(state));
    if (state) refresh();
  }
  toggle.addEventListener("click", () => open(panel.hidden));
  $("v3-close").addEventListener("click", () => open(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) open(false); });
  $("v3-schedule-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    run(() => request(base() + "/schedules", {
      ...data, minutesFromNow: Number(data.minutesFromNow),
      everyMinutes: Number(data.everyMinutes), requestId: crypto.randomUUID(),
    }));
  });
  $("v3-background-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    run(() => request(base() + "/background", {
      text: new FormData(form).get("text"), requestId: crypto.randomUUID(),
    }));
  });
  $("v3-export").addEventListener("click", () => {
    if (!currentId()) return;
    const a = document.createElement("a"); a.href = base() + "/export.md"; a.click();
  });
  $("v3-refresh").addEventListener("click", refresh);
  window.addEventListener("hashchange", refresh);
  window.setInterval(() => { if (!panel.hidden) refresh(); }, 5000);
})();
