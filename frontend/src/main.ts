import { listen } from "@tauri-apps/api/event";
import { getAllWindows, getCurrentWindow } from "@tauri-apps/api/window";
import { ask, open as openDialog } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { ipc, type ArtifactHit, type CleanupProgress, type ScanReport, type UpdaterProgress } from "./ipc";
import { readCleanPrefs, readSettings, writeCleanPrefs, writeSettings, type CleanPrefs } from "./store";
import "./style.css";

const app = document.querySelector<HTMLElement>("#app")!;
if (!app) throw new Error("Missing #app root");

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[char] ?? char);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function readPrefsFromForm(): CleanPrefs {
  return {
    root: document.querySelector<HTMLInputElement>("#clean-root")?.value.trim() ?? "",
    target: document.querySelector<HTMLInputElement>("#opt-target")?.checked ?? false,
    nodeModules: document.querySelector<HTMLInputElement>("#opt-node-modules")?.checked ?? false,
    dist: document.querySelector<HTMLInputElement>("#opt-dist")?.checked ?? false,
    build: document.querySelector<HTMLInputElement>("#opt-build")?.checked ?? false,
    next: document.querySelector<HTMLInputElement>("#opt-next")?.checked ?? false,
    output: document.querySelector<HTMLInputElement>("#opt-output")?.checked ?? false,
    nuxt: document.querySelector<HTMLInputElement>("#opt-nuxt")?.checked ?? false,
    turbo: document.querySelector<HTMLInputElement>("#opt-turbo")?.checked ?? false,
    vite: document.querySelector<HTMLInputElement>("#opt-vite")?.checked ?? false,
  };
}

function renderResultRows(items: ArtifactHit[]): string {
  if (!items.length) {
    return `<p class="muted empty-state">No matching build folders found.</p>`;
  }
  return `
    <div class="result-table" role="table">
      <div class="result-row head" role="row">
        <span>Kind</span><span>Size</span><span>Path</span>
      </div>
      ${items
        .map(
          (item, index) => `
        <label class="result-row" role="row">
          <span class="kind">${escapeHtml(item.kind)}</span>
          <span class="size">${formatBytes(item.bytes)}</span>
          <span class="path" title="${escapeHtml(item.path)}">
            <input type="checkbox" class="hit-check" data-index="${index}" checked />
            ${escapeHtml(item.path)}
          </span>
        </label>`,
        )
        .join("")}
    </div>`;
}

