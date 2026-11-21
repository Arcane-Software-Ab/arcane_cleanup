#!/usr/bin/env bash
set -euo pipefail

# One-shot release:
#   ./scripts/release.sh           # bump patch (0.1.1 -> 0.1.2)
#   ./scripts/release.sh minor     # bump minor (0.1.2 -> 0.2.0)
#   ./scripts/release.sh major     # bump major (0.2.0 -> 1.0.0)
#   ./scripts/release.sh 1.4.0     # set an exact version

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root_dir"

command -v git >/dev/null || { echo "git is required." >&2; exit 1; }

read_version() {
  sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$root_dir/backend/tauri.conf.json" | head -1
}

bump_semver() {
  local current="$1" kind="$2"
  local major minor patch
  IFS=. read -r major minor patch <<<"$current"
  patch="${patch%%-*}"
  case "$kind" in
    patch) patch=$((patch + 1)) ;;
    minor) minor=$((minor + 1)); patch=0 ;;
    major) major=$((major + 1)); minor=0; patch=0 ;;
    *) echo "Unknown bump kind: $kind" >&2; exit 1 ;;
  esac
  echo "${major}.${minor}.${patch}"
}

current="$(read_version)"
if [[ ! "$current" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "Could not read a semver from backend/tauri.conf.json (got: ${current:-empty})" >&2
  exit 1
fi

arg="${1:-patch}"
if [[ "$arg" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  version="$arg"
elif [[ "$arg" == "patch" || "$arg" == "minor" || "$arg" == "major" ]]; then
  version="$(bump_semver "$current" "$arg")"
else
  echo "Usage: $0 [patch|minor|major|X.Y.Z]" >&2
  exit 1
fi

tag="v$version"

if [[ "$version" == "$current" ]]; then
  echo "Version is already $version. Nothing to bump." >&2
  exit 1
fi

if git rev-parse "$tag" >/dev/null 2>&1; then
  echo "Tag $tag already exists locally." >&2
  exit 1
fi

if git ls-remote --tags origin "refs/tags/$tag" | grep -q .; then
  echo "Tag $tag already exists on origin." >&2
  exit 1
fi

echo "Releasing $current -> $version"
echo "Pulling latest main…"
git pull --ff-only

python3 - "$version" <<'PY'
import pathlib, re, sys

version = sys.argv[1]
root = pathlib.Path(".")

def replace_json_version(path: pathlib.Path) -> None:
    text = path.read_text()
    updated, count = re.subn(
        r'("version"\s*:\s*")([^"]+)(")',
        rf'\g<1>{version}\g<3>',
        text,
        count=1,
    )
    if count != 1:
        raise SystemExit(f"Could not update version in {path}")
    path.write_text(updated)

def replace_cargo_version(path: pathlib.Path) -> None:
    text = path.read_text()
    updated, count = re.subn(
        r'(?m)^(version\s*=\s*")([^"]+)(")',
        rf'\g<1>{version}\g<3>',
        text,
        count=1,
    )
    if count != 1:
        raise SystemExit(f"Could not update version in {path}")
    path.write_text(updated)

replace_json_version(root / "backend" / "tauri.conf.json")
replace_json_version(root / "frontend" / "package.json")
replace_cargo_version(root / "backend" / "Cargo.toml")
print(f"Updated version files to {version}")
PY

git add -A
if git diff --cached --quiet; then
  echo "No changes to commit after version bump." >&2
  exit 1
fi

git commit -m "Release ${tag}"
git push origin HEAD
git tag -a "$tag" -m "Arcane Cleanup $version"
git push origin "$tag"

echo
echo "Done: pushed $tag"
echo "Watch: Actions → Build and Release"
echo "Installers appear under Releases when the workflow finishes."
