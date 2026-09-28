const fs = require("node:fs/promises");
const path = require("node:path");
const BACKUP_DIR = path.resolve(__dirname, "../backups");
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
  async function status() {
    let files;
    try {
      files = (await fs.readdir(directory))
        .filter((n) => /^daily-\d{4}-\d{2}-\d{2}\.json$/.test(n))
        .sort();
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      files = [];
    }
    const latest = files.at(-1);
    return {
      due: !files.includes(`daily-${day(clock())}.json`),
      last_backup: latest
        ? (await fs.stat(path.join(directory, latest))).mtime.toISOString()
        : null,
      folder: "backups",
      file: latest || null,
    };
  }
  function save(data) {
    const job = pending.then(async () => {
      validate(data);
      if (!(await status()).due) return status();
      await fs.mkdir(directory, { recursive: true });
      const file = path.join(directory, `daily-${day(clock())}.json`),
        temp = file + ".tmp";
      try {
        await fs.writeFile(
          temp,
          JSON.stringify({ ...data, created_at: clock().toISOString() }),
          { mode: 0o600 },
        );
        await fs.rename(temp, file);
      } finally {
        await fs.unlink(temp).catch(() => {});
      }
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
