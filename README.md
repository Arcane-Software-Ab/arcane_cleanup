# Arcane Cleanup

Free desktop app that finds rebuildable project junk — Rust/Tauri `target` folders, `dist`, `build`, `.next`, and friends — shows how much space they use, and deletes only what you select.

No account. No cloud. Everything stays on your machine.

## Download

Grab the latest build from this repo’s **Releases** page.

| Platform | Installer |
|----------|-----------|
| Windows | `Arcane-Cleanup-*-windows-setup.exe` |
| macOS | `Arcane-Cleanup-*-macos.dmg` |
| Linux | `Arcane-Cleanup-*-linux.AppImage` |

Installers are **update-signed** (so the app can auto-update) but not Apple/Microsoft notarized:

- **Windows:** if SmartScreen warns you, choose **More info → Run anyway**
- **macOS:** control-click the app → **Open**
- **Linux:** `chmod +x Arcane-Cleanup-*.AppImage`, then run it

### Auto-update

Packaged builds check this repo’s latest GitHub Release on startup. If a newer version is available, Cleanup downloads and installs it, then restarts.

## What it does

1. Pick a root folder (for example your monorepo or `~/dev`)
2. Choose which folder names to look for (`target`, `dist`, `build`, `.next`, `.output`, `.nuxt`, …)
3. **Scan** — see sizes before anything is removed
4. Check/uncheck rows, then **Delete selected**

`node_modules` is off by default. Turn it on only if you want that cleaned too (you’ll need to reinstall deps later).

### Safety

- Only deletes directories whose **exact name** matches a known build artifact type
- Paths must stay **under** the root you chose
- You get a confirmation dialog before delete
- Source code is never targeted — only rebuildable output folders

Still: review the scan list. Deleted folders are gone until you rebuild.

## Build from source

Needs **Node 22+**, **Rust**, and **Tauri CLI 2**.

```sh
git clone <your-repo-url> arcane_cleanup
cd arcane_cleanup/frontend
npm install

cd ../backend
cargo tauri dev
```

Production build:

```sh
cd backend
cargo tauri build
```

## Releases (maintainers)

See [DEPLOYMENT.md](./DEPLOYMENT.md) for signing secrets and the full checklist.

```sh
# bump version in tauri.conf.json, Cargo.toml, frontend/package.json
./scripts/release.sh 0.1.1
git push origin v0.1.1
```

## License

Use and share freely for personal or team disk cleanup. If you publish a fork, please keep attribution to Arcane Software / the original repo.
