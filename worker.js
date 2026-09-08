const ALLOWED_METHODS = "GET, OPTIONS";

export default {
    async fetch(request, env) {
        const origin = request.headers.get("Origin");
        const corsHeaders = {
            "Access-Control-Allow-Origin": origin === env.ALLOWED_ORIGIN ? origin : "null",
            "Access-Control-Allow-Methods": ALLOWED_METHODS,
            "Cache-Control": "no-store",
            "Vary": "Origin"
        };

        if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
        if (request.method !== "GET" || new URL(request.url).pathname !== "/turn-credentials") {
            return new Response("Not found", { status: 404, headers: corsHeaders });
        }

        const response = await fetch(
            `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${env.TURN_API_TOKEN}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ ttl: 3600 })
            }
        );

        return new Response(await response.text(), {
            status: response.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }
};