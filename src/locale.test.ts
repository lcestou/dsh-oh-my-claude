import assert from "node:assert/strict";
import { bindServerLocale, serverIsChinese, serverText } from "./locale.js";
import { HEADER_MARK, formatToolCall, formatToolResult, resetClock } from "./translator.js";

// Unbound (a test, an older dsh): English, placeholders filled.
assert.equal(serverText("planApprove"), "Approve");
assert.equal(serverText("notLoggedIn"), "not logged in");
assert.ok(serverText("loggedOutError", { host: "nova" }).startsWith("not logged in on nova."));

// The stored preference decides; any zh tag counts, anything else and a throwing read are English.
const reader = (preference?: string) => ({ get: () => (preference ? { preference } : {}) });
assert.equal(serverIsChinese(reader("zh")), true);
assert.equal(serverIsChinese(reader("zh-CN")), true);
assert.equal(serverIsChinese(reader("en")), false);
assert.equal(serverIsChinese(reader()), false, "no stored pick");
assert.equal(
  serverIsChinese({
    get: () => {
      throw new Error("namespace not registered");
    },
  }),
  false,
);

// Bound to a Chinese pick: every string answers in Chinese, placeholders intact, and the disposer
// puts it back to English.
{
  const dispose = bindServerLocale(reader("zh"));
  assert.equal(serverText("planApprove"), "同意执行");
  const msg = serverText("loginFailure", { host: "nova", detail: "401" });
  assert.ok(msg.includes("nova") && msg.includes("401") && msg.includes("未登录"));
  dispose();
  assert.equal(serverText("planApprove"), "Approve");
}

// Tool headers: the words dsh translates on its own cards follow the stored language; Bash, Grep and
// Glob stay English as dsh keeps them. The glyph and HEADER_MARK the client folds on never change.
{
  const dispose = bindServerLocale(reader("zh"));
  const read = formatToolCall("read", JSON.stringify({ file_path: "/tmp/a.txt" }));
  assert.ok(read.startsWith(`▤${HEADER_MARK} 读取`), "Read is 读取, glyph and mark intact");
  assert.ok(
    formatToolCall("bash", JSON.stringify({ command: "ls" })).startsWith(`❯${HEADER_MARK} Bash`),
  );
  assert.ok(
    formatToolCall("grep", JSON.stringify({ pattern: "x" })).startsWith(`⌕${HEADER_MARK} Grep`),
  );
  assert.ok(
    formatToolResult("read", "/tmp/a.txt", "hi", false).startsWith(`▤${HEADER_MARK} 读取 · 输出`),
  );
  assert.ok(formatToolResult("bash", "", "boom", true).includes("Bash · 失败"));
  dispose();
  assert.ok(
    formatToolCall("read", "{}").startsWith(`▤${HEADER_MARK} Read`),
    "English when unbound",
  );
}

// Reset times in the limit lines read the Chinese way when the stored language is Chinese.
{
  const at = Date.parse("2026-09-24T15:00:00Z");
  const dispose = bindServerLocale(reader("zh"));
  const zh = resetClock(at, "UTC");
  dispose();
  const en = resetClock(at, "UTC");
  assert.ok(/周|月/.test(zh) || /\d{1,2}:\d{2}/.test(zh), `Chinese clock: ${zh}`);
  assert.ok(!/[ap]m/.test(zh), "no am/pm in Chinese");
  assert.ok(/[ap]m/.test(en), `English keeps am/pm: ${en}`);
}
