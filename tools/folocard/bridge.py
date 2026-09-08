#!/usr/bin/env python3
"""Loopback bridge. Explicit extension origin + startup code + single-use challenge."""
import argparse
import asyncio
import hmac
import json
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from protocol import MAX_BYTES, loads, validate
from codex_local import LocalUsage
from ble_sync import scan_devices, send

async def scan():
    for device in await scan_devices():
        print(device.address, 'FoloCard')

class Server(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, args):
        super().__init__(('127.0.0.1', args.port), Handler)
        self.origin = 'chrome-extension://' + args.extension_id
        self.code = secrets.token_hex(8)
        self.challenges = {}
        self.guard = threading.Lock()
        self.transfer = threading.Lock()
        self.device = args.device
        self.usage = LocalUsage(getattr(args, 'codex_home', None))

class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup(); self.connection.settimeout(10)
    def log_message(self, *args): pass  # Never log profile data or authorization.
    def trusted(self):
        return self.headers.get('Origin') == self.server.origin and self.headers.get('Host') == f'127.0.0.1:{self.server.server_port}'
    def reply(self, code, payload):
        data = json.dumps(payload).encode()
        self.send_response(code)
        if self.trusted():
            self.send_header('Access-Control-Allow-Origin', self.server.origin)
            self.send_header('Vary', 'Origin')
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers(); self.wfile.write(data)
    def do_OPTIONS(self):
        if not self.trusted(): return self.reply(403, {'error': 'Origin rejected'})
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', self.server.origin)
        self.send_header('Access-Control-Allow-Methods', 'POST')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Folo-Code, X-Folo-Challenge')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.end_headers()
    def do_POST(self):
        if not self.trusted(): return self.reply(403, {'error': 'Origin rejected'})
        try:
            length = int(self.headers.get('Content-Length', '-1'))
            if not 0 <= length <= MAX_BYTES or self.headers.get('Content-Type') != 'application/json':
                return self.reply(400, {'error': 'Invalid content type or size'})
            if self.path == '/challenge':
                if not hmac.compare_digest(self.headers.get('X-Folo-Code', ''), self.server.code):
                    return self.reply(403, {'error': 'Invalid bridge code'})
                self.rfile.read(length)
                challenge = secrets.token_urlsafe(32)
                with self.server.guard:
                    self.server.challenges = {challenge: time.monotonic() + 60}
                return self.reply(200, {'challenge': challenge})
            if self.path == '/codex/usage':
                if not hmac.compare_digest(self.headers.get('X-Folo-Code', ''), self.server.code):
                    return self.reply(403, {'error': '桥接启动码无效，请填写当前终端显示的启动码。'})
                self.rfile.read(length)
                try:
                    return self.reply(200, self.server.usage.read())
                except (ValueError, TimeoutError) as error:
                    return self.reply(422, {'error': str(error)})
            if self.path != '/sync': return self.reply(404, {'error': 'Unknown endpoint'})
            if not self.server.device: return self.reply(409, {'error': '桥接仅用于读取 Token；同步时请使用 --device 启动。'})
            with self.server.guard:
                expires = self.server.challenges.pop(self.headers.get('X-Folo-Challenge', ''), 0)
            if expires < time.monotonic(): return self.reply(403, {'error': 'Expired or consumed challenge'})
            raw = self.rfile.read(length)
            if len(raw) != length: raise ValueError('Incomplete body')
            data = validate(loads(raw))
            if not self.server.transfer.acquire(blocking=False): return self.reply(409, {'error': 'Device busy'})
            try: ack = asyncio.run(send(self.server.device, data))
            finally: self.server.transfer.release()
            self.reply(200, ack)
        except (ValueError, TypeError, KeyError, UnicodeError):
            self.reply(400, {'error': 'Invalid card or rejected transfer; previous card retained'})
        except Exception:
            self.reply(503, {'error': 'BLE unavailable or acknowledgement lost; check device and retry'})

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--scan', action='store_true')
    parser.add_argument('--device')
    parser.add_argument('--send', metavar='JSON_FILE', help='Explicit one-shot local file transfer for device testing')
    parser.add_argument('--extension-id')
    parser.add_argument('--codex-home', help='Native Codex home; defaults to CODEX_HOME or ~/.codex')
    parser.add_argument('--port', type=int, default=17321)
    args = parser.parse_args()
    if args.scan: return asyncio.run(scan())
    if args.send:
        if not args.device: parser.error('--send needs --device')
        from pathlib import Path
        data=validate(loads(Path(args.send).read_bytes()))
        print(json.dumps(asyncio.run(send(args.device,data))))
        return
    import re
    if not re.fullmatch('[a-p]{32}', args.extension_id or ''):
        parser.error('The installed --extension-id is required; --device is optional for reading local Token usage')
    server = Server(args)
    print(f'FoloCard bridge at 127.0.0.1:{args.port}\nPaste this startup code into the extension: {server.code}', flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
if __name__ == '__main__': main()
