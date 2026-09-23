import type { Job } from '@music/contracts';
import { randomUUID } from 'node:crypto';

type Work = (signal: AbortSignal, progress: (value: number) => void) => Promise<unknown>;
type Entry = { job: Job; controller: AbortController; done: Promise<void> };
export class JobRegistry {
  private entries = new Map<string, Entry>();
  private stopped = false;
  constructor(private readonly maxJobs = 100) {}
  get(id: string) { return this.entries.get(id)?.job; }
  settled(id: string) { return this.entries.get(id)?.done ?? Promise.resolve(); }
  start(kind: Job['kind'], work: Work): Job {
    if (this.stopped) throw new Error('Job registry is stopped');
    if (this.entries.size >= this.maxJobs) {
      for (const [id,entry] of this.entries) {
        if (entry.job.status === 'succeeded' || entry.job.status === 'failed' || entry.job.status === 'cancelled') this.entries.delete(id);
        if (this.entries.size < this.maxJobs) break;
      }
    }
    if (this.entries.size >= this.maxJobs) throw new Error('Job capacity reached');
    const now = new Date().toISOString();
    const job: Job = { id: randomUUID(), kind, status: 'queued', createdAt: now, updatedAt: now };
    const controller = new AbortController();
    const entry: Entry = { job, controller, done: Promise.resolve() };
    this.entries.set(job.id, entry);
    entry.done = Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      job.status = 'running'; job.updatedAt = new Date().toISOString();
      try {
        const result = await work(controller.signal, value => { if (!controller.signal.aborted) job.progress = Math.max(0, Math.min(1, value)); });
        if (!controller.signal.aborted) { job.result = result; job.status = 'succeeded'; }
      } catch (error) {
        if (!controller.signal.aborted) { job.status = 'failed'; job.diagnosticId = randomUUID(); const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'job_failed'; job.error = { code, message: code, retryable: error && typeof error === 'object' && 'retryable' in error && typeof error.retryable === 'boolean' ? error.retryable : true, requestId: job.diagnosticId }; }
      } finally { job.updatedAt = new Date().toISOString(); }
    });
    return job;
  }
  cancel(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (entry.job.status === 'queued' || entry.job.status === 'running') { entry.controller.abort(); entry.job.status = 'cancelled'; entry.job.updatedAt = new Date().toISOString(); }
    return entry.job;
  }
  async stop() { this.stopped = true; for (const id of this.entries.keys()) this.cancel(id); await Promise.all([...this.entries.values()].map(entry => entry.done)); }
}
