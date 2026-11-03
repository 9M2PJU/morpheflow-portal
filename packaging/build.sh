#!/usr/bin/env bash
# Build .deb and .rpm locally with nFPM (no root required to build).
# Usage: ./packaging/build.sh [--version 2.4.1] [--arch amd64|arm64]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="${1:-}"
if [[ "${1:-}" == "--version" ]]; then VERSION="${2:-}"; shift 2; fi
ARCH_FLAG="${1:-}"
if [[ "$ARCH_FLAG" == "--arch" ]]; then ARCH_FLAG="${2:-}"; shift 2; fi

if [[ -z "$VERSION" ]]; then
  VERSION="$(node -p "require('./package.json').version" 2>/dev/null || grep '"version"' package.json | head -1 | cut -d'"' -f4)"
fi
UNAME_M="$(uname -m)"
case "${ARCH_FLAG:-$UNAME_M}" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "unsupported arch: $ARCH_FLAG" >&2; exit 1 ;;
esac

OUT="$ROOT/dist"
mkdir -p "$OUT"

# Never ship bytecode caches or local build output inside the package
find "$ROOT/web" "$ROOT/scripts" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true

# nFPM binary (pinned, no system install needed)
NFPM_VER="2.43.1"
NFPM_BIN="$OUT/nfpm-${NFPM_VER}"
if [[ ! -x "$NFPM_BIN" ]]; then
  case "$UNAME_M" in
    x86_64) NFPM_ARCH=x86_64 ;; aarch64) NFPM_ARCH=arm64 ;; *) NFPM_ARCH=x86_64 ;;
  esac
  echo "==> downloading nFPM v$NFPM_VER ($NFPM_ARCH)..."
  curl -fsSL "https://github.com/goreleaser/nfpm/releases/download/v${NFPM_VER}/nfpm_${NFPM_VER}_Linux_${NFPM_ARCH}.tar.gz" \
    | tar -xz -C "$OUT"
  mv "$OUT/nfpm" "$NFPM_BIN"
fi

export VERSION ARCH
echo "==> building morpheflow_${VERSION} ($ARCH) ..."
"$NFPM_BIN" package --config packaging/nfpm.yaml --packager deb --target "$OUT/"
"$NFPM_BIN" package --config packaging/nfpm.yaml --packager rpm --target "$OUT/"
echo "==> artifacts:"
ls -lh "$OUT/"*.{deb,rpm} 2>/dev/null
echo "Install: sudo apt install ./dist/morpheflow_${VERSION}*_{amd64,arm64}.deb  # or: sudo dnf install ./dist/*.rpm"
