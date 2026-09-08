// The bridge independently scans native Codex logs. No external application is
// required, and neither session text nor account credentials cross this boundary.
export function requestNative(api, message) {
  return new Promise((resolve,reject)=>{
    if(!api.runtime?.connectNative) {reject(Error('native-unavailable'));return;}
    let port, done=false;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);port?.disconnect();error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(Error('native-timeout')),120000);
    try {
      port=api.runtime.connectNative('com.folotoy.folocard');
      port.onMessage.addListener(value=>finish(null,value));
      port.onDisconnect.addListener(()=>{
        const message=api.runtime.lastError?.message || 'Native host disconnected';
        finish(Error(message));
      });
      port.postMessage(message);
    } catch(error) {finish(error);}
  });
}
export const readNativeUsage = api => requestNative(api,{type:'codex-usage'});
export async function syncNativeDevice(api, card) {
  let result;
  try { result=await requestNative(api,{type:'sync-device',card}); }
  catch(error) {
    const reason=String(error.message || 'native-unavailable');
    if(/not found|native-unavailable|not registered/i.test(reason)) throw Error('本机同步组件未安装或版本过旧，请按安装说明更新后重新加载扩展。');
    throw Error('无法启动本机同步组件：'+reason.slice(0,160));
  }
  if(result?.error) throw Error(result.error);
  if(!result || result.status!==2 || !Number.isInteger(result.revision) || !Number.isInteger(result.checksum)) throw Error('设备回执无效，请保持同步页开启后重试。');
  return result;
}
export async function readLocalUsage(api) {
  try {
    let result;
    try {result=await readNativeUsage(api);}
    catch(error) {
      const reason=String(error.message || 'native-unavailable');
      if(/not found|native-unavailable|not registered/i.test(reason)) return {status:'setup_required',message:'自动读取组件尚未连接。首次安装一次本机组件，此后点击读取即可，无需启动码。',diagnostic:reason.slice(0,180)};
      return {status:'error',message:'本机自动读取组件连接失败：'+reason.slice(0,180)};
    }
    if(result?.error) return {status:'error',message:result.error};
    if(result.source!=='local-logs' || !Array.isArray(result.days) || !result.days.length || result.days.length>84) throw Error('Invalid daily usage');
    let previous='';
    const days=result.days.map(day=>{
      if(!/^\d{4}-\d{2}-\d{2}$/.test(day.date) || day.date<=previous || !Number.isSafeInteger(day.tokens) || day.tokens<0 || !Number.isInteger(day.intensity) || day.intensity<0 || day.intensity>4) throw Error('Invalid daily usage');
      previous=day.date;return {date:day.date,tokens:day.tokens,intensity:day.intensity};
    });
    const totalTokens=days.reduce((sum,day)=>sum+day.tokens,0);
    if(!Number.isSafeInteger(totalTokens) || totalTokens!==result.totalTokens || !Number.isFinite(Date.parse(result.updatedAt))) throw Error('Invalid daily total');
    return {status:'success',source:'local-logs',days,totalTokens,updatedAt:result.updatedAt,partial:!!result.partial,message:result.partial?'已读取本机 Token；部分日志无法完整计入。':'已读取本机 Codex 每日 Token。'};
  } catch { return {status:'error',message:'本机 Token 数据无效，请更新本机组件后重试。'}; }
}
