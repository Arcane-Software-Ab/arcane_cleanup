import { invoke } from "@tauri-apps/api/core";

export type ScanOptions = {
  root: string;
  target: boolean;
  nodeModules: boolean;
  dist: boolean;
  build: boolean;
  next: boolean;
  output: boolean;
  nuxt: boolean;
  turbo: boolean;
  vite: boolean;
};

export type ArtifactHit = {
  path: string;
  kind: string;
  bytes: number;
};

export type ScanReport = {
  root: string;
  items: ArtifactHit[];
  totalBytes: number;
};

export type DeleteItem = {
  path: string;
  bytes: number;
};

export type DeleteReport = {
  removed: string[];
  failed: string[];
  freedBytes: number;
};

export type CleanupProgress = {
  phase: string;
  current: number;
  total: number;
  path: string;
  message: string;
};

export type UpdaterProgress = {
  phase: string;
  downloaded: number;
  total?: number | null;
  version?: string | null;
};

export type StartupUpdateResult = {
  status: string;
  message?: string | null;
  savedInstallerPath?: string | null;
};

export const ipc = {
  getStartOnBoot: () => invoke<boolean>("get_start_on_boot"),
  setStartOnBoot: (enabled: boolean) => invoke<void>("set_start_on_boot", { enabled }),
  openSettings: () => invoke<void>("open_settings_window"),
  resetLocalData: () => invoke<void>("reset_local_user_data"),
  defaultCleanupRoot: () => invoke<string>("default_cleanup_root"),
  scanCleanupTargets: (options: ScanOptions) => invoke<ScanReport>("scan_cleanup_targets", { options }),
  deleteCleanupTargets: (root: string, items: DeleteItem[]) =>
    invoke<DeleteReport>("delete_cleanup_targets", { root, items }),
  startupApplyUpdates: () => invoke<StartupUpdateResult>("startup_apply_updates"),
  revealLastManualInstaller: () => invoke<void>("reveal_last_manual_installer"),
};
