# Deployment

GitHub Actions builds **Windows**, **macOS**, and **Linux**, signs updater packages, and publishes installers + update manifests to **GitHub Releases**.

A normal `git push` does **not** create a release.

## One-time setup

### 1. Signing key (already generated on this Mac)

Private key (keep secret):

```text
~/.tauri/arcane-cleanup.key
```

Public key is already in `backend/tauri.conf.json`.

Add the **full contents** of the private key file as a GitHub Actions secret:

| Secret | Value |
|--------|--------|
| `TAURI_SIGNING_PRIVATE_KEY` | entire `~/.tauri/arcane-cleanup.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | leave empty (key has no password) |

Repo → **Settings → Secrets and variables → Actions → New repository secret**

### 2. GitHub repo URL in the app

`backend/tauri.conf.json` updater endpoint defaults to:

```text
https://github.com/DevelDoe/arcane_cleanup/releases/latest/download/{{target}}-{{arch}}.json
```

If your repo path is different, change that URL **before** shipping builds.

## Release steps

### 1. Pull

```sh
git pull
```

### 2. Bump version (same in all three)

- `backend/tauri.conf.json`
- `backend/Cargo.toml`
- `frontend/package.json`

### 3. Commit and push

```sh
git add .
git commit -m "Release v0.1.1"
git push
```

### 4. Tag

```sh
./scripts/release.sh 0.1.1
git push origin v0.1.1
```

### 5. Wait for CI

1. **Actions → Build and Release** — all three platforms green  
2. **Releases** — installers + `*-x86_64.json` / `darwin-aarch64.json` attached  

Installed apps check **latest** GitHub Release on startup and auto-update when a newer signed build is available.

## Notes

- Do not reuse tags
- Tags with `-beta` are marked prerelease (`latest` ignores them for updates)
- Manual test build: **Actions → Build and Release → Run workflow** (no GitHub Release unless you push a tag)
- If you lose `~/.tauri/arcane-cleanup.key`, you must generate a new keypair and ship a manual update once (old installs cannot verify new signatures)
