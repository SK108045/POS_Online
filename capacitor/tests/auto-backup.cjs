const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createStore } = require("../auto-backup");
const data = {
  format: "oraforge-pos-backup",
  version: 1,
  records: [["shop:test:settings", { business_name: "Test" }]],
  preferences: {},
};
test("daily backup survives restart, skips duplicates and catches up next day", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pos-backup-"));
  let now = new Date(2026, 8, 27, 12);
  const clock = () => now;
  try {
    const store = createStore(dir, clock);
    assert.equal((await store.status()).due, true);
    await Promise.all([store.save(data), store.save(data)]);
    assert.deepEqual(await fs.readdir(dir), ["daily-2026-09-27.json"]);
    assert.equal((await createStore(dir, clock).status()).due, false);
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(dir, "daily-2026-09-27.json")))
        .records,
      data.records,
    );
    now = new Date(2026, 8, 29, 9);
    assert.equal((await store.status()).due, true);
    await store.save(data);
    assert.equal((await fs.readdir(dir)).length, 2);
    assert.equal((await store.status()).due, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("invalid backup is rejected without recording success", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pos-backup-"));
  try {
    const store = createStore(dir);
    await assert.rejects(store.save({ ...data, records: [] }));
    assert.equal((await store.status()).due, true);
    assert.deepEqual(await fs.readdir(dir), []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
