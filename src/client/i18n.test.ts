import assert from "node:assert/strict";
import { EN, ZH, fill, t } from "./i18n.js";

// Every key has a Chinese string, none empty, and both languages use the same placeholders, so a
// switch never shows a raw key or drops a value.
{
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).toSorted();
  for (const key of Object.keys(EN) as (keyof typeof EN)[]) {
    assert.ok(ZH[key]?.trim(), `zh missing ${key}`);
    assert.ok(EN[key].trim(), `en empty ${key}`);
    assert.deepEqual(placeholders(ZH[key]), placeholders(EN[key]), `placeholders differ: ${key}`);
  }
  assert.deepEqual(Object.keys(ZH).toSorted(), Object.keys(EN).toSorted(), "no extra zh keys");
}

// Without dsh's locale service `t` answers in English and fills placeholders.
{
  assert.equal(t("common.copy"), "Copy");
  assert.equal(fill("{n} left of {max}", { n: 3, max: 5 }), "3 left of 5");
  assert.equal(fill("{n} left", {}), "{n} left", "a missing value stays visible");
  assert.equal(fill("no params"), "no params");
}
