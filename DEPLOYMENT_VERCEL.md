# Deploying to Vercel

Project is already linked: `longyearmuseum` (team `ralph-4100s-projects`).

## 1. Create a Blob store (required)

On Vercel, generated CSVs go to Vercel Blob because the filesystem is read-only. Your
project has **no Blob store yet**, so `BLOB_READ_WRITE_TOKEN` is missing and every
export write would fail.

Vercel dashboard → your project → **Storage** → **Create** → **Blob** → connect it to
`longyearmuseum`. That injects `BLOB_READ_WRITE_TOKEN` automatically.

Verify:

```bash
npx vercel env ls production   # BLOB_READ_WRITE_TOKEN should now be listed
```

## 2. Environment variables

Already set: `DATABASE_URL`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`,
`SCOPES`, `NODE_ENV`.

Still worth adding:

| Variable | Why |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` | Added for you by step 1. |
| `CRON_SECRET` | The nightly cron route accepts **any** caller when this is unset — `/api/cron/nightly-export` is currently a public trigger. Set it, and Vercel sends it as `Authorization: Bearer …`. |
| `RESEND_API_SECRET` | Only if you want export notification emails; without it email is skipped with a warning. |

```bash
npx vercel env add CRON_SECRET production
```

## 3. Deploy

```bash
npx vercel --prod
```

The build runs `prisma generate && prisma db push --skip-generate && npm run build`.

`db push` (not `migrate deploy`) is deliberate: `prisma/migrations/` contains a single
migration written in **SQLite** syntax (`DATETIME`, inline `PRIMARY KEY`) left over from
the Shopify template, while the datasource is now `postgresql`. Running
`migrate deploy` would try to execute that SQLite SQL against Postgres and fail the
build. `db push` reconciles the schema directly, which is also what `npm run setup`
already does locally. Worth cleaning up separately — either delete the stale migration
and baseline properly, or commit to `db push`.

## 4. Shopify app config

`shopify.app.longyear-store.toml` currently points at a `trycloudflare.com` dev tunnel.
Before/after deploying, point it back at the production URL and redeploy the app config:

```toml
application_url = "https://longyearmuseum.vercel.app"
redirect_urls = [
  "https://longyearmuseum.vercel.app/auth/callback",
  "https://longyearmuseum.vercel.app/auth/shopify/callback"
]
```

```bash
npm run deploy
```

Then reinstall the app on the store so a fresh access token is issued — changing the app
URL revokes the previous one.

---

## Local development is unchanged

Nothing about the local workflow changed:

```bash
npm run dev
```

Storage backends are selected by environment, not by code changes:

| | Local | Vercel |
| --- | --- | --- |
| Config, mappings, exports | `data/<shop>/` on disk | Vercel Blob |
| Job queue | `data/jobs/*.json` | Postgres (`ExportJob` table) |
| Export execution | single pass, one process | chunked, one file per step |

Two flags let you cross over for testing:

```bash
CHUNKED_EXPORTS=1 npm run dev   # exercise the chunked path locally
CHUNKED_EXPORTS=0               # force single-pass on Vercel
```

**Fixed along the way:** the job queue previously wrote to a hardcoded `/tmp/data`
even locally, which on Windows resolved to `C:\tmp\data` — so local job state landed
outside the project. It now uses `data/jobs` locally and `/tmp/data` only on Vercel.

Note that `data/` is git-tracked while the app writes and deletes files there at
runtime (the "Clear Completed" button really does delete from it). Consider
gitignoring `data/` to stop runtime state showing up as repo changes.

---

## How chunked exports work

A full export takes ~3 minutes, well past the 60s function limit. On Vercel it runs as
one step per output file, checkpointed on the job row:

- `job.completedSteps` — step ids already done
- `job.stepState.files` — files accumulated so far
- `job.currentStep` — step in flight

Each step calls the existing `processExport` with exactly one file flag enabled, so
chunked and single-pass runs generate files through identical code. Steps are
idempotent — re-running one overwrites its file, so a retry cannot double-post.

Reconciliation (~21s) is repeated per step rather than cached between invocations. That
is deliberate: the reconciliation result holds `decimal.js` values that do not survive
a JSON round-trip intact, and re-deriving is safer than risking corrupted money values.

Order snapshots and the notification email are suppressed on every step but the last,
so they happen once per export rather than once per file.

---

## Known limitations — read before relying on this

These are real and not yet solved.

### 1. Background job processing does not survive on serverless

Every UI route kicks off work fire-and-forget:

```ts
processPendingJobs(shop, accessToken).catch(...)   // not awaited
```

A Vercel function is frozen as soon as it returns a response, so this work is killed
partway through and the job sticks in `processing`. **Manual exports triggered from the
UI will not complete on Vercel** until this is changed to either:

- advance one step per request, awaited, driven by the UI's existing progress polling
  (fits the chunking model — `runExportStepsWithinBudget` is ready for this), or
- `waitUntil()` from `@vercel/functions` (survives the response but is still capped by
  `maxDuration`, so it does not fix a 3-minute export on its own).

The nightly cron is already handled: it queues a job and drains steps within a 50s
budget, resuming on later runs.

### 2. The receipts step alone exceeds 60s

Measured from your logs for 2026-06-15 (297 orders):

| Step | Duration |
| --- | --- |
| Reconcile | ~21s |
| Payouts (Income) | ~2s |
| Products (Store) | ~2s |
| **Receipts** | **~118s** |
| Journal summary | <1s |
| Order JSON | <1s |
| Order snapshots | ~32s |

Per-file chunking fits every step under 60s **except receipts**, which needs internal
batching (process N orders per invocation) to be safe on Hobby. On Pro you can instead
raise `maxDuration` to 300 in `vercel.json` and receipts fits comfortably.

### 3. Hobby cron limits

Hobby allows 2 cron jobs at daily granularity, so a frequent "drain the queue" cron
isn't available. Unattended exports that need more than one invocation have no
scheduler to resume them on Hobby — Pro (or an external ping) is required for that.

### 4. `node-cron` is dead code on Vercel

`app/services/scheduler.server.ts` schedules in-process via `node-cron`. There is no
long-lived process on serverless, so it never fires; `vercel.json` crons replace it.
It still works locally.
