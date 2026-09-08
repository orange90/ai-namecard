import {discoverAccount} from './accounts.js';
import {extractVisiblePage} from './adapters.js';
import {fetchCodexUsage, codexWindowLabel} from './codex-usage.js';

export const sites = [
  {id:'codex', name:'Codex', origin:'https://chatgpt.com', home:'https://chatgpt.com/codex/cloud/settings/analytics#usage'},
  {id:'zhihu', name:'知乎', origin:'https://www.zhihu.com', home:'https://www.zhihu.com/'},
  {id:'xiaohongshu', name:'小红书', origin:'https://www.xiaohongshu.com', home:'https://www.xiaohongshu.com/explore'}
];

function matchesProfile(site, raw) {
  try {
    const url = new URL(raw);
    return url.origin === site.origin && (site.id === 'codex'
      ? ['/codex/settings/usage','/codex/cloud/settings/usage','/codex/cloud/settings/analytics'].includes(url.pathname.replace(/\/$/,''))
      : (site.id === 'zhihu' ? /^\/people\/[A-Za-z0-9_-]+\/?$/ : /^\/user\/profile\/[A-Za-z0-9_-]+\/?$/).test(url.pathname));
  } catch { return false; }
}

// Discover all three signed-in accounts independently. Host permission limits
// tab queries to these sites; existing user tabs are never navigated or closed.
export async function collectAccounts(api, report, {timeout=25000, pause=ms=>new Promise(resolve=>setTimeout(resolve, ms)), now=Date.now}={}) {
  return Promise.all(sites.map(async site => {
    const deadline = now()+timeout;
    let tab, ownedTab, expectedUrl, accountUrl;
    const owned = new Map();
    let outcome = {site:site.id, status:'error', message:'采集未完成，请重试。'};
    try {
      await report({site:site.id, status:'loading', message:'正在查找已登录账号…'});
      if (!await api.permissions.contains({origins:[site.origin+'/*']})) {
        outcome = {site:site.id, status:'permission_required', message:'请在浏览器扩展管理页允许 FoloCard 访问此站点，再重试读取。'};
        return outcome;
      }
      const tabs = (await api.tabs.query({url:site.origin+'/*'})).filter(item=>!item.incognito);
      tab = tabs.find(item=>item.url === site.home) || tabs[0];
      if (!tab) {
        tab = await api.tabs.create({url:site.home, active:false});
        owned.set(tab.id, site.home);
      }
      if (site.id==='codex') {
        // Cookie-authenticated API first, from any existing ChatGPT tab. This
        // does not depend on dashboard language, layout, or rendering readiness.
        while ((await api.tabs.get(tab.id)).status==='loading' && now()<deadline) await pause(500);
        let usage;
        try { usage=(await api.scripting.executeScript({target:{tabId:tab.id},func:fetchCodexUsage}))[0]?.result; }
        catch { /* A redirect may be temporarily inaccessible; use UI fallback. */ }
        if (usage?.status==='login_required' || usage?.status==='rate_limited') {
          outcome={site:site.id,status:usage.status==='login_required'?'login_required':'error',message:usage.message,tabId:tab.id};
          return outcome;
        }
        if (usage?.status==='success') {
          const selected=usage.summary.windows.find(window=>window.kind===usage.summary.deviceWindow);
          outcome={site:site.id,status:'success',data:usage.data,summary:usage.summary,
            message:selected?`已读取用量接口；设备显示${codexWindowLabel(selected)}。`:'已读取用量接口；当前数据仅在插件中显示，设备保留原数据。'};
          return outcome;
        }
        await report({site:site.id,status:'loading',message:'用量接口暂不可用，正在读取用量页面…'});
      }
      let discovery;
      while (now() < deadline) {
        const current = await api.tabs.get(tab.id);
        if (current.status === 'loading') { await pause(500); continue; }
        try {
          discovery = (await api.scripting.executeScript({target:{tabId:tab.id}, func:discoverAccount, args:[site.id]}))[0]?.result;
        } catch {
          discovery = {status:'pending', message:'页面暂时无法读取，请检查是否需要登录或完成站点验证。'};
        }
        if (discovery?.status === 'login_required') {
          outcome = {site:site.id, status:'login_required', message:`请先登录${site.name}，登录后点击重新读取。`, tabId:tab.id};
          return outcome;
        }
        if (discovery?.status === 'error') throw Error(discovery.message);
        if (discovery?.status === 'ready' && matchesProfile(site, discovery.url)) break;
        await pause(800);
      }
      if (discovery?.status !== 'ready' || !matchesProfile(site, discovery.url)) throw Error(discovery?.message || '账号页面加载超时，请检查网络后重试。');
      accountUrl = discovery.url.split('#')[0].replace(/\/$/,'');
      const currentUrl = new URL((await api.tabs.get(tab.id)).url);
      if (currentUrl.origin+currentUrl.pathname.replace(/\/$/, '') !== accountUrl.replace(/\/$/, '')) {
        const existing = tabs.find(item=>item.url && new URL(item.url).origin+new URL(item.url).pathname.replace(/\/$/, '') === accountUrl);
        tab = existing || await api.tabs.create({url:accountUrl, active:false});
        if (!existing) owned.set(tab.id, accountUrl);
      }
      expectedUrl = accountUrl;
      await report({site:site.id, status:'loading', message:'已找到账号，正在读取资料…'});
      let lastMessage = '页面已登录，但尚未找到可识别的数据；请检查页面后重试。';
      while (now() < deadline) {
        const current = await api.tabs.get(tab.id);
        if (current.status === 'loading') { await pause(500); continue; }
        // Re-check authentication and identity after navigation/hydration.
        let probe;
        try { probe = (await api.scripting.executeScript({target:{tabId:tab.id}, func:discoverAccount, args:[site.id]}))[0]?.result; } catch { /* Redirects can be temporarily inaccessible. */ }
        if (probe?.status === 'login_required') {
          outcome = {site:site.id, status:'login_required', message:`请先登录${site.name}，登录后点击重新读取。`, tabId:tab.id};
          return outcome;
        }
        if (probe?.status !== 'ready') { lastMessage=probe?.message || lastMessage; await pause(800); continue; }
        const actual = new URL((await api.tabs.get(tab.id)).url);
        // Codex migrated its usage dashboard. Accept only the explicit same-
        // origin dashboard aliases, never an arbitrary redirected/chat page.
        if(site.id==='codex' && matchesProfile(site,actual.href) && matchesProfile(site,probe.url)) {
          accountUrl=actual.origin+actual.pathname.replace(/\/$/,'');expectedUrl=accountUrl;
        } else if (probe.url !== accountUrl) throw Error('浏览器账号发生变化，请重新读取。');
        if (actual.origin+actual.pathname.replace(/\/$/, '') !== expectedUrl.replace(/\/$/, '')) throw Error('采集页面已跳转，请重新读取。');
        try {
          const result = (await api.scripting.executeScript({target:{tabId:tab.id}, func:extractVisiblePage, args:[{expectedUrl:accountUrl}]}))[0]?.result;
          if (result?.site === site.id && (site.id === 'codex' || result.data?.url === accountUrl)) {
            outcome = {site:site.id, status:'success', message:site.id==='codex'?'已读取用量页面（接口暂不可用），待核对后同步。':'已读取，待核对后同步。', data:result.data};
            return outcome;
          }
        } catch { /* Retry a hydrated page, without exposing website error payloads. */ }
        await pause(800);
      }
      throw Error(lastMessage);
    } catch (error) {
      outcome = {site:site.id, status:'error', message:error.message, ...(tab ? {tabId:tab.id} : {})};
      return outcome;
    } finally {
      // Keep the failing page available for login/verification. Clean up only
      // untouched tabs we created; user navigation transfers ownership to them.
      for (const [id, initial] of owned) {
        if (id === tab?.id && outcome.status !== 'success') continue;
        try {
          ownedTab = await api.tabs.get(id);
          if (!ownedTab.active && ownedTab.url === initial) await api.tabs.remove(id);
        } catch { /* The user may already have closed it. */ }
      }
      await report(outcome);
    }
  }));
}

export function mergeAccount(card, site, data) {
  const next = structuredClone(card);
  if (site === 'codex') {
    // This scan only identifies the currently signed-in usage account. Older
    // activity without an account identity must not be combined with it.
    next.codex = data;
  } else {
    const previous = next[site]?.url === data.url ? next[site] : undefined;
    const {avatarUrl, avatarUrls, ...profile} = data;
    next[site] = {...previous, ...profile, metrics:{...previous?.metrics, ...profile.metrics}};
    if (!profile.bio && previous?.bio) next[site].bio=previous.bio;
  }
  const time=new Date(), offset=-time.getTimezoneOffset();
  next.updatedAt=new Date(time.getTime()+offset*60000).toISOString().slice(0,19)
    +(offset>=0?'+':'-')+String(Math.floor(Math.abs(offset)/60)).padStart(2,'0')+':'+String(Math.abs(offset)%60).padStart(2,'0');
  return next;
}
