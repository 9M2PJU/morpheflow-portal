#!/usr/bin/env bash
# Build a portable MorpheFlow AppImage (server bundle).
#
# What it is: AppDir containing web/, scripts/, defaults/, requirements.txt and
# the morphe.jar; AppRun launches uvicorn on 127.0.0.1:8080 and opens the browser.
# System requirements inside the AppImage host: python3 (>=3.11), Java 21, pip deps.
# This keeps the AppImage small (~60MB incl. jar) instead of bundling interpreters.
#
# Usage: ./packaging/appimage/build-appimage.sh [--version 2.4.1]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version" 2>/dev/null || grep '"version"' package.json | head -1 | cut -d'"' -f4)"
if [[ "${1:-}" == "--version" ]]; then VERSION="$2"; fi
MORPHE_VERSION="${MORPHE_VERSION:-1.20.0}"
OUT="$ROOT/dist"
APPDIR="$OUT/MorpheFlow.AppDir"

rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/src/morpheflow" "$APPDIR/usr/bin" "$OUT"

cp -a web scripts defaults requirements.txt "$APPDIR/usr/src/morpheflow/"
mkdir -p "$APPDIR/usr/src/morpheflow/tools" "$APPDIR/usr/src/morpheflow/apps"
JAR="$APPDIR/usr/src/morpheflow/tools/morphe-desktop-${MORPHE_VERSION}-all.jar"
if [[ ! -s "$JAR" ]]; then
  echo "==> downloading morphe.jar v${MORPHE_VERSION} ..."
  curl -fsSL -o "$JAR" "https://github.com/MorpheApp/morphe-desktop/releases/download/v${MORPHE_VERSION}/morphe-desktop-${MORPHE_VERSION}-all.jar"
fi
ln -sf "morphe-desktop-${MORPHE_VERSION}-all.jar" "$APPDIR/usr/src/morpheflow/tools/morphe.jar"

cp packaging/appimage/AppRun "$APPDIR/AppRun"
chmod +x "$APPDIR/AppRun"
cp packaging/appimage/morpheflow.desktop "$APPDIR/morpheflow.desktop"
cp web/frontend/favicon.svg "$APPDIR/morpheflow.svg"

# appimagetool (pinned)
TOOL="$OUT/appimagetool-x86_64.AppImage"
if [[ ! -x "$TOOL" ]]; then
  curl -fsSL -o "$TOOL" "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage"
  chmod +x "$TOOL"
fi

export VERSION
echo "==> building MorpheFlow-${VERSION}-x86_64.AppImage ..."
ARCH=x86_64 "$TOOL" "$APPDIR" "$OUT/MorpheFlow-${VERSION}-x86_64.AppImage"
ls -lh "$OUT/"*.AppImage
