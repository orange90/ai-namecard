"""Strict, local-only card envelope and BLE framing; no account sessions."""
import datetime as dt
import base64
import json
import math
import re
import struct
import zlib

MAX_BYTES = 8192
SERVICE = 'fc010000-4643-0080-464f-435500000001'
DATA = 'fc010000-4643-0080-464f-435500000002'
ACK = 'fc010000-4643-0080-464f-435500000003'

def require(condition, message):
    if not condition:
        raise ValueError(message)

def keys(obj, allowed):
    require(type(obj) is dict and set(obj) <= set(allowed), 'Unexpected fields')

def text(value, limit, required=False):
    require(type(value) is str and len(value.encode('utf-8')) < limit and (not required or bool(value)) and all(ord(c) >= 32 and ord(c) != 127 for c in value), 'Invalid text')

def number(value, maximum, integer=True):
    require(type(value) in (int, float) and math.isfinite(value) and 0 <= value <= maximum and (not integer or int(value) == value), 'Invalid number')

def stamp(value):
    text(value, 36, True)
    require(re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})', value), 'Timestamp needs timezone')
    dt.datetime.fromisoformat(value.replace('Z', '+00:00'))

def validate(card):
    keys(card, ('version', 'updatedAt', 'codex', 'zhihu', 'xiaohongshu'))
    require(type(card.get('version')) is int and card['version'] == 1, 'Unsupported version')
    stamp(card.get('updatedAt'))
    require(any(k in card for k in ('codex', 'zhihu', 'xiaohongshu')), 'Empty card')
    if 'codex' in card:
        c = card['codex']; keys(c, ('source', 'days', 'quota', 'usage'))
        require(c.get('source') in ('profile-ui', 'usage-ui', 'profile-ui+usage-ui'), 'Unsupported source')
        days = c.get('days'); require(type(days) is list and len(days) <= 84, 'Too many days')
        previous = ''
        for day in days:
            keys(day, ('date', 'intensity', 'tokens'))
            date = day.get('date'); text(date, 11, True)
            require(re.fullmatch(r'\d{4}-\d{2}-\d{2}', date) and previous < date <= card['updatedAt'][:10], 'Dates must be sorted, unique and not future')
            require(dt.date.fromisoformat(date).year >= 2000, 'Date before 2000')
            previous = date
            number(day.get('intensity'), 4)
            if 'tokens' in day: number(day['tokens'], 9007199254740991)
        if 'quota' in c:
            q = c['quota']; keys(q, ('usedPercent', 'resetsAt'))
            number(q.get('usedPercent'), 100, False); stamp(q.get('resetsAt'))
        if 'usage' in c:
            usage = c['usage']; keys(usage, ('tokens', 'credits'))
            require(bool(usage), 'Empty usage')
            if 'tokens' in usage: number(usage['tokens'], 9007199254740991)
            if 'credits' in usage: number(usage['credits'], 1e12, False)
    for site, prefix, metrics in (
        ('zhihu', 'https://www.zhihu.com/people/', ('likes', 'followers', 'answers', 'articles', 'interactions')),
        ('xiaohongshu', 'https://www.xiaohongshu.com/user/profile/', ('likes', 'followers')),
    ):
        if site not in card: continue
        s = card[site]; keys(s, ('name', 'bio', 'url', 'metrics', 'avatar'))
        text(s.get('name'), 97, True); text(s.get('bio', ''), 193)
        text(s.get('url'), 193, True)
        require(re.fullmatch(re.escape(prefix) + r'[A-Za-z0-9_-]+', s['url']), 'Only public profile URLs are allowed')
        keys(s.get('metrics', {}), metrics)
        for value in s.get('metrics', {}).values(): number(value, 1e12)
        if 'avatar' in s:
            avatar = s['avatar']; keys(avatar, ('format', 'width', 'height', 'data'))
            require(avatar.get('format') == 'rgb565le' and avatar.get('width') == 24 and avatar.get('height') == 24, 'Invalid avatar format')
            text(avatar.get('data'), 1537, True)
            require(len(avatar['data']) == 1536, 'Invalid avatar size')
            try:
                raw = base64.b64decode(avatar['data'], validate=True)
            except (ValueError, TypeError):
                raise ValueError('Invalid avatar encoding') from None
            require(len(raw) == 1152, 'Invalid avatar data')
    data = json.dumps(card, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
    require(len(data) <= MAX_BYTES, 'Card exceeds 8192 bytes')
    return data

def frames(data, payload=128):
    require(0 < len(data) <= MAX_BYTES and 1 <= payload <= 241, 'Invalid transfer size')
    yield b'\x01' + struct.pack('<II', len(data), zlib.crc32(data))
    for offset in range(0, len(data), payload):
        yield b'\x02' + struct.pack('<H', offset) + data[offset:offset + payload]
    yield b'\x03'

def loads(data):
    def unique(pairs):
        result = {}
        for k, v in pairs:
            require(k not in result, 'Duplicate JSON field')
            result[k] = v
        return result
    return json.loads(data, object_pairs_hook=unique)
