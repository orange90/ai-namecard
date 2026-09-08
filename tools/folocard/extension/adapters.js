// Serialized into the active tab only after an explicit user click.
export async function extractVisiblePage(options = {}) {
  const visible = element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
  const first = selector => selector.split(',').map(part => [...document.querySelectorAll(part.trim())].find(visible)).find(Boolean);
  // The firmware text contract rejects ASCII control characters. Browser
  // profiles commonly render multi-line biographies, so canonicalize visible
  // whitespace before the value reaches either the preview or the device.
  const cleanText = value => typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
    : undefined;
  const read = selector => cleanText(first(selector)?.innerText);
  const url = new URL(location.href);
  const avatarUrls = (element, extra, domain) => {
    const values=[extra, element?.currentSrc, element?.src,
      element?.getAttribute?.('src'), element?.getAttribute?.('data-src'),
      element?.getAttribute?.('data-original'), element?.getAttribute?.('data-lazy-src')];
    for (const srcset of [element?.srcset, element?.getAttribute?.('data-srcset')]) {
      if (srcset) values.push(...srcset.split(',').map(item=>item.trim().split(/\s+/)[0]));
    }
    const result=[];
    for (const value of values) {
      if (!value) continue;
      try {
        const candidate=new URL(value, location.href);
        if(candidate.protocol==='https:' && (candidate.hostname===domain || candidate.hostname.endsWith('.'+domain)) && !result.includes(candidate.href)) result.push(candidate.href);
      } catch { /* Ignore placeholders and malformed lazy-load attributes. */ }
    }
    return result;
  };
  if (options.expectedUrl && url.origin+url.pathname.replace(/\/$/, '') !== options.expectedUrl.replace(/\/$/, '')) throw new Error('账号页面已变化，请重新读取。');
  const exactNumber = raw => {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw;
    if (typeof raw !== 'string') return undefined;
    const match = raw.trim().match(/^([\d,.]+)\s*([千万亿kKmM]?)$/);
    if (!match) return undefined;
    const multiplier = ({千: 1000, 万: 10000, 亿: 100000000, k: 1000, m: 1000000})[match[2].toLowerCase()] || 1;
    const value = Number(match[1].replaceAll(',', '')) * multiplier;
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
  };
  const labeledMetric = (labels, root = document) => {
    const candidates = [];
    for (const element of root.querySelectorAll('a, span, div, button, p, strong, li')) {
      if (!visible(element) || element.children.length > 8) continue;
      const value = element.innerText?.replace(/[\u200b-\u200d\ufeff]/g, '').trim();
      if (!value || value.length > 50) continue;
      for (const label of labels) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = value.match(new RegExp(`^(?:${escaped}\\s*([\\d,.]+\\s*[千万亿kKmM]?)|([\\d,.]+\\s*[千万亿kKmM]?)\\s*${escaped})$`, 'i'));
        const number = exactNumber(match?.[1] || match?.[2]);
        if (number !== undefined) candidates.push(number);
      }
    }
    const unique = [...new Set(candidates)];
    return unique.length === 1 ? unique[0] : undefined;
  };

  if (url.hostname === 'chatgpt.com') {
    if (!/^\/codex(?:\/|$)/.test(url.pathname)) throw new Error('请打开 Codex 页面，而非 ChatGPT 对话。');
    const days = [];
    for (const element of document.querySelectorAll('[data-date], [aria-label], [title], svg rect')) {
      if (!visible(element)) continue;
      const description = [element.getAttribute('aria-label'), element.getAttribute('title'), element.querySelector('title')?.textContent].filter(Boolean).join(' ');
      const date = element.getAttribute('data-date') || description.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
      const rawLevel = element.getAttribute('data-level') ?? element.getAttribute('data-intensity') ?? description.match(/(?:level|intensity|强度|等级)\s*[:：]?\s*([0-4])\b/i)?.[1];
      if (!date || !/^[0-4]$/.test(rawLevel ?? '')) continue;
      const day = {date, intensity: Number(rawLevel)};
      const tokenText = description.match(/\b([\d,]+)\s+tokens?\b/i)?.[1];
      if (tokenText) day.tokens = Number(tokenText.replaceAll(',', ''));
      const existing = days.find(item => item.date === date);
      if (existing && JSON.stringify(existing) !== JSON.stringify(day)) throw new Error('同一天出现冲突数据，适配器需要更新。');
      if (!existing) days.push(day);
    }
    days.sort((a, b) => a.date.localeCompare(b.date));
    const body = [...document.querySelectorAll('main, [role=main], body')].find(visible)?.innerText || '';
    const tokensText = body.match(/(?:tokens?\s*(?:used|usage|用量)|(?:used|使用|消耗)\s*tokens?)\s*[:：]?\s*([\d,]+)/i)?.[1];
    const creditsText = body.match(/(?:credits?\s*(?:used|usage|用量)|(?:used|使用|消耗)\s*credits?)\s*[:：]?\s*([\d,.]+)/i)?.[1];
    const percentText = body.match(/(?:used|已用|使用)\s*[:：]?\s*(\d{1,3}(?:\.\d+)?)\s*%/i)?.[1] ?? body.match(/(\d{1,3}(?:\.\d+)?)\s*%\s*(?:used|已用|使用)/i)?.[1];
    const data = {source: days.length ? (tokensText || creditsText || percentText ? 'profile-ui+usage-ui' : 'profile-ui') : 'usage-ui', days: days.slice(-84)};
    if (tokensText || creditsText) {
      data.usage = {};
      if (tokensText) data.usage.tokens = Number(tokensText.replaceAll(',', ''));
      if (creditsText) data.usage.credits = Number(creditsText.replaceAll(',', ''));
    }
    // Keep the firmware contract: quota always includes an explicit reset time.
    // Scope percentages to their reset container so weekly and session limits cannot mix.
    const quotaNodes = [...document.querySelectorAll('section, article, div')].filter(visible)
      .filter(el => /reset|重置/i.test(el.innerText || '') && (el.innerText || '').length < 500);
    for (const node of quotaNodes) {
      const text = node.innerText;
      const used = text.match(/(?:used|已用|已使用)\s*[:：]?\s*(\d{1,3}(?:\.\d+)?)\s*%/i)?.[1]
        ?? text.match(/(\d{1,3}(?:\.\d+)?)\s*%\s*(?:used|已用|已使用)/i)?.[1];
      const remaining = text.match(/(\d{1,3}(?:\.\d+)?)\s*%\s*(?:remaining|left|剩余)/i)?.[1]
        ?? text.match(/(?:remaining|剩余)\s*[:：]?\s*(\d{1,3}(?:\.\d+)?)\s*%/i)?.[1];
      if ((text.match(/%/g) || []).length !== 1) continue;
      const usedPercent = used !== undefined ? Number(used) : remaining !== undefined ? 100 - Number(remaining) : undefined;
      let reset = Date.parse([...node.querySelectorAll('time[datetime]')].find(visible)?.dateTime);
      // The current analytics dashboard renders an absolute local reset label
      // as plain text (e.g. "Resets Sep 14, 2026 11:43 PM"), without <time>.
      if(!Number.isFinite(reset)) {
        const absolute=text.match(/\bResets?\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}\s+(?:at\s+)?\d{1,2}:\d{2}\s*(?:AM|PM)?)/i)?.[1];
        if(absolute) reset=Date.parse(absolute.replace(/\bat\s+/i,''));
      }
      const relative = text.match(/(?:resets?\s+in|重置(?:还需|于)?|距离重置)\s*(?:(\d+)\s*(?:h(?:ours?)?|小时)\s*)?(?:(\d+)\s*(?:m(?:inutes?)?|分钟))?/i);
      if (!Number.isFinite(reset) && relative && (relative[1] || relative[2])) reset = Date.now() + (Number(relative[1] || 0)*60 + Number(relative[2] || 0))*60000;
      if (usedPercent >= 0 && usedPercent <= 100 && Number.isFinite(reset)) {
        data.quota = {usedPercent, resetsAt:new Date(reset).toISOString().replace(/\.\d{3}Z$/, 'Z')};
        break;
      }
    }
    if (days.length && (data.usage || data.quota)) data.source = 'profile-ui+usage-ui';
    if (!days.length && !data.usage && !data.quota) throw new Error('当前页面没有明确标注的 Codex 活动或用量，请打开 Codex 的用量页面（/codex/settings/usage），等待加载完成后重试。');
    return {site: 'codex', data};
  }

  const zhihu = url.hostname === 'www.zhihu.com';
  const xhs = url.hostname === 'www.xiaohongshu.com';
  if (!zhihu && !xhs) throw new Error('当前站点不受支持。');
  if (xhs) {
    if (!/^\/user\/profile\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) throw new Error('请打开小红书公开个人主页。');
    const name = read('.user-name, .user-info .name, .user-info h1, h1');
    if (!name) throw new Error('没有找到昵称，页面适配器需要更新；旧数据会保留。');
    const metrics = {};
    const metricRoot = first('.user-info, .user-profile') || document;
    const followers = labeledMetric(['粉丝', '关注者', 'followers'], metricRoot);
    const likes = labeledMetric(['获赞与收藏', '获赞与收藏数', '赞与收藏', 'likes & collects'], metricRoot);
    if (likes !== undefined) metrics.likes = likes;
    if (followers !== undefined) metrics.followers = followers;
    const avatar = first('.avatar img, img.avatar, .user-avatar img, img.user-avatar');
    const avatars=avatarUrls(avatar, undefined, 'xhscdn.com');
    return {site: 'xiaohongshu', data: {name, bio: read('.user-desc, .desc') || '', url: url.origin + url.pathname.replace(/\/$/, ''), ...(avatars.length?{avatarUrl:avatars[0],avatarUrls:avatars}:{}), metrics}};
  }

  const fetchJson = async path => {
    try {
      const response = await fetch(path, {credentials: 'include', headers: {Accept: 'application/json'}, signal: AbortSignal.timeout(5000)});
      return response.ok ? await response.json() : null;
    } catch { return null; }
  };
  let slug = url.pathname.match(/^\/people\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1];
  const ownPage = !slug && (url.pathname === '/' || /^\/(?:creator|follow|hot)(?:\/|$)/.test(url.pathname));
  const me = ownPage ? await fetchJson('/api/v4/me') : null;
  if (ownPage) slug = me?.url_token;
  if (!slug) throw new Error('请打开知乎公开个人主页或创作中心。');
  const profile = await fetchJson(`/api/v4/members/${encodeURIComponent(slug)}?include=name,headline,avatar_url,voteup_count,follower_count,answer_count,articles_count,url_token`);
  const name = cleanText(profile?.name || me?.name || read('.ProfileHeader-name'));
  if (!name) throw new Error('没有找到知乎资料，页面适配器需要更新；旧数据会保留。');
  const metric = (apiValue, labels) => exactNumber(apiValue) ?? (ownPage ? undefined : labeledMetric(labels));
  const metrics = {};
  const values = {likes: metric(profile?.voteup_count, ['获赞', '获得赞同', 'likes']), followers: metric(profile?.follower_count, ['粉丝', '关注者', 'followers']), answers: metric(profile?.answer_count, ['回答', 'answers']), articles: metric(profile?.articles_count, ['文章', '专栏文章', 'articles'])};
  if (values.likes === undefined && !ownPage) {
    const counts = [...document.querySelectorAll('div, span, p')].filter(visible)
      .map(el => el.innerText?.trim().match(/^获得\s*([\d,.]+\s*[千万亿kKmM]?)\s*次赞同$/)?.[1])
      .map(exactNumber).filter(value => value !== undefined);
    if (new Set(counts).size === 1) values.likes = counts[0];
  }
  for (const [key, value] of Object.entries(values)) if (value !== undefined) metrics[key] = value;

  // Matches zhihu-copilot's explicit creator-data refresh path.
  const today = new Date();
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const [home, daily, aggregate] = ownPage ? await Promise.all([
    fetchJson('/api/v4/creators/homepage'),
    fetchJson(`/api/v4/creators/analysis/realtime/member/daily?tab=all&start=${day}&end=${day}`),
    fetchJson(`/api/v4/creators/analysis/realtime/member/aggr?tab=all&start=${day}&end=${day}`)
  ]) : [];
  const findNumber = (value, fields, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 5) return undefined;
    for (const field of fields) {
      const number = exactNumber(value[field]);
      if (number !== undefined) return number;
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      const number = findNumber(child, fields, depth + 1);
      if (number !== undefined) return number;
    }
    return undefined;
  };
  const sources = [aggregate?.today, daily, home?.realtime_card, aggregate];
  const findFirst = fields => {
    for (const source of sources) {
      const value = findNumber(source, fields);
      if (value !== undefined) return value;
    }
    return undefined;
  };
  const comments = findFirst(['today_comment_count', 'today_comment_num', 'today_comments_count', 'comment_count']);
  const favorites = findFirst(['today_favorite_count', 'today_favorites_count', 'today_collect_count', 'favorite_count', 'collect_count']);
  if (comments !== undefined || favorites !== undefined) metrics.interactions = (comments || 0) + (favorites || 0);
  const avatar = first('.ProfileHeader-main img, .Avatar');
  const avatars=avatarUrls(avatar, profile?.avatar_url || me?.avatar_url, 'zhimg.com');
  return {site: 'zhihu', data: {name, bio: cleanText(profile?.headline || me?.headline || read('.ProfileHeader-headline')) || '', url: `https://www.zhihu.com/people/${slug}`, ...(avatars.length?{avatarUrl:avatars[0],avatarUrls:avatars}:{}), metrics}};
}
