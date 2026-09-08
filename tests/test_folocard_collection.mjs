import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectAccounts, sites, mergeAccount} from '../tools/folocard/extension/collection.js';
import {runCollection} from '../tools/folocard/extension/collection-job.js';
import {readLocalUsage, syncNativeDevice} from '../tools/folocard/extension/local-usage.js';

const empty=()=>({version:1,updatedAt:'2026-09-07T00:00:00Z',codex:{source:'profile-ui',days:[]}});
function mockBrowser({login, deny, blocked, tabs=[], failedAvatar=false, codexAPI}={}) {
  let tick=0, id=100;
  const open=new Map(tabs.map(tab=>[tab.id,tab]));
  const calls={queries:[],created:[],removed:[],extracted:[],saved:[]};
  const ownUrl=site=>site.id==='codex'?site.home:site.origin+(site.id==='zhihu'?'/people/self':'/user/profile/self');
  const api={
    permissions:{contains:async({origins})=>!deny || !origins[0].includes(deny)},
    tabs:{query:async query=>{calls.queries.push(query);return [...open.values()].filter(tab=>tab.url.startsWith(query.url.slice(0,-1)));},
      get:async id=>{if(!open.has(id))throw Error('Closed');return open.get(id);},
      create:async({url,active})=>{const tab={id:++id,url,active,status:'complete'};calls.created.push(tab);open.set(tab.id,tab);return tab;},
      remove:async id=>{calls.removed.push(id);open.delete(id);}},
    scripting:{executeScript:async({target,func})=>{
      const tab=open.get(target.tabId), site=sites.find(site=>tab.url.startsWith(site.origin));
      if(func.name==='fetchCodexUsage') return [{result:codexAPI || {status:'unavailable'}}];
      if(func.name==='discoverAccount') return [{result:site.id===login?{status:'login_required'}:site.id===blocked?{status:'pending',message:'站点验证未完成'}:{status:'ready',url:ownUrl(site)}}];
      calls.extracted.push(tab.url);
      return [{result:{site:site.id,data:site.id==='codex'?{source:'usage-ui',days:[],quota:{usedPercent:25,resetsAt:'2026-09-08T00:00:00Z'}}:{name:site.name,url:ownUrl(site),metrics:{followers:42},...(failedAvatar?{avatarUrl:'https://pic1.zhimg.com/avatar.jpg'}:{})}}}];
    }},
    storage:{local:{set:async value=>calls.saved.push(structuredClone(value))}}
  };
  return {api,calls,open,clock:{now:()=>tick,pause:async ms=>{tick+=ms;},timeout:1000}};
}

