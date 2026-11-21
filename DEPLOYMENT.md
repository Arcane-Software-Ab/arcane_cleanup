# Deployment

GitHub Actions builds **Windows**, **macOS**, and **Linux**, signs updater packages, and publishes installers + update manifests to **GitHub Releases**.

A normal `git push` does **not** create a release. Use the release script (or push a `v*` tag).

## One-time setup

### 1. Signing key

Private key (keep secret):

```text
~/.tauri/arcane-cleanup.key
```

Public key is already in `backend/tauri.conf.json`.

| Secret | Value |
|--------|--------|
| `TAURI_SIGNING_PRIVATE_KEY` | entire `~/.tauri/arcane-cleanup.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | leave empty (key has no password) |

Repo → **Settings → Secrets and variables → Actions → New repository secret**

### 2. GitHub repo URL in the app

Updater endpoint in `backend/tauri.conf.json`:

```text
https://github.com/DevelDoe/arcane_cleanup/releases/latest/download/{{target}}-{{arch}}.json
```

Change that if the repo path is different **before** shipping builds.

## Release (one command)

From the repo root:

```sh
./scripts/release.sh
```

That will:

1. `git pull --ff-only`
2. Bump **patch** version in `tauri.conf.json`, `Cargo.toml`, and `frontend/package.json`
3. Commit everything (`Release vX.Y.Z`)
4. Push `main`
5. Create and push tag `vX.Y.Z` (triggers CI)

### Other bumps

```sh
./scripts/release.sh          # 0.1.1 -> 0.1.2
./scripts/release.sh minor    # 0.1.2 -> 0.2.0
./scripts/release.sh major    # 0.2.0 -> 1.0.0
./scripts/release.sh 1.4.0    # exact version
```

### After it runs

1. Open **Actions → Build and Release** — wait for all three platforms  
2. Download installers from **Releases**

| Platform | File |
|----------|------|
| Windows | `Arcane-Cleanup-*-windows-setup.exe` |
| macOS | `Arcane-Cleanup-*-macos.dmg` |
| Linux | `Arcane-Cleanup-*-linux.AppImage` |

Installed apps check **latest** GitHub Release on startup and auto-update when a newer signed build is available.

## Notes

- Commit or include your WIP — the script stages **all** changes into the release commit
- Do not reuse tags
- Tags with `-beta` are marked prerelease (`latest` ignores them for updates)
- Manual test build: **Actions → Build and Release → Run workflow**
- If you lose `~/.tauri/arcane-cleanup.key`, generate a new keypair and ship one manual update (old installs cannot verify new signatures)
