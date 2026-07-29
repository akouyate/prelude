# Private role brief import runbook

`RoleIntake` is a temporary, private staging record. It is not a visible Job until an authorized recruiter reviews the extracted title, location, and description.

## Required configuration

1. Create a dedicated **private** R2 bucket for role intake objects. Do not reuse the recording bucket and do not enable public access.
2. Create a scoped R2 access key that can only read, write, copy, head, and delete objects in that bucket.
3. Configure the following encrypted dotenvx variables for the console and the worker:

```sh
dotenvx set ROLE_INTAKE_ENABLED 1
dotenvx set ROLE_INTAKE_R2_ENDPOINT https://<account-id>.r2.cloudflarestorage.com
dotenvx set ROLE_INTAKE_R2_ACCESS_KEY_ID <scoped-access-key-id>
dotenvx set ROLE_INTAKE_R2_SECRET_ACCESS_KEY <scoped-secret>
dotenvx set ROLE_INTAKE_R2_BUCKET prelude-role-intakes
dotenvx set ROLE_INTAKE_R2_REGION auto
dotenvx set ROLE_INTAKE_CLAMAV_HOST 127.0.0.1
dotenvx set ROLE_INTAKE_CLAMAV_PORT 3310
dotenvx set ROLE_INTAKE_INDEXED_SEARCH_ENABLED 1
dotenvx set ROLE_INTAKE_INDEXED_SEARCH_MODEL gpt-5.6-luna
dotenvx set ROLE_INTAKE_INDEXED_SEARCH_TIMEOUT_SECONDS 20
```

`OPENAI_API_KEY` is also required when indexed search is enabled. Keep indexed
search disabled in environments that do not have an approved OpenAI key; URL
imports still use the deterministic public-page importer and preserve the
submitted link when the recruiter continues manually.

5. Apply this CORS policy to the **private** R2 bucket, replacing the origins with each console deployment origin:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "https://app.hirecall.ai"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": [],
    "MaxAgeSeconds": 600
  }
]
```

## Local development

```sh
make role-intake-env-up
make role-intake-worker
```

The worker claims one durable DB-backed job at a time. It retries a temporarily unavailable scanner at most three times and a transient public URL retrieval once, reclaims expired leases, and deletes raw objects after extraction or failure. It also expires unfinished intakes after 24 hours.

## Railway topology

Deploy three private services in the same Railway project/network:

1. `console`: the Next.js console. It signs uploads and serves review pages.
2. `role-intake-worker`: same source image with command `pnpm --filter @prelude/console role-intake:worker`.
3. `clamav`: the official daemon image listening only on its private Railway hostname.

Give the console and worker the same R2 configuration. Set `ROLE_INTAKE_CLAMAV_HOST` to the Railway private ClamAV hostname for both. Only the console has a public HTTP route. The scanner and worker have none.

Allocate the ClamAV service at least **2 GB RAM**. Its signature database requires roughly 1 GB during load; `ConcurrentDatabaseReload no` avoids holding two copies during refresh. Keep the console and worker on smaller independent services so signature reloads cannot affect recruiter traffic.

## Retention and incident behavior

- File input: PDF/DOCX only, maximum 10 MB; MIME declaration is checked before signing and file magic is checked in the worker.
- Public URL input: HTTPS DNS hostnames only; credentials, non-default ports,
  private/special-use DNS results, redirect downgrades, non-HTML responses and
  oversized responses are rejected. The worker sends no browser cookies or
  authorization headers, pins the validated DNS address into the TLS request
  and never stores raw HTML, response headers or resolved IP addresses.
- LinkedIn is never crawled directly. LinkedIn and Indeed URLs use indexed
  search, and blocked or script-only public pages may fall back to the same
  adapter. The result is accepted only with exact-source evidence; otherwise
  the recruiter sees a retry option and a manual path that retains the original
  URL.
- Paid live-provider tests are opt-in. Run
  `ALLOW_LIVE_JOB_URL_TESTS=1 pnpm --filter @prelude/console test --run src/server/role-intakes/role-intake-indexed-search.live.test.ts src/server/role-intakes/role-intake-url-importer.live.test.ts`
  through dotenvx when intentionally validating current LinkedIn, Indeed, and
  public ATS fixtures. Normal test and CI runs never call OpenAI or external
  job pages.
- DOCX packages with macros, OLE/embedded objects, external relationships, path traversal, or more than 50 MB uncompressed content are rejected.
- A malware finding, parsing failure, or expiry prevents a Job from being created and triggers raw-object deletion. A matching pending document also deletes the new raw object, then offers the recruiter a private link to resume the existing intake.
- Store only structural lifecycle telemetry in `RoleIntakeEvent`; never store document text, URLs, raw HTML, headers, resolved IPs, hashes or recruiter content in event metadata.
- A recruiter can continue manually whenever import is unavailable or unsuitable.