test('Auto-discovery ignores active unrelated/other-user tabs and collects all three own accounts',async()=>{
  const {api,calls,clock}=mockBrowser({tabs:[{id:1,url:'https://www.zhihu.com/people/other',active:true,status:'complete'}]});
  const events=[];
  const outcomes=await collectAccounts(api,event=>events.push(event),clock);
  assert.deepEqual(outcomes.map(item=>item.status),['success','success','success']);
  assert.ok(calls.extracted.includes('https://www.zhihu.com/people/self'));
  assert.ok(!calls.extracted.includes('https://www.zhihu.com/people/other'));
  assert.ok(!calls.removed.includes(1));
  assert.equal(calls.queries.length,3);
  assert.ok(calls.created.every(tab=>tab.active===false));
  assert.equal(events.filter(event=>event.status==='success').length,3);
});
test('Logged-out site keeps its login tab, other accounts succeed and retain local results',async()=>{
  const {api,calls,clock,open}=mockBrowser({login:'xiaohongshu',failedAvatar:true});
  const original=empty();original.xiaohongshu={name:'Previously saved',url:'https://www.xiaohongshu.com/user/profile/old',metrics:{likes:7}};
  const final=await runCollection(api,original,(api,report)=>collectAccounts(api,report,clock),async()=>{throw Error('Failed avatar');});
  assert.equal(final.collection.running,false);
  assert.equal(final.collection.sites.xiaohongshu.status,'login_required');
  assert.ok(open.has(final.collection.sites.xiaohongshu.tabId));
  assert.deepEqual(final.card.xiaohongshu,original.xiaohongshu);
  assert.equal(final.card.zhihu.metrics.followers,42);
  assert.equal(final.card.codex.quota.usedPercent,25);
  assert.match(final.collection.sites.zhihu.message,/头像未更新/);
  assert.ok(calls.saved.some(state=>state.card?.zhihu?.metrics?.followers===42));
});
test('Avatar collection retries trusted page candidates and stores the first successful conversion',async()=>{
  const {api}=mockBrowser();
  const expected={format:'rgb565le',width:24,height:24,data:'AAAA'};
  const attempts=[];
  const collect=async(_api,report)=>report({site:'zhihu',status:'success',message:'已读取',data:{name:'知乎',url:'https://www.zhihu.com/people/self',metrics:{},avatarUrl:'https://pic1.zhimg.com/placeholder.jpg',avatarUrls:['https://pic1.zhimg.com/placeholder.jpg','https://pic2.zhimg.com/avatar.jpg']}});
  const result=await runCollection(api,empty(),collect,async url=>{attempts.push(url);if(url.includes('placeholder'))throw Error('头像下载失败（HTTP 403）');return expected;},{local:async()=>({status:'error',message:'跳过'})});
  assert.deepEqual(attempts,['https://pic1.zhimg.com/placeholder.jpg','https://pic2.zhimg.com/avatar.jpg']);
  assert.deepEqual(result.card.zhihu.avatar,expected);
  assert.match(result.collection.sites.zhihu.message,/资料和头像已读取/);
  assert.ok(!('avatarUrl' in result.card.zhihu));assert.ok(!('avatarUrls' in result.card.zhihu));
});
test('Missing permission and challenge timeout are distinct from logged out',async()=>{
  const {api,clock}=mockBrowser({deny:'zhihu.com',blocked:'xiaohongshu'});
  const outcomes=await collectAccounts(api,()=>{},clock);
  assert.equal(outcomes.find(site=>site.site==='zhihu').status,'permission_required');
  assert.equal(outcomes.find(site=>site.site==='xiaohongshu').status,'error');
  assert.match(outcomes.find(site=>site.site==='xiaohongshu').message,/验证/);
});
test('Manual navigation during collection prevents extracting a different account',async()=>{
  const {api,clock,open}=mockBrowser();
  const original=api.scripting.executeScript;
  api.scripting.executeScript=async args=>{
    const result=await original(args);
    if(args.func.name==='discoverAccount' && open.get(args.target.tabId).url==='https://www.zhihu.com/people/self') {
      open.get(args.target.tabId).url='https://www.zhihu.com/people/other';
      open.get(args.target.tabId).active=true;
    }
    return result;
  };
  const outcomes=await collectAccounts(api,()=>{},clock);
  assert.equal(outcomes.find(site=>site.site==='zhihu').status,'error');
  assert.ok([...open.values()].some(tab=>tab.url.endsWith('/other')));
});
test('Account changes clear old identity fields; same account preserves absent metrics',()=>{
  const card=empty();card.zhihu={name:'Old',url:'https://www.zhihu.com/people/old',bio:'old bio',avatar:{data:'old'},metrics:{likes:99}};
  const next=mergeAccount(card,'zhihu',{name:'New',url:'https://www.zhihu.com/people/new',metrics:{followers:42}});
  assert.deepEqual(next.zhihu.metrics,{followers:42});assert.ok(!next.zhihu.avatar);assert.ok(!next.zhihu.bio);
  const same=mergeAccount(card,'zhihu',{name:'Old',url:card.zhihu.url,metrics:{followers:42}});
  assert.deepEqual(same.zhihu.metrics,{likes:99,followers:42});
});

