import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {chromium} from '../tools/folocard/node_modules/playwright/index.mjs';
import {extractVisiblePage} from '../tools/folocard/extension/adapters.js';
import {discoverAccount} from '../tools/folocard/extension/accounts.js';
import {fetchCodexUsage, codexWindowLabel} from '../tools/folocard/extension/codex-usage.js';
import {spawnSync} from 'node:child_process';
let browser;
before(async()=>{browser=await chromium.launch({headless:true,executablePath:process.env.FOLOCARD_CHROME || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined)});});
after(async()=>{await browser?.close();});
async function fixture(name,url) {
 const page=await browser.newPage();
 const html=await readFile(new URL(`./fixtures/folocard/${name}.html`,import.meta.url),'utf8');
 await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:html}));
 await page.goto(url);return page;
}
test('Codex preserves explicit token absence and excludes hidden data',async()=>{
 const page=await fixture('codex','https://chatgpt.com/codex/profile');
 const result=await page.evaluate(extractVisiblePage);
 assert.equal(result.data.days.length,2);assert.equal(result.data.days[0].tokens,1234);
 assert.equal(result.data.days[1].intensity,4);assert.ok(!('tokens' in result.data.days[1]));await page.close();
});
test('Codex reads only explicitly labeled usage values',async()=>{
 const page=await fixture('codex-usage','https://chatgpt.com/codex/settings/usage');
 const result=await page.evaluate(extractVisiblePage);
 assert.deepEqual(result.data.usage,{tokens:123456,credits:3.5});
 assert.deepEqual(result.data.quota,{usedPercent:42,resetsAt:'2026-09-08T00:00:00Z'});await page.close();
});
test('Zhihu public profile and metrics',async()=>{
 const page=await fixture('zhihu','https://www.zhihu.com/people/example');
 const result=await page.evaluate(extractVisiblePage);
 assert.deepEqual(result.data.metrics,{likes:1200,followers:520,answers:12,articles:3});
 assert.equal(result.data.avatarUrl,'https://pic1.zhimg.com/avatar.jpg');await page.close();
});
test('XHS abbreviated metrics require preview',async()=>{
 const page=await fixture('xiaohongshu','https://www.xiaohongshu.com/user/profile/example?xsec_token=not-retained');
 const result=await page.evaluate(extractVisiblePage);
 assert.deepEqual(result.data.metrics,{likes:8600,followers:12000});assert.ok(!result.data.url.includes('?'));
 assert.equal(result.data.bio,'Public biography');await page.close();
});
test('XHS canonicalizes multiline profile text for the device protocol',async()=>{
 const page=await fixture('xiaohongshu','https://www.xiaohongshu.com/user/profile/example');
 await page.setContent('<div class="user-name">Owner</div><div class="user-desc">First line<br>Second line</div>');
 const result=await page.evaluate(extractVisiblePage);
 assert.equal(result.data.bio,'First line Second line');
 assert.ok(!/[\u0000-\u001f\u007f]/.test(result.data.bio));await page.close();
});
test('XHS skips a lazy-load placeholder and keeps trusted avatar candidates',async()=>{
 const page=await fixture('xiaohongshu','https://www.xiaohongshu.com/user/profile/example');
 await page.setContent('<h1 class="user-name">Fixture</h1><div class="avatar"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" data-src="https://sns-avatar-qc.xhscdn.com/avatar/example.jpg"></div>');
 const result=await page.evaluate(extractVisiblePage);
 assert.equal(result.data.avatarUrl,'https://sns-avatar-qc.xhscdn.com/avatar/example.jpg');
 assert.deepEqual(result.data.avatarUrls,[result.data.avatarUrl]);await page.close();
});
test('Changed DOM fails rather than returning an empty overwrite',async()=>{
 const page=await fixture('zhihu','https://www.zhihu.com/people/example');
 await page.locator('h1').evaluate(el=>el.remove());
 await assert.rejects(page.evaluate(extractVisiblePage),/适配器需要更新/);await page.close();
});
test('Popup previews the stored card and syncs only after confirmation',async()=>{
 const page=await browser.newPage({viewport:{width:700,height:1200},deviceScaleFactor:1});
 let syncCalls=0;
 await page.exposeFunction('syncRequested',()=>syncCalls++);
 await page.addInitScript(()=>{
   window.chrome={storage:{local:{get:async()=>({card:{version:1,updatedAt:'2026-09-08T00:00:00Z',codex:{source:'profile-ui',days:[]},zhihu:{name:'Fixture account',url:'https://www.zhihu.com/people/example',metrics:{followers:520}},xiaohongshu:{name:'Fixture XHS',bio:'First line\n\nSecond line',url:'https://www.xiaohongshu.com/user/profile/example',metrics:{likes:8}}}}),set:async()=>{}}},permissions:{contains:async()=>true},runtime:{id:'a'.repeat(32),sendMessage:async msg=>{if(msg.type==='sync'){await window.syncRequested();window.syncedCard=msg.card;return {result:{revision:1,checksum:'fixture'}};}return {};}}};
 });
 await page.route('http://127.0.0.1:17322/**',async r=>{
   const path=new URL(r.request().url()).pathname.slice(1)||'popup.html';
   const body=await readFile(new URL('../tools/folocard/extension/'+path,import.meta.url));
   await r.fulfill({body,contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html'});
 });
 await page.goto('http://127.0.0.1:17322/popup.html');
  await page.waitForFunction(()=>document.querySelectorAll('#heatmap span').length===84);
  assert.equal(await page.locator('#heatmap span').count(),84);
  assert.match(await page.locator('#zhihu').innerText(),/Fixture account/);
  assert.match(await page.locator('#deviceScreen').innerText(),/请先同步数据/);
  assert.doesNotMatch(await page.locator('#deviceScreen').innerText(),/84 DAYS/);
  assert.equal(await page.locator('.deviceCodexSummary').evaluate(el=>getComputedStyle(el).whiteSpace),'nowrap');
  await page.locator('#deviceNext').click();
  assert.match(await page.locator('#deviceScreen').innerText(),/Fixture account/);
  await page.locator('#deviceDetail').click();
  assert.match(await page.locator('#deviceScreen').innerText(),/二维码/);
  assert.equal(syncCalls,0);
  await page.locator('#sync').click();
  assert.match(await page.locator('#status').innerText(),/请先确认/);
  assert.equal(syncCalls,0);
  await page.locator('#confirm').check();
  await page.locator('#sync').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('设备保存成功'));
  assert.equal(syncCalls,1);
  assert.equal(await page.evaluate(()=>window.syncedCard.zhihu.metrics.followers),520);
  assert.equal(await page.evaluate(()=>window.syncedCard.xiaohongshu.bio),'First line Second line');
 await page.screenshot({path:new URL('../build/folocard-extension-preview.png',import.meta.url).pathname,fullPage:true});
 await page.close();
});

test('Zhihu accepts profile subpages and visible achievement wording when API fails',async()=>{
 const page=await fixture('zhihu','https://www.zhihu.com/people/example/answers');
 await page.setContent('<h1><span class="ProfileHeader-name">Profile Owner</span><span>Bio</span></h1><a><span>关注者</span><strong>7.8 万</strong></a><div><svg></svg>获得 <strong>274,563</strong> 次赞同</div><a>回答<span>1,061</span></a><a>文章<span>177</span></a>');
 const result=await page.evaluate(extractVisiblePage);
 assert.equal(result.data.name,'Profile Owner');
 assert.deepEqual(result.data.metrics,{likes:274563,followers:78000,answers:1061,articles:177});
 assert.equal(result.data.url,'https://www.zhihu.com/people/example');await page.close();
});
test('Zhihu home resolves signed-in identity without collecting feed metrics',async()=>{
 const page=await fixture('zhihu','https://www.zhihu.com/');
 await page.route('**/api/v4/me',r=>r.fulfill({json:{url_token:'self',name:'Owner'}}));
 await page.route('**/api/v4/members/**',r=>r.fulfill({json:{name:'Owner',follower_count:42}}));
 const result=await page.evaluate(extractVisiblePage);
 assert.equal(result.data.url,'https://www.zhihu.com/people/self');
 assert.deepEqual(result.data.metrics,{followers:42});await page.close();
});
test('XHS prioritizes profile name and handles separated count/unit and nested stats',async()=>{
 const page=await fixture('xiaohongshu','https://www.xiaohongshu.com/user/profile/example');
 await page.setContent('<div class="name">Unrelated author</div><div class="user-info"><div class="user-name">Owner</div><div><span><b>1.2 万</b></span><span>粉丝</span><i></i></div><div><span>8.6 千</span><span>获赞与收藏</span></div></div><div>999 粉丝</div>');
 const result=await page.evaluate(extractVisiblePage);
 assert.equal(result.data.name,'Owner');assert.equal(result.data.metrics.followers,12000);await page.close();
});
test('Codex converts remaining quota and relative reset without requiring a time element',async()=>{
 const page=await fixture('codex-usage','https://chatgpt.com/codex/settings/usage');
 await page.setContent('<main><section><h2>5 hour usage limit</h2><p>75% remaining</p><p>Resets in 2h 30m</p></section><section><h2>Weekly limit</h2><p>90% remaining</p><p>Resets in 24h</p></section></main>');
 const start=Date.now();const result=await page.evaluate(extractVisiblePage);
 assert.equal(result.data.quota.usedPercent,25);
 assert.ok(Math.abs(Date.parse(result.data.quota.resetsAt)-start-150*60000)<3000);await page.close();
});
test('Codex does not extract usage-looking conversation content',async()=>{
 const page=await fixture('codex-usage','https://chatgpt.com/c/example');
 await assert.rejects(page.evaluate(extractVisiblePage),/而非 ChatGPT/);await page.close();
});
test('Codex analytics route parses weekly plain-text reset after a normal migration',async()=>{
 const page=await fixture('codex-usage','https://chatgpt.com/codex/cloud/settings/analytics#usage');
 await page.setContent('<main><h1>Codex and Work Analytics</h1><div><h2>Balance</h2><div>Weekly usage limit 89% remaining</div><p>Resets Sep 14, 2026 11:43 PM</p><p>Credits remaining 44</p></div></main>');
 const account=await page.evaluate(discoverAccount,'codex');
 assert.equal(account.url,'https://chatgpt.com/codex/cloud/settings/analytics');
 const result=await page.evaluate(extractVisiblePage,{expectedUrl:account.url});
 assert.equal(result.data.quota.usedPercent,11);assert.ok(Number.isFinite(Date.parse(result.data.quota.resetsAt)));
 assert.ok(!result.data.usage);await page.close();
});
test('Standalone collection works without a source tab and offers login for failed sites',async()=>{
 const page=await browser.newPage({viewport:{width:700,height:1000}});
 await page.addInitScript(()=>{
   window.savedCard=null;
   window.chrome={
     storage:{local:{get:async()=>({card:{version:1,updatedAt:'2026-09-07T00:00:00Z',codex:{source:'profile-ui',days:[]},zhihu:{name:'Old account',url:'https://www.zhihu.com/people/old',metrics:{likes:999},avatar:{format:'rgb565le',width:24,height:24,data:'AAAA'.repeat(384)}}}}),set:async({card})=>{window.savedCard=card;}}},
     tabs:{create:async({url})=>{window.loginUrl=url;}},
     permissions:{request:async()=>true},
     runtime:{id:'a'.repeat(32),sendMessage:async msg=>{
       if(msg.type==='collection-status')return {};
       if(msg.type!=='collect')throw Error('Unexpected sync');
       if('code' in msg)throw Error('Legacy bridge code must not be sent');
       const card={...msg.card,zhihu:{name:'New account',url:'https://www.zhihu.com/people/new',metrics:{followers:42}}};
       window.savedCard=card;
       const localCodex={status:'success',source:'local-logs',days:[{date:'2026-09-07',tokens:1234,intensity:4}],totalTokens:1234,message:'已读取本机 Codex 每日 Token。'};
       card.codex={source:'usage-ui',days:localCodex.days};
       return {card,collection:{running:false,localCodex,sites:{codex:{status:'success',message:'已读取',summary:{source:'usage-api',windows:[{kind:'primary',usedPercent:25,windowSeconds:18000,resetsAt:'2026-09-08T12:00:00Z'},{kind:'secondary',usedPercent:60,windowSeconds:604800,resetsAt:'2026-09-10T12:00:00Z'}],deviceWindow:'primary',creditsRemaining:45}},zhihu:{status:'success',message:'资料已读取；头像未更新。'},xiaohongshu:{status:'login_required',message:'请先登录小红书'}}}};
     }}
   };
 });
 await page.route('https://pic1.zhimg.com/**',r=>r.fulfill({status:403,body:''}));
 await page.route('http://127.0.0.1:17322/**',async r=>{
   const path=new URL(r.request().url()).pathname.slice(1)||'popup.html';
   await r.fulfill({body:await readFile(new URL('../tools/folocard/extension/'+path,import.meta.url)),contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html'});
 });
 await page.goto('http://127.0.0.1:17322/popup.html');
 await page.locator('#deviceNext').click();
 assert.equal(await page.locator('#deviceScreen canvas.deviceAvatar').count(),1);
 await page.locator('#devicePrev').click();
 await page.locator('#extract').click();
 await page.waitForFunction(()=>window.savedCard?.zhihu?.name==='New account');
 assert.match(await page.locator('#collectionStatus').innerText(),/头像未更新/);
 assert.match(await page.locator('#status').innerText(),/2\/3/);
 const limits=await page.locator('#codexDetails').innerText();
 assert.match(limits,/5 小时额度/);assert.match(limits,/每周额度/);
 assert.match(limits,/75%/);assert.match(limits,/40%/);assert.match(limits,/45/);
 assert.equal(await page.locator('#codexDetails progress').count(),2);
 assert.match(await page.locator('#localCodex').innerText(),/1,234/);
 assert.match(await page.locator('.deviceCodexSummary').innerText(),/本周活跃：\s*1天/);
 const labelBox=await page.locator('.deviceCodexSummary span').boundingBox();
 const activeBox=await page.locator('.deviceCodexSummary strong').boundingBox();
 assert.ok(Math.abs((activeBox.y+activeBox.height/2)-(labelBox.y+labelBox.height/2))<1);
 const summaryLayout=await page.locator('.deviceCodexSummary').evaluate(element=>({
   whiteSpace:getComputedStyle(element).whiteSpace,
   clientWidth:element.clientWidth,
   scrollWidth:element.scrollWidth,
   clientHeight:element.clientHeight,
   scrollHeight:element.scrollHeight
 }));
 assert.equal(summaryLayout.whiteSpace,'nowrap');
 assert.ok(summaryLayout.scrollWidth<=summaryLayout.clientWidth);
 assert.ok(summaryLayout.scrollHeight<=summaryLayout.clientHeight);
 assert.doesNotMatch(await page.locator('.deviceCodexSummary').innerText(),/84 DAYS/);
 await page.locator('#localCodex summary').click();
 assert.match(await page.locator('#localCodex table').innerText(),/2026-09-07/);
 await page.locator('#deviceDetail').click();
 assert.match(await page.locator('#deviceScreen').innerText(),/2026-09-07/);
 assert.match(await page.locator('#deviceScreen').innerText(),/1,234/);
 await page.locator('.intro').screenshot({path:new URL('../build/folocard-codex-usage-preview.png',import.meta.url).pathname});
 await page.getByRole('button',{name:'去登录',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.loginUrl),'https://www.xiaohongshu.com/explore');
 const profile=await page.evaluate(()=>window.savedCard.zhihu);
 assert.deepEqual(profile.metrics,{followers:42});assert.ok(!profile.avatar);
 await page.reload();await page.close();
});

test('XHS discovery follows the signed-in Me entry instead of the viewed author',async()=>{
 const page=await fixture('xiaohongshu','https://www.xiaohongshu.com/user/profile/other');
 await page.setContent('<div class="user-name">Other Person</div><a href="/user/profile/other">Other Person</a><aside><a href="/user/profile/self?xsec_token=not-retained">我</a></aside>');
 assert.deepEqual(await page.evaluate(discoverAccount,'xiaohongshu'),{status:'ready',url:'https://www.xiaohongshu.com/user/profile/self'});
 await page.setContent('<div class="user-name">Other Person</div><button>登录</button>');
 assert.deepEqual(await page.evaluate(discoverAccount,'xiaohongshu'),{status:'login_required'});
 await page.close();
});
test('Zhihu distinguishes missing login from forbidden or failed requests',async()=>{
 const page=await fixture('zhihu','https://www.zhihu.com/people/other');
 await page.route('**/api/v4/me',r=>r.fulfill({status:401,json:{}}));
 assert.equal((await page.evaluate(discoverAccount,'zhihu')).status,'login_required');
 await page.route('**/api/v4/me',r=>r.fulfill({status:403,json:{}}));
 assert.equal((await page.evaluate(discoverAccount,'zhihu')).status,'pending');
 await page.route('**/api/v4/me',r=>r.fulfill({json:{url_token:'self',name:'Self'}}));
 assert.equal((await page.evaluate(discoverAccount,'zhihu')).url,'https://www.zhihu.com/people/self');
 await page.close();
});
test('Codex login page requests login instead of an adapter update',async()=>{
 const page=await fixture('codex','https://chatgpt.com/auth/login');
 await page.setContent('<button>Log in</button>');
 assert.equal((await page.evaluate(discoverAccount,'codex')).status,'login_required');await page.close();
});

test('Codex API maps independent windows and credit balance without exposing identity or credentials',async()=>{
 const page=await fixture('codex','https://chatgpt.com/c/example');
 const requests=[];
 await page.route('**/backend-api/wham/usage',r=>{
   requests.push(r.request().method());
   return r.fulfill({json:{account_id:'private-account-marker',access_token:'private-session-marker',plan_type:'pro',rate_limit:{primary_window:{used_percent:0,reset_at:1788868800,limit_window_seconds:18000},secondary_window:{used_percent:64,reset_at:1789041600,limit_window_seconds:604800}},credits:{has_credits:true,unlimited:false,balance:'250.5'}}});
 });
 const result=await page.evaluate(fetchCodexUsage);
 assert.equal(result.status,'success');
 assert.deepEqual(result.data,{source:'usage-ui',days:[],quota:{usedPercent:0,resetsAt:new Date(1788868800000).toISOString().replace('.000Z','Z')}});
 assert.equal(result.summary.windows[1].usedPercent,64);
 assert.equal(result.summary.creditsRemaining,250.5);
 assert.equal(result.summary.deviceWindow,'primary');
 assert.equal(codexWindowLabel(result.summary.windows[0]),'5 小时额度');
 assert.equal(codexWindowLabel(result.summary.windows[1]),'每周额度');
 assert.ok(!JSON.stringify(result).includes('private-'));
 assert.ok(!result.data.usage);assert.deepEqual(requests,['GET']);
 const card={version:1,updatedAt:'2026-09-08T00:00:00Z',codex:result.data};
 const validation=spawnSync('python3',['-c','import json,sys; from tools.folocard.protocol import validate; validate(json.load(sys.stdin))'],{cwd:new URL('..',import.meta.url),input:JSON.stringify(card),encoding:'utf8'});
 assert.equal(validation.status,0,validation.stderr);
 await page.close();
});
test('Malformed primary window cannot discard a valid secondary window or zero credit balance',async()=>{
 const page=await fixture('codex','https://chatgpt.com/codex/settings/usage');
 await page.route('**/backend-api/wham/usage',r=>r.fulfill({json:{rate_limit:{primary_window:{used_percent:999,reset_at:1788868800},secondary_window:{used_percent:12.5,reset_at:1789041600,limit_window_seconds:604800}},credits:{balance:'0'}}}));
 const result=await page.evaluate(fetchCodexUsage);
 assert.equal(result.data.quota.usedPercent,12.5);assert.equal(result.summary.deviceWindow,'secondary');
 assert.equal(result.summary.creditsRemaining,0);assert.equal(result.summary.windows.length,1);
 await page.close();
});
test('API errors distinguish logout, rate limiting, forbidden responses and HTML challenges',async()=>{
 const page=await fixture('codex','https://chatgpt.com/codex/settings/usage');
 await page.route('**/api/auth/session',r=>r.fulfill({json:{}}));
 for(const [status,expected] of [[401,'login_required'],[403,'unavailable'],[429,'rate_limited'],[500,'unavailable'],[200,'unavailable']]) {
   await page.route('**/backend-api/wham/usage',r=>r.fulfill({status,contentType:'text/html',body:'<h1>private-response-marker</h1>'}));
   const result=await page.evaluate(fetchCodexUsage);
   assert.equal(result.status,expected);assert.ok(!JSON.stringify(result).includes('private-response-marker'));
 }
 await page.close();
});
test('Usage 401 with a valid browser session falls back instead of asking for another login',async()=>{
 const page=await fixture('codex','https://chatgpt.com/codex/settings/usage');
 await page.route('**/backend-api/wham/usage',r=>r.fulfill({status:401,json:{}}));
 await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{id:'private-session-user'},accessToken:'private-session-value'}}));
 const result=await page.evaluate(fetchCodexUsage);
 assert.equal(result.status,'unavailable');assert.ok(!JSON.stringify(result).includes('private-session'));
 await page.close();
});
test('Unknown reset timestamps stay unknown and unlimited credit never becomes zero usage',async()=>{
 const page=await fixture('codex','https://chatgpt.com/codex/settings/usage');
 await page.route('**/backend-api/wham/usage',r=>r.fulfill({json:{rate_limit:{primary_window:{used_percent:40,reset_at:null,limit_window_seconds:18000}},credits:{unlimited:true,balance:null}}}));
 const result=await page.evaluate(fetchCodexUsage);
 assert.equal(result.summary.windows[0].usedPercent,40);
 assert.ok(!result.summary.windows[0].resetsAt);assert.ok(!result.data.quota);assert.ok(!result.data.usage);
 assert.equal(result.summary.creditsUnlimited,true);assert.ok(!('creditsRemaining' in result.summary));
 await page.close();
});
test('Bootstrap logout signal is recognized without copying session data',async()=>{
 const page=await fixture('codex','https://chatgpt.com/codex/settings/usage');
 await page.setContent('<script type="application/json" id="client-bootstrap">{"authStatus":"logged_out","session":{"private":"marker"}}</script>');
 assert.deepEqual(await page.evaluate(discoverAccount,'codex'),{status:'login_required'});await page.close();
});
