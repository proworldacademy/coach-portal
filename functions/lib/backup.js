/* The nightly copy of the database (Antonio, Oct 24: "a scheduled export to a bucket is cheap insurance").
   Every night at 04:40 ET the whole Firestore database is exported to the bucket proworld-coach-portal-backups
   (one folder per night, kept 90 days by the bucket's own lifecycle rule). Restoring is one command:
   gcloud firestore import gs://proworld-coach-portal-backups/<folder>. The export runs with the engine's own service
   account, so nothing here needs a key. Owners can see the last runs from the backend (GET /api/admin/backup). */
'use strict';
const { v1 } = require('@google-cloud/firestore');
const { Storage } = require('@google-cloud/storage');

const PROJECT = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'proworld-coach-portal';
const BUCKET = `${PROJECT}-backups`;
const KEEP_DAYS = 90;

async function ensureBucket(storage) {
  const b = storage.bucket(BUCKET);
  const [exists] = await b.exists();
  if (!exists) {
    await storage.createBucket(BUCKET, { location: 'US', storageClass: 'STANDARD', uniformBucketLevelAccess: true });
    await b.addLifecycleRule({ action: { type: 'Delete' }, condition: { age: KEEP_DAYS } });
  }
  return b;
}

async function run(log) {
  const storage = new Storage();
  await ensureBucket(storage);
  const client = new v1.FirestoreAdminClient();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const prefix = `gs://${BUCKET}/${stamp}`;
  const [op] = await client.exportDocuments({ name: client.databasePath(PROJECT, '(default)'), outputUriPrefix: prefix, collectionIds: [] });
  if (log) log(`backup started → ${prefix} (${op.name})`);
  return { bucket: BUCKET, folder: stamp, operation: op.name };
}

/* The last exports in the bucket, newest first — what the owners see. */
async function status() {
  const storage = new Storage();
  const b = storage.bucket(BUCKET);
  const [exists] = await b.exists();
  if (!exists) return { bucket: BUCKET, exists: false, runs: [] };
  const [files] = await b.getFiles({ maxResults: 2000 });
  const byRun = {};
  for (const f of files) { const run = f.name.split('/')[0]; if (!byRun[run]) byRun[run] = { folder: run, files: 0, bytes: 0, done: false }; byRun[run].files++; byRun[run].bytes += Number(f.metadata.size || 0); if (/\.overall_export_metadata$/.test(f.name)) byRun[run].done = true; }
  const runs = Object.values(byRun).sort((a, b) => b.folder.localeCompare(a.folder)).slice(0, 14);
  return { bucket: BUCKET, exists: true, keepDays: KEEP_DAYS, runs };
}

module.exports = { run, status, BUCKET };
