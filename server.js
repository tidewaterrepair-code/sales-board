'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

// Minimal .env loader (no dependencies).
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const { openDefault } = require('./src/db');
const { createApp } = require('./src/app');

const PORT = Number(process.env.PORT) || 3000;
const db = openDefault(path.join(__dirname, 'data'), process.env.DATA_FILE);
const app = createApp({ db, dataDir: path.dirname(db.file || path.join(__dirname, 'data', 'x')) });

const server = http.createServer((req, res) => app.handle(req, res));
server.listen(PORT, () => {
  console.log(`\n  🚀 SalesBoard is running → http://localhost:${PORT}\n`);
  console.log(`  Google leads: ${process.env.GOOGLE_PLACES_API_KEY ? '✅ live' : '🧪 demo data (set GOOGLE_PLACES_API_KEY for real leads)'}`);
  console.log(`  Stripe:       ${process.env.STRIPE_SECRET_KEY ? '✅ payment links on' : '— off'}`);
  console.log(`  Webhook:      ${process.env.SETUP_WEBHOOK_URL ? '✅ ' + process.env.SETUP_WEBHOOK_URL : '— set in Manager → Settings'}`);
  console.log(`  Email drip:   ${process.env.BREVO_API_KEY ? '✅ Brevo' : process.env.RESEND_API_KEY ? '✅ Resend' : '— add BREVO_API_KEY (emails wait in the queue until then)'}\n`);
});

// Finish any client setup that a restart interrupted.
setTimeout(() => { const n = app.resumeProvisioning(); if (n) console.log(`[setup] Resumed ${n} interrupted client setup(s).`); }, 2000);

// Pay reps whose commission is ready (client payment cleared, hold passed).
setInterval(() => app.sweepPayouts().catch((err) => console.error('[payout]', err.message)), 15 * 60000);

// Callback reminders (phone notifications) every minute.
setInterval(() => app.runReminders().catch((err) => console.error('[push]', err.message)), 60000);

// Nightly backup (checks hourly, runs once a day after 3am).
const backupTick = () => Promise.resolve(app.runBackupIfDue()).then((r) => r && console.log(`[backup] ${r.file}${r.uploaded ? ` → ${r.uploaded}` : ''}${r.error ? ` (upload failed: ${r.error})` : ''}`)).catch((err) => console.error('[backup]', err.message));
setTimeout(backupTick, 10000);
setInterval(backupTick, 3600000);

// Email drip: send whatever is due every minute.
const runDrips = () => app.runDrips().catch((err) => console.error('[drip]', err.message));
setTimeout(runDrips, 5000);
setInterval(runDrips, 60000);

const shutdown = () => { db.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
