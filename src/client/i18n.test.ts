import assert from "node:assert/strict";
import { EN, ZH, fill, t } from "./i18n.js";
import * as dshCommon from "./i18n/dsh-common.js";

// Every key has a Chinese string, none empty, and both languages use the same placeholders, so a
// switch never shows a raw key or drops a value.
{
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).toSorted();
  const borrowed = new Set(Object.keys(dshCommon.en));
  for (const key of Object.keys(ZH) as (keyof typeof ZH)[]) {
    assert.ok(ZH[key]?.trim(), `zh missing ${key}`);
    assert.ok(EN[key].trim(), `en empty ${key}`);
    assert.deepEqual(placeholders(ZH[key]), placeholders(EN[key]), `placeholders differ: ${key}`);
  }
  assert.deepEqual(
    Object.keys(ZH).toSorted(),
    Object.keys(EN)
      .filter((k) => !borrowed.has(k))
      .toSorted(),
    "every key the plugin owns has Chinese, and none of dsh's common words is registered as ours",
  );
}

// Without dsh's locale service `t` answers in English and fills placeholders.
{
  assert.equal(
    t("copy"),
    "Copy",
    "a borrowed dsh word answers in English without the locale service",
  );
  assert.equal(fill("{n} left of {max}", { n: 3, max: 5 }), "3 left of 5");
  assert.equal(fill("{n} left", {}), "{n} left", "a missing value stays visible");
  assert.equal(fill("no params"), "no params");
}
