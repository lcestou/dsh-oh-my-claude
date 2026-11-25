import assert from "node:assert/strict";
import { isWebUrl } from "./web-url.js";

// Only http(s) pages pass; script, data and file links and plain text do not.
for (const u of ["https://x.example/a?b=1", "http://127.0.0.1:3080/cb", "HTTPS://X.EXAMPLE"])
  assert.equal(isWebUrl(u), true, u);
for (const u of [
  "javascript:alert(1)",
  " javascript:alert(1)",
  "data:text/html,x",
  "file:///etc/passwd",
  "",
  "not a url",
  "//x.example",
])
  assert.equal(isWebUrl(u), false, u);
console.log("web-url ok");
