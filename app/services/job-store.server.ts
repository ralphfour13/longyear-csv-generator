/**
 * Job persistence layer.
 *
 * Two backends, selected by environment:
 * - Local development: JSON files under `data/jobs/` (unchanged behaviour, easy to inspect).
 * - Vercel: Postgres via Prisma. Required because a chunked export spans multiple
 *   function invocations that may run on different instances — `/tmp` is per-instance,
 *   so file-based job state would be lost mid-run.
 *
 * Everything above this layer (background-jobs.server.ts) is backend-agnostic.
 */

import { promises as fs } from "fs";
import path from "path";
import type { ExportJob } from "./background-jobs.server";

const IS_VERCEL =
  process.env.VERCEL === "1" || process.env.VERCEL_ENV !== undefined;

const DATA_DIR = IS_VERCEL ? "/tmp/data" : path.join(process.cwd(), "data");
const JOBS_DIR = path.join(DATA_DIR, "jobs");

/* ------------------------------------------------------------------ *
 * Filesystem backend
 * ------------------------------------------------------------------ */

async function ensureJobsDir() {
  await fs.mkdir(JOBS_DIR, { recursive: true });
}

function jobPath(jobId: string) {
  return path.join(JOBS_DIR, `${jobId}.json`);
}

const fsBackend = {
  async read(jobId: string): Promise<ExportJob | null> {
    try {
      return JSON.parse(await fs.readFile(jobPath(jobId), "utf-8"));
    } catch {
      return null;
    }
  },

  async write(job: ExportJob): Promise<void> {
    await ensureJobsDir();
    await fs.writeFile(jobPath(job.id), JSON.stringify(job, null, 2));
  },

  async list(shop?: string): Promise<ExportJob[]> {
    try {
      await ensureJobsDir();
      const files = await fs.readdir(JOBS_DIR);
      const jobs: ExportJob[] = [];
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const job = JSON.parse(
            await fs.readFile(path.join(JOBS_DIR, file), "utf-8"),
          );
          if (!shop || job.shop === shop) jobs.push(job);
        } catch {
          // Skip malformed job files rather than failing the whole listing.
        }
      }
      return jobs;
    } catch {
      return [];
    }
  },

  async remove(jobId: string): Promise<void> {
    try {
      await fs.unlink(jobPath(jobId));
    } catch {
      // Already gone.
    }
  },
};

/* ------------------------------------------------------------------ *
 * Prisma backend
 * ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JobRow = any;

/** Prisma row → the ExportJob shape the rest of the app expects. */
function rowToJob(row: JobRow): ExportJob {
  return {
    id: row.id,
    shop: row.shop,
    status: row.status,
    jobType: row.jobType,
    startDate: row.startDate,
    endDate: row.endDate ?? undefined,
    fileOptions: row.fileOptions ?? {},
    salesTaxRequest: row.salesTaxRequest ?? undefined,
    uncapturedAuthRequest: row.uncapturedAuthRequest ?? undefined,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt ? row.startedAt.toISOString() : undefined,
    completedAt: row.completedAt ? row.completedAt.toISOString() : undefined,
    error: row.error ?? undefined,
    result: row.result ?? undefined,
    progress: row.progress ?? undefined,
    currentStep: row.currentStep ?? undefined,
    completedSteps: row.completedSteps ?? undefined,
    stepState: row.stepState ?? undefined,
  };
}

/** ExportJob → Prisma columns. `undefined` is dropped; dates become Date objects. */
function jobToRow(job: ExportJob): Record<string, unknown> {
  return {
    id: job.id,
    shop: job.shop,
    status: job.status,
    jobType: job.jobType ?? "export",
    startDate: job.startDate,
    endDate: job.endDate ?? null,
    fileOptions: job.fileOptions ?? {},
    salesTaxRequest: job.salesTaxRequest ?? null,
    uncapturedAuthRequest: job.uncapturedAuthRequest ?? null,
    createdAt: new Date(job.createdAt),
    startedAt: job.startedAt ? new Date(job.startedAt) : null,
    completedAt: job.completedAt ? new Date(job.completedAt) : null,
    error: job.error ?? null,
    result: job.result ?? null,
    progress: job.progress ?? null,
    currentStep: job.currentStep ?? null,
    completedSteps: job.completedSteps ?? null,
    stepState: job.stepState ?? null,
  };
}

/**
 * The subset of the generated Prisma client this module uses.
 *
 * Declared structurally rather than imported from `@prisma/client` so this file
 * compiles before `prisma generate` has been run against the new ExportJob model
 * (e.g. on a fresh clone, or in CI before the generate step). Once generated, the
 * real delegate satisfies this shape.
 */
interface ExportJobDelegate {
  findUnique(args: { where: { id: string } }): Promise<JobRow | null>;
  findMany(args: { where?: { shop: string } }): Promise<JobRow[]>;
  upsert(args: {
    where: { id: string };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<JobRow>;
  deleteMany(args: { where: { id: string } }): Promise<{ count: number }>;
}

async function prisma(): Promise<{ exportJob: ExportJobDelegate }> {
  const { default: db } = await import("../db.server");
  return db as unknown as { exportJob: ExportJobDelegate };
}

const dbBackend = {
  async read(jobId: string): Promise<ExportJob | null> {
    const db = await prisma();
    const row = await db.exportJob.findUnique({ where: { id: jobId } });
    return row ? rowToJob(row) : null;
  },

  async write(job: ExportJob): Promise<void> {
    const db = await prisma();
    const data = jobToRow(job);
    await db.exportJob.upsert({
      where: { id: job.id },
      create: data,
      update: data,
    });
  },

  async list(shop?: string): Promise<ExportJob[]> {
    const db = await prisma();
    const rows = await db.exportJob.findMany({
      where: shop ? { shop } : undefined,
    });
    return rows.map(rowToJob);
  },

  async remove(jobId: string): Promise<void> {
    const db = await prisma();
    await db.exportJob.deleteMany({ where: { id: jobId } });
  },
};

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

const backend = IS_VERCEL ? dbBackend : fsBackend;

export const jobStoreBackend = IS_VERCEL ? "postgres" : "filesystem";

export function readJob(jobId: string): Promise<ExportJob | null> {
  return backend.read(jobId);
}

export function writeJob(job: ExportJob): Promise<void> {
  return backend.write(job);
}

/** All jobs, optionally filtered by shop. Unsorted — callers sort as needed. */
export function listJobs(shop?: string): Promise<ExportJob[]> {
  return backend.list(shop);
}

export function removeJob(jobId: string): Promise<void> {
  return backend.remove(jobId);
}
