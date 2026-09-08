"""Read native Codex token counters locally; no CodexBar/credentials required.

Only session identity, timestamps and numeric counters are retained in memory.
Accounting follows the concepts in CodexBar's CostUsageScanner (MIT, Peter
Steinberger; reviewed revision 170a4d41c6d69e2bb25daac4fb088a92de2f9bc4).
This is an independent, native-session implementation, not its full cost engine.
"""
import datetime as dt
import json
import os
from pathlib import Path
import threading
import time

LIMIT = 9007199254740991
LINE_LIMIT = 4 * 1024 * 1024


def timestamp(value):
    try:
        value = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        return value if value.tzinfo and value.year >= 2000 else None
    except (AttributeError, ValueError, TypeError):
        return None


def counters(value):
    if not isinstance(value, dict):
        return None
    # Cached input is already part of input; reasoning is part of output.
    values = tuple(value.get(k) for k in ('input_tokens', 'output_tokens'))
    if all(type(v) is int and 0 <= v <= LIMIT for v in values):
        return values
    return None


class LocalUsage:
    def __init__(self, home=None):
        self.home = Path(home or os.environ.get('CODEX_HOME') or Path.home()/'.codex').expanduser().resolve()
        self.cache = {}
        self.lock = threading.Lock()

    def _read(self, path, deadline):
        stat = path.stat()
        old = self.cache.get(path)
        identity = (stat.st_dev, stat.st_ino)
        if old and old['identity'] == identity and old['size'] == stat.st_size and old['mtime'] == stat.st_mtime_ns:
            return old
        # Appended files resume at the last complete line. Rewrites/truncations
        # rebuild this file; no session text is cached or written to disk.
        entry = old if old and old['identity'] == identity and stat.st_size > old['size'] else {
            'id': None, 'parent': None, 'fork': None, 'events': [], 'offset': 0, 'partial': False}
        with path.open('rb') as handle:
            handle.seek(entry['offset'])
            while True:
                if time.monotonic() > deadline:
                    raise TimeoutError('本机日志首次扫描较慢，请重新读取以继续扫描。')
                start = handle.tell()
                line = handle.readline(LINE_LIMIT + 1)
                if not line:
                    break
                if len(line) > LINE_LIMIT:
                    while line and not line.endswith(b'\n'):
                        line = handle.readline(LINE_LIMIT + 1)
                    entry['partial'] = True
                    entry['offset'] = handle.tell()
                    continue
                if not line.endswith(b'\n'):
                    handle.seek(start)
                    break  # Writer is still appending this record.
                entry['offset'] = handle.tell()
                if b'"token_count"' not in line and b'"session_meta"' not in line:
                    continue
                try:
                    record = json.loads(line)
                    if not isinstance(record, dict):
                        continue
                    payload = record.get('payload')
                    if not isinstance(payload, dict):
                        continue
                    if record.get('type') == 'session_meta':
                        if entry['id'] is None:
                            entry['id'] = payload.get('id') or payload.get('session_id') or payload.get('sessionId')
                            entry['parent'] = next((payload[k] for k in ('forked_from_id', 'forkedFromId', 'parent_session_id', 'parentSessionId') if payload.get(k)), None)
                            entry['fork'] = timestamp(payload.get('timestamp') or record.get('timestamp'))
                        continue
                    if record.get('type') != 'event_msg' or payload.get('type') != 'token_count':
                        continue
                    info = payload.get('info')
                    if info is None:  # Rate-limit-only notification.
                        continue
                    when = timestamp(record.get('timestamp'))
                    total = counters(info.get('total_token_usage'))
                    last = counters(info.get('last_token_usage'))
                    if when and (total is not None or last is not None):
                        entry['events'].append((when, total, last))
                    else:
                        entry['partial'] = True
                except (ValueError, AttributeError, TypeError):
                    entry['partial'] = True
        entry.update(identity=identity, size=stat.st_size, mtime=stat.st_mtime_ns)
        self.cache[path] = entry
        return entry

    def read(self, now=None, seconds=110):
        if not self.lock.acquire(blocking=False):
            raise ValueError('本机 Token 正在扫描，请稍后重试。')
        try:
            return self._scan(now or dt.datetime.now().astimezone(), time.monotonic()+seconds)
        finally:
            self.lock.release()

    def _scan(self, now, deadline):
        sessions = {}
        paths = set()
        partial = False
        for folder in ('sessions', 'archived_sessions'):
            root = self.home/folder
            if not root.is_dir() or root.is_symlink():
                continue
            for path in root.rglob('*.jsonl'):
                if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
                    continue
                paths.add(path)
                try:
                    entry = self._read(path, deadline)
                except OSError:
                    partial = True
                    continue
                partial |= entry['partial']
                # Archived copies and live copies of the same session must not
                # count twice. Union only sanitized events, never conversation text.
                key = entry['id'] if isinstance(entry['id'], str) else str(path)
                current = sessions.setdefault(key, {'parent': entry['parent'], 'fork': entry['fork'], 'events': set()})
                current['events'].update(entry['events'])
        self.cache = {path: value for path, value in self.cache.items() if path in paths}
        if not paths:
            raise ValueError('未找到本机 Codex 会话日志。请先在此电脑使用 Codex；自定义目录可通过 --codex-home 指定。')
        daily = {}
        start_day = now.date()-dt.timedelta(days=83)
        for session in sessions.values():
            baseline = (0, 0)
            fork = session['fork'] if session['parent'] else None
            if session['parent']:
                parent = sessions.get(session['parent']) if isinstance(session['parent'], str) else None
                snapshots = [(when, total) for when, total, _ in parent['events'] if total is not None and fork and when <= fork] if parent else []
                if not snapshots:
                    partial = True
                    continue  # An unresolved inherited counter is not new usage.
                baseline = max(snapshots, key=lambda row: row[0])[1]
            water = baseline
            counted = baseline
            seen = set()
            divergent = False
            interleaved = False
            has_previous = bool(session['parent'])
            for when, total, last in sorted(session['events'], key=lambda row: (row[0], row[1] or (-1, -1), row[2] or (-1, -1))):
                if fork and when <= fork:
                    continue
                if total is not None:
                    if total in seen:
                        continue
                    seen.add(total)
                    if any(t < w for t, w in zip(total, water)):
                        interleaved = True
                        partial = True  # Conservative containment for mixed lineages.
                    growth = tuple(max(0, t-w) for t, w in zip(total, water))
                    if interleaved:
                        delta = tuple(max(0, t-(max(w, c) if t >= w else c)) for t, w, c in zip(total, water, counted))
                        if last is not None:
                            delta = tuple(min(d, v) for d, v in zip(delta, last))
                    elif session['parent'] or last is None:
                        delta = growth
                    elif has_previous and not divergent and all(d <= v for d, v in zip(growth, last)):
                        delta = growth
                    else:
                        delta = last
                    water = tuple(max(t, w) for t, w in zip(total, water))
                else:
                    delta = last
                counted = tuple(c+d for c, d in zip(counted, delta))
                if total is None:
                    water = tuple(max(w, c) for w, c in zip(water, counted))
                elif counted != total:
                    divergent = True
                has_previous = True
                day = when.astimezone().date()  # Attribute each event, not file creation.
                if start_day <= day <= now.date():
                    key = day.isoformat()
                    daily[key] = daily.get(key, 0) + sum(delta)
        if not daily:
            raise ValueError('最近 84 天没有可确认的本机 Token 记录；缺失记录不会记为零。')
        if any(v > LIMIT for v in daily.values()) or sum(daily.values()) > LIMIT:
            raise ValueError('Token 统计超出设备数值范围。')
        peak = max(daily.values()) or 1
        days = [{'date': day, 'tokens': value, 'intensity': min(4, max(1, (value*4+peak-1)//peak)) if value else 0} for day, value in sorted(daily.items())]
        return {'source': 'local-logs', 'updatedAt': now.isoformat(timespec='seconds'),
                'days': days, 'totalTokens': sum(daily.values()), 'partial': partial,
                'message': '已读取本机 Token；部分日志无法完整计入。' if partial else '已读取本机 Codex 每日 Token。'}