test('Codex API success uses an existing ChatGPT tab without navigating or scraping it',async()=>{
  const summary={source:'usage-api',windows:[{kind:'primary',usedPercent:25,windowSeconds:18000,resetsAt:'2026-09-08T12:00:00Z'},{kind:'secondary',usedPercent:60,windowSeconds:604800,resetsAt:'2026-09-10T12:00:00Z'}],deviceWindow:'primary',creditsRemaining:45};
  const data={source:'usage-ui',days:[],quota:{usedPercent:25,resetsAt:'2026-09-08T12:00:00Z'}};
  const {api,clock,calls}=mockBrowser({tabs:[{id:1,url:'https://chatgpt.com/c/example',status:'complete',active:true}],codexAPI:{status:'success',data,summary}});
  const result=await runCollection(api,empty(),(api,report)=>collectAccounts(api,report,clock));
  assert.deepEqual(result.card.codex,data);
  assert.deepEqual(result.collection.sites.codex.summary,summary);
  assert.ok(!calls.created.some(tab=>tab.url.startsWith('https://chatgpt.com')));
  assert.ok(!calls.extracted.some(url=>url.startsWith('https://chatgpt.com')));
  assert.ok(!JSON.stringify(result.card).includes('creditsRemaining'));
});
test('Codex API login failure or rate limiting never falls back to stale dashboard text',async()=>{
  for (const status of ['login_required','rate_limited']) {
    const {api,clock,calls}=mockBrowser({codexAPI:{status,message:'请检查账号'}});
    const result=await collectAccounts(api,()=>{},clock);
    assert.equal(result[0].status,status==='login_required'?'login_required':'error');
    assert.ok(!calls.extracted.some(url=>url.startsWith('https://chatgpt.com')));
  }
});
test('Browser-only credits do not erase an existing device card or become consumed credit',async()=>{
  const original=empty();original.codex.quota={usedPercent:15,resetsAt:'2026-09-08T12:00:00Z'};
  const {api,clock}=mockBrowser({codexAPI:{status:'success',data:{source:'usage-ui',days:[]},summary:{source:'usage-api',windows:[],creditsRemaining:0}}});
  const result=await runCollection(api,original,(api,report)=>collectAccounts(api,report,clock));
  assert.deepEqual(result.card.codex,original.codex);
  assert.equal(result.collection.sites.codex.summary.creditsRemaining,0);
  assert.ok(!result.card.codex.usage);
});

