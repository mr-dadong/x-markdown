// 全量版本历史接口，供官网 changelog 页和客户端更新日志使用。
// 数据保存在 Cloudflare KV 的 history key 中，由 `make manifest-upload` 上传。
export async function onRequestGet(context) {
    var history = await context.env.VERSION_MANIFEST.get("history", {
        type: "json",
    });

    if (!history) {
        // KV 里还没有上传历史清单时明确报错，提醒执行清单上传命令。
        return new Response("版本历史未上传，请先执行 make manifest-upload", {
            status: 503,
            headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
            },
        });
    }

    return new Response(JSON.stringify(history), {
        status: 200,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=60, s-maxage=300",
            "X-Content-Type-Options": "nosniff",
        },
    });
}
