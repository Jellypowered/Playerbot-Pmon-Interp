#!/usr/bin/env bash
# Preserve the current profiler exports as timestamped comparison snapshots.
set -euo pipefail
APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${PMON_CONFIG:-$APP_DIR/pmon.conf}"

# Defaults match pmon.sh; a simple INI [server] section is read without sourcing code.
CONFIG_VALUES=()
if [[ -f "$CONFIG_FILE" ]]; then
    mapfile -t CONFIG_VALUES < <(python3 - "$CONFIG_FILE" <<'PY'
import configparser
import sys
config = configparser.ConfigParser()
with open(sys.argv[1], encoding='utf-8') as stream:
    config.read_file(stream)
section = config['server'] if config.has_section('server') else {}
for key in ('pmon_dir', 'snapshot_dir'):
    print(section.get(key, ''))
PY
)
fi
SOURCE_DIR="${PMON_DIR:-${CONFIG_VALUES[0]:-snapshots}}"
DEST_DIR="${PMON_SNAPSHOT_DIR:-${CONFIG_VALUES[1]:-snapshots}}"
[[ "$SOURCE_DIR" = /* ]] || SOURCE_DIR="$APP_DIR/$SOURCE_DIR"
[[ "$DEST_DIR" = /* ]] || DEST_DIR="$APP_DIR/$DEST_DIR"

python3 - "$SOURCE_DIR" "$DEST_DIR" <<'PY'
import datetime
import json
import pathlib
import shutil
import sys

source = pathlib.Path(sys.argv[1])
destination = pathlib.Path(sys.argv[2])
destination.mkdir(parents=True, exist_ok=True)
found = 0
for path in sorted(source.iterdir() if source.is_dir() else []):
    if path.parent.resolve() == destination.resolve():
        continue
    if not path.is_file() or 'pmon' not in path.name.lower() or path.suffix.lower() != '.json':
        continue
    try:
        with path.open(encoding='utf-8') as stream:
            payload = json.load(stream)
        stamp = datetime.datetime.fromtimestamp(float(payload['generatedAt']), datetime.timezone.utc)
    except (OSError, ValueError, KeyError, json.JSONDecodeError, TypeError):
        continue
    timestamp = stamp.strftime('%Y%m%dT%H%M%SZ')
    target = destination / f'{path.stem}_{timestamp}{path.suffix}'
    if target.resolve() == path.resolve():
        continue
    shutil.copy2(path, target)
    print(f'Saved {target.name}')
    found += 1
if not found:
    raise SystemExit(f'No valid *pmon*.json exports found in {source}')
PY