async function renderWorkspace(): Promise<void> {
  const settings = await readSettings();
  await getCurrentWindow().setAlwaysOnTop(settings.alwaysOnTop);
  const fallbackRoot = await ipc.defaultCleanupRoot().catch(() => "~/dev/arcane");
  const prefs = await readCleanPrefs(fallbackRoot);
  let lastReport: ScanReport | null = null;

  app.innerHTML = `
    <section class="workspace-shell">
      <header class="titlebar" data-tauri-drag-region>
        <div><span class="brand-dot"></span><strong>ARCANE CLEANUP</strong></div>
        <nav>
          <button class="ghost" id="settings-button">Settings</button>
        </nav>
      </header>
      <div class="workspace clean-workspace">
        <p class="eyebrow">LOCAL DISK</p>
        <h1>Scan &amp; reclaim space.</h1>
        <p class="muted">Find rebuildable folders under a root path, review sizes, then delete what you choose.</p>

        <div class="clean-panel">
          <div class="root-row">
            <label class="root-field">
              <span>Root folder</span>
              <input id="clean-root" type="text" value="${escapeHtml(prefs.root)}" spellcheck="false" />
            </label>
            <button class="ghost" id="browse-root" type="button">Browse</button>
          </div>

          <div class="option-grid">
            <label><input id="opt-target" type="checkbox" ${prefs.target ? "checked" : ""} /> target</label>
            <label><input id="opt-node-modules" type="checkbox" ${prefs.nodeModules ? "checked" : ""} /> node_modules</label>
            <label><input id="opt-dist" type="checkbox" ${prefs.dist ? "checked" : ""} /> dist</label>
            <label><input id="opt-build" type="checkbox" ${prefs.build ? "checked" : ""} /> build</label>
            <label><input id="opt-next" type="checkbox" ${prefs.next ? "checked" : ""} /> .next</label>
            <label><input id="opt-output" type="checkbox" ${prefs.output ? "checked" : ""} /> .output</label>
            <label><input id="opt-nuxt" type="checkbox" ${prefs.nuxt ? "checked" : ""} /> .nuxt</label>
            <label><input id="opt-turbo" type="checkbox" ${prefs.turbo ? "checked" : ""} /> .turbo</label>
            <label><input id="opt-vite" type="checkbox" ${prefs.vite ? "checked" : ""} /> .vite</label>
          </div>

          <div class="clean-actions">
            <button id="scan-button" type="button">Scan</button>
            <button class="danger" id="delete-button" type="button" disabled>Delete selected</button>
            <p class="summary" id="scan-summary">Scan to see reclaimable space.</p>
          </div>
          <p class="error" id="clean-error" role="status"></p>
          <div id="scan-results"></div>
        </div>
      </div>
    </section>`;

  const errorEl = document.querySelector<HTMLElement>("#clean-error")!;
  const summaryEl = document.querySelector<HTMLElement>("#scan-summary")!;
  const resultsEl = document.querySelector<HTMLElement>("#scan-results")!;
  const scanButton = document.querySelector<HTMLButtonElement>("#scan-button")!;
  const deleteButton = document.querySelector<HTMLButtonElement>("#delete-button")!;

  const persistPrefs = () => void writeCleanPrefs(readPrefsFromForm());
  document.querySelectorAll("#clean-root, .option-grid input").forEach((el) => {
    el.addEventListener("change", persistPrefs);
    el.addEventListener("blur", persistPrefs);
  });

  document.querySelector("#settings-button")?.addEventListener("click", () => void ipc.openSettings());

  document.querySelector("#browse-root")?.addEventListener("click", () => {
    const rootInput = document.querySelector<HTMLInputElement>("#clean-root")!;
    errorEl.textContent = "";
    void openDialog({
      directory: true,
      multiple: false,
      defaultPath: rootInput.value.trim() || undefined,
      title: "Choose cleanup root",
    })
      .then((selected) => {
        if (typeof selected !== "string" || !selected) return;
        rootInput.value = selected;
        void writeCleanPrefs(readPrefsFromForm());
      })
      .catch((reason: unknown) => {
        errorEl.textContent = reason instanceof Error ? reason.message : String(reason);
      });
  });

  const selectedItems = (): ArtifactHit[] => {
    if (!lastReport) return [];
    return [...document.querySelectorAll<HTMLInputElement>(".hit-check:checked")]
      .map((input) => Number(input.dataset.index))
      .filter((index) => Number.isInteger(index) && index >= 0 && index < lastReport!.items.length)
      .map((index) => lastReport!.items[index]!);
  };

  const refreshDeleteState = () => {
    deleteButton.disabled = selectedItems().length === 0;
  };

  scanButton.addEventListener("click", () => {
    const options = readPrefsFromForm();
    errorEl.textContent = "";
    scanButton.disabled = true;
    deleteButton.disabled = true;
    summaryEl.textContent = "Scanning…";
    resultsEl.innerHTML = "";
    void writeCleanPrefs(options);
    void ipc
      .scanCleanupTargets(options)
      .then((report) => {
        lastReport = report;
        summaryEl.textContent = `${report.items.length} folders · ${formatBytes(report.totalBytes)} reclaimable under ${report.root}`;
        resultsEl.innerHTML = renderResultRows(report.items);
        resultsEl.querySelectorAll(".hit-check").forEach((input) => input.addEventListener("change", refreshDeleteState));
        refreshDeleteState();
      })
      .catch((reason: unknown) => {
        errorEl.textContent = reason instanceof Error ? reason.message : String(reason);
        summaryEl.textContent = "Scan failed.";
      })
      .finally(() => {
        scanButton.disabled = false;
      });
  });

  deleteButton.addEventListener("click", () => {
    void (async () => {
      const items = selectedItems();
      if (!items.length || !lastReport) {
        errorEl.textContent = "Nothing selected to delete. Run Scan and keep at least one row checked.";
        return;
      }
      const paths = items.map((item) => item.path);
      const selectedBytes = items.reduce((sum, item) => sum + item.bytes, 0);
      let ok = false;
      try {
        ok = await ask(
          `Delete ${paths.length} folder(s) (~${formatBytes(selectedBytes)})?\n\nThis cannot be undone. Rebuild/reinstall will recreate them.`,
          { title: "Confirm delete", kind: "warning" },
        );
      } catch (reason: unknown) {
        errorEl.textContent = `Confirm dialog failed: ${reason instanceof Error ? reason.message : String(reason)}`;
        return;
      }
      if (!ok) {
        summaryEl.textContent = "Delete cancelled.";
        return;
      }

      errorEl.textContent = "";
      deleteButton.disabled = true;
      scanButton.disabled = true;
      summaryEl.textContent = `Deleting 0/${items.length}… large folders can take a few minutes.`;
      console.info("[arcane-cleanup] delete start", { count: items.length, bytes: selectedBytes });

      const unlisten = await listen<CleanupProgress>("cleanup-progress", (event) => {
        summaryEl.textContent = event.payload.message;
        console.info("[arcane-cleanup]", event.payload);
      });

      const root = lastReport.root;
      try {
        const report = await ipc.deleteCleanupTargets(
          root,
          items.map((item) => ({ path: item.path, bytes: item.bytes })),
        );
        console.info("[arcane-cleanup] delete done", report);
        const failNote = report.failed.length ? ` · ${report.failed.length} failed` : "";
        summaryEl.textContent = `Removed ${report.removed.length} · freed ${formatBytes(report.freedBytes)}${failNote}`;
        if (report.failed.length) {
          errorEl.textContent = report.failed.slice(0, 5).join(" · ");
        }
        scanButton.click();
      } catch (reason: unknown) {
        console.error("[arcane-cleanup] delete failed", reason);
        errorEl.textContent = reason instanceof Error ? reason.message : String(reason);
        summaryEl.textContent = "Delete failed.";
        deleteButton.disabled = false;
        scanButton.disabled = false;
      } finally {
        unlisten();
      }
    })();
  });
}

