import datetime as dt
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'tools/folocard'))
from codex_local import LocalUsage
from protocol import validate

NOW = dt.datetime(2026, 9, 8, 23, 59).astimezone()


def event(day, total=None, last=None):
    info = {}
    for key, value in [('total_token_usage', total), ('last_token_usage', last)]:
        if value is not None:
            info[key] = {'input_tokens': value, 'output_tokens': value//10,
                         'cached_input_tokens': value//2, 'reasoning_output_tokens': value//20}
    return {'type':'event_msg', 'timestamp':dt.datetime(2026, 9, day, 12).astimezone().isoformat(),
            'payload':{'type':'token_count', 'info':info}}


class LocalTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.home=Path(self.temp.name)
        (self.home/'sessions').mkdir(); (self.home/'archived_sessions').mkdir()
        self.reader=LocalUsage(self.home)
    def tearDown(self): self.temp.cleanup()
    def write(self, name, events, folder='sessions', parent=None):
        meta={'id':name, 'timestamp':dt.datetime(2026,9,7,13).astimezone().isoformat()}
        if parent: meta['forked_from_id']=parent
        path=self.home/folder/(name+'.jsonl')
        rows=[{'type':'session_meta','payload':meta}, *events]
        path.write_text(''.join(json.dumps(row)+'\n' for row in rows))
        return path
    def test_daily_duplicates_and_cache_subsets(self):
        events=[event(7,100,100),event(7,100,100),event(8,150,50)]
        self.write('one',events);self.write('one',events,'archived_sessions')
        result=self.reader.read(NOW)
        self.assertEqual([d['tokens'] for d in result['days']],[110,55])
        self.assertEqual(result['totalTokens'],165)
        wire=validate({'version':1,'updatedAt':result['updatedAt'],'codex':{'source':'usage-ui','days':result['days'],'usage':{'tokens':result['totalTokens']}}})
        self.assertNotIn(b'one',wire)
    def test_append_incomplete_line_then_truncation(self):
        path=self.write('one',[event(7,100,100)])
        self.assertEqual(self.reader.read(NOW)['totalTokens'],110)
        line=json.dumps(event(8,150,50))
        with path.open('a') as f:f.write(line[:20])
        self.assertEqual(self.reader.read(NOW)['totalTokens'],110)
        with path.open('a') as f:f.write(line[20:]+'\n')
        self.assertEqual(self.reader.read(NOW)['totalTokens'],165)
        self.write('one',[event(8,20,20)])
        self.assertEqual(self.reader.read(NOW)['totalTokens'],22)
    def test_fork_excludes_parent_prefix(self):
        self.write('parent',[event(7,100,100)])
        self.write('child',[event(7,100,100),event(8,130,30)],parent='parent')
        self.assertEqual(self.reader.read(NOW)['totalTokens'],143)
    def test_unresolved_fork_is_partial_not_new_usage(self):
        self.write('one',[event(8,20,20)])
        self.write('child',[event(8,1000000,1000000)],parent='missing')
        result=self.reader.read(NOW)
        self.assertEqual(result['totalTokens'],22);self.assertTrue(result['partial'])
    def test_regression_does_not_recount_watermark(self):
        self.write('one',[event(6,100,100),event(7,50,50),event(8,150,50)])
        result=self.reader.read(NOW)
        self.assertEqual(result['totalTokens'],165);self.assertTrue(result['partial'])
    def test_missing_records_not_fabricated_and_no_auth_read(self):
        (self.home/'auth.json').write_text('must not be opened')
        self.write('one',[{'type':'response_item','payload':{'content':'private text'}},event(8,None,20)])
        result=self.reader.read(NOW)
        self.assertEqual(len(result['days']),1)
        self.assertNotIn('private',json.dumps(result));self.assertNotIn('must not',json.dumps(result))
    def test_zero_and_invalid_counters(self):
        self.write('one',[event(7,0,0),event(8,-10,-10)])
        result=self.reader.read(NOW)
        self.assertEqual(result['days'][0]['tokens'],0);self.assertTrue(result['partial'])
    def test_missing_home_and_symlink(self):
        with self.assertRaisesRegex(ValueError,'未找到'):self.reader.read(NOW)
        target=self.home/'outside.jsonl';target.write_text(json.dumps(event(8,100,100))+'\n')
        (self.home/'sessions'/'link.jsonl').symlink_to(target)
        with self.assertRaisesRegex(ValueError,'未找到'):self.reader.read(NOW)


if __name__=='__main__': unittest.main()
