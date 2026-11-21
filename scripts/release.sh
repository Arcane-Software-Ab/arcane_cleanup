#!/usr/bin/env bash
set -euo pipefail

version="${1:-}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "Usage: $0 <version>  (example: $0 0.1.0)" >&2
  exit 1
fi

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
tag="v$version"

command -v git >/dev/null || { echo "git is required." >&2; exit 1; }

configured_version="$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$root_dir/backend/tauri.conf.json" | head -1)"
if [[ "$configured_version" != "$version" ]]; then
  echo "Version mismatch: tauri.conf.json is $configured_version, requested $version." >&2
  echo "Bump these to $version first:" >&2
  echo "  - backend/tauri.conf.json" >&2
  echo "  - backend/Cargo.toml" >&2
  echo "  - frontend/package.json" >&2
  exit 1
fi

cargo_version="$(sed -n 's/^version = "\([^"]*\)".*/\1/p' "$root_dir/backend/Cargo.toml" | head -1)"
frontend_version="$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$root_dir/frontend/package.json" | head -1)"
if [[ "$cargo_version" != "$version" || "$frontend_version" != "$version" ]]; then
  echo "Version mismatch across files (tauri=$configured_version cargo=$cargo_version frontend=$frontend_version)." >&2
  exit 1
fi

if [[ -n "$(git -C "$root_dir" status --porcelain)" ]]; then
  echo "Commit or stash your changes before releasing." >&2
  exit 1
fi

if git -C "$root_dir" rev-parse "$tag" >/dev/null 2>&1; then
  echo "Tag $tag already exists." >&2
  exit 1
fi

git -C "$root_dir" tag -a "$tag" -m "Arcane Cleanup $version"
echo "Created tag $tag"
echo
echo "Push the tag to trigger GitHub Actions builds:"
echo "  git push origin $tag"
echo
echo "Watch: Actions → Build and Release"
echo "Installers appear under Releases when the workflow finishes."