async function renderSettings(): Promise<void> {
  const settings = await readSettings();
  app.innerHTML = `
    <section class="settings-shell">
      <p class="eyebrow">ARCANE CLEANUP</p>
      <h1>Settings</h1>
      <label class="setting-row"><span><strong>Always on top</strong><small>Keep Cleanup above other windows.</small></span><input id="always-on-top" type="checkbox" ${settings.alwaysOnTop ? "checked" : ""} /></label>
      <label class="setting-row"><span><strong>Compact interface</strong><small>Reserve space for a denser future workspace.</small></span><input id="compact-mode" type="checkbox" ${settings.compactMode ? "checked" : ""} /></label>
      <label class="setting-row"><span><strong>Start on boot</strong><small>Open automatically when you sign in to your computer.</small></span><input id="start-on-boot" type="checkbox" disabled /></label>
      <p class="muted">Closing the main window keeps the app running in the tray. Use the tray menu to reopen it or quit.</p>
      <p class="error" id="startup-error" role="status"></p>
      <div class="settings-actions"><button class="danger" id="reset-button">Reset local data</button><button id="close-button">Done</button></div>
    </section>`;

  const startup = document.querySelector<HTMLInputElement>("#start-on-boot")!;
  const startupError = document.querySelector<HTMLElement>("#startup-error")!;
  try {
    startup.checked = await ipc.getStartOnBoot();
    startup.disabled = false;
  } catch (error) {
    startupError.textContent = `Could not read startup setting: ${String(error)}`;
  }
  startup.addEventListener("change", () => {
    const enabled = startup.checked;
    startup.disabled = true;
    startupError.textContent = "";
    void ipc.setStartOnBoot(enabled).catch((error: unknown) => {
      startup.checked = !enabled;
      startupError.textContent = `Could not update startup setting: ${String(error)}`;
    }).finally(() => { startup.disabled = false; });
  });

  const persist = async () => {
    const next = {
      alwaysOnTop: document.querySelector<HTMLInputElement>("#always-on-top")?.checked ?? false,
      compactMode: document.querySelector<HTMLInputElement>("#compact-mode")?.checked ?? false,
    };
    await writeSettings(next);
    const mainWindow = (await getAllWindows()).find((window) => window.label === "main");
    await mainWindow?.setAlwaysOnTop(next.alwaysOnTop);
  };
  document.querySelectorAll<HTMLInputElement>("#always-on-top, #compact-mode").forEach((input) => input.addEventListener("change", () => void persist()));
  document.querySelector("#reset-button")?.addEventListener("click", () => void ipc.resetLocalData());
  document.querySelector("#close-button")?.addEventListener("click", () => void getCurrentWindow().close());
}

