"""BLE discovery and transactional FoloCard transfer shared by local tools."""
import asyncio
import json
import zlib

from protocol import ACK, DATA, SERVICE, frames


class SyncError(RuntimeError):
    """A user-actionable device synchronization failure."""


def transfer_payload_size(characteristic):
    """Use the negotiated write size, with ATT-MTU-23 as a safe fallback."""
    try:
        maximum = int(characteristic.max_write_without_response_size)
    except (AttributeError, TypeError, ValueError):
        maximum = 20
    return max(17, min(241, maximum - 3))


async def scan_devices(timeout=8):
    from bleak import BleakScanner

    devices = await BleakScanner.discover(timeout=timeout, return_adv=True)
    matches = []
    for device, advertisement in devices.values():
        services = {value.lower() for value in advertisement.service_uuids}
        if (SERVICE in services or advertisement.local_name == 'FoloCard'
                or device.name == 'FoloCard'):
            matches.append((device, getattr(advertisement, 'rssi', None) or -127))
    return [device for device, _ in sorted(matches, key=lambda item: item[1], reverse=True)]


async def send(device, data):
    from bleak import BleakClient

    try:
        async with BleakClient(device, timeout=45) as client:
            # Reading an authenticated characteristic triggers the macOS PIN
            # dialog. The PIN is entered into that dialog, never into FoloCard.
            before = json.loads(bytes(await client.read_gatt_char(ACK)))
            characteristic = client.services.get_characteristic(DATA)
            # CoreBluetooth negotiates MTU without exposing it directly. Bleak
            # does expose the characteristic's conservative write length. Keep
            # a 17-byte payload for ATT-MTU-23 clients and cap the complete
            # frame at the firmware queue's 244-byte packet limit.
            payload = transfer_payload_size(characteristic)
            for packet in frames(data, payload):
                await client.write_gatt_char(DATA, packet, response=True)
                expected = (int.from_bytes(packet[1:3], 'little')
                            + len(packet) - 3 if packet[0] == 2 else 0)
                for _ in range(100):
                    ack = json.loads(bytes(await client.read_gatt_char(ACK)))
                    if packet[0] != 1 and ack['status'] == -1:
                        raise SyncError('设备拒绝了数据；旧名片仍保留。')
                    if packet[0] == 1 and ack['status'] == 1 and ack['offset'] == 0:
                        break
                    if packet[0] == 2 and ack['offset'] == expected:
                        break
                    if (packet[0] == 3 and ack['status'] == 2
                            and ack['checksum'] == zlib.crc32(data)
                            and ack['revision'] > before['revision']):
                        return ack
                    await asyncio.sleep(.05)
                else:
                    raise SyncError('设备回执超时；请保持设备同步页开启后重试。')
    except SyncError:
        raise
    except Exception as error:
        raise SyncError('BLE 连接失败；请确认设备同步已开启，并在系统配对框输入设备 PIN。'
                        '如果仍然失败，请先在系统蓝牙设置中忽略已有的 FoloCard，再重新配对。') from error
    raise SyncError('设备没有返回保存成功回执；旧名片仍保留。')


async def sync_nearest(data):
    try:
        devices = await scan_devices()
    except ModuleNotFoundError as error:
        if error.name == 'bleak':
            raise SyncError('本机组件缺少 BLE 支持，请按扩展中的安装命令更新组件。') from error
        raise
    except Exception as error:
        raise SyncError('无法扫描蓝牙设备；请确认 macOS 已允许蓝牙访问。') from error
    if not devices:
        raise SyncError('未发现 FoloCard；请在设备上双击 OK，再按 OK 开启三分钟同步。')
    return await send(devices[0], data)


def sync_card(data):
    return asyncio.run(sync_nearest(data))
