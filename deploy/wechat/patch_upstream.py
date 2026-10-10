"""固定上游 commit 的最小源代码补丁：可靠推进游标 + 二维码 POST。
严格匹配源码片段；上游变化时构建必须失败，禁止静默生成不兼容镜像。
"""
from pathlib import Path
import sys

root = Path(sys.argv[1])


def replace_once(path, before, after):
    file = root / path
    src = file.read_text()
    count = src.count(before)
    if count != 1:
        raise SystemExit(f"{path}: expected one patch location, found {count}")
    file.write_text(src.replace(before, after, 1))


replace_once("internal/ilink/login.go",
    'http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)',
    'http.NewRequestWithContext(ctx, http.MethodPost, reqURL, strings.NewReader(`{"local_token_list":[]}`))')
replace_once("internal/ilink/login.go",
    'AddAppHeaders(req, "")\n\n\tresp, err := l.http().Do(req)',
    'AddAppHeaders(req, "")\n\treq.Header.Set("Content-Type", "application/json")\n\n\tresp, err := l.http().Do(req)')

# 只有入站 Webhook 获得成功响应，才推进 getupdates cursor。
# 若请求失败，重放批次由 Pi Durable 通过 requestId 去重。
replace_once("internal/bridge/poller.go",
    '''\t\tif resp.GetUpdatesBuf != "" {
\t\t\tcursor = resp.GetUpdatesBuf
\t\t\tif err := p.Store.SaveCursor(cursor); err != nil {
\t\t\t\tlog.Error("save cursor", "err", err)
\t\t\t}
\t\t}

''', '')
replace_once("internal/bridge/poller.go",
    '''\t\tfor _, msg := range resp.Msgs {
\t\t\tp.handleMessage(ctx, msg)
\t\t}
''',
    '''\t\tdelivered := true
\t\tfor _, msg := range resp.Msgs {
\t\t\tif err := p.handleMessage(ctx, msg); err != nil {
\t\t\t\tlog.Error("webhook delivery failed; cursor unchanged", "err", err)
\t\t\t\tdelivered = false
\t\t\t\tbreak
\t\t\t}
\t\t}
\t\tif !delivered {
\t\t\tselect {
\t\t\tcase <-time.After(p.retry()):
\t\t\tcase <-ctx.Done():
\t\t\t\treturn
\t\t\t}
\t\t\tcontinue
\t\t}
\t\tif resp.GetUpdatesBuf != "" {
\t\t\tif err := p.Store.SaveCursor(resp.GetUpdatesBuf); err != nil {
\t\t\t\tlog.Error("save cursor", "err", err)
\t\t\t\tcontinue
\t\t\t}
\t\t\tcursor = resp.GetUpdatesBuf
\t\t}
''')
replace_once("internal/bridge/poller.go",
    '''\t\tdelivered := true
''',
    '''\t\tif resp.Ret != 0 || resp.ErrCode != 0 {
\t\t\tlog.Warn("iLink business error; cursor unchanged", "ret", resp.Ret, "errcode", resp.ErrCode)
\t\t\tselect {
\t\t\tcase <-time.After(p.retry()):
\t\t\tcase <-ctx.Done():
\t\t\t\treturn
\t\t\t}
\t\t\tcontinue
\t\t}
\t\tdelivered := true
''')
replace_once("internal/bridge/poller.go",
    'func (p *Poller) handleMessage(ctx context.Context, msg ilink.IncomingMessage) {',
    'func (p *Poller) handleMessage(ctx context.Context, msg ilink.IncomingMessage) error {')
before = '''\tif !allowed {
\t\tlog.Info("unallowed sender")
\t\tif !p.ForwardUnallowed {
\t\t\treturn
\t\t}
\t}
'''
after = before.replace('\t\t\treturn\n', '\t\t\treturn nil\n')
replace_once("internal/bridge/poller.go", before, after)
replace_once("internal/bridge/poller.go",
    '''\tpayload, err := p.buildPayload(ctx, msg)
\tif err != nil {
\t\tlog.Error("build payload", "err", err)
\t\treturn
\t}

\tif p.Webhook == nil || p.Webhook.Webhook.URL == "" {
\t\tlog.Warn("webhook url empty, dropping message")
\t\treturn
\t}
\tif err := p.Webhook.Post(ctx, payload); err != nil {
\t\tlog.Error("webhook post", "err", err)
\t}
''',
    '''\tpayload, err := p.buildPayload(ctx, msg)
\tif err != nil {
\t\treturn err
\t}
\tif p.Webhook == nil || p.Webhook.Webhook.URL == "" {
\t\treturn fmt.Errorf("webhook url missing")
\t}
\treturn p.Webhook.Post(ctx, payload)
''')
print("wx-bot compatibility and cursor patch applied")