async function runStartupUpdateGate(): Promise<void> {
  if (import.meta.env.DEV) return;

  app.innerHTML = `
    <section class="startup-update-shell">
      <p class="eyebrow">ARCANE CLEANUP</p>
      <h1>Checking for updates…</h1>
      <p class="muted" id="startup-update-sub">Looking on GitHub Releases</p>
      <p class="startup-update-pct" id="startup-update-pct" aria-live="polite"></p>
      <div class="startup-update-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div class="startup-update-bar-fill" id="startup-update-bar-fill"></div>
      </div>
      <div id="startup-update-extra"></div>
    </section>`;

  const subEl = document.querySelector<HTMLElement>("#startup-update-sub")!;
  const pctEl = document.querySelector<HTMLElement>("#startup-update-pct")!;
  const barFill = document.querySelector<HTMLElement>("#startup-update-bar-fill")!;
  const barTrack = document.querySelector<HTMLElement>(".startup-update-bar")!;
  const extra = document.querySelector<HTMLElement>("#startup-update-extra")!;

  const setProgress = (downloaded: number, total: number | null | undefined) => {
    if (total != null && total > 0) {
      const pct = Math.min(100, Math.round((downloaded / total) * 100));
      barFill.style.width = `${pct}%`;
      barTrack.setAttribute("aria-valuenow", String(pct));
      pctEl.textContent = `${formatBytes(downloaded)} / ${formatBytes(total)} (${pct}%)`;
    } else {
      barFill.style.width = "0%";
      pctEl.textContent = downloaded > 0 ? formatBytes(downloaded) : "";
    }
  };

  const unlisten = await listen<UpdaterProgress>("updater-progress", (event) => {
    const payload = event.payload;
    if (payload.phase === "checking") {
      subEl.textContent = "Checking for updates…";
      setProgress(0, null);
      return;
    }
    if (payload.phase === "downloading") {
      subEl.textContent = payload.version ? `Downloading v${payload.version}…` : "Downloading…";
      setProgress(payload.downloaded, payload.total);
      return;
    }
    if (payload.phase === "installing") {
      subEl.textContent = payload.version ? `Installing v${payload.version}…` : "Installing…";
      barFill.style.width = "100%";
      pctEl.textContent = "Finishing…";
    }
  });

  try {
    const result = await ipc.startupApplyUpdates();
    if (result.status === "installed") {
      subEl.textContent = "Update installed. Restarting…";
      await new Promise((resolve) => setTimeout(resolve, 800));
      await relaunch();
      return;
    }
    if (result.status === "failed_manual") {
      subEl.textContent = "Automatic update install failed";
      barTrack.style.display = "none";
      pctEl.textContent = "";
      extra.innerHTML = `<p class="muted">${escapeHtml(result.message ?? "A copy was saved to Downloads.")}</p>
        <div class="startup-update-actions">
          <button type="button" id="reveal-installer">Show installer</button>
          <button class="ghost" type="button" id="continue-current">Continue</button>
        </div>`;
      await new Promise<void>((resolve) => {
        document.querySelector("#reveal-installer")?.addEventListener("click", () => {
          void ipc.revealLastManualInstaller().catch(() => undefined);
        });
        document.querySelector("#continue-current")?.addEventListener("click", () => resolve());
      });
    } else if (result.status === "failed") {
      subEl.textContent = result.message ?? "Update check failed. Continuing.";
      await new Promise((resolve) => setTimeout(resolve, 1800));
    }
  } catch (error: unknown) {
    subEl.textContent = error instanceof Error ? error.message : "Update step failed. Continuing.";
    await new Promise((resolve) => setTimeout(resolve, 1800));
  } finally {
    unlisten();
  }
}

async function bootstrap(): Promise<void> {
  if (new URLSearchParams(location.search).get("view") === "settings") {
    await renderSettings();
    return;
  }
  await runStartupUpdateGate();
  await renderWorkspace();
}

void bootstrap();