const nativeUsage=()=>({status:'success',source:'local-logs',days:[{date:'2026-09-07',tokens:1234,intensity:4}],totalTokens:1234,updatedAt:'2026-09-08T10:00:00+08:00',partial:false,message:'已读取本机 Codex 每日 Token。'});
test('Native daily tokens survive a late browser quota response and browser logout',async()=>{
  for(const login of [undefined,'codex']) {
    const {api,clock}=mockBrowser({login});
    const result=await runCollection(api,empty(),(api,report)=>collectAccounts(api,report,clock),undefined,{local:async()=>nativeUsage()});
    assert.deepEqual(result.card.codex.days,nativeUsage().days);
    assert.ok(!result.card.codex.usage);
    assert.equal(result.collection.localCodex.status,'success');
    assert.equal(result.collection.sites.codex.status,login?'login_required':'success');
    if(!login) assert.equal(result.card.codex.quota.usedPercent,25);
    assert.ok(!JSON.stringify(result.card).includes('local-logs'));
  }
});
test('Bridge failure preserves last daily tokens while quota refreshes',async()=>{
  const original=empty();original.codex.days=nativeUsage().days;original.codex.usage={tokens:1234};
  const {api,clock}=mockBrowser();
  const result=await runCollection(api,original,(api,report)=>collectAccounts(api,report,clock),undefined,{local:async()=>({status:'error',message:'桥接未启动'})});
  assert.deepEqual(result.card.codex.days,original.codex.days);assert.equal(result.card.codex.quota.usedPercent,25);
  assert.match(result.collection.localCodex.message,/保留上次/);
});
test('Native usage can add Codex to a social-only card',async()=>{
  const {api}=mockBrowser();const card={version:1,updatedAt:'2026-09-08T00:00:00Z',zhihu:{name:'Fixture',url:'https://www.zhihu.com/people/fixture',metrics:{}}};
  const result=await runCollection(api,card,async()=>{},undefined,{local:async()=>nativeUsage()});
  assert.deepEqual(result.card.codex.days,nativeUsage().days);
});
function withNativeResult(api,value) {
  api.runtime={connectNative:()=>{
    let listener;
    return {onMessage:{addListener:fn=>listener=fn},onDisconnect:{addListener:()=>{}},postMessage:()=>queueMicrotask(()=>listener(value)),disconnect:()=>{}};
  }};
  return api;
}
test('Native client validates totals and never returns arbitrary payload fields',async()=>{
  const {api}=mockBrowser();
  assert.equal((await readLocalUsage(api)).status,'setup_required');
  const result=await readLocalUsage(withNativeResult(api,{...nativeUsage(),prompt:'must not escape'}));
  assert.equal(result.totalTokens,1234);assert.ok(!('prompt' in result));
  assert.equal((await readLocalUsage(withNativeResult(api,{...nativeUsage(),totalTokens:1}))).status,'error');
  assert.equal((await readLocalUsage(withNativeResult(api,{error:'本机组件读取失败'}))).message,'本机组件读取失败');
});
test('Native host starts automatically without code or HTTP',async()=>{
  const {api}=mockBrowser();let disconnected=false, listener;
  api.runtime={connectNative:name=>{assert.equal(name,'com.folotoy.folocard');return {
    onMessage:{addListener:fn=>listener=fn},onDisconnect:{addListener:()=>{}},
    postMessage:message=>{assert.deepEqual(message,{type:'codex-usage'});queueMicrotask(()=>listener(nativeUsage()));},disconnect:()=>{disconnected=true;}
  };}};
  const result=await readLocalUsage(api);
  assert.equal(result.status,'success');assert.equal(result.totalTokens,1234);assert.equal(disconnected,true);
});
test('Device sync uses native messaging and validates the acknowledgement',async()=>{
  let listener,posted,disconnected=false;
  const api={runtime:{connectNative:name=>{assert.equal(name,'com.folotoy.folocard');return {
    onMessage:{addListener:fn=>listener=fn},onDisconnect:{addListener:()=>{}},
    postMessage:message=>{posted=message;queueMicrotask(()=>listener({status:2,revision:4,checksum:123}));},
    disconnect:()=>{disconnected=true;}
  };}}};
  const card=empty();const result=await syncNativeDevice(api,card);
  assert.deepEqual(posted,{type:'sync-device',card});assert.equal(result.revision,4);assert.equal(disconnected,true);
});
test('Normal redirect from old Codex dashboard to analytics is accepted',async()=>{
  const old='https://chatgpt.com/codex/settings/usage',latest='https://chatgpt.com/codex/cloud/settings/analytics#usage';
  const {api,clock,open}=mockBrowser({tabs:[{id:1,url:old,status:'complete',active:true}]});
  const execute=api.scripting.executeScript;let probes=0;
  api.scripting.executeScript=async args=>{
    if(args.func.name==='discoverAccount' && args.args[0]==='codex') {
      if(++probes===1)return [{result:{status:'ready',url:old}}];
      open.get(args.target.tabId).url=latest;
      return [{result:{status:'ready',url:latest.split('#')[0]}}];
    }
    return execute(args);
  };
  const result=await collectAccounts(api,()=>{},clock);
  assert.equal(result[0].status,'success');
});
