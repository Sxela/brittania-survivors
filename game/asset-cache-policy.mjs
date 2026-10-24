export const CACHE_LIMIT=1024;
export const validAssetVersion=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function cacheableAsset(request,scope) {
  const base=new URL(scope),url=new URL(request.url);
  return request.method==='GET'&&!request.headers.has('range')&&url.origin===base.origin
    &&url.pathname.startsWith(new URL('assets/',base).pathname);
}
export const cacheableResponse=response=>response.status===200&&response.type!=='opaque'
  &&!response.headers.get('content-type')?.includes('text/html');
