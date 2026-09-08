// Endpoint and field semantics verified against steipete/CodexBar at
// 170a4d41c6d69e2bb25daac4fb088a92de2f9bc4 (see docs/assets/folocard.md).
// This self-contained function runs in the ChatGPT tab's isolated world. The
// browser supplies session cookies; only allowlisted usage numbers leave it.
export async function fetchCodexUsage() {
  if (location.origin !== 'https://chatgpt.com') return {status:'unavailable', message:'请打开 ChatGPT 检查账号登录。'};
  let response;
  try {
    response=await fetch('/backend-api/wham/usage', {
      method:'GET', credentials:'include', cache:'no-store', redirect:'error',
      headers:{Accept:'application/json'}, signal:AbortSignal.timeout(4500)
    });
  } catch { return {status:'unavailable', message:'Codex 用量接口暂时无法连接。'}; }
  if (response.status===401) {
    // A rejected usage request alone does not prove the browser is logged out.
    // CodexBar uses this session endpoint for its web identity check as well.
    try {
      const sessionResponse=await fetch('/api/auth/session', {credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(2000)});
      if (sessionResponse.status===401) return {status:'login_required',message:'Codex 登录已失效，请重新登录 ChatGPT。'};
      if (sessionResponse.ok) {
        const session=await sessionResponse.json();
        if (session && typeof session==='object' && !Array.isArray(session) && !session.user) return {status:'login_required',message:'请先登录 ChatGPT，再读取 Codex 用量。'};
      }
    } catch { /* A session challenge or network failure is not a confirmed logout. */ }
    return {status:'unavailable',message:'用量接口未接受当前会话，正在尝试用量页面。'};
  }
  if (response.status===429) return {status:'rate_limited', message:'Codex 用量请求过于频繁，请稍后重试。'};
  if (!response.ok) return {status:'unavailable', message:response.status===403?'Codex 用量接口受限，请检查站点验证。':'Codex 用量接口暂时不可用。'};
  let raw;
  try { raw=await response.json(); } catch { return {status:'unavailable', message:'Codex 用量接口没有返回可识别的数据。'}; }
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) return {status:'unavailable', message:'Codex 用量数据格式已变化。'};
  const windows=[];
  // Each window is decoded independently. Missing/malformed primary data must
  // not discard a valid secondary window; zero usage is a valid reading.
  for (const [kind,key] of [['primary','primary_window'],['secondary','secondary_window']]) {
    const value=raw.rate_limit?.[key];
    if (!value || typeof value.used_percent!=='number' || !Number.isFinite(value.used_percent)
      || value.used_percent<0 || value.used_percent>100) continue;
    const window={kind, usedPercent:value.used_percent};
    if (Number.isSafeInteger(value.limit_window_seconds) && value.limit_window_seconds>0) window.windowSeconds=value.limit_window_seconds;
    if (Number.isSafeInteger(value.reset_at) && value.reset_at>=946684800 && value.reset_at<=253402300799) {
      // Both the device and bridge require timestamps without fractional seconds.
      window.resetsAt=new Date(value.reset_at*1000).toISOString().replace('.000Z','Z');
    }
    windows.push(window);
  }
  const summary={source:'usage-api', windows};
  if (raw.credits?.unlimited===true) summary.creditsUnlimited=true;
  const balance=raw.credits?.balance;
  const numeric=typeof balance==='number'?balance:typeof balance==='string' && /^\d+(?:\.\d+)?$/.test(balance.trim())?Number(balance.trim()):NaN;
  if (Number.isFinite(numeric) && numeric>=0 && numeric<=1e12) summary.creditsRemaining=numeric;
  if (!windows.length && summary.creditsRemaining===undefined && !summary.creditsUnlimited) {
    return {status:'unavailable', message:'当前账号没有可识别的 Codex 额度数据。'};
  }
  // Keep the installed firmware's version-1 card contract. "usage-ui" denotes
  // dashboard data; the detailed browser summary distinguishes its API source.
  // Credits.balance is REMAINING credit, never consumed credit or token usage.
  const data={source:'usage-ui',days:[]};
  const quota=windows.find(window=>window.kind==='primary' && window.resetsAt)
    || windows.find(window=>window.resetsAt);
  if (quota) {
    data.quota={usedPercent:quota.usedPercent,resetsAt:quota.resetsAt};
    summary.deviceWindow=quota.kind;
  }
  return {status:'success',site:'codex',data,summary};
}

export function codexWindowLabel(window) {
  if (window.windowSeconds===18000) return '5 小时额度';
  if (window.windowSeconds===604800) return '每周额度';
  if (window.windowSeconds) return `${Number((window.windowSeconds/3600).toFixed(1))} 小时额度`;
  return window.kind==='primary'?'主周期额度':'次周期额度';
}
