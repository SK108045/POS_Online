const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const ctx = { window: {} };
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "../www/shop-operations.js"), "utf8"),
  ctx,
);
const ops = ctx.window.OraforgeOperations;
test("backup rejects foreign versions, duplicates and malformed collections", () => {
  const d = {
    format: "oraforge-pos-backup",
    version: 1,
    records: [["shop:a:orders", []]],
    preferences: { pos_active_shop_id: "a" },
  };
  assert.equal(ops.validate(d), d);
  assert.throws(() => ops.validate({ ...d, version: 2 }));
  assert.throws(() =>
    ops.validate({ ...d, records: [...d.records, ...d.records] }),
  );
  assert.throws(() => ops.validate({ ...d, records: [["shop:a:orders", {}]] }));
  assert.throws(() =>
    ops.validate({ ...d, preferences: { pos_logged_in: "true" } }),
  );
});
