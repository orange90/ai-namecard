import {runCollection} from './collection-job.js';
import {syncNativeDevice} from './local-usage.js';
let collectionJob;

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg.type === 'collect') {
    if (!collectionJob) {
      collectionJob=runCollection(chrome, msg.card).finally(()=>{collectionJob=undefined;});
    }
    collectionJob.then(result=>respond(result), ()=>respond({error:'采集未完成，已保存的结果会保留，请重试。'}));
    return true;
  }
  if (msg.type === 'collection-status') {
    (async()=>{
      const state=await chrome.storage.local.get(['card','collection']);
      if (state.collection?.running && !collectionJob) {
        state.collection.running=false;
        for (const value of Object.values(state.collection.sites)) if(value.status==='loading') {
          value.status='error'; value.message='上次采集中断，请重新读取。';
        }
        if(state.collection.localCodex?.status==='loading') state.collection.localCodex={status:'error',message:'本机 Token 采集中断，请重新读取。'};
        await chrome.storage.local.set({collection:state.collection});
      }
      return state;
    })().then(respond, ()=>respond({error:'无法读取本机采集状态。'}));
    return true;
  }
});

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (sender.id !== chrome.runtime.id || msg.type !== 'sync') return;
  syncNativeDevice(chrome,msg.card)
    .then(result => respond({result}), error => respond({error:error.message}));
  return true;
});
