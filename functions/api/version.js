// 最新版小清单接口（体积恒定，仅含 latest 和最新一版详情），供客户端更新检测
// 和官网首页/下载页使用。历史清单保存在同一 KV 的 history key，由 /api/history 提供。
export async function onRequestGet(context) {
  // KV 是边缘存储，读取不走外部网络，速度和稳定性都优于原先的 CNB 代理。
  var manifest = await context.env.VERSION_MANIFEST.get("manifest", {
    type: "json",
  });

  if (!manifest) {
    // KV 里还没有上传清单时明确报错，提醒执行清单上传命令。
    return new Response("版本清单未上传，请先执行 make manifest-upload", {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  return new Response(JSON.stringify(manifest), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
