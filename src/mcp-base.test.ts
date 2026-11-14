import assert from "node:assert/strict";
import { webServerBase } from "./mcp.js";

// Bound to every interface: loopback answers.
assert.equal(webServerBase({ port: 3080 }), "http://127.0.0.1:3080");
assert.equal(webServerBase({ port: 3080, host: "0.0.0.0" }), "http://127.0.0.1:3080");
assert.equal(webServerBase({ port: 3080, host: "::" }), "http://127.0.0.1:3080");
// Bound to one address (dsh web --host): only that address answers.
assert.equal(webServerBase({ port: 3080, host: "172.25.0.3" }), "http://172.25.0.3:3080");
assert.equal(webServerBase({ port: 3080, host: "127.0.0.1" }), "http://127.0.0.1:3080");
assert.equal(webServerBase({ port: 3080, host: "fd00::3" }), "http://[fd00::3]:3080");
console.log("mcp-base ok");
