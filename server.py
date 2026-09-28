#!/usr/bin/env python3
"""Static PMON dashboard plus live, read-only PMON snapshot endpoints."""
import argparse
import datetime
import html
import json
import shutil
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlparse


def snapshots(*folders: Path):
    """Return valid PMON exports sorted oldest to newest by embedded timestamp."""
    found = []
    seen = set()
    for folder in folders:
        try:
            entries = list(folder.iterdir())
        except OSError:
            continue
        for path in entries:
            try:
                resolved = path.resolve()
            except OSError:
                continue
            if resolved in seen:
                continue
            seen.add(resolved)
            if not path.is_file() or path.suffix.lower() != '.json' or 'pmon' not in path.name.lower():
                continue
            try:
                with path.open(encoding='utf-8') as handle:
                    payload = json.load(handle)
                timestamp = float(payload.get('generatedAt', path.stat().st_mtime))
                if not isinstance(payload.get('metrics'), list):
                    continue
                found.append((timestamp, path.stat().st_mtime_ns, path.name, path))
            except (OSError, ValueError, json.JSONDecodeError, AttributeError):
                # A profiler export can be observed during a write; skip until the next request.
                continue
    return sorted(found)


class PmonHandler(SimpleHTTPRequestHandler):
    pmon_dir = Path('.')
    snapshot_dir = Path('.')

    def end_headers(self):
        if self.path.startswith('/latest-pmon_total.json') or self.path.startswith('/pmon-exports/'):
            self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()

    def send_snapshot(self, path: Path):
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(path.stat().st_size))
            self.end_headers()
            with path.open('rb') as handle:
                shutil.copyfileobj(handle, self.wfile)
        except (OSError, BrokenPipeError):
            return

    def do_POST(self):
        request_path = urlparse(self.path).path
        if request_path != '/api/snapshot':
            self.send_error(404, 'Not found')
            return
        if self.pmon_dir.resolve() == self.snapshot_dir.resolve():
            self.send_error(409, 'Snapshot archive must be separate from the live PMON directory')
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length < 0 or length > 4096:
                raise ValueError('Invalid request size')
            body = json.loads(self.rfile.read(length) or b'{}')
            requested = body.get('filename') if isinstance(body, dict) else None
            live_files = [entry for entry in snapshots(self.pmon_dir) if entry[3].parent.resolve() == self.pmon_dir.resolve()]
            if requested is None:
                entry = live_files[-1] if live_files else None
            else:
                entry = next((item for item in live_files if item[2] == requested), None)
            if entry is None:
                self.send_error(404, 'Selected live PMON export not found')
                return
            source = entry[3]
            self.snapshot_dir.mkdir(parents=True, exist_ok=True)
            timestamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
            target = self.snapshot_dir / f'{source.stem}_snapshot_{timestamp}{source.suffix}'
            shutil.copy2(source, target)
            response = json.dumps({'saved': target.name, 'source': source.name}).encode()
            self.send_response(201)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(response)))
            self.send_header('Cache-Control', 'no-store, max-age=0')
            self.end_headers()
            self.wfile.write(response)
        except (ValueError, json.JSONDecodeError) as error:
            self.send_error(400, str(error))
        except OSError as error:
            self.send_error(500, str(error))

    def do_GET(self):
        request_path = unquote(urlparse(self.path).path)
        current = snapshots(self.pmon_dir, self.snapshot_dir)

        if request_path == '/latest-pmon_total.json':
            if not current:
                self.send_error(404, 'No PMON JSON exports found yet')
                return
            self.send_snapshot(current[-1][3])
            return

        if request_path in ('/pmon-exports', '/pmon-exports/'):
            links = ''.join('<li><a data-live="' + str(path.parent.resolve() == self.pmon_dir.resolve()).lower() + '" href="' + quote(name, safe='') + '">' + html.escape(name) + '</a></li>' for _, _, name, path in current)
            body = f'<!doctype html><title>PMON exports</title><ul>{links}</ul>'.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if request_path.startswith('/pmon-exports/'):
            name = request_path.removeprefix('/pmon-exports/')
            match = next((path for _, _, filename, path in current if filename == name), None)
            if match:
                self.send_snapshot(match)
            else:
                self.send_error(404, 'PMON export not found')
            return

        if request_path not in ('/', '/index.html', '/styles.css', '/app.js', '/sample-pmon_total.json'):
            self.send_error(404, 'Not found')
            return
        super().do_GET()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', default='.', type=Path)
    parser.add_argument('--pmon-dir', required=True, type=Path)
    parser.add_argument('--snapshot-dir', default='.', type=Path)
    parser.add_argument('--bind', default='0.0.0.0')
    parser.add_argument('--port', default=8089, type=int)
    args = parser.parse_args()
    PmonHandler.directory = str(args.directory.resolve())
    PmonHandler.pmon_dir = args.pmon_dir.resolve()
    PmonHandler.snapshot_dir = args.snapshot_dir.resolve()
    httpd = ThreadingHTTPServer((args.bind, args.port), PmonHandler)
    print(f'PMON dashboard: http://{args.bind}:{args.port} (live source: {PmonHandler.pmon_dir})')
    httpd.serve_forever()


if __name__ == '__main__':
    main()
