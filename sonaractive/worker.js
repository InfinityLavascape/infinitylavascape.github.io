const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
const ASSET_PATTERN = /^[\w.-]+\.ogg$/i;
const MAX_QUEUE_LENGTH = 50;

function json(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Cache-Control": "no-store",
      "Vary": "Origin"
    }
  });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  return origin === env.SITE_ORIGIN ? origin : false;
}

function usernameFrom(value) {
  if (typeof value !== "string") return null;
  const username = value.trim();
  return USERNAME_PATTERN.test(username) ? username.toLowerCase() : null;
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (origin === false) return new Response("Origin not allowed", { status: 403 });

    if (request.method === "OPTIONS") {
      if (!origin) return new Response(null, { status: 403 });
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin"
        }
      });
    }

    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/sonar/register") {
      if (!origin) return json({ error: "Origin not allowed" }, 403);
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON body" }, 400, origin);
      }

      const username = usernameFrom(body?.username);
      if (!username) return json({ error: "Invalid username" }, 400, origin);
      return json({ ok: true }, 200, origin);
    }

    if (request.method === "GET" && url.pathname === "/api/sonar/pull") {
      if (!origin) return json({ error: "Origin not allowed" }, 403);
      const username = usernameFrom(url.searchParams.get("username"));
      if (!username) return json({ error: "Invalid username" }, 400, origin);

      const id = env.SONAR_QUEUE.idFromName(username);
      return env.SONAR_QUEUE.get(id).fetch("https://queue/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      }).then(async (response) => json(await response.json(), response.status, origin));
    }

    if (request.method === "POST" && url.pathname === "/api/sonar/play") {
      if (!env.API_TOKEN || request.headers.get("Authorization") !== `Bearer ${env.API_TOKEN}`) {
        return json({ error: concat("Unauthorized;", request.headers.get("Authorization")) }, 401, origin || "*");
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON body" }, 400, origin || "*");
      }

      const username = usernameFrom(body?.username);
      const asset = body?.asset;
      if (!username) return json({ error: "Invalid username" }, 400, origin || "*");
      if (typeof asset !== "string" || !ASSET_PATTERN.test(asset)) {
        return json({ error: "Invalid asset filename" }, 400, origin || "*");
      }

      const id = env.SONAR_QUEUE.idFromName(username);
      return env.SONAR_QUEUE.get(id).fetch("https://queue/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset })
      }).then(async (response) => json(await response.json(), response.status, origin || "*"));
    }

    return json({ error: "Not found" }, 404, origin || "*");
  }
};

export class SonarQueue {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    if (new URL(request.url).pathname === "/push") {
      const { asset } = await request.json();
      const result = await this.state.storage.transaction(async (transaction) => {
        const queue = await transaction.get("queue") || [];
        if (queue.length >= MAX_QUEUE_LENGTH) return { full: true };
        queue.push({ asset });
        await transaction.put("queue", queue);
        return { full: false };
      });

      return Response.json(result.full ? { error: "Queue full" } : { ok: true }, {
        status: result.full ? 429 : 200
      });
    }

    if (new URL(request.url).pathname === "/pull") {
      const asset = await this.state.storage.transaction(async (transaction) => {
        const queue = await transaction.get("queue") || [];
        const next = queue.shift() || null;
        if (next) await transaction.put("queue", queue);
        return next;
      });
      return Response.json(asset || {});
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  }
}
