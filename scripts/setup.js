#!/usr/bin/env node
'use strict';

// Interactive setup: asks for each key (Enter = skip) and writes .env.
// Safe to re-run anytime: existing values are kept as defaults.
//   node scripts/setup.js          interactive
//   node scripts/setup.js --yes    non-interactive (just create .env)

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline/promises');

const ROOT = path.join(__dirname, '..');
const ENV = path.join(ROOT, '.env');
const auto = process.argv.includes('--yes') || !process.stdin.isTTY;

const QUESTIONS = [
  { key: 'PORT', label: 'Port to run on', def: '3000' },
  { key: 'PUBLIC_URL', label: 'Public web address of this app (used in client links)', def: (env) => `http://localhost:${env.PORT || 3000}`, help: 'Example: https://board.yourdomain.com (guide Part 4)' },
  { key: 'GOOGLE_PLACES_API_KEY', label: 'Google Places API key (real leads)', check: /^AIza[\w-]{20,}$/, secret: true, help: 'Guide Part 5. Skip it to use practice leads.' },
  { key: 'GOOGLE_MONTHLY_LIMIT', label: 'Max Google searches per month (1000 = Google\'s free amount)', def: '1000' },
  { key: 'BREVO_API_KEY', label: 'Brevo API key (email drip, free 300/day)', check: /^xkeysib-/, secret: true, help: 'Guide Part 6. Starts with xkeysib-' },
  { key: 'RESEND_API_KEY', label: 'Resend API key (alternative to Brevo)', check: /^re_/, secret: true, skipIf: (env) => env.BREVO_API_KEY },
  { key: 'STRIPE_SECRET_KEY', label: 'Stripe secret key (payment links)', check: /^(sk|rk)_(test|live)_/, secret: true, help: 'Guide Part 7. Start with sk_test_ while you practice.' },
  { key: 'STRIPE_WEBHOOK_SECRET', label: 'Stripe webhook signing secret', check: /^whsec_/, secret: true, skipIf: (env) => !env.STRIPE_SECRET_KEY },
  { key: 'GHL_API_KEY', label: 'GoHighLevel Private Integration key (builds client accounts)', check: /^pit-/, secret: true, help: 'Guide Part 8. Starts with pit-' },
  { key: 'GHL_COMPANY_ID', label: 'GoHighLevel Company ID', skipIf: (env) => !env.GHL_API_KEY, help: 'Guide Part 8. You pick your template (snapshot) inside the app later.' },
  { key: 'RETELL_API_KEY', label: 'Retell API key (AI receptionists)', check: /^key_/, secret: true, help: 'Guide Part 9.' },
  { key: 'SETUP_WEBHOOK_URL', label: 'Extra automation webhook URL (optional: Make / Zapier)', check: /^https:\/\//, help: 'Optional. Most people skip this.' },
];

function readEnv() {
  const env = {};
  if (!fs.existsSync(ENV)) return env;
  for (const line of fs.readFileSync(ENV, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

function writeEnv(env) {
  const lines = [
    '# SalesBoard settings. Re-run `npm run setup` to change these.',
    '# Full walkthrough: docs/SETUP-GUIDE.md',
    '',
    ...Object.entries(env).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${v}`),
    '',
  ];
  fs.writeFileSync(ENV, lines.join('\n'), { mode: 0o600 });
}

const mask = (v) => (v.length > 10 ? `${v.slice(0, 6)}…${v.slice(-4)}` : '•••');

async function main() {
  const env = readEnv();
  if (!env.WEBHOOK_SECRET) env.WEBHOOK_SECRET = crypto.randomBytes(24).toString('hex');

  if (auto) {
    for (const q of QUESTIONS) if (!env[q.key] && q.def) env[q.key] = typeof q.def === 'function' ? q.def(env) : q.def;
    writeEnv(env);
    console.log('✅ .env is ready (practice mode). Run `npm run setup` later to add your keys.');
    return;
  }

  console.log('\n🏆  SalesBoard setup');
  console.log('    Press Enter to skip anything. Everything works in practice mode without keys.');
  console.log('    Step-by-step free-tier guide: docs/SETUP-GUIDE.md\n');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  for (const q of QUESTIONS) {
    if (q.skipIf && q.skipIf(env)) continue;
    const current = env[q.key] || (typeof q.def === 'function' ? q.def(env) : q.def) || '';
    if (q.help) console.log(`   ℹ️  ${q.help}`);
    const shown = current ? ` [${q.secret ? mask(current) : current}]` : ' [skip]';
    for (;;) {
      const ans = (await rl.question(` ▶ ${q.label}${shown}: `)).trim();
      if (!ans) { env[q.key] = current; break; }
      if (ans === '-') { delete env[q.key]; break; } // "-" clears a value
      if (q.check && !q.check.test(ans)) {
        const keep = (await rl.question('   ⚠️  That doesn\'t look like the usual format. Use it anyway? (y/N): ')).trim().toLowerCase();
        if (keep !== 'y') continue;
      }
      env[q.key] = ans;
      break;
    }
    console.log('');
  }
  rl.close();
  writeEnv(env);

  const on = (k) => (env[k] ? '✅' : '—');
  console.log('✅ Saved to .env\n');
  console.log(`   ${on('GOOGLE_PLACES_API_KEY')} Real Google leads${env.GOOGLE_PLACES_API_KEY ? '' : ' (practice leads until you add a key)'}`);
  console.log(`   ${env.BREVO_API_KEY || env.RESEND_API_KEY ? '✅' : '—'} Email drip${env.BREVO_API_KEY || env.RESEND_API_KEY ? ' (also set your sender email + address in Manager → Email Drip)' : ' (emails wait in the queue until you add a key)'}`);
  console.log(`   ${on('STRIPE_SECRET_KEY')} Stripe payment links`);
  console.log(`   ${env.GHL_API_KEY && env.GHL_COMPANY_ID ? '✅' : '—'} GoHighLevel client accounts`);
  console.log(`   ${on('RETELL_API_KEY')} AI receptionists`);
  console.log(`   ${on('SETUP_WEBHOOK_URL')} Extra automation webhook`);
  console.log('   ✅ Webhook signing secret (auto-generated)\n');
  console.log('   Restart SalesBoard so it picks up the changes:');
  console.log('     server:   sudo systemctl restart salesboard');
  console.log('     computer: stop it (Ctrl+C) and run  npm start\n');
}

main().catch((err) => { console.error(err); process.exit(1); });
