/**
 * Chunked export runner.
 *
 * A full export takes roughly three minutes, which does not fit in a Vercel function
 * invocation (60s on Hobby, 300s on Pro). This module splits it into one step per
 * output file and checkpoints progress on the job, so the work can span several
 * invocations and resume wherever it left off.
 *
 * Design notes:
 *
 * - Each step calls `processExport` with exactly one file flag enabled. That reuses the
 *   existing pipeline as-is rather than re-implementing it, so a chunked run and a
 *   single-pass run generate files through identical code.
 *
 * - Reconciliation is therefore repeated per step (~21s). That is deliberate: the
 *   alternative is persisting the reconciliation result between invocations, and it
 *   holds decimal.js `Decimal` instances that do not survive a JSON round-trip
 *   intact. Re-deriving is slower but cannot silently corrupt money values.
 *
 * - Steps are idempotent: re-running one overwrites its file. A retried or duplicated
 *   invocation cannot double-post anything.
 *
 * Locally, `runExportToCompletion` drives every step back-to-back in one process, so
 * development behaviour matches today's single-pass export.
 */

import {
  processExport,
  type FileGenerationOptions,
} from "./batch-processor.server";
import type { ExportHistoryEntry } from "../types/journal-entry";
import { getJobStatus, updateJobStatus } from "./background-jobs.server";
import { logInfo } from "./error-logger.server";

/** One chunk of an export: a single generated file. */
interface ExportStep {
  /** Stable id recorded in `job.completedSteps`. */
  id: string;
  /** The `FileGenerationOptions` flag this step turns on. */
  flag: keyof FileGenerationOptions;
  label: string;
}

/**
 * Steps in execution order.
 *
 * Ordered cheapest-first among the summaries so a run that dies partway still leaves
 * the most useful artefacts behind. `generateReceipts` is by far the slowest
 * (~118s for ~300 orders) and is the one step that can still exceed a 60s limit —
 * see the module docs in DEPLOYMENT_VERCEL.md.
 */
const EXPORT_STEPS: ExportStep[] = [
  { id: "payouts-orders", flag: "generatePayoutsOrders", label: "Payouts with Orders" },
  { id: "products-orders", flag: "generateProductsOrders", label: "Products with Orders" },
  { id: "journal-summary", flag: "generateJournalSummary", label: "Journal Entry Summary" },
  { id: "journal-details", flag: "generateJournalDetails", label: "Journal Entry Details" },
  { id: "daily-sales", flag: "generateDailySales", label: "Detailed Sales Report" },
  { id: "reconciliation", flag: "generateReconciliation", label: "Daily Reconciliation" },
  { id: "cogs-details", flag: "generateCogsDetails", label: "COGS Details" },
  { id: "order-json", flag: "generateOrderJson", label: "Order JSON Data" },
  { id: "receipts", flag: "generateReceipts", label: "Receipts" },
];

/** Only the steps this job actually asked for. */
function stepsForJob(fileOptions: FileGenerationOptions): ExportStep[] {
  return EXPORT_STEPS.filter((step) => fileOptions[step.flag]);
}

export interface StepResult {
  /** The step just run, or null when there was nothing left to do. */
  ranStep: string | null;
  /** True once every requested step has completed. */
  done: boolean;
  /** Files accumulated so far across all steps. */
  files: ExportHistoryEntry["files"];
  /** Present on the final step. */
  entry?: ExportHistoryEntry;
}

/**
 * Run the next pending step for a job, then return.
 *
 * Call repeatedly until `done` is true. Safe to call again after a crash — progress is
 * read from the job record, not from memory.
 */
