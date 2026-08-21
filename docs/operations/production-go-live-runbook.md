# Production Go-Live Runbook — HireCall

Parent epic: #11. Companion to `live-ia-commercial-poc-checklist.md` (demo
readiness). This runbook covers turning the **code-ready** application on `main`
into a **deployed** one, for the first time.

**Read it top to bottom, once, in order.** The order is load-bearing: several
steps are gates that must close before a later step is safe to take, and two of
them (the Art. 28 agreements, the privacy mailbox) have lead times measured in
days, not minutes. They are first for that reason.

**Nothing here has ever been deployed.** There is no Dockerfile, no `Procfile`,
no `vercel.json`, no Railway or Fly config in this repository, and no GitHub
deployment has ever run. Packaging and hosting are therefore **operator-owned
decisions this runbook deliberately does not make for you** — it tells you what
each unit needs, not where to put it. Sections marked **operator-owned** cannot
be verified from the repository at all.

---

## 0. What is code-ready (no further code required)

Verified against `main` at `390383e`.

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
- **The realtime service fails fast in production** (#97) on missing
  `DATABASE_URL` / `REDIS_URL` / `LIVEKIT_URL` / `LIVEKIT_API_KEY` /
  `LIVEKIT_API_SECRET` / `REALTIME_API_KEY`, instead of silently degrading to an
  in-memory store, a mock LiveKit gateway, no agent dispatch, or an
  unauthenticated HTTP API.
- **It also refuses to record outside the EU** (#161): with `RECORDING_ENABLED=1`
  production will not boot unless the egress destination attests EU placement,
  so the "stored in the European Union" line in the candidate consent cannot
  silently become false. The guard reads config, not the bucket — the manual
  confirmation in §3.4 is still required.
- **The candidate consent surface no longer overclaims, and erasure is durable**
  (#162, #163): the pre-join screens render and stamp one of two v3 consent
  variants (`candidate-consent-v3` with recording,
  `candidate-consent-v3-no-recording` without), a layer-2 privacy notice is
  served at `/interview/[token]/privacy`, and an erased `CandidateSession`
  carries a durable `erasedAt` / `erasureReason` tombstone rather than a silent
  blank.
- **A session delete can no longer orphan its R2 audio** (#164): the
  `live_interview_recordings` → `live_interview_sessions` foreign key is
  `ON DELETE RESTRICT`, so the database refuses a delete that would leave audio
  unreachable behind the erasure path's back.
- **Recruiter- and candidate-facing content speaks the recipient's language**
  (#159, #160): the console is localised throughout, and generated content
  (drafts, briefs, notifications) is produced in the recipient's language rather
  than translated after the fact. `make e2e-smoke E2E_SMOKE_LANGUAGE=fr` seeds a
  French workspace end to end, so the non-English path is exercised, not assumed.
- **Prepaid credit billing** (#140, #147) is wired through Stripe Checkout, with
  an hourly sweep endpoint and a shipped GitHub Actions scheduler.
- The whole Postgres schema — console *and* realtime — is reproducible from the
  committed Prisma migration history in `packages/db/prisma/migrations`
  (41 migrations at `390383e`, six of them from the last three days).

---

## 1. Operator-owned gates — close these first

⚠️ **None of this is verifiable from the repository.** Each item needs an
account, a signature, or a person. They are first because the later steps
publish candidate-facing promises that these items are what make true.

### 1.1 Art. 28 agreements executed and recorded

⚠️ **The candidate privacy notice must not be reachable before this line is
checked** (#161). The notice states that LiveKit, OpenAI and Cloudflare act on
HireCall's behalf and that transfers outside the EEA are covered by the
Commission's standard contractual clauses. Publishing it first means publishing
a claim you have not yet made true — and the notice becomes reachable the moment
the candidate app serves a real interview link, which is §5, not §7.

- Confirm each subprocessor's DPA is signed. Record its SCC module and date.
- Confirm the OpenAI account tier's no-training default.
- Confirm the master DPA between HireCall and each hiring organization (the
  controller) is in place.

### 1.2 `privacy@hirecall.ai` exists and is monitored

The candidate privacy notice prints it as the address for exercising access,
erasure, and objection rights, and Art. 12(3) gives one month to answer — a
promised right with no working address is not an effective right (#161).

- Create the mailbox.
- Route it to a named owner, with a named backup.
- Confirm a test message sent **from outside the domain** arrives.

Do this **before** the first real candidate, and before the notice is reachable.

### 1.3 LiveKit egress region + Chapter V transfer basis

Confirm which region the LiveKit Cloud project runs rooms and egress from. If
candidate audio transits outside the EEA at any hop, record the Chapter V
transfer basis (adequacy decision or SCCs) and the named recipient. This is an
open legal item on #161 and a prerequisite for the layer-2 privacy notice — so
it belongs here, with §1.1, not after deployment.

### 1.4 Accounts, infrastructure and deploy targets

⚠️ **The repository does not choose these for you and this runbook will not
either.** Provision, and record where each lives:

- A **Postgres** instance (one database serves both the console and the realtime
  service — the Go service reads the Prisma-managed schema).
- A **Redis** instance (agent dispatch; without it agents never join).
- A **LiveKit** project (Cloud or self-hosted).
- **OpenAI** Realtime quota and an API key.
- A **Clerk** application with Organizations enabled.
- A **Stripe** account, if you are turning on prepaid credits (§4.1).
- A **Cloudflare R2** bucket, if you are turning on recording (§3.4).
- **Resend** with a verified sender domain, if you are turning on notifications.
- **Four deploy targets** — see §2 for what each unit is and what it needs.
- Secret storage and TLS for all of the above.

---

## 2. The four deployable units

There are four long-running units, plus two scheduled jobs. **No packaging
exists in this repo for any of them** — no Dockerfile, no start script beyond
the `make` targets, which are development conveniences and not deployment
entrypoints.

| Unit | Path | Shape | Notes |
| --- | --- | --- | --- |
| Console | `apps/console` | Next.js server | Recruiter app, port 3000 in dev |
| Candidate | `apps/candidate` | Next.js server | Public candidate app, port 3001 in dev |
| Realtime API | `services/realtime` | Go HTTP service | Listens on `PORT`; fails fast on bad config |
| Interviewer agent | `services/interviewer-agent` | **Long-running Python process** | ⚠️ Not a serverless function — see below |

⚠️ **The Python interviewer agent is a persistent worker, not a request
handler.** It is a Redis consumer-group reader (`app.auto_worker`) that holds a
lease, claims agent-join messages, and joins LiveKit rooms for the duration of
each interview. It must run somewhere that keeps a process alive indefinitely
and permits long-lived outbound WebSocket connections. A serverless function, a
cron invocation, or any platform with a request timeout will not host it.

⚠️ **The Python worker takes three of its most important settings as CLI flags,
not environment variables.** `--realtime-api-url` (required), `--redis-url`
(required) and `--api-key` are argparse arguments on `app.auto_worker`. The
`make live-openai-autoworker` target reads `REALTIME_API_URL`, `REDIS_URL` and
`REALTIME_API_KEY` from the environment **and translates them into those
flags** — that translation is in the Makefile, not in the worker. A deployment
that runs `python -m app.auto_worker` directly and only sets the env vars will
fail to start (missing required arguments). Either pass the flags explicitly, or
invoke it through the same wrapper the Makefile uses.

The two scheduled jobs are plain authenticated `POST`s against the console, so
any scheduler can run them (§6).

---

## 3. Required production configuration

Set `APP_ENV=production` on **all four units**. Do **not** set
`ALLOW_MOCK_INTERVIEW`. Do **not** set any `MOCK_CLERK_*` variable.

⚠️ **Every `NEXT_PUBLIC_*` value is baked into the browser bundle at `next
build`, not read when the process starts.** This applies to both Next apps
(§3.5, §3.6) and it is the one configuration mistake that does not announce
itself: the server boots, health checks pass, `isClerkConfigured` is true
server-side — and the bundle the browser downloaded carries a missing or stale
key, so sign-in simply fails. Set every `NEXT_PUBLIC_*` variable **before the
build runs**, in whatever your host calls build-time environment, and rebuild
(not restart) after changing one. Non-`NEXT_PUBLIC_*` variables are read at
runtime as usual, so the two halves of a unit's configuration have different
deadlines.

### 3.1 Go realtime service (`services/realtime`)

**Refuses to start in production without** (`cmd/server/config.go`):

- `DATABASE_URL` — the same Postgres the console uses (Prisma-managed schema).
- `REDIS_URL` — agent dispatch; without it agents never join.
- `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`.
- `REALTIME_API_KEY` — the shared bearer the HTTP API verifies on every
  non-public route. ⚠️ **The service disables authentication entirely when this
  is empty**, which would leave event ingestion, recruiter reads and the
  destructive recordings-erasure endpoint open. Production requires it, and
  **every caller must send the same value**: the console, the candidate app, and
  the Python worker (via `--api-key`).

Also set:

- `APP_ENV=production` — this is what turns the fail-fast on.
- `PORT` — the listen port.
- `LIVE_INTERVIEW_PROVIDER=openai_realtime`.
- `AGENT_JOIN_STREAM_KEY` — must match the Python worker's stream key
  (defaults agree at `prelude:agent-join:stream`; set both or neither).

### 3.2 Python interviewer agent (`services/interviewer-agent`)

Read `⚠️` in §2 first: `--realtime-api-url`, `--redis-url` and `--api-key` are
**flags**, not env vars.

Environment variables the worker itself reads:

- ⚠️ `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` — **required**.
  `app/adapters/livekit_tokens.py` raises `missing LiveKit environment
  variables` and the agent cannot join a room without them. These were absent
  from earlier revisions of this runbook; they are not optional.
- `OPENAI_API_KEY` + `OPENAI_REALTIME_MODEL` / `OPENAI_REALTIME_VOICE` /
  `OPENAI_REALTIME_TURN_DETECTION` / `OPENAI_REALTIME_REASONING_EFFORT` — the
  worker refuses a real handshake without these.
- `APP_ENV=production` — hard-denies the mock interview paths (#96).
- Optional tuning, all with working defaults: `AGENT_JOIN_STREAM_KEY`,
  `AGENT_JOIN_CONSUMER_GROUP`, `AGENT_JOIN_PENDING_IDLE_SECONDS`,
  `LIVE_WORKER_MAX_CONCURRENCY` (default 2), the `LIVE_WORKER_*` timeout family,
  `LIVEKIT_TURN_DETECTOR_VERSION`, `LIVEKIT_ENDPOINTING_*`, `LIVEKIT_STT_MODEL`,
  `OPENAI_EXACT_TTS_*`, `OPENAI_REALTIME_TRANSCRIPTION_MODEL`,
  `OPENAI_ANSWER_INFERENCE_*`.
- Do **not** set `LIVEKIT_LEGACY_TURN_HANDLING` (deprecated rollback only) or
  any `ELEVENLABS_*` / `BENCHMARK_*` variable (benchmark harness only).

### 3.3 `RECORDING_ENABLED` — one value, three processes

⚠️ **Three processes read `RECORDING_ENABLED` and they must carry the same
value, set from the same deployment config.** This is stated once, here; the
per-unit sections below just point back at it.

1. **`services/realtime` (Go)** — decides whether to start an egress at all.
2. **`apps/candidate`** — decides what the candidate is *told*: which of the two
   v3 consent variants the pre-join screens render, and which version id is
   stamped on their session (`candidate-consent-v3` with recording,
   `candidate-consent-v3-no-recording` without).
3. **`apps/console`** — decides what the *recruiter* is shown in the pre-publish
   trust panel, whose whole claim is that it prints exactly what the candidate
   reads.

They cannot disagree about what "on" **means**: the two TypeScript readers share
one parse rule, `parseRecordingEnabled` in `@prelude/core`
(`policies/recording.ts`), whose accepted spellings (`1`, `true`, `yes`) are
pinned by test against the Go switch — drift fails the build instead of shipping.
The reads are `apps/candidate/src/server/recording-state.ts` and
`apps/console/src/server/interviews/recording-state.ts`.

A mismatch in the flag's **value** cannot open a hole either: the realtime
recording gate accepts only the audio-disclosing consent ids, so an app with the
flag off stamps a no-recording version and the service then declines to record —
the mismatch fails **closed**, never into a recording the candidate was not told
about. What it *does* produce is a deployment that pays for egress config and
captures nothing, or a trust panel showing recruiters copy their candidates never
see. **Set all three, or none.**

### 3.4 Recruiter replay (only when `RECORDING_ENABLED=1`)

The Go service **additionally refuses to start** without:

- `EGRESS_R2_BUCKET` / `EGRESS_R2_ENDPOINT` / `EGRESS_R2_ACCESS_KEY_ID` /
  `EGRESS_R2_SECRET_ACCESS_KEY`.

The console reads the same five `EGRESS_R2_*` names to mint short-lived signed
playback URLs (`src/server/interviews/recording-playback.ts`), so **set them on
the console too**, or replay resolves to nothing.

- ⚠️ **An EU storage destination.** Every candidate is told their recording is
  stored in the European Union (« stockés dans l'Union européenne »). Point
  `EGRESS_R2_ENDPOINT` at Cloudflare's **`eu` jurisdiction** endpoint,
  `https://<account_id>.eu.r2.cloudflarestorage.com`: a jurisdictional bucket is
  the only R2 feature that *guarantees* objects are stored and processed in the
  EU, and it leaves `EGRESS_R2_REGION` at the `auto` that R2's S3 API requires.
  Failing that, set `EGRESS_R2_REGION` to `eu`, `weur`, or `eeur`. The default
  `auto` region alone stores audio wherever Cloudflare lands it and is **refused
  at boot** (#161).
- ⚠️ **Confirm the bucket really is in the EU — by hand, once, before you set
  `RECORDING_ENABLED=1` in production.** The boot guard validates the *declared*
  destination; it cannot see where the bucket was actually created, and an R2
  location hint is best-effort rather than binding. Open the bucket in the
  Cloudflare dashboard, confirm its jurisdiction is `eu` (or its location is
  European), then confirm `EGRESS_R2_ENDPOINT` / `EGRESS_R2_REGION` name that
  same destination. This gate belongs here, not after deployment: enabling
  recording against an unconfirmed bucket is what makes the consent copy false.
- `RECORDING_RETENTION_DAYS` ≠ `0` — production refuses that too, since it
  contradicts the 90-day deletion promise in the consent copy. Defaults to 90.
- ⚠️ **An R2 bucket lifecycle rule is a backstop, never the deletion itself.**
  What honours the promise is the application: the retention sweep and the
  erasure endpoint delete the object first, then tombstone the row, and the
  recording foreign key is `ON DELETE RESTRICT` (#164) so no session delete can
  orphan audio behind their backs. Set a lifecycle rule if you want a net under
  that — at a horizon *no shorter* than `RECORDING_RETENTION_DAYS`, so it can
  only ever catch what the sweep missed — but never treat it as the mechanism:
  it expires objects on Cloudflare's schedule, which would mean telling a
  candidate their audio is deleted when it is merely scheduled to be.

### 3.5 Candidate app (`apps/candidate`)

- ⚠️ `PRELUDE_REALTIME_API_URL` — the candidate app and the console read
  **this** name, which is **distinct** from the Python worker's
  `--realtime-api-url` flag and from the `REALTIME_API_URL` variable that only
  the `make` targets and `scripts/live-smoke-report.mjs` consume. If you set
  `REALTIME_API_URL` alone, the candidate app silently falls back to
  `http://127.0.0.1:8080` and live interviews break. Set
  `PRELUDE_REALTIME_API_URL` to the deployed Go API.
- `REALTIME_API_KEY` — same value as the Go service, or every server-to-server
  call is rejected.
- `DATABASE_URL`, `APP_ENV=production`.
- `NEXT_PUBLIC_CONSOLE_URL` — the console's public origin.
- ⚠️ `RECORDING_ENABLED` — same value as the Go service and the console. See §3.3.
- `CREDIT_BILLING_ENABLED` — must match the console (§4.1): the candidate app
  runs the admission check that spends a credit.

### 3.6 Console app (`apps/console`)

**Authentication** — ⚠️ mock auth is refused when `NODE_ENV=production`, and
`CONSOLE_AUTH_PROVIDER=auto` with unset Clerk keys is *also* refused in
production, so a half-configured console fails rather than degrading:

- `CONSOLE_AUTH_PROVIDER=clerk`.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` — **both**, or
  `isClerkConfigured` is false and the console refuses to serve.
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `NEXT_PUBLIC_CLERK_SIGN_UP_URL` /
  `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` /
  `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` — optional; they have
  working defaults (`/login`, `/sign-up`, `/`, `/onboarding/organization`).
- ⚠️ Do **not** set `MOCK_CLERK_USER_ID` / `_EMAIL` / `_NAME` / `MOCK_CLERK_ORG_ID`
  / `MOCK_CLERK_ORG_ROLE`. They are local-mock identity only.

**Clerk webhook** — `CLERK_WEBHOOK_SIGNING_SECRET`, plus an endpoint configured
in the Clerk Dashboard pointing at `apps/console/app/api/clerk/webhook/route.ts`
(Svix-signed; see `apps/console/src/server/organizations/clerk-webhook-sync.ts`
for the event → DB mapping). **The endpoint must be subscribed to exactly**:
`organizationMembership.created` / `.updated` / `.deleted`,
`organizationInvitation.created` / `.accepted` / `.revoked`,
`subscription.*` / `subscriptionItem.*` (billing), and **`user.updated`** (keeps
`User.name`/`User.email` from silently diverging from the identity a recruiter
edits in Clerk's own account modal, #155). A handler nobody subscribed the
endpoint to is dead code that reads as done — verify the subscription list in
the Dashboard, not just that the code exists. Do NOT subscribe to `user.created`
(real users are already lazily provisioned, with org context, by the membership
events above) or `user.deleted` (handled as a deliberate no-op — see the code
comment on that case for why a hard delete would be unsafe).

**Core**:

- `DATABASE_URL`, `APP_ENV=production`, `NODE_ENV=production`.
- `NEXT_PUBLIC_CANDIDATE_URL` — the candidate app's public origin. The console
  builds every candidate link from it; unset, recruiters copy broken links.
- `NEXT_PUBLIC_CONSOLE_URL` — the console's own public origin, used for links in
  outbound notifications.
- `PRELUDE_REALTIME_API_URL` + `REALTIME_API_KEY` — the console calls the Go API
  for recording actions and candidate erasure.
- ⚠️ `RECORDING_ENABLED` — same value as the Go service and the candidate app.
  See §3.3. Leave it unset here and recruiters approve copy their candidates
  never see.
- `EGRESS_R2_*` — see §3.4, needed for signed replay URLs.

**Generation and compliance**:

- `INTERVIEW_DRAFT_GENERATOR=openai` + `OPENAI_API_KEY`. ⚠️ Anything other than
  `openai` or `deterministic` is rejected; with neither the key nor
  `deterministic`, draft generation throws on every call.
- `PROTECTED_TOPIC_CLASSIFIER` — leave **unset** for the LLM classifier (the
  production default). `deterministic` is the offline fallback; `off` disables
  the protected-topic scan entirely and must not be used in production.
- `CANDIDATE_BRIEF_LLM_ENABLED=1` + `OPENAI_API_KEY` — without both, brief
  synthesis silently falls back to the local non-LLM synthesizer. That is a safe
  fallback, not an error, so it will not announce itself; set it deliberately.
- ⚠️ Do **not** set `ALLOW_LIVE_LLM_TESTS`. It gates paid live-LLM test paths and
  has no production use.

**Optional, off unless you configure them** — each is disabled by default and
fails closed, so skip any you are not launching with:

- `NOTIFICATIONS_ENABLED=1` + `RESEND_API_KEY` + `RESEND_FROM_EMAIL` (verified
  Resend sender domain). With `NOTIFICATIONS_ENABLED` unset, or either Resend
  value missing, no transactional email is sent at all.
- `ROLE_INTAKE_ENABLED=1` — only after **all** of `ROLE_INTAKE_R2_ENDPOINT` /
  `_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` / `_BUCKET` / `_REGION` and
  `ROLE_INTAKE_CLAMAV_HOST` / `_PORT` are configured. Keep that bucket private.
  `ROLE_INTAKE_INDEXED_SEARCH_ENABLED=1` additionally requires `OPENAI_API_KEY`.
- `CONNECTED_ACCOUNT_ENCRYPTION_KEY` (generate: `openssl rand -base64 32`),
  `CONNECTED_ACCOUNT_STATE_SECRET`, `GOOGLE_OAUTH_CLIENT_ID` /
  `GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REDIRECT_URI` — first-party
  connected accounts.

### 3.7 Anonymous marketing-demo lead delivery

The demo result page can accept a work email only after Candidate mints a
short-lived, single-use completion proof. Configure these Console-only values:

- `MARKETING_DEMO_LEAD_WEBHOOK_URL` — the HTTPS server-to-server receiver in
  the CRM/marketing integration layer.
- `MARKETING_DEMO_LEAD_WEBHOOK_SECRET` — independent bearer, at least 32 bytes.
- `MARKETING_DEMO_LEAD_OPERATIONS_SECRET` — independent bearer for the
  scheduled outbox/retention endpoint.
- `MARKETING_DEMO_LEAD_UNSUBSCRIBE_SECRET` — independent signing key for
  confirmation links.
- `MARKETING_DEMO_LEAD_RETENTION_DAYS` — 730 by default; accepted range is
  30–3650. Non-consented and withdrawn records keep a separate 30-day ceiling.

The receiver must deduplicate by `Idempotency-Key`. It receives
`setup_requested`, `consent_granted`, and `consent_withdrawn` events containing
only email, predefined role, consent state/timestamps, event metadata, and the
signed unsubscribe URL. Reject any integration change that adds transcript,
answer, generated-insight, handoff, or preview-token fields.

---

## 4. Billing configuration (console)

Skip §4 entirely if you are launching unmetered. Otherwise pick **one** path.

### 4.1 Prepaid credits (Stripe) — the #140 path

- `CREDIT_BILLING_ENABLED=1`. ⚠️ Accepted values are `1` / `true` / `yes`; the
  candidate app must carry the **same** value (§3.5), since it runs the
  admission check that spends a credit.
- `STRIPE_SECRET_KEY` — must start with `sk_`, or every Stripe call throws.
- `STRIPE_WEBHOOK_SECRET` — from the **dashboard webhook endpoint config** for a
  deployed environment. ⚠️ It is *not* a shared secret: `stripe listen` mints a
  different one per developer, so never copy a local value into production.
- ⚠️ `BILLING_SWEEP_SECRET` (generate: `openssl rand -hex 32`) **and an hourly
  scheduler** — see §6.1.
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is in `.env.example` but is **read by no
  code** at `390383e` (Checkout is hosted). You do not need to set it.

### 4.2 Legacy Clerk billing projection (alternative to §4.1)

`CLERK_BILLING_ENABLED` + `CLERK_BILLING_V1_PLAN_SLUG` +
`CLERK_BILLING_PROJECTION_MAX_AGE_SECONDS`. Enable only if organization Billing
and the V1 Workspace plan exist in the matching Clerk instance. Disabled
environments stay explicitly unmetered; production fails closed.

---

## 5. Deploy order

The order matters: each step depends on the previous one already being true.

1. **Confirm §1 is closed.** In particular §1.1 — the candidate app publishes the
   privacy notice, so deploying it is publishing.
2. **Confirm the LiveKit project is reachable** from wherever the Go service and
   the Python worker will run, and from a candidate browser. The Go service
   fails fast on *missing* LiveKit config but cannot detect an *unreachable*
   LiveKit — that failure would surface as an interview that never starts.
3. **`prisma migrate deploy`** against the production Postgres. This creates and
   updates the console **and** realtime schema — one database, one migration
   history (41 migrations at `390383e`; the newest six landed in the last three
   days, including the erasure tombstone and the recording FK `RESTRICT`).
   ⚠️ Run it **before** any service boots: the Go service reads tables Prisma
   owns, and the recording FK change alters a constraint the realtime service
   writes through.
4. **Deploy the Go realtime service.** It fails fast if config is incomplete —
   that is the desired behaviour, and the fastest way to find a missing
   `REALTIME_API_KEY` or a non-EU recording destination.
5. **Deploy the Python autoworker** as a long-running process (§2), with the
   LiveKit + OpenAI env and the `--realtime-api-url` / `--redis-url` /
   `--api-key` flags pointing at the service from step 4.
6. **Deploy the console and the candidate app together**, with
   `PRELUDE_REALTIME_API_URL` and `REALTIME_API_KEY` pointing at step 4.
   ⚠️ **Deploy them in the same change as the Go service whenever
   `RECORDING_ENABLED` moves**, so all three readers flip together (§3.3). A
   partial rollout is the one way to get a deployment that promises a replay it
   never captures.
7. **Configure the two schedulers** (§6). Neither is optional in an environment
   holding real candidate data or real money.

⚠️ **Before step 6**, both public origins must already be decided:
`NEXT_PUBLIC_CANDIDATE_URL` and `NEXT_PUBLIC_CONSOLE_URL` name each other, and
both are inlined at build time (§3), so a hostname chosen after the build means
another build.

### 5.1 When a step fails

Fail-fast is the intended behaviour of this stack, so a refused boot is
information, not damage. What to do:

- **A service refuses to start.** Read the error: the Go service names the
  missing variable, and the console names the auth misconfiguration. Fix the
  configuration and redeploy that unit only. Nothing partial was written.
- **`prisma migrate deploy` fails.** PostgreSQL applies each migration inside a
  transaction, so the failing one leaves no half-applied schema — but Prisma
  records it as failed and refuses every later deploy until you resolve it.
  Read the error, fix the cause, then mark it with `prisma migrate resolve`
  (`--rolled-back` if it truly did not apply, `--applied` only if you verified
  by hand that its effects are present). Do not edit a committed migration to
  make it pass; add a new one.
- **You need to undo a deploy.** Redeploy the previous commit of the affected
  unit. The migration history is forward-only and additive, so an older app
  generally runs against a newer schema — with one exception worth knowing:
  rolling the Go service back past #164 restores a build whose expired-preview
  sweep deletes sessions without stepping around those that hold a recording.
  Against the `RESTRICT` constraint that is now in the database, such a sweep
  fails and rolls back its whole transaction, so preview cleanup silently stops
  running. Candidate data stays safe — the constraint is stricter, not looser —
  but do not leave that combination in place.
- **A candidate hit a broken deploy.** Their session is durable: the event store
  is append-only and the brief regenerates from persisted evidence. Fix the
  unit, then reopen the candidate's interview link — unless the invitation was
  consumed, in which case reissue it from the console.
- **When in doubt about candidate data, stop rather than clean up by hand.**
  Erasure has exactly one correct path (§0, #164); deleting rows directly is
  what that FK exists to refuse.

---

## 6. Scheduled jobs

All are plain authenticated `POST`s against the console, so any scheduler
works — a platform cron, a k8s CronJob, or GitHub Actions.

### 6.1 Billing sweep — hourly

`.github/workflows/billing-sweep.yml` **exists and ships enabled-by-flag**.
Turn it on for an environment with:

```
gh variable set BILLING_SWEEP_ENABLED --body true
gh variable set BILLING_SWEEP_URL --body https://<console-host>/api/internal/billing-sweep
gh secret   set BILLING_SWEEP_SECRET   # same value as the console's env var
```

Until `BILLING_SWEEP_SECRET` is set the endpoint answers 503 and the job fails
loudly rather than sweeping nothing quietly.

⚠️ GitHub's schedule is best-effort, can be delayed under load, and is disabled
automatically on repos with no activity for 60 days. It is a **stopgap by
design**, acceptable only because every sweep operation is idempotent. Replace
it with a platform cron once you have one.

### 6.2 Retention sweep — daily

⚠️ **No workflow file exists for this one.** `.github/workflows/billing-sweep.yml`
is the only workflow in the repository; you must create the retention job
yourself.

`RETENTION_SWEEP_SECRET` (generate: `openssl rand -hex 32`) **and a daily
scheduler** calling `POST /api/internal/retention-sweep` with
`Authorization: Bearer $RETENTION_SWEEP_SECRET`. This is what enforces the
12-month transcript + brief horizon every candidate consent promises. Without
the secret the endpoint answers 503 and deletes nothing — a silence that reads as
healthy while the promise quietly stops being true. Schedule it in **every**
environment holding real candidate data.

To copy `billing-sweep.yml` into a retention job, the changes are:

- `on.schedule.cron` → once a day, not hourly.
- Gate variable → `RETENTION_SWEEP_ENABLED`; URL variable →
  `RETENTION_SWEEP_URL` (pointing at `/api/internal/retention-sweep`); secret →
  `RETENTION_SWEEP_SECRET`.
- `concurrency.group` → a distinct name, so it never cancels or queues behind
  the billing sweep.
- Drop the billing-specific pagination and drift/`needs_admin` reporting: this
  endpoint pages on `?limit=` with a self-advancing selection (no cursor), and
  answers `{ cutoff, erased, failed, hasMore, scanned, retentionMonths,
  durationMs }`. `failed` is a **report, not an HTTP failure** — do not make the
  job retry the whole batch on it. Re-run while `hasMore` is true if you want a
  single run to drain the backlog.
- Keep the shape that matters: `curl --fail-with-body`, a bounded `--max-time`,
  the bearer in a **header** and never in the URL, and disabled-by-default behind
  a repo variable.

⚠️ Its secret is deliberately **separate** from `BILLING_SWEEP_SECRET`: the two
sweeps have different blast radii (money vs. irreversible deletion), and a shared
credential would let a leak of the harmless one drive the destructive one. Do not
reuse one value for both.

Locally: `make retention-sweep` and `make billing-sweep` (both need the console
running, and the matching secret exported).

### 6.3 Marketing-demo lead operations — at least every five minutes

Schedule `POST /api/internal/marketing-demo-leads/operations` with
`Authorization: Bearer $MARKETING_DEMO_LEAD_OPERATIONS_SECRET`. The endpoint
leases and retries pending webhook events and enforces lead/capture-proof
retention. It answers 503 when its secret, webhook URL, webhook bearer, or
unsubscribe signer is unavailable, so delivery fails closed and remains in the
outbox.

Use a bounded `?limit=` value from 1 to 200, `curl --fail-with-body`, and an
independent scheduler concurrency group. Monitor non-2xx responses and a
growing pending outbox. Locally the equivalent is
`make marketing-demo-lead-operations` with the Console running.

---

## 7. Verification before opening to real candidates

1. **Deterministic spine smoke** (no paid calls):
   `make db-migrate && make e2e-smoke E2E_SMOKE_RUN_ID=prod-rehearsal`.
   Then repeat with `E2E_SMOKE_LANGUAGE=fr` if you are launching in French — it
   seeds a French workspace end to end rather than French stamps over English
   prose (#160).
2. **One real end-to-end live interview**, on desktop **and** mobile Chrome:
   publish a plan, open the candidate link, grant the microphone, answer, ask for
   one repeat, and trigger a stop request to confirm the duty-of-care close. The
   agent must join, audio must flow, and events must persist.
3. **Replayability report**: `make live-smoke-report SESSION_ID=is_xxx`
   (this target reads `REALTIME_API_URL`, not `PRELUDE_REALTIME_API_URL` — see
   §3.5). Capture the evidence listed in `live-ia-commercial-poc-checklist.md`.
4. **Consent copy matches reality.** On the interview you just ran, confirm the
   stamped consent version is `candidate-consent-v3` if `RECORDING_ENABLED=1` and
   `candidate-consent-v3-no-recording` if not, and that the console's pre-publish
   trust panel showed the recruiter that same variant (§3.3).
5. **The privacy notice resolves** at `/interview/[token]/privacy` for a real
   token, in the interview's language, and prints the mailbox from §1.2.
6. **Both schedulers have run once successfully** (§6) — trigger each manually
   and read the response body, rather than waiting for the first cron tick to
   tell you the secret was wrong.

---

## 8. Out of scope for this runbook (operator-owned)

Everything in §1, plus: packaging each unit for its host (no Dockerfile or start
script exists), the four deploy targets themselves, secret storage, TLS,
DNS, backups and restore-testing for Postgres and Redis, log aggregation, and
uptime alerting. These need infrastructure, credentials and decisions that are
not in the repository, and this runbook does not presume them.
