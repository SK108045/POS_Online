const fs = require("node:fs/promises");
const path = require("node:path");
const BACKUP_DIR = path.resolve(process.env.POS_BACKUP_DIR || path.join(__dirname, "../backups"));
const day = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
function validate(data) {
  if (
    !data ||
    data.format !== "oraforge-pos-backup" ||
    data.version !== 1 ||
    !Array.isArray(data.records) ||
    !data.records.length ||
    !data.preferences ||
    typeof data.preferences !== "object" ||
    Array.isArray(data.preferences)
  )
    throw Error("Invalid backup format");
  const keys = new Set();
  for (const row of data.records) {
    if (
      !Array.isArray(row) ||
      row.length !== 2 ||
      typeof row[0] !== "string" ||
      !/^(shop:|oraforge:)/.test(row[0]) ||
      keys.has(row[0])
    )
      throw Error("Invalid backup records");
    keys.add(row[0]);
  }
}
function createStore(directory = BACKUP_DIR, clock = () => new Date()) {
  let pending = Promise.resolve();
  async function latest() {
    try {
      const data = JSON.parse(await fs.readFile(path.join(directory, "latest.json"), "utf8"));
      validate(data);
      return data;
    } catch (err) {
      if (err.code === "ENOENT" || err instanceof SyntaxError || err.message.startsWith("Invalid backup")) return null;
      throw err;
    }
  }
  async function status() {
    const data = await latest();
    return { due: !data || clock().getTime() - Date.parse(data.created_at) >= 60000,
      last_backup: data?.created_at || null, folder: "backups", file: data ? "latest.json" : null };
  }
  async function atomicWrite(name, contents) {
    const file = path.join(directory, name), temp = file + ".tmp";
    try {
      await fs.writeFile(temp, contents, { mode: 0o600 });
      await fs.rename(temp, file);
    } finally { await fs.unlink(temp).catch(() => {}); }
  }
  function save(data) {
    const job = pending.then(async () => {
      validate(data);
      const previous = await latest(), now = clock();
      const same = previous && JSON.stringify(previous.records) === JSON.stringify(data.records)
        && JSON.stringify(previous.preferences) === JSON.stringify(data.preferences);
      if (same && day(new Date(previous.created_at)) === day(now)) return status();
      await fs.mkdir(directory, { recursive: true });
      const contents = JSON.stringify({ ...data, created_at: now.toISOString() });
      // Keep the latest snapshot, each day's closing snapshot, and 60 recent versions.
      const stamp = now.toISOString().replace(/[:.]/g, "-");
      await atomicWrite(`auto-${stamp}.json`, contents);
      await atomicWrite(`daily-${day(now)}.json`, contents);
      await atomicWrite("latest.json", contents);
      const versions = (await fs.readdir(directory)).filter(n => /^auto-\d{4}-\d{2}-\d{2}T[\d-]+Z\.json$/.test(n)).sort();
      await Promise.all(versions.slice(0, -60).map(n => fs.unlink(path.join(directory, n))));
      return status();
    });
    pending = job.catch(() => {});
    return job;
  }
  return { status, save };
}
const store = createStore();
async function handle(req, res) {
  const send = (code, data) => {
    res.writeHead(code, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(data));
  };
  // Backups belong to this computer; neither remote clients nor foreign pages may write them.
  const remote = req.socket.remoteAddress;
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote))
    return send(403, { error: "PC local access only" });
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)
    return send(403, { error: "Same-origin access required" });
  try {
    if (req.method === "GET") return send(200, await store.status());
    if (req.method !== "POST")
      return send(405, { error: "Method not allowed" });
    if (!String(req.headers["content-type"]).startsWith("application/json"))
      return send(415, { error: "JSON required" });
    let size = 0,
      chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 100 * 1024 * 1024)
        return send(413, { error: "Backup exceeds 100 MB" });
      chunks.push(chunk);
    }
    let data;
    try {
      data = JSON.parse(Buffer.concat(chunks).toString());
      validate(data);
    } catch (err) {
      return send(400, { error: err.message });
    }
    return send(200, await store.save(data));
  } catch (err) {
    console.error("[Backup]", err.message);
    send(500, {
      error:
        "Could not save automatic backup. Check project folder permissions and free disk space.",
    });
  }
}
module.exports = { handle, createStore, day };
