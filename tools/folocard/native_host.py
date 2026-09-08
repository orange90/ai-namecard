#!/usr/bin/env python3
"""FoloCard native messaging host: one allowlisted local operation, no HTTP."""
import json
from pathlib import Path
import struct
import sys
from codex_local import LocalUsage

NAME = 'com.folotoy.folocard'
MAX_MESSAGE = 65536


def read_message(stream):
    header = stream.read(4)
    if not header:
        return None
    if len(header) != 4:
        raise ValueError('Incomplete message header')
    length = struct.unpack('=I', header)[0]
    if not 0 < length <= MAX_MESSAGE:
        raise ValueError('Invalid message length')
    chunks = bytearray()
    while len(chunks) < length:
        chunk = stream.read(length-len(chunks))
        if not chunk:
            raise ValueError('Incomplete message body')
        chunks.extend(chunk)
    return json.loads(chunks)


def write_message(stream, value):
    raw = json.dumps(value, ensure_ascii=False, allow_nan=False).encode('utf-8')
    if len(raw) > 1024*1024:
        raise ValueError('Response too large')
    stream.write(struct.pack('=I', len(raw)) + raw)
    stream.flush()


def serve(reader, incoming, outgoing, syncer=None):
    while True:
        try:
            message = read_message(incoming)
            if message is None:
                return
            if message == {'type': 'codex-usage'}:
                try:
                    value = reader.read()
                except (ValueError, TimeoutError) as error:
                    value = {'error': str(error)}
                except Exception:
                    value = {'error': '本机日志读取失败，请检查文件访问权限。'}
            elif (type(message) is dict and set(message) == {'type', 'card'}
                  and message.get('type') == 'sync-device'):
                try:
                    from protocol import loads, validate
                    raw = json.dumps(message['card'], ensure_ascii=False,
                                     allow_nan=False).encode('utf-8')
                    data = validate(loads(raw))
                    if syncer is None:
                        from ble_sync import sync_card
                        value = sync_card(data)
                    else:
                        value = syncer(data)
                except (ValueError, TimeoutError) as error:
                    value = {'error': str(error)}
                except ModuleNotFoundError as error:
                    value = {'error': ('本机组件缺少 BLE 支持，请按扩展中的安装命令更新组件。'
                                       if error.name == 'bleak' else '本机同步组件不完整，请重新安装。')}
                except Exception as error:
                    value = {'error': str(error) if str(error) else 'BLE 同步失败，请检查设备后重试。'}
            else:
                value = {'error': '不支持的本机请求。'}
            write_message(outgoing, value)
        except (ValueError, OSError):
            return


def main():
    config = json.loads(Path(__file__).with_name('native_config.json').read_text())
    if len(sys.argv) < 2 or sys.argv[1].rstrip('/')+'/' not in config['allowed_origins']:
        return 1
    serve(LocalUsage(config.get('codex_home')), sys.stdin.buffer, sys.stdout.buffer)
    return 0


if __name__ == '__main__':
    sys.exit(main())
