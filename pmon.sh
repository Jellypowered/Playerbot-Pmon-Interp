#!/usr/bin/env bash
# Start/stop the PMON dashboard and live snapshot server in tmux.
set -euo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${PMON_CONFIG:-$APP_DIR/pmon.conf}"

# Read the optional INI config without evaluating it as shell code.
CONFIG_VALUES=()
if [[ -f "$CONFIG_FILE" ]]; then
    mapfile -t CONFIG_VALUES < <(python3 - "$CONFIG_FILE" <<'PY'
import configparser
import sys

config = configparser.ConfigParser()
try:
    with open(sys.argv[1], encoding='utf-8') as stream:
        config.read_file(stream)
except (OSError, configparser.Error) as error:
    raise SystemExit(f'Error reading {sys.argv[1]}: {error}')
section = config['server'] if config.has_section('server') else {}
for key in ('pmon_dir', 'snapshot_dir', 'bind', 'port', 'tmux_session'):
    print(section.get(key, ''))
PY
)
fi

# Environment variables override config; paths in config are relative to the app folder.
PMON_DIR="${PMON_DIR:-${CONFIG_VALUES[0]:-snapshots}}"
[[ "$PMON_DIR" = /* ]] || PMON_DIR="$APP_DIR/$PMON_DIR"
PMON_DIR="$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).resolve())' "$PMON_DIR")"
PMON_SNAPSHOT_DIR="${PMON_SNAPSHOT_DIR:-${CONFIG_VALUES[1]:-snapshots}}"
[[ "$PMON_SNAPSHOT_DIR" = /* ]] || PMON_SNAPSHOT_DIR="$APP_DIR/$PMON_SNAPSHOT_DIR"
PMON_SNAPSHOT_DIR="$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).resolve())' "$PMON_SNAPSHOT_DIR")"
PMON_BIND="${PMON_BIND:-${CONFIG_VALUES[2]:-0.0.0.0}}"
PMON_PORT="${PMON_PORT:-${CONFIG_VALUES[3]:-8089}}"
PMON_TMUX_SESSION="${PMON_TMUX_SESSION:-${CONFIG_VALUES[4]:-pmon-interp}}"

usage() {
    cat <<EOF
Usage: $0 {start|stop|restart|status}

Configuration: $CONFIG_FILE (optional; copy pmon.conf.example to pmon.conf)
Environment overrides: PMON_DIR, PMON_BIND, PMON_PORT, PMON_TMUX_SESSION, PMON_CONFIG
EOF
}

require_tmux() {
    command -v tmux >/dev/null || { echo "Error: tmux is required." >&2; exit 1; }
    command -v python3 >/dev/null || { echo "Error: python3 is required." >&2; exit 1; }
}

start() {
    require_tmux
    [[ -d "$PMON_DIR" ]] || { echo "Error: PMON directory not found: $PMON_DIR" >&2; exit 1; }

    if tmux has-session -t "$PMON_TMUX_SESSION" 2>/dev/null; then
        echo "PMON Interpreter is already running in tmux session '$PMON_TMUX_SESSION'."
        echo "Open http://$PMON_BIND:$PMON_PORT  (attach: tmux attach -t $PMON_TMUX_SESSION)"
        return
    fi

    # The server scans PMON_DIR on every request, so new files appear without a restart.
    tmux new-session -d -s "$PMON_TMUX_SESSION" -c "$APP_DIR" \
        "exec python3 server.py --directory '$APP_DIR' --pmon-dir '$PMON_DIR' --snapshot-dir '$PMON_SNAPSHOT_DIR' --port '$PMON_PORT' --bind '$PMON_BIND'"

    echo "PMON Interpreter started in tmux session '$PMON_TMUX_SESSION'."
    echo "Open http://$PMON_BIND:$PMON_PORT"
    echo "Attach with: tmux attach -t $PMON_TMUX_SESSION"
}

stop() {
    require_tmux
    if tmux has-session -t "$PMON_TMUX_SESSION" 2>/dev/null; then
        tmux kill-session -t "$PMON_TMUX_SESSION"
        echo "PMON Interpreter stopped."
    else
        echo "PMON Interpreter is not running."
    fi
}

status() {
    require_tmux
    if tmux has-session -t "$PMON_TMUX_SESSION" 2>/dev/null; then
        echo "PMON Interpreter is running: http://$PMON_BIND:$PMON_PORT"
        echo "Session: $PMON_TMUX_SESSION"
        echo "Live source directory: $PMON_DIR"
    else
        echo "PMON Interpreter is not running."
        return 1
    fi
}

case "${1:-}" in
    start) start ;;
    stop) stop ;;
    restart) stop || true; start ;;
    status) status ;;
    *) usage; exit 2 ;;
esac
