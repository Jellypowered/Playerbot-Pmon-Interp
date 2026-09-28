# PMON Interpreter

A self-hosted dashboard for AzerothCore Playerbot PMON JSON exports. It provides an overview, operation-level analysis, and snapshot comparison. It has no build step or third-party runtime dependencies; the dashboard server and UI use Python's standard library and browser APIs.

## Requirements

- Python 3.9 or newer
- A modern web browser
- `tmux` for the optional Linux/macOS background-session helper (`pmon.sh`); Windows uses PowerShell and does not need tmux
- PMON JSON files to analyze (an example file is included)

## Install and configure

1. Clone the dashboard beside your AzerothCore checkout. This recommended layout lets the example PMON path work as-is:

   ```text
   Source/
   ├── azerothcore-wotlk/
   └── Playerbot-Pmon-Interp/
   ```

   From the directory containing `azerothcore-wotlk`, run:

   ```bash
   git clone https://github.com/Jellypowered/Playerbot-Pmon-Interp.git
   cd Playerbot-Pmon-Interp
   ```

   Prefer a shorter directory name? Choose one when cloning:

   ```bash
   git clone https://github.com/Jellypowered/Playerbot-Pmon-Interp.git PmonInterp
   cd PmonInterp
   ```

2. Copy `pmon.conf.example` to `pmon.conf`:

   ```bash
   cp pmon.conf.example pmon.conf                 # Linux/macOS
   Copy-Item pmon.conf.example pmon.conf          # PowerShell
   ```

3. Edit `pmon.conf` and set `pmon_dir` to the directory where your AzerothCore setup writes PMON exports. Locate the generated JSON on your server and use its containing directory; the output path depends on your `LogsDir` configuration/build setup. The example assumes the dashboard directory and `azerothcore-wotlk` checkout are siblings. Relative paths are resolved from the dashboard project directory; absolute paths are also accepted.

   ```ini
   [server]
   pmon_dir = ../azerothcore-wotlk/env/dist/bin
   snapshot_dir = snapshots
   bind = 0.0.0.0
   port = 8089
   tmux_session = pmon-interp
   ```

   `pmon.conf` is local and ignored by Git. Edit `snapshot_dir` if you want the archive somewhere else. The archive must be separate from the live PMON directory.

## Run the dashboard

### Linux / macOS

With `tmux` installed:

```bash
./pmon.sh start
./pmon.sh status
```

Open <http://127.0.0.1:8089>. Stop it with `./pmon.sh stop`; attach to its console with `tmux attach -t pmon-interp`.

### Windows (PowerShell)

Ensure Python is installed and `python.exe` is on `PATH`, then run from the project directory:

```powershell
.\pmon.ps1 start
Start-Process http://127.0.0.1:8089
.\pmon.ps1 status
.\pmon.ps1 stop
```

If Windows blocks the scripts, allow them for the current PowerShell session with `Set-ExecutionPolicy -Scope Process Bypass`. The helper runs the same Python server in a hidden process; its PID and logs are kept in ignored local files.

### LAN access

The example binds to all interfaces (`0.0.0.0`), so another device on your trusted LAN can use `http://HOST-LAN-IP:8089`. This server has no authentication. For local-machine-only access, set `bind = 127.0.0.1` in `pmon.conf`. If using LAN access, restrict it with your firewall; on Windows, allow the configured port through Windows Firewall only if needed.

The server scans the configured directories while running, so new exports and snapshots appear without restarting it. It serves only the dashboard assets and explicit PMON endpoints—not arbitrary files in the project or archive. It never changes live profiler files; the webpage's snapshot action writes only into `snapshot_dir`.

### Try the included sample without an AzerothCore server

Run the custom Python server from the project directory:

```bash
python3 server.py --directory . --pmon-dir . --snapshot-dir ./snapshots --bind 127.0.0.1 --port 8089
```

On Windows, use `python` instead of `python3`. Open <http://127.0.0.1:8089> and choose **Load included sample**. A plain `python -m http.server` is sufficient for a static preview, but does not provide live PMON discovery or webpage snapshot capture.

## Select and analyze exports

The **PMON files on this server** dropdown lists valid `*pmon*.json` exports from both `pmon_dir` and `snapshot_dir`. Files are ordered by their embedded `generatedAt` timestamp, with filesystem modification time as a fallback. Choose a file to load it, or select **Follow newest live file** to follow the newest export. The page refreshes live data and the file list every 15 seconds; refresh the browser to update sooner.

The **Overview** tab presents timing summaries, category costs, high-cost operations, latency outliers, and a searchable operation table. Hover metric headings for definitions; click an operation row for implementation-specific context. The included **PMON help** button explains profiler commands and how the measured scopes work.

## Preserve snapshots

Many profiler setups write stable filenames such as `pmon_total.json` and `pmon_tick.json`, replacing them on each dump. Without copies, those files do not provide a history for comparison.

### From the webpage

Select a live export in **PMON files on this server**, then click **Save to snapshots**. With **Follow newest live file** selected, it saves the newest live export. The server copies that JSON into `snapshot_dir` under a unique timestamped name; it does not alter the original. The new archive file appears in the dropdown and Compare tab automatically. The button is disabled when an archived file is selected.

### From the command line

To archive all valid PMON exports in the live source directory:

```bash
./snapshot.sh       # Linux/macOS
.\snapshot.ps1     # Windows PowerShell
```

These helpers use the `generatedAt` timestamp in each JSON to name the copies. If your server already emits timestamped filenames, they can be selected directly; archiving them is still useful to preserve a sequence. The archive can grow over time, so remove old files when they are no longer needed.

## Compare two runs

Open the **Compare snapshots** tab. The two newest discovered files are selected as baseline (older) and candidate (newer) automatically. Select different files if needed and click **Compare**. Lower timing values are green; higher values are red. Operations present in only one file are marked separately because they may reflect a workload or instrumentation change.

For a useful comparison, keep export mode, bot count, capture duration, and gameplay activity as similar as practical. If the profiler reuses stable filenames, save a snapshot between runs—either from the webpage or with the command-line helper.

## Collect comparable PMON data

The local `mod-playerbots` pull-request template recommends a consistent bot load: set `BotActiveAlone = 100` and `botActiveAloneSmartScale = 0`, wait for bots to finish logging in, enable collection with `playerbot pmon toggle`, then capture with `playerbot pmon stack` after five minutes. Use `playerbot pmon reset` before an independent run. Check the configuration and command behavior in your own module checkout if it differs.

## Reading the metrics

PMON declares time in microseconds. **Time/tick** and **calls/tick** normalize operation totals by FullTick sample count. `Total` rows represent enclosing timing scopes and overlap category rows; do not sum them together. In this implementation, FullTick finishes on the next `UpdateAI` invocation, so its duration is the interval between calls—not pure CPU execution time. See the dashboard's help for more detail.

## Project files

- `index.html`, `styles.css`, `app.js` — dashboard UI
- `server.py` — local web server and live PMON/snapshot endpoints
- `pmon.conf.example` — portable configuration template
- `pmon.sh`, `snapshot.sh` — Linux/macOS helpers
- `pmon.ps1`, `snapshot.ps1` — Windows PowerShell helpers
- `sample-pmon_total.json` — example data
