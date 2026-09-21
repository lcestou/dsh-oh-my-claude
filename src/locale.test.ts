import assert from "node:assert/strict";
import { bindServerLocale, serverIsChinese, serverText } from "./locale.js";

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
