import {collectAccounts, mergeAccount, sites} from './collection.js';
import {encodeAvatar} from './avatar.js';
import {readLocalUsage} from './local-usage.js';

// Serialize result commits so concurrent site completions cannot overwrite one
// another. Persist progress and card together, even if the popup is closed.
export async function runCollection(api, initialCard, collect=collectAccounts, avatar=encodeAvatar, {local=readLocalUsage}={}) {
  let card = structuredClone(initialCard);
  const collection = {running:true, startedAt:Date.now(), localCodex:{status:'loading',message:'正在读取本机每日 Token…'}, sites:Object.fromEntries(sites.map(site=>[site.id,{status:'loading',message:'正在查找已登录账号…'}]))};
  await api.storage.local.set({card, collection});
  let commits = Promise.resolve();
  try {
    const browserJob=collect(api, event => {
      commits = commits.then(async () => {
        const {site, data, ...status} = event;
        if (status.status === 'success') {
          if (site!=='codex' || data.quota || data.usage || data.days?.length) card=mergeAccount(card, site, data);
          const candidates=[...new Set([...(Array.isArray(data.avatarUrls)?data.avatarUrls:[]), data.avatarUrl].filter(Boolean))];
          if (site !== 'codex' && candidates.length) {
            let failure;
            for (const candidate of candidates) {
              try {
                const value = await avatar(candidate, site, api);
                if (value) { card[site].avatar=value; failure=undefined; status.message='资料和头像已读取，待核对后同步。'; break; }
                failure=Error('头像地址不受支持');
              } catch (error) { failure=error; }
            }
            if (failure) status.message=`资料已读取；头像未更新：${failure.message}`;
          } else if (site !== 'codex') status.message='资料已读取；页面中未找到可用头像地址。';
        }
        collection.sites[site]=status;
        await api.storage.local.set({card, collection});
      });
      return commits;
    });
    // Independent from browser authentication. Only merge after all browser
    // commits, so a later quota response cannot clear native daily history.
    const localJob=local(api).catch(()=>({status:'error',message:'本机 Token 读取失败，请检查本机组件。'}));
    await browserJob;
    await commits;
    collection.localCodex=await localJob;
    if(collection.localCodex.status==='success') {
      const usage=collection.localCodex;
      // Legacy wire source retained for installed version-1 firmware. Exact
      // provenance stays in collection.localCodex, separate from browser quota.
      const base={...card.codex};delete base.usage;
      // The firmware already displays the latest dated token entry when no
      // billing-period total exists. Do not label an 84-day sum as that period.
      card=mergeAccount(card,'codex',{...base,source:'usage-ui',days:usage.days});
    } else if(initialCard.codex?.days?.some(day=>day.tokens!==undefined)) {
      card.codex={...card.codex,days:initialCard.codex.days};
      if(initialCard.codex.usage?.tokens!==undefined) card.codex.usage={...card.codex.usage,tokens:initialCard.codex.usage.tokens};
      collection.localCodex.message+=' 保留上次每日 Token 数据。';
    }
    await api.storage.local.set({card,collection});
  } finally {
    collection.running=false;
    for (const status of Object.values(collection.sites)) if (status.status==='loading') {
      status.status='error'; status.message='采集未完成，请重新读取。';
    }
    if(collection.localCodex.status==='loading') collection.localCodex={status:'error',message:'本机 Token 采集中断，请重新读取。'};
    collection.finishedAt=Date.now();
    await api.storage.local.set({collection});
  }
  return {card, collection};
}