export async function runNextExportStep(
  jobId: string,
  accessToken: string,
): Promise<StepResult> {
  const job = await getJobStatus(jobId);
  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  const steps = stepsForJob(job.fileOptions);
  const completed = new Set(job.completedSteps ?? []);
  const accumulated: ExportHistoryEntry["files"] = job.stepState?.files ?? [];

  const next = steps.find((step) => !completed.has(step.id));

  if (!next) {
    return { ranStep: null, done: true, files: accumulated };
  }

  const isFinalStep = steps.filter((s) => !completed.has(s.id)).length === 1;

  await updateJobStatus(jobId, { currentStep: next.id });
  await logInfo(
    job.shop,
    "Export",
    `Chunked export step ${completed.size + 1}/${steps.length}: ${next.label}`,
  );

  // Enable only this step's file.
  const singleFileOptions: FileGenerationOptions = { [next.flag]: true };

  const entry = await processExport(
    job.shop,
    accessToken,
    job.startDate,
    singleFileOptions,
    jobId,
    {
      // Snapshots and the notification email must happen once per export, not once
      // per step, so they run only on the last one.
      suppressSnapshots: !isFinalStep,
      suppressEmail: !isFinalStep,
    },
  );

  // Merge this step's files into the running set, replacing any prior entry for the
  // same filename so a retried step doesn't produce duplicates.
  const merged = [...accumulated];
  for (const file of entry.files ?? []) {
    const existing = merged.findIndex((f) => f.filename === file.filename);
    if (existing >= 0) {
      merged[existing] = file;
    } else {
      merged.push(file);
    }
  }

  completed.add(next.id);
  const done = steps.every((step) => completed.has(step.id));

  await updateJobStatus(jobId, {
    completedSteps: [...completed],
    currentStep: done ? undefined : next.id,
    stepState: { ...(job.stepState ?? {}), files: merged },
  });

  return {
    ranStep: next.id,
    done,
    files: merged,
    entry: done ? { ...entry, files: merged } : undefined,
  };
}

/**
 * Run steps until the budget is nearly spent, then stop and report.
 *
 * For callers that live inside a bounded invocation (a Vercel function, a cron hit).
 * Steps are only started while enough of the budget remains for the slowest one, so
 * the caller can return a response instead of being killed mid-step. Whatever is left
 * stays checkpointed on the job and the next invocation resumes it.
 *
 * @param budgetMs How long this caller may spend in total.
 * @param reserveMs Stop starting new steps once less than this remains. Defaults to
 *   generous headroom, because the receipts step is by far the slowest.
 */
export async function runExportStepsWithinBudget(
  jobId: string,
  accessToken: string,
  budgetMs: number,
  reserveMs = 25_000,
): Promise<StepResult & { exhaustedBudget: boolean }> {
  const startedAt = Date.now();
  let last: StepResult = { ranStep: null, done: false, files: [] };

  for (let i = 0; i <= EXPORT_STEPS.length; i++) {
    const elapsed = Date.now() - startedAt;
    if (elapsed > budgetMs - reserveMs) {
      return { ...last, exhaustedBudget: true };
    }

    last = await runNextExportStep(jobId, accessToken);
    if (last.ranStep === null || last.done) {
      return { ...last, exhaustedBudget: false };
    }
  }

  return { ...last, exhaustedBudget: false };
}

/**
 * Drive every remaining step to completion in this process.
 *
 * Used in local development and by any long-lived worker, where there is no invocation
 * timeout to work around. The per-step boundaries still apply, so the sequence of work
 * is identical to a chunked run — it just happens without yielding.
 */
export async function runExportToCompletion(
  jobId: string,
  accessToken: string,
): Promise<ExportHistoryEntry> {
  let last: StepResult | undefined;

  // Bounded by the step count so a bug in checkpointing can't spin forever.
  for (let i = 0; i <= EXPORT_STEPS.length; i++) {
    const result = await runNextExportStep(jobId, accessToken);
    if (result.ranStep === null) break;
    last = result;
    if (result.done) break;
  }

  if (!last?.entry) {
    throw new Error(
      `Chunked export for job ${jobId} finished without producing a final result`,
    );
  }

  return last.entry;
}

export { EXPORT_STEPS };
