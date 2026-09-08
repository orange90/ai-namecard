// Runs in the website's isolated world. Return only account navigation/status,
// never session payloads, cookies, access tokens, or content from the feed.
export async function discoverAccount(site) {
  const origins = {codex:'https://chatgpt.com', zhihu:'https://www.zhihu.com', xiaohongshu:'https://www.xiaohongshu.com'};
  if (location.origin !== origins[site]) return {status:'error', message:'页面已跳转，请打开站点检查登录或验证提示。'};
  const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const controls = [...document.querySelectorAll('button, a, [role=button]')].filter(visible);
  const login = controls.some(el => /^(登录|登录\/注册|登录或注册|立即登录|去登录|Log in|Sign in)$/i.test(el.innerText?.trim() || ''));
  if (site === 'zhihu') {
    try {
      const response = await fetch('/api/v4/me', {credentials:'include', headers:{Accept:'application/json'}, signal:AbortSignal.timeout(5000)});
      if (response.status === 401) return {status:'login_required'};
      if (response.ok) {
        const me = await response.json();
        if (/^[A-Za-z0-9_-]+$/.test(me.url_token || '')) return {status:'ready', url:`https://www.zhihu.com/people/${me.url_token}`};
      }
      // A forbidden request can be a site verification challenge, not a logout.
      return login ? {status:'login_required'} : {status:'pending', message:'暂时无法确认知乎账号，请检查站点验证提示后重试。'};
    } catch {
      return {status:'pending', message:'知乎账号请求未完成，请检查网络后重试。'};
    }
  }
  if (site === 'xiaohongshu') {
    // Only the signed-in user's navigation entry establishes identity. A
    // visible public profile may belong to someone else, even when logged out.
    const links = [...document.querySelectorAll('aside a[href], nav a[href], [role=navigation] a[href], .side-bar a[href], .sidebar a[href]')].filter(visible).filter(el =>
      /^(我|我的|个人主页|我的主页|Me|Profile)$/i.test((el.innerText || el.getAttribute('aria-label') || '').trim()));
    const urls = [...new Set(links.map(el => {
      const url = new URL(el.href, location.href);
      return url.origin === origins[site] && /^\/user\/profile\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) ? url.origin + url.pathname.replace(/\/$/, '') : null;
    }).filter(Boolean))];
    if (urls.length === 1) return {status:'ready', url:urls[0]};
    if (login) return {status:'login_required'};
    return {status:'pending', message:'没有找到小红书的“我”入口，请打开站点检查页面是否加载完成。'};
  }
  if (site === 'codex') {
    // CodexBar also checks this documented dashboard bootstrap status. Read
    // only authStatus; never copy the embedded user/session data to the worker.
    try {
      const bootstrap=JSON.parse(document.querySelector('#client-bootstrap')?.textContent || '{}');
      if (bootstrap.authStatus==='logged_out') return {status:'login_required'};
    } catch { /* Older pages may not contain a bootstrap JSON script. */ }
    if (login || /^\/auth\/login(?:\/|$)/.test(location.pathname)) return {status:'login_required'};
    const usagePaths=['/codex/settings/usage','/codex/cloud/settings/usage','/codex/cloud/settings/analytics'];
    const path=location.pathname.replace(/\/$/,'');
    return {status:'ready', url:usagePaths.includes(path)?location.origin+path:'https://chatgpt.com/codex/cloud/settings/analytics'};
  }
  return {status:'error', message:'不支持的站点。'};
}
