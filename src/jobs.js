const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const ytdlp = require('./ytdlp');

const jobs = new Map();
fs.mkdirSync(config.tmpRoot, { recursive: true });

const ACTIVE = new Set(['queued', 'downloading', 'processing']);

function activeCount() {
  let n = 0;
  for (const j of jobs.values()) if (ACTIVE.has(j.status)) n++;
  return n;
}

function removeJob(id) {
  const j = jobs.get(id);
  if (!j) return;
  if (j.cancel) j.cancel();
  fs.rm(j.dir, { recursive: true, force: true }, () => {});
  jobs.delete(id);
}

function createJob({ url, quality }) {
  if (activeCount() >= config.maxConcurrentJobs) {
    const err = new Error('Server is busy, please try again in a moment');
    err.status = 503;
    throw err;
  }
  const id = crypto.randomUUID();
  const dir = fs.mkdtempSync(path.join(config.tmpRoot, 'job-'));
  const job = { id, dir, status: 'queued', progress: 0, error: null, file: null, filename: null, cancel: null };
  jobs.set(id, job);

  const { promise, cancel } = ytdlp.startDownload({
    url, quality, dir,
    onProgress: (p) => { job.progress = Math.max(job.progress, p); },
    onStage: (s) => { if (ACTIVE.has(job.status)) job.status = s; },
  });
  job.cancel = cancel;
  promise
    .then((file) => {
      job.file = file;
      job.filename = path.basename(file);
      job.progress = 1;
      job.status = 'done';
    })
    .catch((e) => {
      job.error = e.message;
      job.status = 'error';
    })
    .finally(() => {
      job.cancel = null;
      setTimeout(() => removeJob(id), config.jobTtlMs).unref();
    });
  return job;
}

const getJob = (id) => jobs.get(id);

function cleanupAll() {
  for (const id of [...jobs.keys()]) removeJob(id);
}

module.exports = { createJob, getJob, removeJob, cleanupAll };
