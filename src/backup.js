'use strict';

// Nightly backups: a dated copy in data/backups (last 14 kept) and, if
// BACKUP_BUCKET is set, an off-server copy in Google Cloud Storage.
// On a Google Cloud VM no key is needed: the VM's own identity is used.

const fs = require('node:fs');
const path = require('node:path');

const KEEP = 14;

async function gceToken(fetchImpl) {
  const res = await fetchImpl('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`Couldn't get Google Cloud credentials (HTTP ${res.status}). Is this running on a Google Cloud VM with Storage access?`);
  return (await res.json()).access_token;
}

async function uploadToBucket({ bucket, file, fetchImpl }) {
  const token = await gceToken(fetchImpl);
  const name = `salesboard/${path.basename(file)}`;
  const res = await fetchImpl(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
    body: fs.readFileSync(file),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(`Upload failed: ${j.error?.message || `HTTP ${res.status}`}${res.status === 403 ? ' (give the VM "Storage: Read Write" access)' : ''}`);
  }
  return `gs://${bucket}/${name}`;
}

async function runBackup({ db, dir, bucket, fetchImpl = fetch, now = Date.now() }) {
  const stamp = new Date(now).toISOString().slice(0, 10);
  const ext = db.kind === 'sqlite' ? 'db' : 'json';
  fs.mkdirSync(dir, { recursive: true });
  const file = db.backupTo(path.join(dir, `salesboard-${stamp}.${ext}`));
  const old = fs.readdirSync(dir).filter((f) => /^salesboard-\d{4}-\d{2}-\d{2}\./.test(f)).sort();
  while (old.length > KEEP) fs.unlinkSync(path.join(dir, old.shift()));
  const status = { at: now, file: path.basename(file), uploaded: '', error: '' };
  if (bucket) {
    try { status.uploaded = await uploadToBucket({ bucket, file, fetchImpl }); } catch (err) { status.error = err.message; }
  }
  db.data.system.backup = status;
  db.save();
  return status;
}

// Run once a day, after 3am server time.
function due(db, now = Date.now()) {
  const last = db.data.system.backup?.at;
  const d = new Date(now);
  return d.getHours() >= 3 && (!last || new Date(last).toDateString() !== d.toDateString());
}

module.exports = { runBackup, due, uploadToBucket };
