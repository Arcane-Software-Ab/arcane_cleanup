import { load, type Store } from "@tauri-apps/plugin-store";

let shellStore: Store | null = null;

async function getShellStore(): Promise<Store> {
  if (!shellStore) shellStore = await load("shell.json", { defaults: {}, autoSave: 250 });
  return shellStore;
}

export type CleanupSettings = {
  alwaysOnTop: boolean;
  compactMode: boolean;
};

export type CleanPrefs = {
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

const settingDefaults: CleanupSettings = {
  alwaysOnTop: false,
  compactMode: false,
};

const cleanDefaults: Omit<CleanPrefs, "root"> = {
  target: true,
  nodeModules: false,
  dist: true,
  build: true,
  next: true,
  output: true,
  nuxt: true,
  turbo: true,
  vite: true,
};

export async function readSettings(): Promise<CleanupSettings> {
  const shellStore = await getShellStore();
  return {
    alwaysOnTop: (await shellStore.get<boolean>("settings.alwaysOnTop")) ?? settingDefaults.alwaysOnTop,
    compactMode: (await shellStore.get<boolean>("settings.compactMode")) ?? settingDefaults.compactMode,
  };
}

export async function writeSettings(settings: CleanupSettings): Promise<void> {
  const shellStore = await getShellStore();
  await shellStore.set("settings.alwaysOnTop", settings.alwaysOnTop);
  await shellStore.set("settings.compactMode", settings.compactMode);
  await shellStore.save();
}

export async function readCleanPrefs(fallbackRoot: string): Promise<CleanPrefs> {
  const shellStore = await getShellStore();
  return {
    root: (await shellStore.get<string>("clean.root")) ?? fallbackRoot,
    target: (await shellStore.get<boolean>("clean.target")) ?? cleanDefaults.target,
    nodeModules: (await shellStore.get<boolean>("clean.nodeModules")) ?? cleanDefaults.nodeModules,
    dist: (await shellStore.get<boolean>("clean.dist")) ?? cleanDefaults.dist,
    build: (await shellStore.get<boolean>("clean.build")) ?? cleanDefaults.build,
    next: (await shellStore.get<boolean>("clean.next")) ?? cleanDefaults.next,
    output: (await shellStore.get<boolean>("clean.output")) ?? cleanDefaults.output,
    nuxt: (await shellStore.get<boolean>("clean.nuxt")) ?? cleanDefaults.nuxt,
    turbo: (await shellStore.get<boolean>("clean.turbo")) ?? cleanDefaults.turbo,
    vite: (await shellStore.get<boolean>("clean.vite")) ?? cleanDefaults.vite,
  };
}

export async function writeCleanPrefs(prefs: CleanPrefs): Promise<void> {
  const shellStore = await getShellStore();
  await shellStore.set("clean.root", prefs.root);
  await shellStore.set("clean.target", prefs.target);
  await shellStore.set("clean.nodeModules", prefs.nodeModules);
  await shellStore.set("clean.dist", prefs.dist);
  await shellStore.set("clean.build", prefs.build);
  await shellStore.set("clean.next", prefs.next);
  await shellStore.set("clean.output", prefs.output);
  await shellStore.set("clean.nuxt", prefs.nuxt);
  await shellStore.set("clean.turbo", prefs.turbo);
  await shellStore.set("clean.vite", prefs.vite);
  await shellStore.save();
}
