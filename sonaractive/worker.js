const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
const ASSET_PATTERN = /^[\w.-]+\.ogg$/i;
const PLAYBACK_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const MAX_QUEUE_LENGTH = 50;
const MAX_TWEEN_SECONDS = 60;

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

function validateCommand(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Request body must be a JSON object" };
  }

  const command = body.command;
  if (!["play", "pause", "resume", "stop", "volume"].includes(command)) {
    return { error: "Invalid command" };
  }
  if (typeof body.playbackId !== "string" || !PLAYBACK_ID_PATTERN.test(body.playbackId)) {
    return { error: "Invalid playbackId" };
  }

  if (command === "play") {
    if (typeof body.sound !== "string" || !ASSET_PATTERN.test(body.sound)) {
      return { error: "Invalid sound filename" };
    }
    if (body.volume !== undefined && (
      typeof body.volume !== "number" || !Number.isFinite(body.volume) ||
      body.volume < 0 || body.volume > 1
    )) {
      return { error: "Play volume must be between 0 and 1" };
    }
    return {
      command,
      playbackId: body.playbackId,
      sound: body.sound,
      volume: body.volume ?? 1
    };
  }

  if (command === "volume") {
    if (typeof body.value !== "number" || !Number.isFinite(body.value) ||
      body.value < 0 || body.value > 1) {
      return { error: "Volume value must be between 0 and 1" };
    }
    const mode = body.mode ?? "set";
    if (mode !== "set" && mode !== "tween") {
      return { error: "Volume mode must be set or tween" };
    }
    const duration = body.duration ?? 0;
    if (typeof duration !== "number" || !Number.isFinite(duration) ||
      duration < 0 || duration > MAX_TWEEN_SECONDS ||
      (mode === "tween" && duration <= 0)) {
      return { error: `Volume duration must be between 0 and ${MAX_TWEEN_SECONDS} seconds` };
    }
    return { command, playbackId: body.playbackId, value: body.value, mode, duration };
  }

  return { command, playbackId: body.playbackId };
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

    if (request.method === "GET" && url.pathname === "/api/sonar/connect") {
      if (!origin) return json({ error: "Origin not allowed" }, 403);
      const username = usernameFrom(url.searchParams.get("username"));
      if (!username) return json({ error: "Invalid username" }, 400, origin);
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return json({ error: "WebSocket upgrade required" }, 426, origin);
      }

      const id = env.SONAR_QUEUE.idFromName(username);
      return env.SONAR_QUEUE.get(id).fetch(request);
    }

    if (request.method === "POST" &&
      (url.pathname === "/api/sonar/play" || url.pathname === "/api/sonar/command")) {
      if (!env.API_TOKEN || request.headers.get("Authorization") !== `Bearer ${env.API_TOKEN}`) {
        return json({ error: "Unauthorized" }, 401, origin || "*");
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON body" }, 400, origin || "*");
      }

      const username = usernameFrom(body?.username);
      if (!username) return json({ error: "Invalid username" }, 400, origin || "*");
      const commandBody = url.pathname === "/api/sonar/play"
        ? {
          command: "play",
          playbackId: typeof body.playbackId === "string" ? body.playbackId : crypto.randomUUID(),
          sound: body.asset
        }
        : body;
      const command = validateCommand(commandBody);
      if (command.error) return json({ error: command.error }, 400, origin || "*");
      const event = { ...command, workerReceivedAt: Date.now() };
      if (command.command === "play") event.asset = command.sound;

      const id = env.SONAR_QUEUE.idFromName(username);
      return env.SONAR_QUEUE.get(id).fetch("https://queue/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event)
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
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/sonar/connect") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server);

      const queued = await this.state.storage.transaction(async (transaction) => {
        const queue = await transaction.get("queue") || [];
        await transaction.delete("queue");
        return queue;
      });

      try {
        for (const event of queued) server.send(JSON.stringify(event));
      } catch (error) {
        await this.state.storage.transaction(async (transaction) => {
          const queue = await transaction.get("queue") || [];
          await transaction.put("queue", queued.concat(queue).slice(-MAX_QUEUE_LENGTH));
        });
        server.close(1011, "Could not deliver queued sounds");
        console.error("Could not send queued sounds to listener:", error);
        return new Response(null, { status: 503 });
      }

      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    if (url.pathname === "/push") {
      const event = await request.json();
      const sockets = this.state.getWebSockets();
      let delivered = false;

      for (const socket of sockets) {
        if (socket.readyState !== WebSocket.OPEN) continue;
        try {
          socket.send(JSON.stringify(event));
          delivered = true;
        } catch (error) {
          console.error("Could not send sound to listener:", error);
        }
      }

      if (delivered) return Response.json({ ok: true, delivered: true });

      const result = await this.state.storage.transaction(async (transaction) => {
        const queue = await transaction.get("queue") || [];
        if (queue.length >= MAX_QUEUE_LENGTH) return { full: true };
        queue.push(event);
        await transaction.put("queue", queue);
        return { full: false };
      });

      return Response.json(result.full ? { error: "Queue full" } : { ok: true }, {
        status: result.full ? 429 : 200
      });
    }

    if (url.pathname === "/pull") {
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
