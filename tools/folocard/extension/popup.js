import {sites} from './collection.js';
import {codexWindowLabel} from './codex-usage.js';
const $ = id => document.getElementById(id);
const now = () => {const d = new Date(); const off = -d.getTimezoneOffset(); const local = new Date(d.getTime() + off * 60000).toISOString().slice(0,19); return local + (off >= 0 ? '+' : '-') + String(Math.floor(Math.abs(off)/60)).padStart(2,'0') + ':' + String(Math.abs(off)%60).padStart(2,'0');};
const empty = () => ({version:1, updatedAt:now(), codex:{source:'profile-ui',days:[]}});
let card = (await chrome.storage.local.get('card')).card || empty();
let devicePage = 0;
let deviceDetail = false;
const metricLabels = {likes:'获赞',followers:'粉丝',answers:'回答',articles:'文章',interactions:'今日互动'};
const compactNumber = value => value === undefined ? '--' : Number(value) >= 100000000 ? `${(Number(value) / 100000000).toFixed(1)}亿` : Number(value) >= 10000 ? `${(Number(value) / 10000).toFixed(1)}万` : Number(value).toLocaleString('zh-CN');
const deviceElement = (tag, className, value) => { const el=document.createElement(tag); if(className) el.className=className; if(value !== undefined) el.textContent=value; return el; };
function deviceHeader(target, logo, title, battery, accent) {
  const header=deviceElement('div','deviceHeader');
  const brand=document.createElement('img');
  brand.className='deviceBrand'; brand.src=logo; brand.alt='';
  header.style.background=accent;
  header.append(brand,deviceElement('span','deviceTitle',title),deviceElement('span','deviceBattery',battery));
  target.append(header);
}
function deviceDots(target, accent) {
  const dots=deviceElement('div','deviceDots');
  for(let i=0;i<3;i++) { const dot=deviceElement('span',i===devicePage?'active':''); dot.style.background=accent; dots.append(dot); }
  target.append(dots);
}
function deviceAvatar(social, accent) {
  const fallback=()=>deviceElement('div','deviceAvatar',social.name?.slice(0,1)||'?');
  const avatar=social.avatar;
  if(avatar?.format!=='rgb565le' || avatar.width!==24 || avatar.height!==24 || typeof avatar.data!=='string') return fallback();
  try {
    const binary=atob(avatar.data);
    if(binary.length!==24*24*2) return fallback();
    const canvas=deviceElement('canvas','deviceAvatar');canvas.width=24;canvas.height=24;canvas.style.borderColor=accent;
    const context=canvas.getContext('2d'), image=context.createImageData(24,24);
    for(let source=0,target=0;source<binary.length;source+=2,target+=4) {
      const value=binary.charCodeAt(source)|(binary.charCodeAt(source+1)<<8);
      image.data[target]=Math.round(((value>>11)&31)*255/31);
      image.data[target+1]=Math.round(((value>>5)&63)*255/63);
      image.data[target+2]=Math.round((value&31)*255/31);
      image.data[target+3]=255;
    }
    context.putImageData(image,0,0);return canvas;
  } catch { return fallback(); }
}
function renderDevicePreview() {
  const target=$('deviceScreen'); target.replaceChildren();
  target.className=`deviceScreen devicePage${devicePage}`;
  const battery='--%';
  const pageLabels=['CODEX', '知乎名片', '小红书名片'];
  const social = devicePage === 1 ? card.zhihu : card.xiaohongshu;
  const accent = devicePage === 0 ? '#080b0a' : devicePage === 1 ? '#1677ff' : '#ff2442';
  $('devicePageLabel').textContent=`${pageLabels[devicePage]} · ${deviceDetail ? '详情' : devicePage === 0 ? '活动' : '名片'}`;
  if(devicePage === 0) {
    deviceHeader(target,'assets/codex.png','CODEX',battery,accent);
    const body=deviceElement('div','deviceCodexBody');
    const snapshotDate=card.updatedAt.slice(0,10);
    const snapshot=new Date(snapshotDate+'T12:00:00Z');
    const monday=new Date(snapshot.getTime()-((snapshot.getUTCDay()+6)%7)*86400000).toISOString().slice(0,10);
    const active=card.codex?.days?.filter(day=>day.intensity>0 && day.date>=monday && day.date<=snapshotDate).length || 0;
    const summary=deviceElement('div','deviceCodexSummary');
    if(card.codex?.days?.length) summary.append(deviceElement('span','', '本周活跃：'),deviceElement('strong','',`${active}天`));
    else summary.append(deviceElement('span','deviceSyncPrompt','请先同步数据'));
    body.append(summary);
    const panel=deviceElement('div','deviceCodexPanel');
    if(deviceDetail) {
      const latest=card.codex?.days?.findLast(day=>day.tokens!==undefined);
      panel.append(deviceElement('strong','devicePanelTitle',card.codex?.usage?.tokens !== undefined || latest ? 'TOKEN 用量' : '活动强度'));
      panel.append(deviceElement('p','deviceToken',card.codex?.usage?.tokens !== undefined ? `当前周期  ${compactNumber(card.codex.usage.tokens)} tokens` : latest ? `${latest.date}  ${compactNumber(latest.tokens)} tokens` : '尚未读取精确 Token'));
      if(card.codex?.quota) { panel.append(deviceElement('span','deviceQuotaLabel','额度（不等于 Token）')); const quota=deviceElement('div','deviceQuota'); const bar=deviceElement('i'); bar.style.width=`${Math.max(0,Math.min(100,card.codex.quota.usedPercent))}%`; quota.append(bar); panel.append(deviceElement('strong','deviceQuotaText',`已用 ${card.codex.quota.usedPercent}%`),quota); }
    } else {
      panel.append(deviceElement('strong','devicePanelTitle','最近 12 周'));
      const grid=deviceElement('div','deviceHeatmap'); const anchor=Date.parse(card.updatedAt.slice(0,10)+'T12:00:00Z');
      for(let i=0;i<84;i++) { const date=new Date(anchor-(83-i)*86400000).toISOString().slice(0,10); const day=card.codex?.days?.find(item=>item.date===date); const cell=deviceElement('i',''); cell.style.background=day ? ['#202a24','#164d2b','#187f3e','#28b85d','#48e17d'][day.intensity] : '#101713'; grid.append(cell); }
      panel.append(grid,deviceElement('span','deviceHint','OK 查看用量'));
    }
    body.append(panel); target.append(body); deviceDots(target,'#35d06f'); return;
  }
  const logo=devicePage===1?'assets/zhihu.png':'assets/xiaohongshu.png'; const title=devicePage===1?'知乎名片':'创作者名片';
  deviceHeader(target,logo,title,battery,accent);
  const body=deviceElement('div','deviceSocialBody'); body.style.background=devicePage===1?'#eaf3ff':'#fff0f2';
  if(!social) body.append(deviceElement('div','deviceEmpty','尚未同步名片'),deviceElement('p','deviceEmptyHint','请在扩展中读取并确认资料'));
  else if(deviceDetail) { body.append(deviceElement('strong','deviceProfileName',social.name),deviceElement('div','deviceQr','公开主页\n二维码'),deviceElement('span','deviceQrHint','扫码访问公开主页')); }
  else {
    const profile=deviceElement('div','deviceProfile'); profile.append(deviceAvatar(social,accent),deviceElement('strong','',social.name),deviceElement('span','', '公开主页'),deviceElement('div','deviceMiniQr','QR')); body.append(profile);
    const metrics=deviceElement('div',devicePage===1?'deviceMetrics zhihuMetrics':'deviceMetrics'); const keys=devicePage===1?['likes','followers','answers','articles','interactions']:['likes','followers'];
    for(const key of keys) { const stat=deviceElement('div','deviceStat'); stat.append(deviceElement('span','',devicePage===2&&key==='likes'?'获赞与收藏':metricLabels[key]),deviceElement('strong','',compactNumber(social.metrics?.[key]))); metrics.append(stat); }
    body.append(metrics,deviceElement('span','deviceHint',devicePage===2?'OK 放大主页二维码':'OK 放大主页二维码'));
  }
  target.append(body); deviceDots(target,accent);
}
function preview() {
  $('codexDetails').replaceChildren();
  $('localCodex').replaceChildren();
  $('heatmap').replaceChildren();
  const anchor = Date.parse(card.updatedAt.slice(0,10) + 'T12:00:00Z');
  for (let i=0;i<84;i++) {
    const date = new Date(anchor-(83-i)*86400000).toISOString().slice(0,10);
    const day = card.codex?.days.find(d=>d.date===date);
    const cell = document.createElement('span');
    cell.style.background = day ? ['#dde5df','#a4d9a4','#5bae67','#288449','#14552f'][day.intensity] : 'transparent';
    cell.title = date + ': ' + (day ? 'level '+day.intensity + (day.tokens === undefined ? '' : ', '+day.tokens+' tokens') : 'unknown');
    $('heatmap').append(cell);
  }
  $('activity').textContent = card.codex?.days.some(d=>d.tokens!==undefined) ? 'Token 活动（仅明确数值）' : 'Codex 活动强度 · 未知保持空白';
  const usage=[];
  if(card.codex?.usage?.tokens!==undefined) usage.push('Tokens：'+Number(card.codex.usage.tokens).toLocaleString('zh-CN'));
  if(card.codex?.usage?.credits!==undefined) usage.push('Credits：'+card.codex.usage.credits);
  if(card.codex?.quota) usage.push('已用 '+card.codex.quota.usedPercent+'% · 重置 '+new Date(card.codex.quota.resetsAt).toLocaleString('zh-CN'));
  $('codexUsage').textContent=usage.join(' · ') || '尚未读取用量';
  const names=metricLabels;
  for (const site of ['zhihu','xiaohongshu']) {
    const target=$(site);target.replaceChildren();
    if(!card[site]) {target.textContent='尚未添加';continue;}
    const title=document.createElement('strong');title.textContent=card[site].name;target.append(title);
    for(const [key,value] of Object.entries(card[site].metrics||{})) {
      const chip=document.createElement('span');chip.className='metricChip';chip.textContent=`${names[key]||key}  ${Number(value).toLocaleString('zh-CN')}`;target.append(chip);
    }
  }
  renderDevicePreview();
  $('confirm').checked = false;
}
const cleanDeviceText = value => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  : value;
function validatedCard() {
  const value=structuredClone(card);
  for(const site of ['zhihu','xiaohongshu']) if(value[site]) {
    value[site].name=cleanDeviceText(value[site].name);
    value[site].bio=cleanDeviceText(value[site].bio || '');
  }
  if(value.version!==1 || typeof value.updatedAt!=='string') throw Error('需要 version: 1 和 updatedAt');
  if(value.codex && (!Array.isArray(value.codex.days) || value.codex.days.length>84 || value.codex.days.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||!Number.isInteger(d.intensity)||d.intensity<0||d.intensity>4))) throw Error('检查热力图日期和 0–4 的强度');
  const encoder=new TextEncoder();
  for(const site of ['zhihu','xiaohongshu']) if(value[site]) {
    const profile=value[site];
    if(!profile.name || encoder.encode(profile.name).length>=97 || encoder.encode(profile.bio).length>=193) throw Error(`${site==='zhihu'?'知乎':'小红书'}资料文字过长`);
    const prefix=site==='zhihu'?'https://www.zhihu.com/people/':'https://www.xiaohongshu.com/user/profile/';
    if(typeof profile.url!=='string' || !profile.url.startsWith(prefix) || encoder.encode(profile.url).length>=193) throw Error(`${site==='zhihu'?'知乎':'小红书'}主页地址无效`);
  }
  if(new TextEncoder().encode(JSON.stringify(value)).length>8192) throw Error('名片超过 8192 字节');
  return value;
}
async function run(fn) {try {await fn();} catch(e) {$('status').textContent = e.message;}}
let collectionRunning=false;
function renderCollection(collection) {
  collectionRunning=!!collection?.running;
  $('extract').disabled=collectionRunning;
  $('extract').textContent=collectionRunning?'正在读取数据…':collection?'重新读取数据':'一键读取数据';
  for (const el of document.querySelectorAll('#sync, #confirm')) el.disabled=collectionRunning;
  const target=$('collectionStatus'); target.replaceChildren();
  for (const site of sites) {
    const state=collection?.sites?.[site.id];
    const row=deviceElement('div','collectionRow');
    row.dataset.status=state?.status || 'idle';
    row.append(deviceElement('strong','',site.id==='codex'?'Codex 额度':site.name), deviceElement('span','',state?.message || '等待自动读取'));
    if (state && ['login_required','error'].includes(state.status)) {
      const button=deviceElement('button','secondary',state.status==='login_required'?'去登录':'打开检查');
      button.type='button';
      button.onclick=()=>run(async()=>{
        if (state.tabId) {
          try {
            const tab=await chrome.tabs.get(state.tabId);
            if (tab.url && new URL(tab.url).origin===site.origin) {
              await chrome.tabs.update(tab.id,{active:true});
              await chrome.windows.update(tab.windowId,{focused:true});
              return;
            }
          } catch { /* Closed or redirected: use the fixed site entry URL. */ }
        }
        await chrome.tabs.create({url:site.home,active:true});
      });
      row.append(button);
    }
    target.append(row);
  }
  renderCodexDetails(collection?.sites?.codex?.summary);
  renderLocalCodex(collection?.localCodex);
  if(collection) {
    const count=Object.values(collection.sites).filter(site=>site.status==='success').length;
    const nativeState=collection.localCodex?.status==='success'?'已读取':collection.localCodex?.status==='setup_required'?'待安装本机组件':'未读取';
    $('status').textContent=collectionRunning?'正在后台读取，关闭弹窗也会继续。':`已读取 ${count}/3 个浏览器账号；每日 Token ${nativeState}。未成功的来源保留原数据；请核对预览后同步。`;
  }
}
function renderLocalCodex(state) {
  const target=$('localCodex');target.replaceChildren();
  const row=deviceElement('div','collectionRow');row.dataset.status=state?.status || 'idle';
  row.append(deviceElement('strong','','每日 Token'),deviceElement('span','',state?.message || '读取时自动连接本机组件，无需启动码'));
  if(state?.status==='setup_required') {const button=deviceElement('button','secondary','安装说明');button.onclick=()=>{$('nativeSetup').open=true;$('nativeSetup').scrollIntoView({block:'nearest'});};row.append(button);}
  target.append(row);
  if(state?.diagnostic) {const detail=document.createElement('details');detail.append(deviceElement('summary','','连接诊断'),deviceElement('p','',state.diagnostic));target.append(detail);}
  if(state?.status!=='success') return;
  const today=state.days.find(day=>day.date===now().slice(0,10));
  target.append(deviceElement('p','',`本机 · 今日 ${today?today.tokens.toLocaleString('zh-CN'):'暂无记录'} · 已记录日期合计 ${state.totalTokens.toLocaleString('zh-CN')} Tokens${state.partial?'（部分统计）':''}`));
  const details=document.createElement('details');details.append(deviceElement('summary','','每日 Token 明细（最近 84 天内的记录）'));
  const table=document.createElement('table');
  const head=document.createElement('tr');head.append(deviceElement('th','','日期'),deviceElement('th','','Token'));table.append(head);
  for(const day of [...state.days].reverse()) {const row=document.createElement('tr');row.append(deviceElement('td','',day.date),deviceElement('td','',day.tokens.toLocaleString('zh-CN')));table.append(row);}
  details.append(table);target.append(details);
}
function renderCodexDetails(summary) {
  const target=$('codexDetails');target.replaceChildren();
  if(!summary) return;
  target.append(deviceElement('p','codexDetailsTitle','Codex 用量 · '+(summary.source==='usage-api'?'账号用量接口':'用量页面')));
  const grid=deviceElement('div','codexLimits');
  for(const window of summary.windows || []) {
    const panel=deviceElement('div','codexLimit');
    panel.append(deviceElement('strong','',codexWindowLabel(window)),deviceElement('p','',`剩余 ${Number((100-window.usedPercent).toFixed(2))}% · 已用 ${window.usedPercent}%`));
    const meter=document.createElement('progress');meter.max=100;meter.value=window.usedPercent;meter.setAttribute('aria-label',codexWindowLabel(window)+'已用百分比');panel.append(meter);
    panel.append(deviceElement('span','',window.resetsAt?'重置：'+new Date(window.resetsAt).toLocaleString('zh-CN'):'重置时间未提供'));
    if(summary.deviceWindow===window.kind) panel.append(deviceElement('small','','同步到设备的额度'));
    grid.append(panel);
  }
  target.append(grid);
  if(summary.creditsUnlimited) target.append(deviceElement('p','','Credits：不限量'));
  else if(summary.creditsRemaining!==undefined) target.append(deviceElement('p','',`Credits 余额：${Number(summary.creditsRemaining).toLocaleString('zh-CN')}`));
}
function receiveCollection(state) {
  if(state.card) { card=state.card; preview(); }
  renderCollection(state.collection);
}
$('extract').onclick=()=>run(async()=>{
  const draft=validatedCard();
  $('extract').disabled=true;
  try {
    renderCollection({running:true,sites:{}});
    const reply=await chrome.runtime.sendMessage({type:'collect',card:draft});
    if(reply.error) throw Error(reply.error);
    receiveCollection(reply);
  } catch(error) {
    renderCollection((await chrome.storage.local.get('collection')).collection);
    throw error;
  }
});
$('sync').onclick=()=>run(async()=>{
  if(!$('confirm').checked) throw Error('请先确认已核对名片。');
  card=validatedCard();
  preview();
  $('sync').disabled=true;$('status').textContent='正在扫描 FoloCard；首次连接请在 macOS 配对框输入设备屏幕上的 PIN。';
  try {
    const reply=await chrome.runtime.sendMessage({type:'sync',card});
    if(reply.error) throw Error(reply.error);
    await chrome.storage.local.set({card});
    $('status').textContent='设备保存成功，版本 '+reply.result.revision+'，CRC '+reply.result.checksum;
  } finally {$('sync').disabled=false;}
});
$('devicePrev').onclick=()=>{devicePage=(devicePage+2)%3;deviceDetail=false;renderDevicePreview();};
$('deviceNext').onclick=()=>{devicePage=(devicePage+1)%3;deviceDetail=false;renderDevicePreview();};
$('deviceDetail').onclick=()=>{deviceDetail=!deviceDetail;renderDevicePreview();};
$('deviceScreen').onclick=()=>{deviceDetail=!deviceDetail;renderDevicePreview();};
$('extensionId').textContent='扩展 ID：'+chrome.runtime.id;
$('bridgeCommand').textContent='.local-tools/folocard-venv/bin/python tools/folocard/install_native.py --extension-id '+chrome.runtime.id;
$('openOptions').onclick=()=>run(async()=>{
  await chrome.runtime.openOptionsPage();
});
preview();
renderCollection();
chrome.storage.onChanged?.addListener((changes, area)=>{
  if(area !== 'local' || !changes.collection) return;
  receiveCollection({card:changes.card?.newValue,collection:changes.collection.newValue});
});
run(async()=>{
  const state=await chrome.runtime.sendMessage({type:'collection-status'});
  if(state?.collection) receiveCollection(state);
});
