#!/bin/sh
# nFPM post-install: create venv, install deps, fetch morphe.jar, seed dirs.
set -eu

APP=/opt/morpheflow
VENV="$APP/.venv"
MORPHE_VERSION="${MORPHE_VERSION:-1.20.0}"
JAR_URL="https://github.com/MorpheApp/morphe-desktop/releases/download/v${MORPHE_VERSION}/morphe-desktop-${MORPHE_VERSION}-all.jar"

# 1. system user (fallback when systemd-sysusers is unavailable, e.g. older distros)
if ! id morpheflow >/dev/null 2>&1; then
  useradd -r -d /opt/morpheflow -s /usr/sbin/nologin morpheflow 2>/dev/null || adduser --system --home /opt/morpheflow --no-create-home morpheflow || true
fi

# 2. state dirs + symlinks (single PROJECT_ROOT layout, data kept outside package upgrades)
mkdir -p /var/lib/morpheflow/apps /var/lib/morpheflow/tools /var/log/morpheflow
mkdir -p "$APP/apps" "$APP/tools"
for d in apps tools; do
  if [ ! -e "/var/lib/morpheflow/$d/.keep" ]; then
    touch "/var/lib/morpheflow/$d/.keep"
  fi
done
chown -R morpheflow:morpheflow /var/lib/morpheflow /var/log/morpheflow "$APP/apps" "$APP/tools" 2>/dev/null || true

# 3. python venv + deps (uses system python3, no bundled interpreter)
if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV" || python3 -m venv --without-pip "$VENV"
fi
"$VENV/bin/pip" install --upgrade pip >/dev/null 2>&1 || true
if [ -f "$APP/requirements.txt" ]; then
  "$VENV/bin/pip" install -r "$APP/requirements.txt" || echo "[morpheflow] WARNING: pip install failed, run '$VENV/bin/pip install -r $APP/requirements.txt' manually"
fi
chown -R morpheflow:morpheflow "$VENV" 2>/dev/null || true

# 4. morphe.jar (45MB, downloaded once, skipped on upgrade if present)
mkdir -p "$APP/tools"
if [ ! -s "$APP/tools/morphe.jar" ] && [ ! -s "$APP/tools/morphe-desktop-$MORPHE_VERSION-all.jar" ]; then
  echo "[morpheflow] downloading morphe-desktop v$ MORPHE_VERSION ..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$APP/tools/morphe-desktop-$MORPHE_VERSION-all.jar" "$JAR_URL" || echo "[morpheflow] WARNING: jar download failed"
  else
    wget -q -O "$APP/tools/morphe-desktop-$MORPHE_VERSION-all.jar" "$JAR_URL" || echo "[morpheflow] WARNING: jar download failed"
  fi
  if [ -s "$APP/tools/morphe-desktop-$MORPHE_VERSION-all.jar" ]; then
    ln -sf "morphe-desktop-$MORPHE_VERSION-all.jar" "$APP/tools/morphe.jar"
  fi
fi
chown -R morpheflow:morpheflow "$APP/tools" 2>/dev/null || true

# 5. systemd
if command -v systemd-sysusers >/dev/null 2>&1; then
  systemd-sysusers /usr/lib/sysusers.d/morpheflow.conf 2>/dev/null || true
fi
if command -v systemd-tmpfiles >/dev/null 2>&1; then
  systemd-tmpfiles --create /usr/lib/tmpfiles.d/morpheflow.conf 2>/dev/null || true
fi
if [ -d /run/systemd/system ]; then
  systemctl daemon-reload 2>/dev/null || true
  echo "[morpheflow] enable with: systemctl enable --now morpheflow  (dashboard: http://127.0.0.1:8080)"
fi
exit 0
