import test from "node:test";
import assert from "node:assert/strict";
import { inboundKey, validateInbound, newAssistantReplies } from "../lib/wechat.mjs";

test("微信入站验证与幂等键", () => {
  const input = { binding: "primary", from_wxid: "wxid_abc", message_id: "1234", text: "你好" };
  const a = validateInbound(input);
  assert.equal(a.message, "你好");
  assert.equal(a.requestId, validateInbound({ ...input, text: "另一条重试内容" }).requestId);
  assert.notEqual(a.requestId, validateInbound({ ...input, message_id: "1235" }).requestId);
  assert.notEqual(inboundKey("one", "same"), inboundKey("two", "same"));
  assert.throws(() => validateInbound({ ...input, message_id: "../../a" }), /message_id/);
  assert.throws(() => validateInbound({ ...input, binding: "../bad" }), /binding/);
  assert.throws(() => validateInbound({ ...input, from_wxid: "" }), /from_wxid/);
  assert.throws(() => validateInbound(null), /对象/);
  assert.equal(validateInbound({ binding: "primary", from_wxid: "u", message_id: "9" }).ignored, true);
});

test("语音转写和附件降级不假装能读取媒体", () => {
  const v = validateInbound({ binding: "primary", from_wxid: "u", message_id: "1",
    voice_text: "帮我整理会议", media: [{ type: "image", path: "/private/a.png" }] });
  assert.match(v.message, /帮我整理会议/);
  assert.match(v.message, /尚不能查看附件内容/);
  assert.doesNotMatch(v.message, /private/);
});

test("仅发送已提交的助手纯文本回复，忽略工具调用与历史", () => {
  const entries = [
    { id: 1, kind: "pi.user", model: [{ content: "hello" }] },
    { id: 2, kind: "pi.assistant", model: [{ content: [{ type: "toolCall", name: "wait_seconds" }] }] },
    { id: 3, kind: "pi.tool-result", model: [{ content: [] }] },
    { id: 4, kind: "pi.assistant", model: [{ content: [{ type: "text", text: "完成" }] }] },
  ];
  assert.deepEqual(newAssistantReplies(entries, 3).replies, [{ id: 4, text: "完成" }]);
  assert.deepEqual(newAssistantReplies(entries, 4).replies, []);
  assert.equal(newAssistantReplies(entries, 4).cursor, 4);
  assert.deepEqual(newAssistantReplies(entries, 999).replies, []);
});
