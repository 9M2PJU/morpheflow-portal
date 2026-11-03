#!/usr/bin/env bash
# MorpheFlow 1-line installer (self-hosted backend).
#
#   curl -fsSL https://raw.githubusercontent.com/wiwek13/morpheflow-portal/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/wiwek13/morpheflow-portal/main/install.sh | bash -s -- --docker    # Docker Compose (default)
#   curl -fsSL https://raw.githubusercontent.com/wiwek13/morpheflow-portal/main/install.sh | bash -s -- --native    # .deb/.rpm via nFPM-built package
#   curl -fsSL https://raw.githubusercontent.com/wiwek13/morpheflow-portal/main/install.sh | bash -s -- --appimage  # portable AppImage to ./MorpheFlow-*.AppImage
#
# Edge (Cloudflare Workers) mode is separate: git clone + ./deploy.sh (see README).
set -euo pipefail

REPO="${MORPHEFLOW_REPO:-wiwek13/morpheflow-portal}"
BRANCH="${MORPHEFLOW_BRANCH:-main}"
INSTALL_DIR="${MORPHEFLOW_DIR:-$HOME/morpheflow}"
MODE="docker"
PORT="${PORT:-8080}"

usage() { echo "Usage: install.sh [--docker|--native|--appimage] [--dir PATH] [--port N]"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --docker) MODE=docker; shift ;;
    --native) MODE=native; shift ;;
    --appimage) MODE=appimage; shift ;;
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

log()  { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mWARN:\033[0m %s\n' "$*" >&2; }

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing required command: $1" >&2; exit 1; }; }

install_docker_engine() {
  if command -v docker >/dev/null 2>&1; then return 0; fi
  log "installing Docker Engine (https://get.docker.com)..."
  curl -fsSL https://get.docker.com | sh
}

do_docker() {
  need curl; need git
  install_docker_engine
  log "installing MorpheFlow (docker) into $INSTALL_DIR ..."
  if [[ ! -d "$INSTALL_DIR/.git" ]]; then
    git clone --depth 1 --branch "$BRANCH" "https://github.com/${REPO}.git" "$INSTALL_DIR"
  else
    git -C "$INSTALL_DIR" pull --ff-only || true
  fi
  cd "$INSTALL_DIR"
  [[ -f .env ]] || cp example.env .env
  if docker compose version >/dev/null 2>&1; then
    docker compose -f default_compose.yaml pull
    PORT="$PORT" docker compose -f default_compose.yaml up -d
  else
    docker-compose -f default_compose.yaml pull
    PORT="$PORT" docker-compose -f default_compose.yaml up -d
  fi
  log "done. Dashboard: http://localhost:${PORT}  (edit $INSTALL_DIR/.env for tunnels/email)"
}

do_native() {
  need curl
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  arch="$(uname -m)"; case "$arch" in x86_64) debarch=amd64 ;; aarch64) debarch=arm64 ;; *) echo "unsupported arch $arch" >&2; exit 1 ;; esac
  ver="$(curl -fsSL "https://raw.githubusercontent.com/${REPO}/${BRANCH}/package.json" | grep '"version"' | head -1 | cut -d'"' -f4)"
  log "installing morpheflow_${ver} (${debarch}) native package ..."
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL -o "$tmp/morpheflow.deb" "https://github.com/${REPO}/releases/latest/download/morpheflow_${ver}_${debarch}.deb"
    sudo apt install -y "$tmp/morpheflow.deb"
    sudo systemctl enable --now morpheflow
  elif command -v dnf >/dev/null 2>&1; then
    curl -fsSL -o "$tmp/morpheflow.rpm" "https://github.com/${REPO}/releases/latest/download/morpheflow-${ver}-1.${debarch}.rpm"
    sudo dnf install -y "$tmp/morpheflow.rpm"
    sudo systemctl enable --now morpheflow
  elif command -v pacman >/dev/null 2>&1; then
    need git
    command -v makepkg >/dev/null 2>&1 || { echo "need base-devel (makepkg) installed first: sudo pacman -S --needed base-devel git" >&2; exit 1; }
    if [ "$(id -u)" = "0" ] && [ -z "${SUDO_USER:-}" ]; then
      echo "makepkg refuses to run as root; rerun as a normal user with sudo access" >&2; exit 1
    fi
    log "building morpheflow-git from AUR packaging (packaging/aur/PKGBUILD) ..."
    aur_tmp="$tmp/aur"; git clone --depth 1 --branch "$BRANCH" "https://github.com/${REPO}.git" "$aur_tmp"
    if [ "$(id -u)" = "0" ]; then
      sudo -u "$SUDO_USER" bash -c "cd '$aur_tmp/packaging/aur' && makepkg -si --noconfirm"
      sudo systemctl enable --now morpheflow
    else
      (cd "$aur_tmp/packaging/aur" && makepkg -si --noconfirm)
      sudo systemctl enable --now morpheflow
    fi
  else
    echo "no apt/dnf/pacman found; use --docker or --appimage mode" >&2; exit 1
  fi
  log "done. Dashboard: http://127.0.0.1:8080"
}

do_appimage() {
  need curl
  arch="$(uname -m)"; [[ "$arch" == "x86_64" ]] || { echo "AppImage ships x86_64 only; use --docker on $arch" >&2; exit 1; }
  ver="$(curl -fsSL "https://raw.githubusercontent.com/${REPO}/${BRANCH}/package.json" | grep '"version"' | head -1 | cut -d'"' -f4)"
  log "downloading MorpheFlow-${ver}-x86_64.AppImage ..."
  curl -fsSL -o "./MorpheFlow-${ver}-x86_64.AppImage" "https://github.com/${REPO}/releases/latest/download/MorpheFlow-${ver}-x86_64.AppImage"
  chmod +x "./MorpheFlow-${ver}-x86_64.AppImage"
  warn "host needs python3 (>=3.11) + Java 21. Run: ./MorpheFlow-${ver}-x86_64.AppImage"
}

case "$MODE" in
  docker) do_docker ;;
  native) do_native ;;
  appimage) do_appimage ;;
esac
