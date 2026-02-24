import { promises as fs } from 'fs';
import path from 'path';
import type { FileGenerationOptions } from './batch-processor.server';

const DATA_DIR = path.join(process.cwd(), 'data');
const JOBS_DIR = path.join(DATA_DIR, 'jobs');

export interface ExportJob {
  id: string;
  shop: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  startDate: string;
  endDate?: string;
  fileOptions: FileGenerationOptions;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: any;
}

/**
 * Ensure jobs directory exists
 */
async function ensureJobsDir() {
  await fs.mkdir(JOBS_DIR, { recursive: true });
}

/**
 * Create a new export job
 */
export async function createExportJob(
  shop: string,
  startDate: string,
  endDate: string | undefined,
  fileOptions: FileGenerationOptions
): Promise<string> {
  await ensureJobsDir();

  const jobId = `export_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const job: ExportJob = {
    id: jobId,
    shop,
    status: 'pending',
    startDate,
    endDate,
    fileOptions,
    createdAt: new Date().toISOString(),
  };

  const jobPath = path.join(JOBS_DIR, `${jobId}.json`);
  await fs.writeFile(jobPath, JSON.stringify(job, null, 2));

  return jobId;
}

/**
 * Get job status
 */
export async function getJobStatus(jobId: string): Promise<ExportJob | null> {
  try {
    const jobPath = path.join(JOBS_DIR, `${jobId}.json`);
    const content = await fs.readFile(jobPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

/**
 * Update job status
 */
export async function updateJobStatus(
  jobId: string,
  updates: Partial<ExportJob>
): Promise<void> {
  const job = await getJobStatus(jobId);
  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  const updatedJob = { ...job, ...updates };
  const jobPath = path.join(JOBS_DIR, `${jobId}.json`);
  await fs.writeFile(jobPath, JSON.stringify(updatedJob, null, 2));
}

/**
 * Get all jobs for a shop
 */
export async function getShopJobs(shop: string): Promise<ExportJob[]> {
  try {
    await ensureJobsDir();
    const files = await fs.readdir(JOBS_DIR);
    const jobs: ExportJob[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const content = await fs.readFile(path.join(JOBS_DIR, file), 'utf-8');
        const job = JSON.parse(content);
        if (job.shop === shop) {
          jobs.push(job);
        }
      }
    }

    // Sort by created date, newest first
    return jobs.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  } catch (error) {
    return [];
  }
}

/**
 * Clean up old completed jobs (older than 7 days)
 */
export async function cleanupOldJobs(): Promise<void> {
  try {
    await ensureJobsDir();
    const files = await fs.readdir(JOBS_DIR);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(JOBS_DIR, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const job = JSON.parse(content);

        if (
          (job.status === 'completed' || job.status === 'failed') &&
          new Date(job.createdAt).getTime() < sevenDaysAgo
        ) {
          await fs.unlink(filePath);
        }
      }
    }
  } catch (error) {
    console.error('Error cleaning up old jobs:', error);
  }
}
