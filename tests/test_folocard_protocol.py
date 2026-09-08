import copy
import base64
import importlib.util
import pathlib
import struct
import sys
from types import SimpleNamespace
import unittest
import zlib
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'tools/folocard'))
from protocol import validate, frames, loads
from ble_sync import transfer_payload_size
class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.card={'version':1,'updatedAt':'2026-09-07T10:30:00+08:00','codex':{'source':'profile-ui','days':[{'date':'2026-09-07','intensity':4}]}}
    def test_round_trip_and_crc(self):
        data=validate(self.card); packets=list(frames(data,17))
        size,crc=struct.unpack('<II',packets[0][1:]);self.assertEqual(size,len(data));self.assertEqual(crc,zlib.crc32(data))
        result=b''
        for packet in packets[1:-1]:
            self.assertEqual(int.from_bytes(packet[1:3],'little'),len(result));result+=packet[3:]
        self.assertEqual(result,data);self.assertNotIn('tokens',loads(result)['codex']['days'][0])
    def test_reject_unknown_secret(self):
        for key in ['cookie','prompt','accessToken','html']:
            card=copy.deepcopy(self.card);card[key]='forbidden'
            with self.assertRaises(ValueError):validate(card)
    def test_bad_days(self):
        for field,value in [('intensity',5),('intensity',1.5),('tokens',-1),('tokens',True),('date','2026-02-30'),('date','2026-09-08')]:
            card=copy.deepcopy(self.card);card['codex']['days'][0][field]=value
            with self.assertRaises(ValueError):validate(card)
    def test_duplicate_dates(self):
        self.card['codex']['days']*=2
        with self.assertRaises(ValueError):validate(self.card)
    def test_profile_url_allowlist(self):
        for url in ['javascript:alert(1)','https://www.zhihu.com.evil/people/a','https://www.zhihu.com/people/a?token=x']:
            self.card['zhihu']={'name':'a','url':url}
            with self.assertRaises(ValueError):validate(self.card)
    def test_duplicate_json_keys(self):
        with self.assertRaises(ValueError):loads('{"version":1,"version":2}')
    def test_size_limits(self):
        with self.assertRaises(ValueError):list(frames(b'x'*8193))
        self.card['zhihu']={'name':'名'*33,'url':'https://www.zhihu.com/people/example'}
        with self.assertRaises(ValueError):validate(self.card)
    def test_usage_and_avatar(self):
        self.card['codex']={'source':'usage-ui','days':[],'usage':{'tokens':123456,'credits':3.5}}
        self.card['zhihu']={'name':'a','url':'https://www.zhihu.com/people/a','metrics':{'likes':1,'followers':2,'answers':3,'articles':4,'interactions':5},'avatar':{'format':'rgb565le','width':24,'height':24,'data':base64.b64encode(bytes(1152)).decode()}}
        self.assertEqual(loads(validate(self.card))['zhihu']['metrics']['interactions'],5)
    def test_ble_payload_uses_negotiated_size_with_safe_bounds(self):
        self.assertEqual(transfer_payload_size(SimpleNamespace(max_write_without_response_size=244)),241)
        self.assertEqual(transfer_payload_size(SimpleNamespace(max_write_without_response_size=20)),17)
        self.assertEqual(transfer_payload_size(SimpleNamespace(max_write_without_response_size=999)),241)
        self.assertEqual(transfer_payload_size(SimpleNamespace()),17)
class BridgeTests(unittest.TestCase):
    def setUp(self):
        import bridge, threading, types
        self.bridge=bridge
        self.server=bridge.Server(types.SimpleNamespace(port=0,extension_id='a'*32,device='fixture'))
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.old_send=bridge.send
        async def sent(device,data): return {'status':2,'version':1,'checksum':zlib.crc32(data),'revision':1}
        bridge.send=sent
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.bridge.send=self.old_send
    def post(self,path,body=b'{}',headers=None):
        import http.client,json
        conn=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=3)
        h={'Origin':self.server.origin,'Content-Type':'application/json'};h.update(headers or {})
        conn.request('POST',path,body,h);response=conn.getresponse();result=json.loads(response.read());conn.close();return response.status,result
    def test_origin_code_and_single_use_challenge(self):
        self.assertEqual(self.post('/challenge',headers={'Origin':'https://example.com'})[0],403)
        self.assertEqual(self.post('/challenge')[0],403)
        status,result=self.post('/challenge',headers={'X-Folo-Code':self.server.code});self.assertEqual(status,200)
        data=validate({'version':1,'updatedAt':'2026-09-07T10:30:00Z','codex':{'source':'profile-ui','days':[]}})
        headers={'X-Folo-Challenge':result['challenge']}
        self.assertEqual(self.post('/sync',data,headers)[0],200)
        self.assertEqual(self.post('/sync',data,headers)[0],403)
    def test_host_and_size_rejection(self):
        self.assertEqual(self.post('/challenge',headers={'Host':'evil.example'})[0],403)
        self.assertEqual(self.post('/challenge',body=b'x'*8193)[0],400)
    def test_usage_requires_origin_and_code_without_bluetooth(self):
        class Usage:
            def read(self):return {'source':'local-logs','days':[{'date':'2026-09-08','tokens':42,'intensity':4}]}
        self.server.usage=Usage();self.server.device=None
        self.assertEqual(self.post('/codex/usage')[0],403)
        self.assertEqual(self.post('/codex/usage',headers={'Origin':'https://example.com','X-Folo-Code':self.server.code})[0],403)
        status,result=self.post('/codex/usage',headers={'X-Folo-Code':self.server.code})
        self.assertEqual(status,200);self.assertEqual(result['days'][0]['tokens'],42)
        self.assertEqual(self.post('/sync')[0],409)
if __name__=='__main__':unittest.main()
