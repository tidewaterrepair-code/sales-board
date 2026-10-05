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

const { DB } = require('./src/db');
const { createApp } = require('./src/app');

const PORT = Number(process.env.PORT) || 3000;
const db = new DB(process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json'));
const app = createApp({ db });

const server = http.createServer((req, res) => app.handle(req, res));
server.listen(PORT, () => {
  console.log(`\n  🚀 SalesBoard is running → http://localhost:${PORT}\n`);
  console.log(`  Google leads: ${process.env.GOOGLE_PLACES_API_KEY ? '✅ live' : '🧪 demo data (set GOOGLE_PLACES_API_KEY for real leads)'}`);
  console.log(`  Stripe:       ${process.env.STRIPE_SECRET_KEY ? '✅ payment links on' : '— off'}`);
  console.log(`  Webhook:      ${process.env.SETUP_WEBHOOK_URL ? '✅ ' + process.env.SETUP_WEBHOOK_URL : '— set in Manager → Settings'}`);
  console.log(`  Email drip:   ${process.env.BREVO_API_KEY ? '✅ Brevo' : process.env.RESEND_API_KEY ? '✅ Resend' : '— add BREVO_API_KEY (emails wait in the queue until then)'}\n`);
});

// Email drip: send whatever is due every minute.
const runDrips = () => app.runDrips().catch((err) => console.error('[drip]', err.message));
setTimeout(runDrips, 5000);
setInterval(runDrips, 60000);

const shutdown = () => { db.flush(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
