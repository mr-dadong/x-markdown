var manifestUrl = 'https://cnb.cool/X-2026/xmd-released/-/git/raw/main/version.json';

export async function onRequestGet() {
  // 请求由 Cloudflare 服务端发出，不受浏览器跨域策略限制。
  var upstreamResponse = await fetch(manifestUrl, {
    cf: {
      cacheEverything: true,
      cacheTtl: 300
    }
  });

  if (!upstreamResponse.ok) {
    return new Response('读取版本信息失败', {
      status: upstreamResponse.status,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }

  return new Response(upstreamResponse.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=300',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
