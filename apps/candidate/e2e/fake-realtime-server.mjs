import http from "node:http";

const port = Number(process.env.FAKE_REALTIME_PORT ?? 18081);
const sessions = new Map();

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/healthz") {
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === "POST" && url.pathname === "/__debug/reset") {
    sessions.clear();
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === "GET" && url.pathname === "/__debug/sessions") {
    return sendJson(response, 200, { sessions: [...sessions.values()] });
  }

  if (request.method === "POST" && url.pathname === "/v1/interview-sessions") {
    const body = await readJson(request);
    const sessionId = `is_e2e_${String(body.candidate_id ?? "candidate").replace(/[^a-zA-Z0-9_-]/g, "")}`;
    const now = new Date().toISOString();
    const session = {
      id: sessionId,
      candidate_id: body.candidate_id,
      interview_plan_id: body.interview_plan_id,
      allowed_modalities: body.allowed_modalities ?? ["audio"],
      status: "waiting_candidate",
      livekit_room_name: `prelude-${sessionId}`,
      events: [],
      created_at: now,
      updated_at: now,
    };

    sessions.set(sessionId, session);

    return sendJson(response, 200, {
      session: {
        id: session.id,
        status: session.status,
        livekit_room_name: session.livekit_room_name,
        allowed_modalities: session.allowed_modalities,
      },
      livekit_join: {
        room_name: session.livekit_room_name,
        url: "wss://mock-livekit.prelude.local",
        token: `mock_lk_${sessionId}`,
        participant: `candidate-${session.candidate_id}`,
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      },
    });
  }

  const sessionMatch = url.pathname.match(
    /^\/v1\/interview-sessions\/([^/]+)(?:\/events)?$/,
  );
  if (!sessionMatch) {
    return sendJson(response, 404, { error: "not_found" });
  }

  const sessionId = decodeURIComponent(sessionMatch[1]);
  const session = sessions.get(sessionId);
  if (!session) {
    return sendJson(response, 404, { error: "session_not_found" });
  }

  if (
    request.method === "GET" &&
    url.pathname === `/v1/interview-sessions/${sessionId}`
  ) {
    return sendJson(response, 200, { session });
  }

  if (
    request.method === "POST" &&
    url.pathname === `/v1/interview-sessions/${sessionId}/events`
  ) {
    const body = await readJson(request);
    session.events.push(body);
    session.status =
      body.type === "candidate_media_ready" ? "in_progress" : session.status;
    session.updated_at = new Date().toISOString();
    return sendJson(response, 200, { event: body });
  }

  return sendJson(response, 405, { error: "method_not_allowed" });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Fake realtime listening on http://127.0.0.1:${port}`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}
