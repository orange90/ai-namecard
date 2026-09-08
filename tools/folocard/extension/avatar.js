const sources = {
  zhihu:{domain:'zhimg.com', permission:'https://*.zhimg.com/*'},
  xiaohongshu:{domain:'xhscdn.com', permission:'https://*.xhscdn.com/*'}
};

// Runs in the extension worker with host permissions declared at installation.
export async function encodeAvatar(url, site, api=chrome, runtime=globalThis) {
  const source=sources[site];
  if (!url || !source) return undefined;
  let parsed;
  try { parsed=new URL(url); } catch { return undefined; }
  if (parsed.protocol !== 'https:' || !(parsed.hostname === source.domain || parsed.hostname.endsWith('.'+source.domain))) return undefined;
  // Keep the check aligned with the wildcard permission in manifest.json rather
  // than constructing a different permission string from a runtime hostname.
  if (!await api.permissions.contains({origins:[source.permission]})) throw Error('头像 CDN 权限未授予');
  let response;
  try {
    response=await runtime.fetch(parsed.href, {credentials:'omit', cache:'no-store', referrerPolicy:'no-referrer', signal:runtime.AbortSignal.timeout(8000)});
  } catch { throw Error('头像下载超时或网络不可用'); }
  if (!response.ok) throw Error(`头像下载失败（HTTP ${response.status}）`);
  const blob=await response.blob();
  if (!blob.size || blob.size>5*1024*1024) throw Error('头像文件为空或过大');
  let image;
  try { image=await runtime.createImageBitmap(blob); }
  catch { throw Error('头像图片格式无法解析'); }
  try {
    if (!image.width || !image.height) throw Error('头像图片尺寸无效');
    const canvas = new runtime.OffscreenCanvas(24, 24), context = canvas.getContext('2d', {willReadFrequently:true});
    if (!context) throw Error('头像转换不可用');
    const edge = Math.min(image.width, image.height);
    context.drawImage(image, (image.width-edge)/2, (image.height-edge)/2, edge, edge, 0, 0, 24, 24);
    const rgba = context.getImageData(0, 0, 24, 24).data;
    let binary = '';
    for (let i=0;i<rgba.length;i+=4) {
      const value=((rgba[i]>>3)<<11)|((rgba[i+1]>>2)<<5)|(rgba[i+2]>>3);
      binary+=String.fromCharCode(value&255,value>>8);
    }
    return {format:'rgb565le',width:24,height:24,data:runtime.btoa(binary)};
  } finally { image.close(); }
}
