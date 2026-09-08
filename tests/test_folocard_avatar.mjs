import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeAvatar} from '../tools/folocard/extension/avatar.js';

function runtime(rgba) {
  const calls={permission:[],fetch:[]};
  class Canvas {
    getContext() { return {drawImage:()=>{},getImageData:()=>({data:rgba})}; }
  }
  return {calls,api:{permissions:{contains:async value=>{calls.permission.push(value);return true;}}},value:{
    fetch:async(url,options)=>{calls.fetch.push({url,options});return {ok:true,status:200,blob:async()=>({size:128})};},
    AbortSignal:{timeout:ms=>({ms})},createImageBitmap:async()=>({width:48,height:32,close:()=>{calls.closed=true;}}),
    OffscreenCanvas:Canvas,btoa:value=>Buffer.from(value,'latin1').toString('base64')
  }};
}

test('Avatar download uses the declared wildcard permission and emits RGB565LE',async()=>{
  const rgba=new Uint8ClampedArray(24*24*4);
  rgba.set([255,0,0,255,0,255,0,255]);
  const mock=runtime(rgba);
  const avatar=await encodeAvatar('https://pic1.zhimg.com/avatar.jpg','zhihu',mock.api,mock.value);
  assert.deepEqual(mock.calls.permission,[{origins:['https://*.zhimg.com/*']}]);
  assert.equal(mock.calls.fetch[0].options.signal.ms,8000);
  const bytes=Buffer.from(avatar.data,'base64');
  assert.deepEqual([...bytes.subarray(0,4)],[0x00,0xf8,0xe0,0x07]);
  assert.equal(bytes.length,1152);assert.equal(mock.calls.closed,true);
});

test('Avatar download rejects URLs outside the platform CDN before fetching',async()=>{
  const mock=runtime(new Uint8ClampedArray(24*24*4));
  assert.equal(await encodeAvatar('https://zhimg.com.evil.example/avatar.jpg','zhihu',mock.api,mock.value),undefined);
  assert.equal(mock.calls.permission.length,0);assert.equal(mock.calls.fetch.length,0);
});
