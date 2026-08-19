# Production Go-Live Runbook — Live IA Interviewer

Parent epic: #11. Companion to `live-ia-commercial-poc-checklist.md` (demo
readiness). This runbook covers turning the **code-ready** live path into a
**deployed** one. It assumes the application code on `main`.

## What is code-ready (no further code required)

- The recruiter → published `Interview` → candidate `CandidateSession` → live
  room → `LiveInterviewEvent` → `CandidateBrief` spine is wired on real data.
- The Go control plane loads the real published interview plan (#94) and
  creates the LiveKit room on session creation (#95).
- The interviewer honours recruiter-authored, compliance-scanned questions and
  one signal-aware follow-up (E1), runs a warm, valence-invariant persona that
  never infers emotion from voice and never reveals the evaluation (E2/E3), and
  gives a candidate a duty-of-care exit that closes without scoring (E4).
- **Mock interview paths are default-deny and hard-denied in production** (#96):
  the candidate app refuses a `mock_lk_*` room with a 502, and the Python worker
  refuses `--skip-openai-handshake` / a mock token unless `ALLOW_MOCK_INTERVIEW`
  is set in a non-production env.
- **The realtime service fails fast in production** on missing
  `DATABASE_URL` / `REDIS_URL` / `LIVEKIT_*` instead of silently degrading (#97).
- **It also refuses to record outside the EU** (#161): with `RECORDING_ENABLED=1`
  production will not boot unless the egress destination attests EU placement,
  so the "stored in the European Union" line in the candidate consent cannot
  silently become false. The guard reads config, not the bucket — the manual
  confirmation below is still required.
- The realtime Postgres schema is reproducible from the committed Prisma
  migration `20260618070500_live_interview_event_store`.

## Required production configuration

Set `APP_ENV=production` everywhere. Do **not** set `ALLOW_MOCK_INTERVIEW`.

**Go realtime service** (`services/realtime`) — refuses to start without:

- `DATABASE_URL` — same Postgres the console uses (Prisma-managed schema).
- `REDIS_URL` — agent dispatch; without it agents never join.
- `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`.
- Recommended: `LIVE_INTERVIEW_PROVIDER=openai_realtime`, `PORT`,
  `AGENT_JOIN_STREAM_KEY`.

**Recruiter replay** (`services/realtime`, only when `RECORDING_ENABLED=1`) —
also refuses to start without:

- `EGRESS_R2_BUCKET` / `EGRESS_R2_ENDPOINT` / `EGRESS_R2_ACCESS_KEY_ID` /
  `EGRESS_R2_SECRET_ACCESS_KEY`.
- ⚠️ **An EU storage destination.** Every candidate is told their recording is
  stored in the European Union (« stockés dans l'Union européenne »). Point
  `EGRESS_R2_ENDPOINT` at Cloudflare's **`eu` jurisdiction** endpoint,
  `https://<account_id>.eu.r2.cloudflarestorage.com`: a jurisdictional bucket is
  the only R2 feature that *guarantees* objects are stored and processed in the
  EU, and it leaves `EGRESS_R2_REGION` at the `auto` that R2's S3 API requires.
  Failing that, set `EGRESS_R2_REGION` to `eu`, `weur`, or `eeur`. The default
  `auto` region alone stores audio wherever Cloudflare lands it and is **refused
  at boot** (#161).
- `RECORDING_RETENTION_DAYS` ≠ `0` — production refuses that too, since it
  contradicts the 90-day deletion promise in the consent copy.
- ⚠️ **`RECORDING_ENABLED` must carry the same value on the candidate app.** See
  the candidate app section below: this service decides whether to record, the
  candidate app decides what the candidate is told, and only one of the two can
  be right if they disagree.

**Python interviewer agent** (`services/interviewer-agent`, the autoworker):

- `OPENAI_API_KEY` + `OPENAI_REALTIME_MODEL` / `OPENAI_REALTIME_VOICE` /
  `OPENAI_REALTIME_TURN_DETECTION` / `OPENAI_REALTIME_REASONING_EFFORT`
  (the worker refuses a real handshake without these).
- `REALTIME_API_URL` (the Go API), `REALTIME_API_KEY`, `REDIS_URL`, `APP_ENV`.

**Candidate app** (`apps/candidate`):

- ⚠️ `PRELUDE_REALTIME_API_URL` — the candidate app reads **this** name, which is
  **distinct** from the worker's `REALTIME_API_URL`. If only `REALTIME_API_URL`
  is set, the candidate app falls back to `http://127.0.0.1:8080` and live
  interviews break. Set `PRELUDE_REALTIME_API_URL` to the deployed Go API.
- `APP_ENV=production`, `DATABASE_URL`.
- ⚠️ `RECORDING_ENABLED` — **the same value as the Go realtime service**, set from
  the same deployment config. The realtime service reads it to decide whether to
  start an egress; the candidate app reads it to decide what the candidate is
  told, choosing between the two v3 consent variants and stamping the one it
  rendered (`candidate-consent-v3` with recording, `candidate-consent-v3-no-recording`
  without). A mismatch cannot open a hole: the realtime recording gate accepts
  only the audio-disclosing consent ids, so an app with the flag off stamps a
  no-recording version and the service then declines to record — the mismatch
  fails **closed**, never into a recording the candidate was not told about. What
  it does produce is a deployment that pays for egress config and captures
  nothing, or promises a replay recruiters never get. Set both, or neither.

**Console app** (`apps/console`):

- `CONSOLE_AUTH_PROVIDER=clerk` with real Clerk keys (mock auth is refused in
  production), `DATABASE_URL`, `INTERVIEW_DRAFT_GENERATOR=openai` +
  `OPENAI_API_KEY`, and the protected-topic classifier config.
- `CLERK_WEBHOOK_SIGNING_SECRET`, plus a webhook endpoint configured in the
  Clerk Dashboard pointing at `apps/console/app/api/clerk/webhook/route.ts`
  (Svix-signed; see `apps/console/src/server/organizations/clerk-webhook-sync.ts`
  for the event → DB mapping). **The endpoint must be subscribed to exactly**:
  `organizationMembership.created` / `.updated` / `.deleted`,
  `organizationInvitation.created` / `.accepted` / `.revoked`,
  `subscription.*` / `subscriptionItem.*` (billing), and **`user.updated`**
  (keeps `User.name`/`User.email` from silently diverging from the identity a
  recruiter edits in Clerk's own account modal). A handler nobody subscribed
  the endpoint to is dead code that reads as done — verify the subscription
  list in the Dashboard, not just that the code exists. Do NOT subscribe to
  `user.created` (real users are already lazily provisioned, with org
  context, by the membership events above) or `user.deleted` (handled as a
  deliberate no-op — see the code comment on that case for why a hard delete
  would be unsafe).
- ⚠️ `RETENTION_SWEEP_SECRET` (generate: `openssl rand -hex 32`) **and a daily
  scheduler** calling `POST /api/internal/retention-sweep` with
  `Authorization: Bearer $RETENTION_SWEEP_SECRET`. This is what enforces the
  12-month transcript + brief horizon every candidate consent promises. Without
  the secret the endpoint answers 503 and deletes nothing — a silence that reads
  as healthy while the promise quietly stops being true, so schedule it in every
  environment holding real candidate data. `.github/workflows/billing-sweep.yml`
  is the precedent to copy: same shape, daily instead of hourly, its own
  `RETENTION_SWEEP_URL` / `RETENTION_SWEEP_SECRET`, `curl --max-time` bounded and
  disabled by default behind a repo variable. Locally: `make retention-sweep`
  (needs the console running).

## Deploy order

1. `prisma migrate deploy` against the production Postgres (creates/updates the
   console + realtime schema).
2. Deploy the Go realtime service (fails fast if config is incomplete — that is
   the desired behaviour).
3. Deploy the Python autoworker (`make live-openai-autoworker` equivalent) with
   the OpenAI Realtime + Redis + realtime-API config.
4. Deploy the console and candidate apps with `PRELUDE_REALTIME_API_URL` set.
5. Confirm a LiveKit project (Cloud or self-hosted) is reachable from the Go
   service and the candidate browser.

## Verification before opening to real candidates

1. Deterministic spine smoke (no paid calls):
   `make db-migrate && make e2e-smoke E2E_SMOKE_RUN_ID=prod-rehearsal`.
2. One real end-to-end live interview on desktop and mobile Chrome: publish a
   plan, open the candidate link, grant the microphone, answer, ask for one
   repeat, and trigger a stop request to confirm the duty-of-care close. The
   agent must join, audio must flow, and events must persist.
3. `make live-smoke-report SESSION_ID=is_xxx` for the replayability report, and
   capture the evidence listed in `live-ia-commercial-poc-checklist.md`.
4. **`privacy@hirecall.ai` exists and is monitored.** The candidate privacy
   notice prints it as the address for exercising access, erasure, and objection
   rights, and Art. 12(3) gives one month to answer — a promised right with no
   working address is not an effective right (#161). Create the mailbox, route it
   to a named owner with a backup, and confirm a test message sent from outside
   the domain arrives, **before** the first real candidate.
5. **The recording bucket really is in the EU.** The boot guard checks the
   *declared* destination; it cannot see where the bucket was actually created,
   and an R2 location hint is best-effort rather than binding. Open the bucket in
   the Cloudflare dashboard once, by hand, and confirm its jurisdiction is `eu`
   (or its location is European) — then confirm `EGRESS_R2_ENDPOINT` /
   `EGRESS_R2_REGION` name that same destination.
6. **LiveKit egress region + Chapter V basis.** Confirm which region the LiveKit
   Cloud project runs rooms and egress from. If candidate audio transits outside
   the EEA at any hop, record the Chapter V transfer basis (adequacy decision or
   SCCs) and the named recipient before opening to real candidates — an open
   legal item on #161, and a prerequisite for the layer-2 privacy notice.
7. ⚠️ **Art. 28 agreements executed and recorded.** The candidate privacy notice
   states that LiveKit, OpenAI and Cloudflare act on HireCall's behalf and that
   transfers outside the EEA are covered by the Commission's standard
   contractual clauses. Confirm each subprocessor's DPA is signed, record its SCC
   module and date, and confirm the OpenAI account tier's no-training default.
   Confirm the master DPA between HireCall and each hiring organization (the
   controller) is in place. **The notice must not publish before this line is
   checked** (#161).

## Out of scope for this runbook (operator-owned)

Provisioning the LiveKit project, OpenAI Realtime quota/secrets, the Redis and
Postgres instances, the deploy targets, secret storage, and TLS — plus the real
end-to-end live run above — require infrastructure and credentials that are not
in the repository.
