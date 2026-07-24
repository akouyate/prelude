# Private role brief import runbook

`RoleIntake` is a temporary, private staging record. It is not a visible Job until an authorized recruiter reviews the extracted title, location, and description.

## Required configuration

1. Create a dedicated **private** R2 bucket for role intake objects. Do not reuse the recording bucket and do not enable public access.
2. Create a scoped R2 access key that can only read, write, copy, head, and delete objects in that bucket.
3. Configure the following encrypted dotenvx variables for the console and the worker:

```sh
dotenvx set ROLE_INTAKE_ENABLED 1
dotenvx set ROLE_INTAKE_PILOT_ORGANIZATION_IDS <org-id-1,org-id-2>
dotenvx set ROLE_INTAKE_PILOT_STARTED_AT 2026-07-24T09:30:00.000Z
dotenvx set ROLE_INTAKE_R2_ENDPOINT https://<account-id>.r2.cloudflarestorage.com
dotenvx set ROLE_INTAKE_R2_ACCESS_KEY_ID <scoped-access-key-id>
dotenvx set ROLE_INTAKE_R2_SECRET_ACCESS_KEY <scoped-secret>
dotenvx set ROLE_INTAKE_R2_BUCKET prelude-role-intakes
dotenvx set ROLE_INTAKE_R2_REGION auto
dotenvx set ROLE_INTAKE_CLAMAV_HOST 127.0.0.1
dotenvx set ROLE_INTAKE_CLAMAV_PORT 3310
```

Production fails closed unless the current organization is in
`ROLE_INTAKE_PILOT_ORGANIZATION_IDS`. The list accepts at most five unique,
explicitly opted-in organization IDs. Development and test environments may
use the global flag without a cohort so the local workflow remains usable.

4. Apply this CORS policy to the **private** R2 bucket, replacing the origins with each console deployment origin:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "https://app.prelude.ai"],
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

## Pilot scorecard

Generate the structural scorecard for the first 50 PDF/DOCX intakes in the
configured cohort:

```sh
export ROLE_INTAKE_PILOT_STARTED_AT="2026-07-24T09:30:00.000Z"
pnpm --filter @prelude/console role-intake:pilot-report
```

The report selects the first 50 terminal file intakes created on or after this
immutable UTC boundary, ordered by creation time and ID. Keep the boundary
unchanged for the duration of a pilot run.

Without human labels, title, description and manual-baseline gates remain
`insufficient_data`. After each document has been reviewed, pass a local JSON
file as the command's first argument. The file contains categorical evidence
only and must not contain filenames, document text, extracted values, URLs,
hashes, email addresses or free-form notes:

```json
[
  {
    "assessmentId": "role-intake-id",
    "assessedAt": "2026-07-24T10:00:00.000Z",
    "cleanEligible": true,
    "titleAcceptable": true,
    "descriptionMateriallyComplete": true,
    "expectedManualFallback": false,
    "fabricatedFieldCount": 0,
    "manualBaselineMs": 180000
  }
]
```

```sh
pnpm --filter @prelude/console role-intake:pilot-report ./pilot-assessments.json
```

Do not commit the assessment file. The command emits aggregate JSON only.

### Assessment rubric

- Judge the title against explicit aliases agreed before the pilot, not against
  a preferred writing style.
- Label clean eligibility independently from the extraction outcome so failed
  processing cannot remove a valid document from the latency denominator.
- Mark the description complete only when the responsibilities, stakeholders
  and expected impact present in the source remain materially represented.
- Label expected manual fallback independently from the parser result. An
  image-only or structurally textless document must fall back without creating
  title, location or description values.
- Measure automatic and manual duration for the same role with identical
  boundaries: start when the source brief is opened and stop when an editable
  question draft is ready.
- Double-review at least 10 of the 50 assessments and adjudicate disagreements
  before generating the release scorecard. Keep reviewer notes outside
  telemetry and out of the repository.

## Railway topology

Deploy three private services in the same Railway project/network:

1. `console`: the Next.js console. It signs uploads and serves review pages.
2. `role-intake-worker`: same source image with command `pnpm --filter @prelude/console role-intake:worker`.
3. `clamav`: the official daemon image listening only on its private Railway hostname.

Give the console and worker the same R2 configuration. Set `ROLE_INTAKE_CLAMAV_HOST` to the Railway private ClamAV hostname for both. Only the console has a public HTTP route. The scanner and worker have none.

Allocate the ClamAV service at least **2 GB RAM**. Its signature database requires roughly 1 GB during load; `ConcurrentDatabaseReload no` avoids holding two copies during refresh. Keep the console and worker on smaller independent services so signature reloads cannot affect recruiter traffic.

## Retention and incident behavior

- File input: PDF/DOCX only, maximum 10 MB; MIME declaration is checked before signing and file magic is checked in the worker.
- Public URL input: HTTPS DNS hostnames only; no credentials, non-default port, private/special-use DNS result, LinkedIn/Indeed URL, robots denial, redirect downgrade, non-HTML response or response above the bounded limit is imported. The worker sends no browser cookies or authorization headers, pins the validated DNS address into the TLS request and never stores raw HTML, response headers or resolved IP addresses.
- DOCX packages with macros, OLE/embedded objects, external relationships, path traversal, or more than 50 MB uncompressed content are rejected.
- A malware finding, parsing failure, or expiry prevents a Job from being created and triggers raw-object deletion. A matching pending document also deletes the new raw object, then offers the recruiter a private link to resume the existing intake.
- Store only structural lifecycle telemetry in `RoleIntakeEvent`; never store document text, URLs, raw HTML, headers, resolved IPs, hashes or recruiter content in event metadata.
- Use the typed event builders for intake analytics. `roleIntakeId` is the
  relational `RoleIntakeEvent.roleIntakeId`; it is deliberately not duplicated
  inside JSON metadata.
- Run the synthetic fixture scorecard before changing the production cohort.
  The scorecard must continue to report `insufficient_data` for customer gates
  until 50 eligible documents and matched manual baselines have actually been
  reviewed.
- A recruiter can continue manually whenever import is unavailable or unsuitable.
