(() => {
  const pref = (k) =>
    /^pos_active_/.test(k) || ["pos_theme", "pos_employee_id"].includes(k);
  async function snapshot() {
    await window.OraforgeDBReady;
    const records = new Map(await window.OraforgeDB.exportRecords()),
      preferences = {};
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("fallback_") && !records.has(k.slice(9)))
        records.set(k.slice(9), JSON.parse(localStorage.getItem(k)));
      if (pref(k)) preferences[k] = localStorage.getItem(k);
    }
    return {
      format: "oraforge-pos-backup",
      version: 1,
      created_at: new Date().toISOString(),
      records: [...records],
      preferences,
    };
  }
  function validate(d) {
    if (
      !d ||
      d.format !== "oraforge-pos-backup" ||
      d.version !== 1 ||
      !Array.isArray(d.records) ||
      !d.records.length ||
      !d.preferences ||
      typeof d.preferences !== "object" ||
      Array.isArray(d.preferences)
    )
      throw Error("Not a supported POS backup.");
    const keys = new Set();
    for (const r of d.records) {
      if (
        !Array.isArray(r) ||
        r.length !== 2 ||
        typeof r[0] !== "string" ||
        !/^(shop:|oraforge:)/.test(r[0]) ||
        keys.has(r[0])
      )
        throw Error("Invalid or duplicate backup records.");
      if (
        /:(orders|items|customers|shifts|categories)$/.test(r[0]) &&
        !Array.isArray(r[1])
      )
        throw Error("Invalid backup collection.");
      keys.add(r[0]);
    }
    for (const [k, v] of Object.entries(d.preferences))
      if (!pref(k) || typeof v !== "string")
        throw Error("Invalid backup preferences.");
    return d;
  }
  function download(d, prefix = "oraforge-backup") {
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(d)], { type: "application/json" }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = `${prefix}-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function backupUI(root) {
    const panel = document.createElement("section");
    panel.style =
      "padding:24px;background:var(--panel);border:1px solid var(--line);border-radius:12px";
    panel.innerHTML =
      '<h2>Backup & restore</h2><p data-auto-backup-status></p><p>Download all local shops, sales, products, customers, invoices and settings. Keep a copy on a USB drive. Separate image files and API key files are not included; retain your application uploads folder separately.</p><button class="primary" data-export>Download backup</button><p><label>Restore backup <input type="file" accept=".json,application/json" data-import style="max-width:100%"></label></p><p role="status" data-feedback></p>';
    root.append(panel);
    window.OraforgeAutoBackup?.show();
    const feedback = panel.querySelector("[data-feedback]");
    panel.querySelector("[data-export]").onclick = async (e) => {
      e.target.disabled = true;
      try {
        const d = validate(await snapshot());
        download(d);
        feedback.textContent =
          "Backup download requested. Keep the downloaded file safe.";
      } catch (err) {
        feedback.textContent = err.message;
      } finally {
        e.target.disabled = false;
      }
    };
    panel.querySelector("[data-import]").onchange = async (e) => {
      const input = e.target,
        file = input.files[0];
      if (!file) return;
      try {
        if (file.size > 100 * 1024 * 1024)
          throw Error("Backup exceeds 100 MB.");
        const d = validate(JSON.parse(await file.text()));
        if (
          !confirm(
            `Restore backup from ${d.created_at || "unknown date"}? ALL local shop data will be replaced. Close other POS tabs first. A safety backup will download before replacement.`,
          )
        )
          return;
        input.disabled = true;
        const previous = await snapshot(),
          oldLocal = { ...localStorage };
        download(previous, "oraforge-before-restore");
        try {
          await window.OraforgeDB.replaceRecords(d.records);
          for (const k of Object.keys(localStorage))
            if (k.startsWith("fallback_") || pref(k))
              localStorage.removeItem(k);
          for (const [k, v] of Object.entries(d.preferences))
            localStorage.setItem(k, v);
        } catch (err) {
          await window.OraforgeDB.replaceRecords(previous.records);
          for (const k of Object.keys(localStorage))
            if (k.startsWith("fallback_") || pref(k))
              localStorage.removeItem(k);
          for (const [k, v] of Object.entries(oldLocal))
            if (k.startsWith("fallback_") || pref(k))
              localStorage.setItem(k, v);
          throw err;
        }
        localStorage.removeItem("pos_logged_in");
        sessionStorage.clear();
        location.href = "/pos";
      } catch (err) {
        feedback.textContent = "Restore failed: " + err.message;
      } finally {
        input.disabled = false;
        input.value = "";
      }
    };
  }
  window.OraforgeOperations = { backupUI, snapshot, validate };
})();
