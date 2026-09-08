import io
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'tools/folocard'))
from native_host import read_message, write_message, serve
from install_native import install, install_runtime


def frame(value):
    output=io.BytesIO();write_message(output,value);return output.getvalue()


class NativeTests(unittest.TestCase):
    def test_framing_unicode_and_multiple_messages(self):
        stream=io.BytesIO(frame({'message':'每日 Token'})+frame({'done':True}))
        self.assertEqual(read_message(stream),{'message':'每日 Token'})
        self.assertEqual(read_message(stream),{'done':True});self.assertIsNone(read_message(stream))
    def test_rejects_truncated_and_oversized_messages(self):
        for data in [b'x',struct.pack('=I',65537),struct.pack('=I',10)+b'{}']:
            with self.assertRaises(ValueError):read_message(io.BytesIO(data))
    def test_only_fixed_operation_can_scan(self):
        class Reader:
            calls=0
            def read(self):self.calls+=1;return {'source':'local-logs','days':[]}
        reader=Reader();output=io.BytesIO()
        serve(reader,io.BytesIO(frame({'type':'codex-usage','path':'/private'})+frame({'type':'codex-usage'})),output)
        output.seek(0);self.assertIn('error',read_message(output));self.assertEqual(read_message(output)['source'],'local-logs');self.assertEqual(reader.calls,1)
    def test_sync_validates_card_and_returns_device_ack(self):
        card={'version':1,'updatedAt':'2026-09-08T10:30:00+08:00','codex':{'source':'usage-ui','days':[{'date':'2026-09-08','intensity':1,'tokens':42}]}}
        seen=[];output=io.BytesIO()
        serve(None,io.BytesIO(frame({'type':'sync-device','card':card})),output,
              syncer=lambda data:(seen.append(json.loads(data)),{'status':2,'revision':3,'checksum':42})[1])
        output.seek(0);self.assertEqual(read_message(output)['revision'],3);self.assertEqual(seen,[card])
        output=io.BytesIO();serve(None,io.BytesIO(frame({'type':'sync-device','card':{'secret':'bad'}})),output,syncer=lambda _:None)
        output.seek(0);self.assertIn('error',read_message(output))
    def test_installed_host_launch_origin_and_no_external_app(self):
        with tempfile.TemporaryDirectory(prefix='folocard native ') as temp:
            home=Path(temp);codex=home/'codex';codex.mkdir()
            paths=install('a'*32,['brave'],home=home,platform='darwin',codex_home=codex)
            manifest=json.loads(paths[0].read_text())
            self.assertEqual(manifest['allowed_origins'],['chrome-extension://'+'a'*32+'/'])
            self.assertEqual(paths[0].parent,(home/'Library/Application Support/Google/Chrome/NativeMessagingHosts').resolve())
            self.assertFalse((home/'Library/Application Support/BraveSoftware').exists())
            launcher=Path(manifest['path'])
            self.assertIn(' -B -u ',launcher.read_text())
            for name in ('native_host.py','codex_local.py','ble_sync.py','protocol.py'):
                self.assertTrue((home/'Library/Application Support/FoloCard/native'/name).exists())
            request=frame({'type':'codex-usage'})
            result=subprocess.run([manifest['path'],'chrome-extension://'+'a'*32+'/'],input=request,capture_output=True,timeout=10)
            self.assertEqual(result.returncode,0);self.assertEqual(result.stderr,b'')
            self.assertIn('未找到',read_message(io.BytesIO(result.stdout))['error'])
            rejected=subprocess.run([manifest['path'],'chrome-extension://'+'b'*32+'/'],input=request,capture_output=True,timeout=10)
            self.assertEqual(rejected.returncode,1);self.assertEqual(rejected.stdout,b'')
            install('b'*32,['brave'],home=home,platform='darwin')
            self.assertEqual(len(json.loads(paths[0].read_text())['allowed_origins']),2)
    def test_invalid_extension_id_cannot_change_installation(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ValueError):install('../bad',['chrome'],home=temp,platform='darwin')
            self.assertEqual(list(Path(temp).iterdir()),[])

    def test_macos_virtualenv_is_copied_out_of_protected_project_path(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=root/'Documents/project/venv';destination=root/'Library/FoloCard'
            (source/'bin').mkdir(parents=True);destination.mkdir(parents=True)
            (source/'pyvenv.cfg').write_text('home = /usr/bin\n')
            (source/'bin/python').symlink_to(sys.executable)
            installed=install_runtime(destination,'darwin',source/'bin/python',source,root/'base')
            self.assertEqual(installed,destination/'venv/bin/python')
            self.assertTrue(installed.exists())
            self.assertEqual((destination/'venv/pyvenv.cfg').read_text(),'home = /usr/bin\n')


if __name__=='__main__': unittest.main()
