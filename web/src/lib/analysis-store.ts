/**
 * Browser-side store for background analysis jobs.
 * Uses localStorage so jobs survive navigation and work across tabs.
 */

export type JobStatus = 'uploading' | 'queued' | 'running' | 'done' | 'failed';

export type AnalysisJob = {
  id: string;
  fileName: string;
  startedAt: number;
  status: JobStatus;
  currentAgent?: string | null;
  pgEditalId?: string | null;
  errorMsg?: string | null;
};

export const JOBS_KEY = 'lici_analysis_jobs';

function read(): AnalysisJob[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(JOBS_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function write(jobs: AnalysisJob[]) {
  localStorage.setItem(JOBS_KEY, JSON.stringify(jobs.slice(0, 30)));
  // Notify other tabs via a custom storage event
  window.dispatchEvent(new StorageEvent('storage', { key: JOBS_KEY, newValue: localStorage.getItem(JOBS_KEY) }));
}

export function getJobs(): AnalysisJob[] {
  return read();
}

export function getActiveJobs(): AnalysisJob[] {
  return read().filter(j => j.status !== 'done' && j.status !== 'failed');
}

export function addJob(job: AnalysisJob): void {
  const list = read().filter(j => j.id !== job.id);
  list.unshift(job);
  write(list);
}

export function updateJob(id: string, patch: Partial<AnalysisJob>): void {
  write(read().map(j => (j.id === id ? { ...j, ...patch } : j)));
}

export function removeJob(id: string): void {
  write(read().filter(j => j.id !== id));
}

/** Remove jobs older than 2 hours that are done/failed */
export function pruneOldJobs(): void {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  write(read().filter(j => j.startedAt > cutoff || (j.status !== 'done' && j.status !== 'failed')));
}
