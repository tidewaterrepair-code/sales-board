/* SalesBoard front-end. Plain JS, no build step. */
(function () {
  'use strict';

  // ---------------------------------------------------------------- state
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* storage blocked */ } },
  };

  const S = {
    token: store.get('sb_token', ''),
    user: null,
    stats: null,
    settings: null,
    catalog: null,
    boot: null,
    login: { userId: null, pin: '' },
    search: { industry: store.get('sb_industry', 'hvac'), city: store.get('sb_city', ''), results: null, next: null, loading: false, demo: false },
    mine: { tab: 'todo', leads: null },
    call: { leadId: null, lead: null, step: 0, selected: [], showAll: false, obj: null, roi: {} },
    board: { period: 'week' },
    admin: { tab: 'launch', data: null, open: null },
    feed: { since: 0, items: [] },
  };

  const app = document.getElementById('app');
  const modalRoot = document.getElementById('modal-root');

  // ---------------------------------------------------------------- utils
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => {
    const v = Number(n) || 0;
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  };
  const pct = (n) => `${Math.round((Number(n) || 0) * 1000) / 10}%`;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const ago = (ts) => {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };
  const when = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const today = new Date();
    const tmr = new Date(); tmr.setDate(today.getDate() + 1);
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === today.toDateString()) return `Today ${time}`;
    if (d.toDateString() === tmr.toDateString()) return `Tomorrow ${time}`;
    return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`;
  };
  const telHref = (p) => `tel:${String(p || '').replace(/[^\d+]/g, '')}`;
  const smsHref = (p, body) => `sms:${String(p || '').replace(/[^\d+]/g, '')}${/iPhone|iPad|Mac/.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(body)}`;
  const wfById = (id) => S.catalog?.workflows.find((w) => w.id === id);
  const industry = (key) => S.catalog?.industries.find((i) => i.key === key) || { key, label: 'Local Business', trade: 'local', customer: 'customers', avgTicket: 250, emoji: '🏪' };
  const cityOf = (lead) => (lead.city || '').split(',')[0].trim() || 'your area';
  const isManager = () => S.user?.role === 'manager';

  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && S.token && !path.startsWith('/api/login')) {
      logout(false);
      throw new Error('Your session ended. Please log in again.');
    }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function toast(msg, kind = '', ms = 3200) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, ms);
    setTimeout(() => el.remove(), ms + 350);
  }
  const fail = (err) => toast(`😬 ${esc(err.message || err)}`, 'bad', 4500);

  function modal(html, { onClose, focus = true } = {}) {
    modalRoot.innerHTML = `<div class="modal-bg" data-act="modal-bg"><div class="modal" role="dialog" aria-modal="true"><button class="x" data-act="close-modal" aria-label="Close">×</button>${html}</div></div>`;
    S.onModalClose = onClose || null;
    const first = focus && modalRoot.querySelector('input:not([type=checkbox]):not([readonly]), textarea, select');
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 50);
  }
  function closeModal() {
    modalRoot.innerHTML = '';
    const cb = S.onModalClose; S.onModalClose = null;
    if (cb) cb();
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('📋 Copied!', 'good', 1500); } catch {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
      document.execCommand('copy'); t.remove(); toast('📋 Copied!', 'good', 1500);
    }
  }

  // Fill a script template with this lead's details. Values are highlighted
  // so reps can see what was personalised.
  function fill(tpl, ctx, mark = true) {
    return esc(tpl).replace(/\{\{(\w+)\}\}/g, (m, k) => {
      const v = ctx[k];
      if (v == null || v === '') return m;
      return mark ? `<mark>${esc(v)}</mark>` : esc(v);
    });
  }
  function ctxFor(lead, workflows) {
    const ind = industry(lead?.industry);
    const setup = workflows.reduce((s, w) => s + w.setupFee, 0);
    const monthly = workflows.reduce((s, w) => s + w.monthlyFee, 0);
    return {
      rep: S.user?.name,
      business: lead?.name || '[Business]',
      city: lead ? cityOf(lead) : '[City]',
      trade: ind.trade,
      customer: ind.customer,
      rating: lead?.rating ?? 'no',
      reviews: lead?.reviews ?? 0,
      setup: money(setup),
      monthly: money(monthly),
      marketSetup: money(workflows.reduce((s, w) => s + (w.market?.setup || w.setupFee), 0)),
      marketMonthly: money(workflows.reduce((s, w) => s + (w.market?.monthly || w.monthlyFee), 0)),
    };
  }
  const COMMISSION_NOTE = () => `${pct(S.catalog.commissionRate)} of the setup fee, paid once. No commission on monthly fees.`;
  function savingsOf(workflows) {
    const setup = workflows.reduce((s, w) => s + ((w.market?.setup || w.setupFee) - w.setupFee), 0);
    const monthly = workflows.reduce((s, w) => s + ((w.market?.monthly || w.monthlyFee) - w.monthlyFee), 0);
    return { setup, monthly, firstYear: setup + monthly * 12 };
  }
  const commissionOf = (setup) => Math.round(setup * (S.catalog?.commissionRate ?? 0.1) * 100) / 100;
  function pointsOf(workflows) {
    const p = S.catalog.points;
    const setup = workflows.reduce((s, w) => s + w.setupFee, 0);
    return Math.round(setup / p.perSetupDollars) + Math.max(0, workflows.length - 1) * p.bundleBonus;
  }
  function roiValue(w, lead, values = {}) {
    if (!w.roi) return null;
    let v = w.roi.multiplier;
    for (const inp of w.roi.inputs) {
      let x = values[inp.key];
      if (x == null) x = inp.fromIndustry && lead ? industry(lead.industry).avgTicket : inp.default;
      x = Number(x) || 0;
      v *= inp.pct ? x / 100 : x;
    }
    return w.roi.unit ? `${Math.round(v).toLocaleString()} ${w.roi.unit}` : money(Math.round(v));
  }
  const aiTag = (w) => w.ai === 'ai' ? '<span class="tag ai">🤖 AI-powered</span>' : w.ai === 'optional' ? '<span class="tag noai">⚙️ No AI needed · AI add-on</span>' : '<span class="tag noai">⚙️ No AI</span>';

  // ---------------------------------------------------------------- routing
  const NAV = [
    ['home', '🏠', 'Home'],
    ['leads', '🔎', 'Find Leads'],
    ['mine', '📞', 'My Leads'],
    ['playbook', '📘', 'Playbook'],
    ['board', '🏆', 'Leaderboard'],
    ['money', '💰', 'My Money'],
  ];
  const route = () => (location.hash.replace(/^#\/?/, '') || 'home').split('/');
  addEventListener('hashchange', () => render());
  const go = (r) => { if (location.hash === `#/${r}`) render(); else location.hash = `#/${r}`; };

  async function render() {
    if (!S.token) return renderLogin();
    if (!S.user || !S.catalog) {
      try {
        const [me, cat] = await Promise.all([api('GET', '/api/me'), api('GET', '/api/catalog')]);
        Object.assign(S, { user: me.user, stats: me.stats, settings: me.settings, catalog: cat });
        if (!S.search.city) S.search.city = S.settings.defaultCity || '';
        startFeed();
      } catch (err) { return S.token ? fail(err) : renderLogin(); }
    }
    const [name, arg] = route();
    if (!document.getElementById('view')) renderShell();
    updateChrome(name);
    const view = document.getElementById('view');
    const views = { home: viewHome, leads: viewLeads, mine: viewMine, call: viewCall, playbook: viewPlaybook, board: viewBoard, money: viewMoney, admin: viewAdmin };
    const fn = views[name] || viewHome;
    if (name === 'admin' && !isManager()) return go('home');
    window.scrollTo(0, 0);
    try { await fn(view, arg); } catch (err) { fail(err); }
  }

  function renderShell() {
    const nav = [...NAV, ...(isManager() ? [['admin', '🛠️', 'Manager']] : [])];
    app.innerHTML = `
      <div class="shell">
        <aside class="side">
          <div class="logo">🏆 <span class="ellipsis">${esc(S.settings.companyName)}</span></div>
          ${nav.map(([r, ic, label]) => `<a class="nav-btn" data-nav="${r}" href="#/${r}"><span class="ic">${ic}</span>${label}</a>`).join('')}
          <div class="spacer"></div>
          <button class="nav-btn" data-act="profile"><span class="ic">${esc(S.user.avatar)}</span>${esc(S.user.name)}</button>
        </aside>
        <div class="main">
          <div class="topbar">
            <div class="grow"><div class="ticker"><div class="ticker-inner" id="ticker"></div></div></div>
            <span class="pill hide-sm" id="pill-streak" title="Daily streak"></span>
            <span class="pill gold" id="pill-points" title="Your points"></span>
            ${isManager() ? '<a class="btn sm ghost" href="#/admin" title="Manager">🛠️</a>' : ''}
            <button class="avatar" style="--c:${esc(S.user.color)}" data-act="profile" title="${esc(S.user.name)}">${esc(S.user.avatar)}</button>
          </div>
          <div id="view"></div>
        </div>
        <nav class="bottom-nav">
          ${nav.filter(([r]) => r !== 'admin').map(([r, ic, label]) => `<a class="nav-btn" data-nav="${r}" href="#/${r}"><span class="ic">${ic}</span>${label.replace('Find ', '').replace('My ', '')}</a>`).join('')}
        </nav>
      </div>`;
    renderTicker();
  }

  function updateChrome(name) {
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === name || (name === 'call' && a.dataset.nav === 'mine')));
    const st = S.stats;
    if (!st) return;
    const ps = document.getElementById('pill-streak');
    const pp = document.getElementById('pill-points');
    if (ps) ps.innerHTML = `🔥 ${st.streak}-day streak`;
    if (pp) pp.innerHTML = `${st.level.emoji} ${st.points.toLocaleString()} pts`;
  }

  async function refreshMe() {
    const before = S.stats;
    const me = await api('GET', '/api/me');
    S.stats = me.stats; S.settings = me.settings;
    celebrateChanges(before, S.stats);
    updateChrome(route()[0]);
  }

  function celebrateChanges(before, after) {
    if (!before || !after) return;
    if (after.level.name !== before.level.name) {
      setTimeout(() => { toast(`${after.level.emoji} <b>LEVEL UP!</b> You're now a <b>${esc(after.level.name)}</b>!`, 'gold', 6000); FX.burst(220); }, 900);
    }
    const had = new Set(before.badges.filter((b) => b.earned).map((b) => b.id));
    after.badges.filter((b) => b.earned && !had.has(b.id)).forEach((b, i) => {
      setTimeout(() => toast(`${b.emoji} <b>New badge:</b> ${esc(b.name)}!`, 'gold', 6000), 1500 + i * 700);
    });
  }

  // ---------------------------------------------------------------- feed / ticker
  let feedTimer = null;
  function startFeed() {
    clearInterval(feedTimer);
    pollFeed(true);
    feedTimer = setInterval(() => pollFeed(false), 15000);
  }
  async function pollFeed(first) {
    if (!S.token) return;
    try {
      const { items, serverTime } = await api('GET', `/api/feed?since=${first ? 0 : S.feed.since}`);
      S.feed.since = serverTime;
      if (first) S.feed.items = items;
      else if (items.length) {
        S.feed.items = [...items, ...S.feed.items].slice(0, 25);
        items.filter((i) => i.type === 'deal' && i.userId !== S.user.id).forEach((i) => {
          toast(`🔥 <b>${esc(i.avatar)} ${esc(i.name)}</b> just ${esc(i.label)}! <b>+${i.points} pts</b>`, 'gold', 6000);
          FX.sound('team');
        });
      }
      renderTicker();
    } catch { /* offline, try later */ }
  }
  function renderTicker() {
    const el = document.getElementById('ticker');
    if (!el) return;
    const items = S.feed.items.slice(0, 12);
    el.innerHTML = items.length
      ? items.map((i) => `<span>${i.type === 'deal' ? '💰' : '🙂'} <b>${esc(i.avatar)} ${esc(i.name)}</b> ${esc(i.label)} ${i.type === 'deal' ? `<b style="color:var(--gold)">+${i.points}</b>` : ''} <span class="muted">${ago(i.at)}</span></span>`).join('')
      : '<span>🚀 First close of the day gets bragging rights. Go get it!</span><span>📞 Every dial = points. Every close = 💰.</span>';
  }

  // ---------------------------------------------------------------- login
  async function renderLogin() {
    clearInterval(feedTimer);
    try { S.boot = await api('GET', '/api/bootstrap'); } catch (err) { app.innerHTML = `<div class="login"><h1>😬</h1><p>${esc(err.message)}</p></div>`; return; }
    document.title = S.boot.companyName;
    if (S.boot.needsSetup) {
      app.innerHTML = `
        <div class="login">
          <div style="font-size:4rem">🏆</div>
          <h1>Welcome! Let's set up your sales board.</h1>
          <p class="muted">You'll be the manager. You can add your sales team right after.</p>
          <form class="card stack" style="text-align:left;max-width:420px;margin:1.5rem auto" data-form="first-setup">
            <div class="field"><label>Company name</label><input class="input" name="companyName" placeholder="Tidewater Automation" required></div>
            <div class="field"><label>Your name</label><input class="input" name="name" placeholder="Alex" required></div>
            <div class="field"><label>Pick a PIN (4–8 digits)</label><input class="input" name="pin" inputmode="numeric" pattern="\\d{4,8}" type="password" required></div>
            <button class="btn go lg block">🚀 Create my board</button>
          </form>
        </div>`;
      return;
    }
    const sel = S.boot.team.find((u) => u.id === S.login.userId);
    if (!sel) {
      app.innerHTML = `
        <div class="login">
          <div style="font-size:3.5rem">🏆</div>
          <h1>${esc(S.boot.companyName)}</h1>
          <p class="muted" style="font-size:1.15rem">Tap your name to start selling 👇</p>
          <div class="team-grid">
            ${S.boot.team.map((u) => `<button class="team-tile" data-act="pick-user" data-id="${esc(u.id)}"><span class="avatar lg" style="--c:${esc(u.color)}">${esc(u.avatar)}</span>${esc(u.name)}</button>`).join('')}
          </div>
        </div>`;
      return;
    }
    const n = S.login.pin.length;
    app.innerHTML = `
      <div class="login">
        <span class="avatar xl" style="--c:${esc(sel.color)}">${esc(sel.avatar)}</span>
        <h1 style="margin-top:.75rem">Hey ${esc(sel.name)}! 👋</h1>
        <p class="muted">Enter your PIN</p>
        <div class="pin-dots" id="pin-dots">${Array.from({ length: Math.max(4, n) }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div>
        <div class="pinpad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => `<button data-act="pin" data-k="${k}">${k}</button>`).join('')}
          <button data-act="pin" data-k="back" aria-label="Delete">⌫</button>
          <button data-act="pin" data-k="0">0</button>
          <button data-act="pin" data-k="go" style="background:var(--green);color:#032015" aria-label="Log in">✓</button>
        </div>
        <button class="btn ghost" data-act="pick-user" data-id="">← Not ${esc(sel.name)}?</button>
      </div>`;
  }

  async function submitPin() {
    if (S.login.pin.length < 4) return;
    try {
      const { token, user } = await api('POST', '/api/login', { userId: S.login.userId, pin: S.login.pin });
      S.token = token; store.set('sb_token', token); S.user = user; S.login = { userId: null, pin: '' };
      app.innerHTML = '';
      location.hash = '#/home';
      render();
    } catch (err) {
      S.login.pin = '';
      renderLogin().then(() => document.getElementById('pin-dots')?.classList.add('shake'));
      fail(err);
    }
  }

  function logout(callApi = true) {
    if (callApi && S.token) api('POST', '/api/logout').catch(() => {});
    S.token = ''; store.del('sb_token');
    Object.assign(S, { user: null, stats: null, catalog: null, settings: null });
    S.login = { userId: null, pin: '' };
    clearInterval(feedTimer);
    closeModal();
    app.innerHTML = '';
    renderLogin();
  }

  // ---------------------------------------------------------------- HOME
  async function viewHome(view) {
    await refreshMe();
    const st = S.stats;
    const { leads } = await api('GET', '/api/leads/mine');
    S.mine.leads = leads;
    const callbacks = leads.filter((l) => l.status === 'callback').sort((a, b) => (a.callbackAt || 0) - (b.callbackAt || 0));
    const queue = leads.filter((l) => ['new', 'called', 'callback', 'interested'].includes(l.status)).length;
    const callP = st.today.callGoal ? Math.min(100, (st.today.calls / st.today.callGoal) * 100) : 100;
    const closeP = st.today.closeGoal ? Math.min(100, (st.today.closes / st.today.closeGoal) * 100) : 100;
    const lvl = st.level;
    const hour = new Date().getHours();
    const hi = hour < 12 ? 'Good morning' : hour < 17 ? 'Let\'s get it' : 'Evening grind';
    view.innerHTML = `
      <div class="stack">
        <div class="hero">
          <h1>${hi}, ${esc(S.user.name)}! ${lvl.emoji}</h1>
          <p style="font-size:1.1rem;opacity:.95">${st.weekRank ? `You're <b>#${st.weekRank} of ${st.teamSize}</b> this week with <b>${st.weekPoints.toLocaleString()} pts</b>.` : 'Make your first call to get on the board!'}
          ${st.weekRank === 1 ? ' 👑 Defend that crown!' : st.weekRank ? ' Time to climb. 🧗' : ''}</p>
          <div class="row" style="margin-top:1rem">
            <button class="btn go lg" data-act="start-calling">📞 Start Calling${queue ? ` (${queue} in queue)` : ''}</button>
            <a class="btn lg" href="#/leads">🔎 Find New Leads</a>
          </div>
        </div>

        <div class="grid four">
          <div class="card center"><div class="label">Calls today</div><div class="ring" style="--p:${callP};margin:.6rem auto"><div>${st.today.calls}<small>of ${st.today.callGoal}</small></div></div></div>
          <div class="card center"><div class="label">Closes today</div><div class="ring" style="--p:${closeP};--c:var(--gold);margin:.6rem auto"><div>${st.today.closes}<small>of ${st.today.closeGoal}</small></div></div></div>
          <div class="card"><div class="label">💰 Commission</div><div class="stat green">${money(st.commission.earned + st.commission.pending)}</div>
            <div class="small muted">${money(st.commission.earned)} earned · ${money(st.commission.pending)} waiting on client payment</div>
            <a class="small" href="#/money">See my money →</a></div>
          <div class="card"><div class="label">⭐ Points today</div><div class="stat gold">+${st.today.points}</div>
            <div class="small muted">🔥 ${plural(st.streak, 'day')} streak. Don't break it!</div></div>
        </div>

        <div class="card">
          <div class="row between"><div><span class="label">Level</span><h2>${lvl.emoji} ${esc(lvl.name)}</h2></div>
          <div class="muted small">${lvl.next ? `${(lvl.next.min - st.points).toLocaleString()} pts to ${lvl.next.emoji} ${esc(lvl.next.name)}` : 'Max level. You\'re a legend 👑'}</div></div>
          <div class="bar gold" style="margin-top:.5rem"><i style="width:${Math.round(lvl.progress * 100)}%"></i></div>
        </div>

        <div class="contest"><span class="big">🏆</span><div><b>${esc(S.settings.contestTitle)}</b><div>${esc(S.settings.contestPrize)}</div></div><a class="btn sm" style="margin-left:auto" href="#/board">Standings</a></div>

        <div class="grid two">
          <div class="card">
            <h3>⏰ Callbacks</h3>
            ${callbacks.length ? callbacks.slice(0, 6).map((l) => `<div class="lead-row" data-act="open-lead" data-id="${esc(l.id)}" style="margin-top:.5rem"><div class="body"><div class="ellipsis"><b>${esc(l.name)}</b></div><div class="small ${l.callbackAt && l.callbackAt < Date.now() ? '' : 'muted'}" ${l.callbackAt && l.callbackAt < Date.now() ? 'style="color:var(--orange)"' : ''}>${l.callbackAt ? (l.callbackAt < Date.now() ? '⚠️ Due now · ' : '') + when(l.callbackAt) : 'Anytime'}</div></div><span class="btn sm go">Call</span></div>`).join('') : '<p class="muted">No callbacks scheduled. Nice and clean.</p>'}
          </div>
          <div class="card">
            <h3>🎖️ Badges</h3>
            <div class="badges">${st.badges.map((b) => `<div class="badge ${b.earned ? '' : 'locked'}" title="${esc(b.desc)}"><span class="em">${b.emoji}</span>${esc(b.name)}</div>`).join('')}</div>
          </div>
        </div>

        <div class="card">
          <h3>🕹️ How to win</h3>
          <div class="grid three small">
            <div><b>1. Find</b> 🔎<br><span class="muted">Search Google for local businesses. Hot leads 🔥 are on top.</span></div>
            <div><b>2. Call</b> 📞<br><span class="muted">Tap Call and read the script on screen. It's written for you.</span></div>
            <div><b>3. Press YES</b> 🎉<br><span class="muted">When they agree, hit the gold button. We handle setup, billing and onboarding.</span></div>
          </div>
          <p class="small" style="margin-top:.8rem">Points: 📞 any call <b>+1</b> · ⏰ callback <b>+2</b> · 📧 got their email <b>+${S.catalog.points.email}</b> · 🙂 interested <b>+5</b> · 🎉 close <b>+1 per $10</b> of setup · 📦 bundle <b>+${S.catalog.points.bundleBonus}</b>/extra workflow · ⚡ close within 24h <b>+${S.catalog.points.speedBonus}</b><br>
          💰 You earn <b>${COMMISSION_NOTE()}</b></p>
        </div>
      </div>`;
  }

  function pickNextLead(leads) {
    const now = Date.now();
    const open = leads.filter((l) => ['new', 'called', 'callback', 'interested'].includes(l.status) && l.id !== S.call.leadId);
    const due = open.filter((l) => l.status === 'callback' && (!l.callbackAt || l.callbackAt <= now)).sort((a, b) => a.callbackAt - b.callbackAt);
    const fresh = open.filter((l) => l.status === 'new').sort((a, b) => (b.analysis?.score || 0) - (a.analysis?.score || 0));
    const interested = open.filter((l) => l.status === 'interested');
    const retry = open.filter((l) => l.status === 'called' && now - (l.lastActivityAt || 0) > 2 * 3600000);
    return due[0] || fresh[0] || interested[0] || retry[0] || null;
  }

  async function startCalling() {
    const { leads } = await api('GET', '/api/leads/mine');
    const next = pickNextLead(leads);
    if (next) return go(`call/${next.id}`);
    toast('📭 Your queue is empty. Grab some fresh leads!', 'gold');
    go('leads');
  }

  // ---------------------------------------------------------------- FIND LEADS
  async function viewLeads(view) {
    const inds = S.catalog.industries;
    view.innerHTML = `
      <div class="stack">
        <div class="row between"><h1>🔎 Find Leads</h1><button class="btn sm" data-act="manual-lead">➕ Add a lead by hand</button></div>
        ${S.catalog.demoMode ? '<div class="card" style="border-color:var(--warm)">🧪 <b>Practice mode.</b> These are made-up businesses so you can learn the system. Real Google leads turn on when your manager adds the Google key.</div>' : ''}
        <div class="card stack">
          <div><div class="label">Step 1 · What kind of business?</div>
            <div class="chips" style="margin-top:.5rem">${inds.map((i) => `<button class="chip ${S.search.industry === i.key ? 'on' : ''}" data-act="pick-industry" data-key="${i.key}">${i.emoji} ${esc(i.label)}</button>`).join('')}</div>
          </div>
          <form class="row" data-form="search" style="align-items:flex-end">
            <div class="field" style="flex:1;min-width:220px"><label class="label">Step 2 · Which city?</label><input class="input" name="city" value="${esc(S.search.city)}" placeholder="e.g. Norfolk, VA" required></div>
            <button class="btn primary lg" ${S.search.loading ? 'disabled' : ''}>${S.search.loading ? '⏳ Searching…' : '🔍 Find Leads'}</button>
          </form>
        </div>
        <div id="results">${renderResults()}</div>
      </div>`;
  }

  function renderResults() {
    const r = S.search.results;
    if (!r) return '<div class="empty"><div class="big">🗺️</div><p>Pick a business type and a city, then hit <b>Find Leads</b>.<br>We\'ll pull them from Google and rank the hottest ones first.</p></div>';
    if (!r.length) return '<div class="empty"><div class="big">🤷</div><p>No businesses found. Try a bigger city or a different type.</p></div>';
    return `<p class="muted small">${plural(r.length, 'business')} found. 🔥 Hottest first, so start at the top.</p>
      <div class="grid two">${r.map((l, i) => leadCard(l, i)).join('')}</div>
      ${S.search.next ? `<div class="center" style="margin-top:1rem"><button class="btn lg" data-act="more-leads" ${S.search.loading ? 'disabled' : ''}>⬇️ Load more</button></div>` : ''}`;
  }

  function leadCard(l, i) {
    const a = l.analysis;
    const recs = a.recommended.map(wfById).filter(Boolean);
    let action;
    if (l.claim?.mine) action = `<button class="btn go block" data-act="open-lead" data-id="${esc(l.claim.leadId)}">📞 Open (your lead)</button>`;
    else if (l.claim) action = `<button class="btn block" disabled>🔒 ${esc(l.claim.by)}'s lead</button>`;
    else if (!l.phone) action = '<button class="btn block" disabled>📵 No phone number</button>';
    else action = `<button class="btn go block" data-act="claim" data-i="${i}">📞 Claim &amp; Call</button>`;
    return `<div class="card ${a.temperature === 'hot' ? 'glow' : ''}">
      <div class="lead-card">
        <div class="score ${a.temperature}"><div>${a.score}<small>${a.temperature.toUpperCase()}</small></div></div>
        <div class="body">
          <div class="name">${esc(l.name)}</div>
          <div class="small muted ellipsis">${esc(l.category)} · ${esc(l.address)}</div>
          <div class="small">${l.rating != null ? `⭐ ${l.rating}` : '⭐ —'} · ${plural(l.reviews, 'review')}${l.phone ? ` · 📞 ${esc(l.phone)}` : ''}</div>
          <div class="chips" style="margin:.5rem 0;gap:.3rem">${a.signals.map((s) => `<span class="tag ${s.tone}">${s.icon} ${esc(s.label)}</span>`).join('')}</div>
          <div class="small"><b>Pitch:</b> ${recs.map((w) => `${w.emoji} ${esc(w.name)}`).join(' · ')}</div>
        </div>
      </div>
      <div class="row" style="margin-top:.8rem">
        <div style="flex:1">${action}</div>
        ${l.mapsUrl ? `<a class="btn" href="${esc(l.mapsUrl)}" target="_blank" rel="noopener" title="Open in Google Maps">🗺️</a>` : ''}
        ${l.website ? `<a class="btn" href="${esc(l.website)}" target="_blank" rel="noopener" title="Website">🌐</a>` : ''}
      </div>
    </div>`;
  }

  async function doSearch(more) {
    if (!S.search.city.trim()) return toast('Type a city first 🙂', 'bad');
    S.search.loading = true;
    if (!more) { S.search.results = null; S.search.next = null; }
    if (route()[0] === 'leads') viewLeads(document.getElementById('view'));
    try {
      const q = new URLSearchParams({ industry: S.search.industry, city: S.search.city });
      if (more && S.search.next) q.set('pageToken', S.search.next);
      const r = await api('GET', `/api/leads/search?${q}`);
      const seen = new Set((S.search.results || []).map((l) => l.placeId));
      S.search.results = more ? [...(S.search.results || []), ...r.leads.filter((l) => !seen.has(l.placeId))] : r.leads;
      S.search.next = r.nextPageToken;
    } catch (err) { fail(err); } finally {
      S.search.loading = false;
      if (route()[0] === 'leads') viewLeads(document.getElementById('view'));
    }
  }

  async function claimLead(raw) {
    try {
      const { lead } = await api('POST', '/api/leads/claim', { lead: raw });
      toast(`✅ <b>${esc(lead.name)}</b> is yours. Let's call!`, 'good');
      go(`call/${lead.id}`);
    } catch (err) { fail(err); }
  }

  function manualLeadModal() {
    const inds = S.catalog.industries;
    modal(`<h2>➕ Add a lead</h2><p class="muted">Got a referral or walked past a shop? Add it here.</p>
      <form class="stack" data-form="manual-lead">
        <div class="field"><label>Business name *</label><input class="input" name="name" required></div>
        <div class="field"><label>Phone *</label><input class="input" name="phone" type="tel" required></div>
        <div class="field"><label>Type of business</label><select class="input" name="industry">${inds.map((i) => `<option value="${i.key}" ${i.key === S.search.industry ? 'selected' : ''}>${i.emoji} ${esc(i.label)}</option>`).join('')}</select></div>
        <div class="field"><label>City</label><input class="input" name="city" value="${esc(S.search.city)}"></div>
        <div class="field"><label>Website (leave blank if none)</label><input class="input" name="website" type="url"></div>
        <div class="row"><div class="field" style="flex:1"><label>Google rating</label><input class="input" name="rating" type="number" step="0.1" min="0" max="5"></div>
        <div class="field" style="flex:1"><label># of reviews</label><input class="input" name="reviews" type="number" min="0"></div></div>
        <button class="btn go lg block">Add &amp; Call 📞</button>
      </form>`);
  }

  // ---------------------------------------------------------------- MY LEADS
  const MINE_TABS = [
    ['todo', '📞 To Call', (l) => ['new', 'called'].includes(l.status)],
    ['callback', '⏰ Callbacks', (l) => l.status === 'callback'],
    ['interested', '🙂 Interested', (l) => l.status === 'interested'],
    ['won', '🎉 Won', (l) => l.status === 'won'],
    ['lost', '👎 Lost', (l) => l.status === 'lost'],
  ];
  const STATUS_LABEL = { new: '🆕 New', called: '😶 No answer', callback: '⏰ Callback', interested: '🙂 Interested', won: '🎉 Customer', lost: '👎 Not interested' };

  async function viewMine(view) {
    const { leads } = await api('GET', '/api/leads/mine');
    S.mine.leads = leads;
    const tab = MINE_TABS.find((t) => t[0] === S.mine.tab) || MINE_TABS[0];
    const list = leads.filter(tab[2]);
    if (tab[0] === 'callback') list.sort((a, b) => (a.callbackAt || 0) - (b.callbackAt || 0));
    view.innerHTML = `
      <div class="row between"><h1>📞 My Leads</h1><button class="btn go" data-act="start-calling">▶ Call next lead</button></div>
      <div class="tabs">${MINE_TABS.map(([k, label, f]) => `<button class="tab ${k === tab[0] ? 'on' : ''}" data-act="mine-tab" data-k="${k}">${label}<span class="count">${leads.filter(f).length}</span></button>`).join('')}</div>
      <div class="stack">
        ${list.length ? list.map((l) => `
          <div class="lead-row" data-act="open-lead" data-id="${esc(l.id)}">
            <div class="score ${l.analysis?.temperature || 'cold'}" style="width:46px;height:46px;font-size:1.05rem">${l.analysis?.score ?? '–'}</div>
            <div class="body">
              <div class="ellipsis"><b>${esc(l.name)}</b></div>
              <div class="small muted ellipsis">${STATUS_LABEL[l.status] || esc(l.status)}${l.status === 'callback' && l.callbackAt ? ` · ${when(l.callbackAt)}` : ''} · ${esc(l.phone)} · ${ago(l.lastActivityAt || l.claimedAt)}</div>
            </div>
            <span class="btn sm ${l.status === 'won' ? '' : 'go'}">${l.status === 'won' ? 'View' : 'Call'}</span>
          </div>`).join('') : `<div class="empty"><div class="big">📭</div><p>Nothing here yet.</p><a class="btn primary" href="#/leads">🔎 Find leads</a></div>`}
      </div>
      <p class="tiny muted" style="margin-top:1rem">Leads you don't touch for ${S.settings.claimDays} days go back to the team pool.</p>`;
  }

  // ---------------------------------------------------------------- CALL MODE
  const STEPS = ['👋 Open', '🎣 Hook', '❓ Ask', '💡 Pitch', '🤝 Close'];

  async function viewCall(view, leadId) {
    const { lead, deals, drip } = await api('GET', `/api/leads/${encodeURIComponent(leadId)}`);
    if (S.call.leadId !== lead.id) {
      const rec = (lead.analysis?.recommended || []).filter((id) => wfById(id));
      S.call = { leadId: lead.id, lead, step: 0, selected: rec.slice(0, 1), showAll: false, obj: null, roi: {} };
    }
    S.call.lead = lead;
    S.call.deals = deals;
    S.call.drip = drip;
    drawCall(view);
  }

  function drawCall(view = document.getElementById('view')) {
    const { lead, step, selected } = S.call;
    const a = lead.analysis || { score: 0, temperature: 'cold', signals: [], recommended: [] };
    const wfs = selected.map(wfById).filter(Boolean);
    const won = lead.status === 'won';
    const activeDeal = (S.call.deals || []).find((d) => d.status !== 'cancelled');
    view.innerHTML = `
      <div class="call-layout">
        <div class="stack">
          <div class="card">
            <div class="lead-card">
              <div class="score ${a.temperature}"><div>${a.score}<small>${a.temperature.toUpperCase()}</small></div></div>
              <div class="body">
                <h2 style="margin:0">${esc(lead.name)}</h2>
                <div class="small muted">${esc(industry(lead.industry).emoji)} ${esc(lead.category)} · ${esc(lead.address || lead.city)}</div>
                <div class="small">${lead.rating != null ? `⭐ ${lead.rating}` : '⭐ —'} · ${plural(lead.reviews, 'review')} · ${lead.website ? `<a href="${esc(lead.website)}" target="_blank" rel="noopener">website</a>` : '<b style="color:var(--hot)">no website</b>'}${lead.mapsUrl ? ` · <a href="${esc(lead.mapsUrl)}" target="_blank" rel="noopener">Google</a>` : ''}</div>
                <div class="chips" style="margin-top:.4rem;gap:.3rem"><span class="tag">${STATUS_LABEL[lead.status] || esc(lead.status)}</span>${a.signals.map((s) => `<span class="tag ${s.tone}">${s.icon} ${esc(s.label)}</span>`).join('')}</div>
              </div>
            </div>
            ${lead.phone ? `<a class="btn go xl" style="margin-top:.9rem" href="${telHref(lead.phone)}">📞 Tap to call ${esc(lead.phone)}</a>` : '<p class="muted">No phone number on file.</p>'}
          </div>

          ${won ? wonPanel(activeDeal) : `
          <div class="card">
            <div class="steps">${STEPS.map((s, i) => `<button class="step ${i === step ? 'on' : i < step ? 'done' : ''}" data-act="step" data-i="${i}">${s}</button>`).join('')}</div>
            <div class="prompter">${prompterHtml(lead, wfs, step)}</div>
            <div class="row between" style="margin-top:.8rem">
              <button class="btn" data-act="step" data-i="${Math.max(0, step - 1)}" ${step === 0 ? 'disabled' : ''}>◀ Back</button>
              ${step < STEPS.length - 1 ? `<button class="btn primary lg" data-act="step" data-i="${step + 1}">Next ▶</button>` : '<button class="btn yes lg" data-act="yes">🎉 THEY SAID YES!</button>'}
            </div>
          </div>`}

          <div class="card">
            <h3>📝 Notes</h3>
            <form class="row" data-form="note"><input class="input" name="note" placeholder="e.g. Owner is Mike, call after 3pm" style="flex:1"><button class="btn">Save</button></form>
            <div class="stack small" style="margin-top:.7rem;max-height:220px;overflow:auto">
              ${(lead.history || []).slice().reverse().map((h) => `<div><span class="muted">${when(h.at)} · ${esc(h.by)}</span><br>${esc(h.text)}</div>`).join('') || '<span class="muted">No history yet.</span>'}
            </div>
            ${!won ? `<button class="btn sm ghost" style="margin-top:.6rem" data-act="release">↩️ Give this lead back to the pool</button>` : ''}
          </div>
        </div>

        <div class="stack">
          ${emailHtml(lead)}
          ${won ? '' : pickerHtml(lead, wfs)}
          ${won ? '' : earnHtml(wfs)}
          ${won || !wfs[0] ? '' : roiHtml(lead, wfs[0])}
          ${won ? '' : objectionsHtml(lead, wfs)}
        </div>
      </div>
      ${won ? '' : `
      <div class="outcomes">
        <button class="btn" data-act="outcome" data-o="no_answer">😶 No answer<small>+1 pt</small></button>
        <button class="btn" data-act="outcome" data-o="not_interested">👎 Not interested<small>+1 pt</small></button>
        <button class="btn" data-act="outcome" data-o="callback">⏰ Call back<small>+2 pts</small></button>
        <button class="btn primary" data-act="outcome" data-o="interested">🙂 Interested<small>+5 pts</small></button>
        <button class="btn yes" data-act="yes">🎉 THEY SAID YES!<small>1-button setup</small></button>
      </div>`}`;
  }

  function prompterHtml(lead, wfs, step) {
    const ctx = ctxFor(lead, wfs);
    const w = wfs[0];
    const say = '<span class="say">🗣️ Say this</span>';
    if (!w && step >= 2) return `${say}Pick at least one workflow on the right →`;
    if (step === 0) return `${say}${fill(S.catalog.opener, ctx)}<div class="coach">😊 Smile while you talk. They can hear it. Wait for a "yeah, what's up?"</div>`;
    if (step === 1) return `${say}${fill(lead.analysis?.hook || '', ctx)} That's actually why I'm calling.<div class="coach">⏸️ Pause here and let them respond. If they say they're busy → tap <b>"I'm busy right now"</b> under Objections.</div>`;
    if (step === 2) return `${say}<ul>${w.discovery.map((q) => `<li>${fill(q, ctx)}</li>`).join('')}</ul><div class="coach">👂 Ask one question, then <b>stop talking and listen</b>. Jot their answers in Notes. Plug their numbers into the calculator →</div>`;
    if (step === 3) {
      const extra = wfs.slice(1).map((x) => `<li><b>${x.emoji} ${esc(x.name)}:</b> ${fill(x.tagline, ctx)}</li>`).join('');
      const roi = roiValue(w, lead, S.call.roi);
      return `${say}${fill(w.pitch, ctx)}${extra ? `<p style="margin-top:.8rem">And on top of that, I'd add:</p><ul>${extra}</ul>` : ''}
        <div class="coach">💡 Drop the number: <i>"For a business like yours that's about <b>${esc(roi)}</b>: ${esc(w.roi.label.toLowerCase())}."</i></div>`;
    }
    const names = wfs.map((x) => x.name).join(' + ');
    const closeLine = wfs.length > 1
      ? `So here's what I'd recommend for {{business}}: ${names}. It's {{setup}} one time to set it all up and {{monthly}} a month. I can get it started today. Want me to set it up for you?`
      : w.close;
    return `${say}${fill(closeLine, ctx)}
      <div class="coach">🤐 Ask, then <b>STOP talking</b>. Whoever talks first loses. If they say YES → hit the big gold button. Objection? Use the list on the right.</div>`;
  }

  function pickerHtml(lead, wfs) {
    const rec = lead.analysis?.recommended || [];
    const all = S.catalog.workflows;
    const shown = S.call.showAll ? all : all.filter((w) => rec.includes(w.id) || S.call.selected.includes(w.id));
    shown.sort((x, y) => (rec.includes(y.id) - rec.includes(x.id)) || x.rank - y.rank);
    return `<div class="card">
      <h3>🎯 What are you pitching?</h3>
      <p class="small muted">We picked the best fit ⭐. Tap to add or remove.</p>
      <div class="stack">${shown.map((w) => `
        <div class="wf-pick ${S.call.selected.includes(w.id) ? 'on' : ''}" data-act="toggle-wf" data-id="${w.id}">
          <span class="em">${w.emoji}</span>
          <div class="body"><div class="ellipsis"><b>${esc(w.name)}</b></div>${rec.includes(w.id) ? '<span class="rec">⭐ RECOMMENDED</span>' : `<span class="tiny muted">${w.ai === 'ai' ? '🤖 AI' : '⚙️ No AI needed'}</span>`}</div>
          <div class="price">${w.market ? `<s class="tiny muted">${money(w.market.setup)}</s> ` : ''}${money(w.setupFee)}<div class="tiny muted">+${money(w.monthlyFee)}/mo</div></div>
        </div>`).join('')}</div>
      <div class="row" style="margin-top:.6rem">
        <button class="btn sm ghost" data-act="show-all-wf">${S.call.showAll ? 'Show fewer' : `Show all ${all.length}`}</button>
      </div>
      <div class="label" style="margin-top:.6rem">Quick bundles</div>
      <div class="chips" style="margin-top:.35rem">${S.catalog.bundles.map((b) => `<button class="chip" data-act="bundle" data-id="${b.id}" title="${esc(b.pitch)}">${b.emoji} ${esc(b.name)}</button>`).join('')}</div>
    </div>`;
  }

  function emailHtml(lead) {
    const d = S.call.drip;
    const status = d ? {
      active: `📬 In the email drip: ${d.step} of ${d.total} sent${d.nextAt ? ` · next ${when(d.nextAt)}` : ''}`,
      completed: `✅ Drip finished. ${esc(d.endedReason)}`,
      stopped: `🛑 Drip stopped. ${esc(d.endedReason)}`,
      unsubscribed: '🚫 They unsubscribed. No more emails.',
      failed: `⚠️ Emails failing: ${esc(d.endedReason)}`,
    }[d.status] : '';
    return `<div class="card">
      <h3>📧 Got their email?</h3>
      ${lead.email ? `<p class="small"><b>${esc(lead.contactName || '')}</b> ${esc(lead.email)}</p><p class="small">${status || '📭 Not in a drip'}</p>
        ${d && d.status === 'active' ? '<button class="btn sm ghost" data-act="drip-stop">🛑 Stop emails</button>' : ''}` : `
      <p class="small muted">Type it in and they get our follow-up emails automatically. <b style="color:var(--gold)">+${S.catalog.points.email} pts</b></p>
      <form class="stack" data-form="lead-email">
        <input class="input" name="name" placeholder="Their first name" value="${esc(lead.contactName || '')}">
        <input class="input" name="email" type="email" placeholder="name@business.com" required>
        <button class="btn primary block">📨 Add to email drip</button>
      </form>`}
    </div>`;
  }

  function earnHtml(wfs) {
    const setup = wfs.reduce((s, w) => s + w.setupFee, 0);
    const monthly = wfs.reduce((s, w) => s + w.monthlyFee, 0);
    return `<div class="earn">
      <div class="row between"><div><div class="label">Their price</div><b style="font-size:1.15rem">${money(setup)}</b> setup + <b>${money(monthly)}</b>/mo</div></div>
      ${wfs.length && savingsOf(wfs).firstYear > 0 ? `<div class="small" style="margin-top:.3rem">🏷️ Typical agencies: <s>${money(setup + savingsOf(wfs).setup)} + ${money(monthly + savingsOf(wfs).monthly)}/mo</s>. They save <b style="color:var(--gold)">${money(savingsOf(wfs).firstYear)}</b> in year one.</div>` : ''}
      <div class="row between" style="margin-top:.5rem"><div><div class="label">You earn</div><div class="big">${money(commissionOf(setup))}</div></div>
      <div class="center"><div class="label">Points</div><div class="big" style="color:var(--gold)">+${wfs.length ? pointsOf(wfs) : 0}</div></div></div>
      <div class="tiny muted" style="margin-top:.3rem">You earn ${COMMISSION_NOTE()}</div>
      ${wfs.length === 1 ? `<div class="tiny muted" style="margin-top:.2rem">💡 Add a 2nd workflow for +${S.catalog.points.bundleBonus} bonus pts</div>` : ''}
    </div>`;
  }

  function roiHtml(lead, w) {
    if (!w.roi) return '';
    return `<div class="card">
      <h3>🧮 Their ROI: ${w.emoji} ${esc(w.name)}</h3>
      <div class="stack">${w.roi.inputs.map((inp) => {
        const v = S.call.roi[inp.key] ?? (inp.fromIndustry ? industry(lead.industry).avgTicket : inp.default);
        return `<div class="row between"><label class="small" style="flex:1">${esc(inp.label)}</label><input class="input" style="width:110px" type="number" min="0" step="any" value="${esc(v)}" data-roi="${inp.key}"></div>`;
      }).join('')}</div>
      <div class="earn" style="margin-top:.7rem"><div class="label">${esc(w.roi.label)}</div><div class="big" id="roi-out">${esc(roiValue(w, lead, S.call.roi))}</div></div>
    </div>`;
  }

  function objectionsHtml(lead, wfs) {
    const ctx = ctxFor(lead, wfs);
    const list = [...wfs.flatMap((w) => w.objections), ...S.catalog.objections];
    return `<div class="card">
      <h3>🛡️ They said…</h3>
      <p class="small muted">Tap what they said to see exactly what to say back.</p>
      <div class="stack">${list.map((o, i) => `
        <div><button class="objection" data-act="obj" data-i="${i}">"${esc(o.q)}"</button>
        ${S.call.obj === i ? `<div class="answer">🗣️ ${fill(o.a, ctx)}</div>` : ''}</div>`).join('')}</div>
    </div>`;
  }

  function wonPanel(deal) {
    if (!deal) return '<div class="card win"><h2>🎉 Customer!</h2></div>';
    return `<div class="card win">
      <h2>🎉 ${esc(S.call.lead.name)} is a customer!</h2>
      <p>${deal.workflows.map((w) => `${w.emoji} ${esc(w.name)}`).join(' · ')}</p>
      <p><b>${money(deal.setupTotal)}</b> setup + <b>${money(deal.monthlyTotal)}</b>/mo · Your commission <b style="color:var(--green)">${money(deal.commission)}</b> <span class="status ${deal.commissionStatus}">${commissionLabel(deal.commissionStatus)}</span></p>
      ${deal.provisioning ? `<div class="label" style="margin-top:.6rem">Setup</div><div class="stack" style="margin-top:.4rem">${stepsHtml(deal)}</div>` : ''}
      <a class="btn" style="margin-top:.8rem" href="#/money">💰 See in My Money</a>
    </div>`;
  }

  async function logOutcome(outcome, extra = {}) {
    const { lead } = S.call;
    try {
      const before = S.stats;
      const r = await api('POST', `/api/leads/${lead.id}/outcome`, { outcome, ...extra });
      S.call.lead = r.lead; S.stats = r.stats;
      celebrateChanges(before, r.stats);
      updateChrome('call');
      if (r.pointsEarned) { FX.sound('point'); toast(`⭐ <b>+${r.pointsEarned} pts</b>`, 'gold', 1800); } else toast('Logged ✅ (points for this lead already counted today)', '', 2500);
      if (outcome === 'interested') {
        S.call.step = Math.max(S.call.step, 3);
        drawCall();
        toast('🙂 Nice! Keep going: pitch and close. 👇', 'good');
        return;
      }
      const msg = { no_answer: '😶 No answer. On to the next one!', not_interested: '👎 Their loss. Next!', callback: `⏰ Callback set for ${when(r.lead.callbackAt) || 'later'}.` }[outcome];
      nextLeadModal(msg);
    } catch (err) { fail(err); }
  }

  async function nextLeadModal(msg) {
    const { leads } = await api('GET', '/api/leads/mine');
    const next = pickNextLead(leads);
    modal(`<div class="center stack">
      <div style="font-size:3rem">✅</div>
      <h2>${esc(msg)}</h2>
      ${next ? `<p class="muted">Next up: <b>${esc(next.name)}</b></p><button class="btn go xl" data-act="go-lead" data-id="${esc(next.id)}">▶ Next Lead</button>` : '<p class="muted">Your queue is empty.</p><button class="btn primary xl" data-act="go-leads">🔎 Find more leads</button>'}
      <button class="btn ghost" data-act="close-modal">Stay on this lead</button>
    </div>`, { onClose: () => { if (route()[0] === 'call') render(); } });
  }

  function callbackModal() {
    const at = (h, m = 0, dayOffset = 0) => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0); return d.getTime(); };
    const opts = [
      ['In 1 hour', Date.now() + 3600000],
      ['In 3 hours', Date.now() + 3 * 3600000],
      ['Tomorrow 9am', at(9, 0, 1)],
      ['Tomorrow 2pm', at(14, 0, 1)],
    ];
    modal(`<h2>⏰ When should you call back?</h2>
      <div class="grid two" style="margin:1rem 0">${opts.map(([label, ts]) => `<button class="btn lg" data-act="cb-quick" data-ts="${ts}">${label}</button>`).join('')}</div>
      <form class="stack" data-form="callback">
        <div class="field"><label>Or pick a time</label><input class="input" type="datetime-local" name="at"></div>
        <div class="field"><label>Note (optional)</label><input class="input" name="note" placeholder="e.g. Talk to the owner, Lisa"></div>
        <button class="btn primary block">Save callback</button>
      </form>`);
  }

  function notInterestedModal() {
    const reasons = ['Too expensive', 'Already has a solution', 'Not the decision maker', 'Hung up', 'Bad timing', 'Other'];
    modal(`<h2>👎 What happened?</h2><p class="muted">One tap. Helps the team learn.</p>
      <div class="grid two" style="margin-top:1rem">${reasons.map((r) => `<button class="btn lg" data-act="ni-reason" data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div>`);
  }

  // ⭐ ONE-BUTTON SETUP ⭐
  // Step 1: the rep ticks what the client agreed to. Step 2: one button builds it all.
  function yesDraftFromForm() {
    const form = modalRoot.querySelector('form[data-form="yes"]');
    if (!form) return;
    const fd = new FormData(form);
    S.call.selected = fd.getAll('wf');
    S.call.yesDraft = {
      name: fd.get('name'), email: fd.get('email'), phone: fd.get('phone'),
      ai: fd.getAll('ai'), areaCode: fd.get('areaCode') ?? S.call.yesDraft?.areaCode,
      createLogin: fd.get('createLogin') === 'on', paymentLink: fd.get('paymentLink') === 'on',
    };
  }

  function yesModal() {
    const { lead } = S.call;
    if (!S.call.selected.length) S.call.selected = (lead.analysis?.recommended || []).slice(0, 1);
    if (!S.call.yesDraft) S.call.yesDraft = { createLogin: true, paymentLink: true, ai: [] };
    const draw = () => {
      const d = S.call.yesDraft;
      const addon = S.catalog.aiAddon?.monthly || 0;
      const wfs = S.call.selected.map(wfById).filter(Boolean);
      const aiOn = (w) => w.ai === 'optional' && (d.ai || []).includes(w.id);
      const setup = wfs.reduce((s, w) => s + w.setupFee, 0);
      const monthly = wfs.reduce((s, w) => s + w.monthlyFee + (aiOn(w) ? addon : 0), 0);
      const wantsAI = S.call.selected.includes('ai_receptionist');
      const area = d.areaCode ?? String(lead.phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '').slice(0, 3);
      const c = S.catalog.connected || {};
      modal(`<h1>🎉 They said YES!</h1><p class="muted">Tick what they agreed to, then press one button. We build everything for them.</p>
        <form class="stack" data-form="yes">
          <div><div class="label">1 · What did they say yes to?</div>
            <div class="stack" style="margin-top:.4rem">${S.catalog.workflows.map((w) => {
              const on = S.call.selected.includes(w.id);
              return `<div class="check ${on ? 'on' : ''}" style="flex-direction:column;gap:.4rem">
                <label class="row" style="gap:.6rem;flex-wrap:nowrap;cursor:pointer;width:100%"><input type="checkbox" name="wf" value="${w.id}" ${on ? 'checked' : ''} data-act="yes-wf">
                <span style="flex:1">${w.emoji} <b>${esc(w.name)}</b></span><span class="small">${money(w.setupFee)} + ${money(w.monthlyFee)}/mo</span></label>
                ${on && w.ai === 'optional' && addon ? `<label class="row small" style="gap:.5rem;margin-left:2rem;cursor:pointer"><input type="checkbox" name="ai" value="${w.id}" ${aiOn(w) ? 'checked' : ''} data-act="yes-wf" style="width:18px;height:18px">🤖 Add the AI upgrade (+${money(addon)}/mo)</label>` : ''}
              </div>`;
            }).join('')}</div>
          </div>
          <div><div class="label">2 · Who's the owner?</div>
            <div class="stack" style="margin-top:.4rem">
              <input class="input" name="name" placeholder="Owner's name" value="${esc(d.name ?? lead.contactName ?? '')}">
              <input class="input" name="email" type="email" placeholder="Their email (for their login + setup link)" value="${esc(d.email ?? lead.email ?? '')}">
              <input class="input" name="phone" type="tel" placeholder="Their cell" value="${esc(d.phone ?? lead.phone ?? '')}">
            </div>
          </div>
          <div><div class="label">3 · Options</div>
            <div class="stack" style="margin-top:.4rem">
              ${wantsAI ? `<div class="row"><label class="small" style="flex:1">📞 Area code for their new AI phone number</label><input class="input" name="areaCode" inputmode="numeric" maxlength="3" style="width:90px" value="${esc(area)}"></div>` : ''}
              <label class="check ${d.createLogin ? 'on' : ''}"><input type="checkbox" name="createLogin" ${d.createLogin ? 'checked' : ''} data-act="yes-wf"><span>🔑 Give the owner their own login to see their leads and messages</span></label>
              <label class="check ${d.paymentLink ? 'on' : ''}"><input type="checkbox" name="paymentLink" ${d.paymentLink ? 'checked' : ''} data-act="yes-wf"><span>💳 Send them a payment link</span></label>
            </div>
          </div>
          <div><div class="label">4 · Check the total</div>
            <div class="earn" style="margin-top:.4rem"><b style="font-size:1.2rem">${money(setup)}</b> setup + <b>${money(monthly)}</b>/mo<br>
            <span class="small">You earn <b style="color:var(--green)">${money(commissionOf(setup))}</b> (one time) + <b style="color:var(--gold)">${wfs.length ? pointsOf(wfs) : 0} pts</b>${wfs.length > 1 ? ' (bundle bonus included)' : ''}</span></div>
          </div>
          <button class="btn go xl" ${wfs.length ? '' : 'disabled'} id="setup-btn">🚀 SET IT ALL UP</button>
          <p class="tiny muted center">${c.ghl ? 'Builds their account, switches on their workflows' : '🧪 Practice mode: shows every step. Real setup turns on when your manager connects the tools'}${c.retell && wantsAI ? ', builds their AI receptionist' : ''}, and sends their payment + setup links.</p>
        </form>`, { focus: false });
    };
    S.redrawYes = draw;
    draw();
  }

  async function submitYes(form) {
    yesDraftFromForm();
    const d = S.call.yesDraft;
    if (!S.call.selected.length) return toast('Tick at least one workflow ☝️', 'bad');
    const btn = form.querySelector('#setup-btn');
    btn.disabled = true; btn.textContent = '⏳ Starting setup…';
    const before = S.stats;
    try {
      const r = await api('POST', '/api/deals', {
        leadId: S.call.lead.id,
        workflowIds: S.call.selected,
        contact: { name: d.name, email: d.email, phone: d.phone },
        options: { aiAddons: d.ai, areaCode: d.areaCode, createLogin: d.createLogin, paymentLink: d.paymentLink },
      });
      S.stats = r.stats;
      S.call.yesDraft = null;
      FX.burst(); FX.sound('cash');
      setTimeout(() => FX.burst(120), 600);
      celebrateChanges(before, r.stats);
      updateChrome('call');
      S.success = { dealId: r.deal.id, onboardingUrl: r.onboardingUrl };
      successModal(r.deal, r.onboardingUrl);
      watchSetup(r.deal.id);
      pollFeed(false);
    } catch (err) {
      btn.disabled = false; btn.textContent = '🚀 SET IT ALL UP';
      fail(err);
    }
  }

  const STEP_ICON = { pending: '⚪', working: '⏳', done: '✅', practice: '🧪', skipped: '➖', failed: '⚠️' };
  function stepsHtml(deal) {
    const steps = deal.provisioning?.steps || [];
    return steps.map((st) => `<div class="setup-step ${st.status}"><span class="ic">${STEP_ICON[st.status] || '⚪'}</span><div><b>${esc(st.label)}</b>${st.detail ? `<div class="tiny muted">${esc(st.detail)}</div>` : ''}</div></div>`).join('')
      || (deal.provisioning?.status === 'running' ? '<div class="setup-step working"><span class="ic">⏳</span><div><b>Starting…</b></div></div>' : '');
  }

  async function watchSetup(dealId) {
    for (let i = 0; i < 120; i++) {
      await new Promise((res) => setTimeout(res, 1000));
      if (!S.success || S.success.dealId !== dealId) return;
      try {
        const { deal, running } = await api('GET', `/api/deals/${dealId}`);
        const box = document.getElementById('setup-steps');
        if (!box) return;
        box.innerHTML = stepsHtml(deal);
        if (!running && deal.provisioning?.finishedAt) { renderAfterSetup(deal, S.success.onboardingUrl); return; }
      } catch { /* keep trying */ }
    }
  }

  function successModal(deal, onboardingUrl) {
    modal(`<div class="center">
        <div class="success-big">🎉💰🎉</div>
        <div class="points-pop">+${deal.points} pts</div>
        <h2>BOOM! ${esc(deal.business.name)} is in!</h2>
        <p style="font-size:1.1rem">You earned <b style="color:var(--green)">${money(deal.commission)}</b> commission<br><span class="small muted">(paid once, as soon as they pay the setup fee)</span></p>
        ${deal.speedBonus ? '<p><span class="tag good">⚡ Speed bonus +20</span></p>' : ''}
      </div>
      <div class="card" style="margin:1rem 0">
        <div class="label">🛠️ Setting everything up for them…</div>
        <div id="setup-steps" class="stack" style="margin-top:.6rem">${stepsHtml(deal)}</div>
      </div>
      <div id="after-setup"><p class="center muted small">Keep them on the phone for a few seconds while this finishes ⏳</p></div>`,
    { focus: false, onClose: () => { S.success = null; S.call.leadId = null; if (route()[0] === 'call') render(); } });
  }

  function renderAfterSetup(deal, onboardingUrl) {
    const box = document.getElementById('after-setup');
    if (!box) return;
    const first = (deal.contact.name || 'there').split(' ')[0];
    const pay = deal.paymentUrl ? ` To lock in your spot, pay securely here: ${deal.paymentUrl}` : '';
    const aiNum = deal.retell?.phoneNumber;
    const msg = `Hi ${first}! It's ${S.user.name}. ${deal.business.name} is all set up on our side! Your 3-minute setup form: ${onboardingUrl}${pay}`;
    const subject = `Your setup for ${deal.business.name}`;
    const problems = (deal.provisioning?.steps || []).some((s) => s.status === 'failed');
    box.innerHTML = `
      ${problems ? '<div class="card" style="border-color:var(--warm);margin-bottom:1rem">⚠️ One step hit a snag. <b>Don\'t worry</b>: your manager got it on their screen and can press Retry. Your deal and commission are safe.</div>' : ''}
      <div class="card">
        <div class="label">🗣️ Now say this before you hang up</div>
        <p style="font-size:1.05rem;margin-top:.4rem">"Awesome, ${esc(first)}! You're all set up on our side.${aiNum ? ` Your new AI receptionist number is <b>${esc(aiNum)}</b>.` : ''} I'm texting you a link right now. It takes about 3 minutes${deal.paymentUrl ? ' to fill in a few details and take care of the setup fee' : ' to fill in a few details'}. Welcome aboard!"</p>
      </div>
      <div class="label" style="margin-top:1rem">Send them the setup link</div>
      <div class="grid two" style="margin:.5rem 0">
        <a class="btn go lg" href="${esc(smsHref(deal.contact.phone, msg))}">💬 Text it</a>
        <a class="btn primary lg" href="mailto:${esc(deal.contact.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(msg)}">📧 Email it</a>
      </div>
      <div class="copybox"><input class="input" readonly value="${esc(onboardingUrl)}"><button class="btn" data-act="copy" data-text="${esc(onboardingUrl)}">📋 Copy</button></div>
      ${deal.paymentUrl ? `<div class="copybox" style="margin-top:.5rem"><input class="input" readonly value="${esc(deal.paymentUrl)}"><button class="btn" data-act="copy" data-text="${esc(deal.paymentUrl)}">💳 Copy pay link</button></div>` : ''}
      <p class="small muted center" style="margin-top:.8rem">✅ That's it for you. Anything left (like connecting their phone line) is on your team's checklist.</p>
      <button class="btn xl" style="margin-top:.5rem" data-act="next-after-win">▶ On to the next one!</button>`;
  }

  // ---------------------------------------------------------------- PLAYBOOK
  function viewPlaybook(view) {
    const ws = S.catalog.workflows;
    view.innerHTML = `
      <div class="stack">
        <div class="row between"><h1>📘 The Playbook</h1><button class="btn sm no-print" onclick="window.print()">🖨️ Print cheat sheet</button></div>
        <div class="card">
          <h3>💰 How you get paid</h3>
          <p>You earn <b style="color:var(--green)">${pct(S.catalog.commissionRate)} of the setup fee</b> on every deal you close, paid once. It unlocks the moment the client pays the setup fee. Monthly fees don't pay commission.
          Sell a ${money(ws[0].setupFee)} ${esc(ws[0].name)} → you make <b>${money(commissionOf(ws[0].setupFee))}</b>. Sell the ${esc(S.catalog.bundles[0].name)} bundle → you make <b>${money(commissionOf(S.catalog.bundles[0].workflows.map(wfById).filter(Boolean).reduce((s, w) => s + w.setupFee, 0)))}</b>.</p>
          <p class="small muted">You never set anything up yourself. Press the gold YES button and the system sends the client their payment link and setup form, and kicks off the automation.</p>
        </div>

        <h2>🔥 Top 10 Fastest-Selling Workflows</h2>
        <div class="grid two">${ws.map((w) => {
          const ctx = ctxFor(null, [w]);
          return `<div class="card wf-card">
            <div class="head"><span class="em">${w.emoji}</span><div style="flex:1">
              <div class="rank">#${w.rank} · ${esc(w.closeSpeed)}</div>
              <h3 style="margin:.1rem 0">${esc(w.name)}</h3>
              <div class="chips" style="gap:.3rem">${aiTag(w)}<span class="tag good">You earn ${money(commissionOf(w.setupFee))}</span></div>
            </div><div class="center"><b>${money(w.setupFee)}</b><div class="tiny muted">+${money(w.monthlyFee)}/mo</div>${w.market ? `<div class="tiny muted">others: <s>${money(w.market.setup)} + ${money(w.market.monthly)}/mo</s></div>` : ''}</div></div>
            <p class="small" style="margin-top:.6rem">${esc(w.tagline)}</p>
            <div class="demand"><span>Demand</span><div class="bar"><i style="width:${w.demand}%"></i></div><span>${w.demand}</span></div>
            <details>
              <summary>📜 Full script &amp; objections</summary>
              <div class="script-block"><span class="label">😣 Their pain</span>${esc(w.pain)}</div>
              <div class="script-block"><span class="label">✅ What it does</span><ul style="margin:.2rem 0;padding-left:1.1rem">${w.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>
              <div class="script-block"><span class="label">❓ Ask</span><ul style="margin:.2rem 0;padding-left:1.1rem">${w.discovery.map((q) => `<li>${fill(q, ctx, false)}</li>`).join('')}</ul></div>
              <div class="script-block"><span class="label">💡 Pitch</span>${fill(w.pitch, ctx, false)}</div>
              <div class="script-block"><span class="label">🤝 Close</span>${fill(w.close, ctx, false)}</div>
              ${w.objections.map((o) => `<div class="script-block" style="border-color:var(--orange)"><span class="label">🛡️ "${esc(o.q)}"</span>${fill(o.a, ctx, false)}</div>`).join('')}
              <p class="tiny muted">Best for: ${w.bestFor.map((k) => industry(k).label).join(', ')}</p>
            </details>
          </div>`;
        }).join('')}</div>

        <h2>📦 Bundles (bonus points!)</h2>
        <div class="grid three">${S.catalog.bundles.map((b) => {
          const items = b.workflows.map(wfById).filter(Boolean);
          const setup = items.reduce((s, w) => s + w.setupFee, 0);
          return `<div class="card"><h3>${b.emoji} ${esc(b.name)}</h3><p class="small">${esc(b.pitch)}</p>
            <p class="small">${items.map((w) => `${w.emoji} ${esc(w.name)}`).join('<br>')}</p>
            <p><b>${money(setup)}</b> setup · <b>${money(items.reduce((s, w) => s + w.monthlyFee, 0))}</b>/mo<br><span class="small" style="color:var(--green)">You earn ${money(commissionOf(setup))} + ${pointsOf(items)} pts</span></p></div>`;
        }).join('')}</div>

        <h2>🛡️ Objections Every Rep Must Know</h2>
        <div class="grid two">${S.catalog.objections.map((o) => `<div class="card"><b>"${esc(o.q)}"</b><p class="small" style="margin-top:.4rem">${fill(o.a, ctxFor(null, [ws[0]]), false)}</p></div>`).join('')}</div>

        <div class="card">
          <h3>🧠 The 5 golden rules</h3>
          <ol>
            <li><b>Dial, dial, dial.</b> Every call is a point. Volume wins.</li>
            <li><b>Read the screen.</b> The script is personalized to each business. Trust it.</li>
            <li><b>Ask, then shut up.</b> After you say the price, the next person to talk loses.</li>
            <li><b>Sell the problem, not the tech.</b> Owners don't care about AI. They care about missed jobs and money.</li>
            <li><b>Always press a button.</b> Every call ends with an outcome button so nothing slips.</li>
          </ol>
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------- LEADERBOARD
  async function viewBoard(view) {
    const { rows, contest } = await api('GET', `/api/leaderboard?period=${S.board.period}`);
    const top = rows.slice(0, 3);
    const medals = ['🥇', '🥈', '🥉'];
    const spot = (r, i) => r ? `<div class="spot p${i + 1}"><div class="medal">${medals[i]}</div><span class="avatar lg" style="--c:${esc(r.color)}">${esc(r.avatar)}</span><div style="font-weight:900;margin-top:.3rem">${esc(r.name)}</div><div class="pts">${r.points.toLocaleString()}</div><div class="tiny muted">pts · ${plural(r.deals, 'deal')}</div><div class="small" style="color:var(--green);font-weight:800">${money(r.commission)}</div></div>` : '<div></div>';
    view.innerHTML = `
      <div class="stack">
        <h1>🏆 Leaderboard</h1>
        <div class="contest"><span class="big">🎁</span><div><b>${esc(contest.title)}</b><div>${esc(contest.prize)}</div></div></div>
        <div class="tabs">${[['today', 'Today'], ['week', 'This Week'], ['month', 'This Month'], ['all', 'All Time']].map(([k, l]) => `<button class="tab ${S.board.period === k ? 'on' : ''}" data-act="board-period" data-k="${k}">${l}</button>`).join('')}</div>
        ${rows.length ? `<div class="podium">${spot(top[1], 1)}${spot(top[0], 0)}${spot(top[2], 2)}</div>` : ''}
        <div class="card table-wrap">
          <table class="tbl">
            <thead><tr><th>#</th><th>Rep</th><th class="num">Points</th><th class="num hide-sm">Calls</th><th class="num">Deals</th><th class="num hide-sm">Sold</th><th class="num">Commission</th><th class="hide-sm">Streak</th></tr></thead>
            <tbody>${rows.map((r) => `<tr class="${r.userId === S.user.id ? 'me' : ''}">
              <td><b>${r.rank <= 3 ? medals[r.rank - 1] : r.rank}</b></td>
              <td><div class="row" style="flex-wrap:nowrap;gap:.5rem"><span class="avatar" style="--c:${esc(r.color)};width:34px;height:34px;font-size:1.1rem">${esc(r.avatar)}</span><div><b>${esc(r.name)}</b>${r.userId === S.user.id ? ' <span class="tag">you</span>' : ''}<div class="tiny muted">${r.level.emoji} ${esc(r.level.name)}</div></div></div></td>
              <td class="num"><b style="color:var(--gold)">${r.points.toLocaleString()}</b></td>
              <td class="num hide-sm">${r.calls}</td>
              <td class="num">${r.deals}</td>
              <td class="num hide-sm">${money(r.setupRevenue)}</td>
              <td class="num" style="color:var(--green);font-weight:800">${money(r.commission)}</td>
              <td class="hide-sm">${r.streak ? `🔥 ${r.streak}` : '–'}</td>
            </tr>`).join('') || '<tr><td colspan="8" class="center muted">No one on the board yet. Be first!</td></tr>'}</tbody>
          </table>
        </div>
        <p class="small muted">Points: call +1 · callback +2 · email +${S.catalog.points.email} · interested +5 · close +1 per $10 setup · bundle +${S.catalog.points.bundleBonus}/extra workflow · speed close +${S.catalog.points.speedBonus}. Commission = ${COMMISSION_NOTE()}</p>
      </div>`;
  }

  // ---------------------------------------------------------------- MONEY
  const commissionLabel = (s) => ({ pending: '⏳ Waiting on client payment', earned: '✅ Earned, payout coming', paid_out: '💸 Paid to you', cancelled: '✖ Cancelled' }[s] || s);
  const dealStatusLabel = (s) => ({ awaiting_payment: 'Awaiting payment', paid: 'Paid, setting up', live: 'Live ✅', cancelled: 'Cancelled' }[s] || s);

  async function viewMoney(view) {
    await refreshMe();
    const { deals } = await api('GET', '/api/deals/mine');
    const c = S.stats.commission;
    view.innerHTML = `
      <div class="stack">
        <h1>💰 My Money</h1>
        <div class="grid four">
          <div class="card"><div class="label">⏳ Pending</div><div class="stat">${money(c.pending)}</div><div class="small muted">Client hasn't paid yet</div></div>
          <div class="card"><div class="label">✅ Earned</div><div class="stat green">${money(c.earned)}</div><div class="small muted">Coming in your next payout</div></div>
          <div class="card"><div class="label">💸 Paid out</div><div class="stat">${money(c.paidOut)}</div><div class="small muted">Already in your pocket</div></div>
          <div class="card"><div class="label">🏆 Lifetime</div><div class="stat gold">${money(c.lifetime)}</div><div class="small muted">${pct(S.catalog.commissionRate)} of each setup fee, paid once</div></div>
        </div>
        <div class="card">
          <h3>Your deals</h3>
          ${deals.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Business</th><th class="hide-sm">Workflows</th><th class="num">Setup</th><th class="num">You earn</th><th>Status</th><th></th></tr></thead><tbody>
          ${deals.map((d) => `<tr>
            <td><b>${esc(d.business.name)}</b><div class="tiny muted">${new Date(d.createdAt).toLocaleDateString()} · ${dealStatusLabel(d.status)}${d.onboarding ? ' · 📝 form done' : ''}</div></td>
            <td class="hide-sm">${d.workflows.map((w) => `<span title="${esc(w.name)}">${w.emoji}</span>`).join(' ')}</td>
            <td class="num">${money(d.setupTotal)}</td>
            <td class="num" style="color:var(--green);font-weight:800">${money(d.commission)}</td>
            <td><span class="status ${d.commissionStatus}">${commissionLabel(d.commissionStatus)}</span></td>
            <td>${d.status === 'awaiting_payment' ? `<button class="btn sm" data-act="copy" data-text="${esc(d.paymentUrl || d.onboardingUrl)}" title="Copy link to send the client">📋 Link</button>` : ''}</td>
          </tr>`).join('')}</tbody></table></div>` : '<div class="empty"><div class="big">🎯</div><p>No deals yet. Your first one is a call away!</p><button class="btn go" data-act="start-calling">📞 Start calling</button></div>'}
        </div>
        <p class="small muted">💡 Pending commission unlocks when the client pays. If a client hasn't paid, copy their link and send a friendly nudge.</p>
      </div>`;
  }

  // ---------------------------------------------------------------- ADMIN
  async function viewAdmin(view) {
    const d = await api('GET', '/api/admin/overview');
    S.admin.data = d;
    S.admin.drips = S.admin.tab === 'drip' ? await api('GET', '/api/admin/drips') : null;
    const t = S.admin.tab;
    view.innerHTML = `
      <div class="stack">
        <h1>🛠️ Manager</h1>
        <div class="grid four">
          <div class="card"><div class="label">Setup fees sold</div><div class="stat">${money(d.totals.setupSold)}</div></div>
          <div class="card"><div class="label">Monthly recurring</div><div class="stat green">${money(d.totals.mrr)}</div></div>
          <div class="card"><div class="label">Commission owed now</div><div class="stat gold">${money(d.totals.commissionOwed)}</div><div class="tiny muted">+ ${money(d.totals.commissionPending)} pending payment</div></div>
          <div class="card"><div class="label">Deals</div><div class="stat">${d.totals.deals}</div></div>
        </div>
        <div class="tabs">${[['launch', '🚀 Launch'], ['deals', '📑 Deals'], ['team', '👥 Team & Payouts'], ['pricing', '🏷️ Pricing & Profit'], ['drip', '📧 Email Drip'], ['settings', '⚙️ Settings']].map(([k, l]) => `<button class="tab ${t === k ? 'on' : ''}" data-act="admin-tab" data-k="${k}">${l}</button>`).join('')}</div>
        <div>${t === 'launch' ? adminLaunch(d) : t === 'deals' ? adminDeals(d) : t === 'team' ? adminTeam(d) : t === 'pricing' ? adminPricing(d) : t === 'drip' ? adminDrip(S.admin.drips) : adminSettings(d)}</div>
      </div>`;
  }

  function adminLaunch(d) {
    const i = d.integrations;
    const steps = [
      [i.httpsUrl, 'Put SalesBoard online at your own web address', 'So reps can log in from anywhere and clients can open their links. Example: https://board.yourdomain.com', 'Parts 2–4'],
      [i.reps > 0, 'Add your sales team', 'Manager → 👥 Team & Payouts → type their name + a PIN.', 'Part 11', '<button class="btn sm" data-act="admin-tab" data-k="team">Open Team</button>'],
      [i.google, 'Connect Google (real leads)', 'Paste your Google Places key with npm run setup.', 'Part 5'],
      [i.email.ready, 'Connect email (Brevo)', i.email.ready ? 'Sending.' : `Still need: ${i.email.missing.join(', ')}.`, 'Part 6', '<button class="btn sm" data-act="admin-tab" data-k="drip">Open Email Drip</button>'],
      [i.stripe && i.stripeWebhook, 'Connect Stripe (get paid)', i.stripe ? (i.stripeWebhook ? 'Done.' : 'Add the Stripe webhook secret too.') : 'Paste your Stripe keys with npm run setup.', 'Part 7'],
      [i.p_ghl, 'Connect GoHighLevel (builds client accounts)', 'Paste your Private Integration key + Company ID with npm run setup.', 'Part 8'],
      [i.p_ghlSnapshot, 'Pick your GoHighLevel template (snapshot)', i.p_ghl ? 'Click the button, pick your template, Save.' : 'Connect GoHighLevel first.', 'Part 8', i.p_ghl ? snapshotPicker(d) : ''],
      [i.p_retell, 'Connect Retell (AI receptionists)', 'Paste your Retell key with npm run setup.', 'Part 9'],
      [i.realDeals > 0, 'Do one practice close', 'Find a lead, press THEY SAID YES, then SET IT ALL UP, and watch every step turn green.', 'Part 11', '<a class="btn sm" href="#/leads">Find a lead</a>'],
    ];
    const done = steps.filter((x) => x[0]).length;
    return `<div class="stack">
      <div class="card">
        <div class="row between"><h3>🚀 Launch checklist</h3><b>${done} of ${steps.length} done</b></div>
        <div class="bar" style="margin:.5rem 0 .2rem"><i style="width:${Math.round((done / steps.length) * 100)}%"></i></div>
        <p class="small muted">Do them top to bottom. The full how-to is <code>docs/SETUP-GUIDE.md</code> (written so anyone can follow it). After changing keys, restart SalesBoard and refresh this page.</p>
      </div>
      ${steps.map(([ok, title, how, part, extra], n) => `<div class="card" style="${ok ? 'border-color:rgba(34,211,143,.5)' : ''}">
        <div class="row" style="flex-wrap:nowrap;align-items:flex-start">
          <div style="font-size:1.6rem">${ok ? '✅' : `<span class="avatar" style="width:34px;height:34px;font-size:1rem">${n + 1}</span>`}</div>
          <div style="flex:1"><b>${esc(title)}</b><div class="small muted">${esc(how)}</div>${extra && !ok ? `<div style="margin-top:.5rem">${extra}</div>` : ''}</div>
          <span class="tag">Guide: ${esc(part)}</span>
        </div>
      </div>`).join('')}
    </div>`;
  }

  function snapshotPicker(d) {
    const list = S.admin.snapshots;
    if (!list) return '<button class="btn sm primary" data-act="load-snapshots">📋 Show my GoHighLevel templates</button>';
    if (!list.length) return '<span class="small">No snapshots found. Build one first (guide Part 8).</span>';
    return `<form class="row" data-form="snapshot"><select class="input" name="ghlSnapshotId" style="flex:1">${list.map((x) => `<option value="${esc(x.id)}" ${x.id === d.settings.ghlSnapshotId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select><button class="btn go sm">Save</button></form>`;
  }

  function adminDeals(d) {
    if (!d.deals.length) return '<div class="empty"><div class="big">📑</div><p>No deals yet. Load the demo team in Settings to see how it looks.</p></div>';
    return `<div class="stack">${d.deals.map((x) => {
      const open = S.admin.open === x.id;
      return `<div class="card ${x.status === 'cancelled' ? '' : x.status === 'live' ? 'win' : ''}">
        <div class="row between" data-act="admin-open" data-id="${esc(x.id)}" style="cursor:pointer">
          <div><b>${esc(x.business.name)}</b> <span class="status ${x.status}">${dealStatusLabel(x.status)}</span>${x.onboarding ? ' <span class="tag good">📝 form done</span>' : ''}
            <div class="small muted">${new Date(x.createdAt).toLocaleString()} · by ${esc(x.repName)} · ${x.workflows.map((w) => w.emoji).join(' ')}</div></div>
          <div class="center"><b>${money(x.setupTotal)}</b> <span class="small muted">+ ${money(x.monthlyTotal)}/mo</span><div class="small" style="color:var(--green)">commission ${money(x.commission)} · <span class="status ${x.commissionStatus}">${x.commissionStatus.replace('_', ' ')}</span></div></div>
        </div>
        ${open ? `
          <div class="grid two" style="margin-top:1rem">
            <div class="stack">
              <div><div class="label">Contact</div>${esc(x.contact.name || '–')} · ${esc(x.contact.phone || '–')} · ${esc(x.contact.email || '–')}</div>
              <div><div class="label">Business</div>${esc(x.business.phone)} · ${esc(x.business.address || x.business.city)}${x.business.website ? ` · <a href="${esc(x.business.website)}" target="_blank" rel="noopener">site</a>` : ''}</div>
              <div><div class="label">One-button setup ${x.provisioning?.status === 'needs_attention' ? '<span class="status pending">needs attention</span>' : x.provisioning?.status === 'done' ? '<span class="status live">done</span>' : x.provisioning?.status === 'practice' ? '<span class="status paid">practice mode</span>' : ''}</div>
                <div class="stack" style="margin-top:.4rem">${stepsHtml(x)}</div>
                ${x.retell?.phoneNumber ? `<div class="small" style="margin-top:.4rem">📞 AI receptionist number: <b>${esc(x.retell.phoneNumber)}</b></div>` : ''}
                ${x.ghl?.locationId ? `<div class="small">🏢 GoHighLevel sub-account: <code>${esc(x.ghl.locationId)}</code></div>` : ''}
                ${x.provisioning?.onboardingSync ? `<div class="tiny muted">📝 Setup form synced: ${x.provisioning.onboardingSync.results.map(esc).join(' · ') || 'nothing to sync yet'}</div>` : ''}
              </div>
              <div class="copybox"><input class="input" readonly value="${esc(x.onboardingUrl)}"><button class="btn sm" data-act="copy" data-text="${esc(x.onboardingUrl)}">📋</button></div>
              ${x.paymentUrl ? `<a class="small" href="${esc(x.paymentUrl)}" target="_blank" rel="noopener">💳 Payment link</a>` : ''}
              ${x.onboarding ? `<div><div class="label">Client onboarding answers</div><div class="small">${Object.entries(x.onboarding.answers).map(([k, v]) => `<div><b>${esc(k.replace(/_/g, ' '))}:</b> ${esc(v)}</div>`).join('')}</div></div>` : ''}
              <div class="row">
                ${!x.paidAt && x.status !== 'cancelled' ? `<button class="btn go sm" data-act="deal-paid" data-id="${esc(x.id)}">💵 Mark client paid</button>` : ''}
                ${x.commissionStatus === 'earned' ? `<button class="btn primary sm" data-act="deal-payout" data-id="${esc(x.id)}">💸 Commission paid to rep</button>` : ''}
                ${x.status !== 'cancelled' && (x.provisioning?.steps || []).some((st) => st.status === 'failed' || st.status === 'practice') ? `<button class="btn sm primary" data-act="deal-retry" data-id="${esc(x.id)}">🔁 Retry setup</button>` : ''}
                ${x.status !== 'cancelled' && x.commissionStatus !== 'paid_out' ? `<button class="btn danger sm" data-act="deal-cancel" data-id="${esc(x.id)}">✖ Cancel deal</button>` : ''}
              </div>
            </div>
            <div class="stack">
              <div class="label">Fulfillment checklist</div>
              ${x.workflows.map((w) => `<div class="card" style="padding:.8rem">
                <div class="row between"><b>${w.emoji} ${esc(w.name)}</b><span class="status ${w.status === 'live' ? 'live' : 'pending'}">${w.status}</span></div>
                ${w.aiAddon ? '<div class="tiny" style="color:var(--purple)">🤖 AI upgrade included</div>' : ''}
                ${w.tasks.map((tk, i) => `<label class="task"><input type="checkbox" ${tk.done ? 'checked' : ''} ${x.status === 'cancelled' ? 'disabled' : ''} data-act="task" data-deal="${esc(x.id)}" data-wf="${w.id}" data-i="${i}"> <span style="flex:1">${esc(tk.label)}</span>${tk.by ? `<span class="owner-tag">${esc(S.catalog.taskOwners?.[tk.by] || tk.by)}</span>` : ''}</label>`).join('')}
                ${w.status !== 'live' && x.status !== 'cancelled' ? `<button class="btn sm go" style="margin-top:.4rem" data-act="wf-live" data-deal="${esc(x.id)}" data-wf="${w.id}">✅ Mark live</button>` : ''}
              </div>`).join('')}
            </div>
          </div>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  function adminTeam(d) {
    return `<div class="grid two">
      <div class="card">
        <h3>➕ Add a sales rep</h3>
        <form class="stack" data-form="add-user">
          <div class="field"><label>Name</label><input class="input" name="name" placeholder="First name" required></div>
          <div class="field"><label>PIN they'll log in with (4–8 digits)</label><input class="input" name="pin" inputmode="numeric" pattern="\\d{4,8}" required></div>
          <div class="field"><label>Role</label><select class="input" name="role"><option value="rep">Sales rep</option><option value="manager">Manager</option></select></div>
          <button class="btn go block">Add to team</button>
        </form>
      </div>
      <div class="card table-wrap">
        <h3>👥 Team</h3>
        <table class="tbl"><thead><tr><th>Rep</th><th class="num">Owed</th><th></th></tr></thead><tbody>
        ${d.users.map((u) => `<tr style="${u.active ? '' : 'opacity:.5'}">
          <td><div class="row" style="flex-wrap:nowrap;gap:.5rem"><span class="avatar" style="--c:${esc(u.color)};width:34px;height:34px;font-size:1.1rem">${esc(u.avatar)}</span><div><b>${esc(u.name)}</b><div class="tiny muted">${u.role}${u.demo ? ' · demo' : ''}${u.active ? '' : ' · inactive'}</div></div></div></td>
          <td class="num" style="color:var(--green);font-weight:800">${money(d.owed[u.id] || 0)}</td>
          <td><div class="row" style="gap:.3rem;justify-content:flex-end">
            ${d.owed[u.id] ? `<button class="btn sm primary" data-act="rep-payout" data-id="${esc(u.id)}" data-name="${esc(u.name)}" data-amt="${d.owed[u.id]}">💸 Pay out</button>` : ''}
            <button class="btn sm" data-act="reset-pin" data-id="${esc(u.id)}" data-name="${esc(u.name)}">🔑 PIN</button>
            ${u.id !== S.user.id ? `<button class="btn sm ${u.active ? 'danger' : ''}" data-act="toggle-user" data-id="${esc(u.id)}" data-active="${u.active ? '1' : ''}">${u.active ? 'Deactivate' : 'Activate'}</button>` : ''}
          </div></td>
        </tr>`).join('')}</tbody></table>
        <p class="tiny muted">"Owed" = commission on deals where the client has paid. Click Pay out after you've paid the rep.</p>
      </div>
    </div>`;
  }

  function adminPricing(d) {
    const num = (w, k, v) => `<input class="input" style="width:92px" type="number" min="0" value="${v}" data-price="${w.id}" data-k="${k}">`;
    const avgMonthly = d.workflows.reduce((s, w) => s + w.profit.monthlyProfit, 0) / d.workflows.length;
    return `<div class="stack">
      <div class="card small">
        <b>How the math works.</b> Prices sit 10–25% under what agencies typically charge (see <code>docs/PRICING-RESEARCH.md</code>).
        Setup profit = setup fee − rep commission (${pct(d.settings.commissionRate)}, paid once) − setup cost − card fees (2.9% + 30¢).
        Monthly profit = monthly fee − tool cost − card fees. The app <b>won't save a price that loses money</b>.
        Your platform subscription (e.g. GoHighLevel) is a fixed cost: at ~${money(Math.round(avgMonthly))}/mo profit per workflow, about ${Math.max(1, Math.ceil(497 / Math.max(1, avgMonthly)))} live workflows cover the $497/mo Agency Pro plan (needed for one-button setup). The AI upgrade adds +${money(S.catalog.aiAddon?.monthly || 0)}/mo.
      </div>
      <div class="card table-wrap">
      <table class="tbl"><thead><tr><th>Workflow</th><th>Market</th><th>Our setup $</th><th>Our monthly $</th><th>Cost: setup / mo</th><th class="num">Profit</th><th>Selling?</th><th></th></tr></thead><tbody>
      ${d.workflows.map((w) => `<tr><td>${w.emoji} <b>${esc(w.name)}</b></td>
        <td class="small muted">${money(w.market.setup)}<br>+${money(w.market.monthly)}/mo</td>
        <td>${num(w, 'setupFee', w.setupFee)}</td>
        <td>${num(w, 'monthlyFee', w.monthlyFee)}</td>
        <td><div class="row" style="gap:.3rem;flex-wrap:nowrap">${num(w, 'costSetup', w.cost.setup)}${num(w, 'costMonthly', w.cost.monthly)}</div></td>
        <td class="num small"><b style="color:${w.profit.ok ? 'var(--green)' : 'var(--red)'}">${money(w.profit.setupProfit)}</b> setup<br><b style="color:var(--green)">${money(w.profit.monthlyProfit)}</b>/mo (${w.profit.monthlyMargin}%)<br><span class="muted">yr 1: ${money(w.profit.firstYearProfit)}</span></td>
        <td><input type="checkbox" style="width:22px;height:22px;accent-color:var(--green)" ${w.enabled ? 'checked' : ''} data-price="${w.id}" data-k="enabled"></td>
        <td><button class="btn sm go" data-act="save-price" data-id="${w.id}">Save</button></td></tr>`).join('')}
      </tbody></table>
      <p class="tiny muted">Price changes only affect new deals. Costs are estimates: update them with your real tool bills.</p></div>
    </div>`;
  }

  function adminDrip(x) {
    if (!x) return '<p class="muted">Loading…</p>';
    const st = x.status; const s = S.admin.data.settings;
    const label = { active: '📬 Active', completed: '✅ Done', stopped: '🛑 Stopped', unsubscribed: '🚫 Unsubscribed', failed: '⚠️ Failed' };
    return `<div class="stack">
      <div class="card" style="border-color:${st.ready ? 'var(--green)' : 'var(--warm)'}">
        ${st.ready ? `✅ <b>Sending with ${esc(st.provider)}</b> · ${st.sentToday} of ${st.cap} sent today (free-tier cap)` : `⏸️ <b>Emails are queued but not sending yet.</b> Still need: ${st.missing.map(esc).join(', ')}.`}
        <div class="small muted" style="margin-top:.3rem">${x.active} people in a drip · ${x.suppressed} unsubscribed. Leads who give an email get 5 follow-ups over ~2 weeks. New customers get a welcome + setup-form reminders.</div>
      </div>
      <div class="grid two">
        <form class="card stack" data-form="email-settings">
          <h3>✉️ Sender details</h3>
          <div class="field"><label>From name</label><input class="input" name="fromName" value="${esc(s.fromName)}" placeholder="${esc(s.companyName)}"></div>
          <div class="field"><label>From email (must be verified with Brevo/Resend)</label><input class="input" name="fromEmail" type="email" value="${esc(s.fromEmail)}" placeholder="hello@yourdomain.com"></div>
          <div class="field"><label>Replies go to</label><input class="input" name="replyTo" type="email" value="${esc(s.replyTo)}" placeholder="sales@yourdomain.com"></div>
          <div class="field"><label>Business mailing address (required by law in every email)</label><input class="input" name="businessAddress" value="${esc(s.businessAddress)}" placeholder="123 Main St, Norfolk, VA 23510"></div>
          <div class="field"><label>Max emails per day (0 = free-tier default: Brevo 280, Resend 95)</label><input class="input" name="emailDailyCap" type="number" min="0" value="${s.emailDailyCap || 0}"></div>
          <button class="btn go">💾 Save sender details</button>
        </form>
        <div class="card stack">
          <h3>🧪 Test it</h3>
          <form class="row" data-form="test-email"><input class="input" name="to" type="email" placeholder="you@example.com" style="flex:1" required><button class="btn primary">Send test</button></form>
          <button class="btn" data-act="drip-run">▶ Send due emails now</button>
          <p class="tiny muted">The app also checks for due emails every minute on its own.</p>
        </div>
      </div>
      <div class="card table-wrap">
        <h3>📬 Who's in the drip</h3>
        ${x.rows.length ? `<table class="tbl"><thead><tr><th>Contact</th><th>Drip</th><th>Progress</th><th>Status</th><th></th></tr></thead><tbody>
        ${x.rows.map((r) => `<tr><td><b>${esc(r.name || r.email)}</b><div class="tiny muted">${esc(r.email)}${r.business ? ` · ${esc(r.business)}` : ''}</div></td>
          <td>${r.sequence === 'customer' ? '🎉 Customer' : '🌱 Prospect'}</td>
          <td class="small">${r.sent.length} of ${r.total} sent${r.nextAt ? `<br><span class="muted">next ${when(r.nextAt)}</span>` : ''}</td>
          <td class="small">${label[r.status] || esc(r.status)}${r.endedReason ? `<br><span class="muted">${esc(r.endedReason)}</span>` : ''}${r.lastError && r.status === 'active' ? `<br><span style="color:var(--red)">${esc(r.lastError)}</span>` : ''}</td>
          <td>${r.status === 'active' ? `<button class="btn sm danger" data-act="admin-drip-stop" data-id="${esc(r.id)}">Stop</button>` : ''}</td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">Nobody yet. When a rep adds a lead\'s email, they show up here.</p>'}
      </div>
    </div>`;
  }

  function adminSettings(d) {
    const s = d.settings; const i = d.integrations;
    const ok = (b) => (b ? '✅' : '⬜');
    return `<div class="grid two">
      <form class="card stack" data-form="settings">
        <h3>⚙️ Settings</h3>
        <div class="field"><label>Company name</label><input class="input" name="companyName" value="${esc(s.companyName)}"></div>
        <div class="field"><label>Commission (% of setup fee)</label><input class="input" name="commissionPct" type="number" min="0" max="100" step="0.5" value="${Math.round(s.commissionRate * 1000) / 10}"></div>
        <div class="row"><div class="field" style="flex:1"><label>Daily call goal</label><input class="input" name="dailyCallGoal" type="number" min="0" value="${s.dailyCallGoal}"></div>
        <div class="field" style="flex:1"><label>Daily close goal</label><input class="input" name="dailyCloseGoal" type="number" min="0" value="${s.dailyCloseGoal}"></div></div>
        <div class="field"><label>Client login link (your GoHighLevel white-label address)</label><input class="input" name="clientLoginUrl" value="${esc(s.clientLoginUrl)}" placeholder="https://app.yourdomain.com"></div>
        <div class="field"><label>Time zone for new client accounts</label><input class="input" name="timezone" value="${esc(s.timezone)}" placeholder="America/New_York"></div>
        <div class="field"><label>Default city for lead search</label><input class="input" name="defaultCity" value="${esc(s.defaultCity)}" placeholder="Norfolk, VA"></div>
        <div class="field"><label>Days before an untouched lead returns to the pool</label><input class="input" name="claimDays" type="number" min="1" value="${s.claimDays}"></div>
        <div class="field"><label>Contest title</label><input class="input" name="contestTitle" value="${esc(s.contestTitle)}"></div>
        <div class="field"><label>Contest prize</label><input class="input" name="contestPrize" value="${esc(s.contestPrize)}"></div>
        <div class="field"><label>Automation webhook URL (Zapier / Make / n8n / GoHighLevel)</label><input class="input" name="webhookUrl" value="${esc(s.webhookUrl)}" placeholder="https://hooks.zapier.com/..."></div>
        <div class="row"><button class="btn go">💾 Save settings</button><button type="button" class="btn" data-act="test-webhook">🧪 Send test webhook</button></div>
      </form>
      <div class="stack">
        <div class="card">
          <h3>🔌 Integrations</h3>
          <div class="stack small">
            <div>${ok(i.google)} <b>Google leads</b>: ${i.google ? `live Google Business data · ${i.googleUsed} of ${i.googleLimit} free searches used this month` : 'demo mode. Add <code>GOOGLE_PLACES_API_KEY</code> to <code>.env</code>'}</div>
            <div>${ok(i.p_ghl)} <b>GoHighLevel</b>: ${i.p_ghl ? (i.p_ghlSnapshot ? 'builds client accounts from your template' : 'connected. Pick your template in 🚀 Launch') : 'add <code>GHL_API_KEY</code> + <code>GHL_COMPANY_ID</code>'}</div>
            <div>${ok(i.p_retell)} <b>Retell AI receptionist</b>: ${i.p_retell ? 'builds AI receptionists + buys numbers' : 'add <code>RETELL_API_KEY</code>'}</div>
            <div>${ok(i.email.ready)} <b>Email drip</b>: ${i.email.ready ? `sending with ${esc(i.email.provider)}` : 'see the 📧 Email Drip tab'}</div>
            <div>${ok(i.stripe)} <b>Stripe payment links</b>: ${i.stripe ? 'on' : 'add <code>STRIPE_SECRET_KEY</code>'}</div>
            <div>${ok(i.stripeWebhook)} <b>Auto-mark paid from Stripe</b>: ${i.stripeWebhook ? 'on' : `add <code>STRIPE_WEBHOOK_SECRET</code>, endpoint <code>${esc(i.publicUrl)}/api/hooks/stripe</code>`}</div>
            <div>${ok(i.webhook)} <b>Automation webhook</b>: ${i.webhook ? 'on' : 'paste a URL on the left'}</div>
            <div>${ok(i.webhookSecret)} <b>Webhook signing</b>: ${i.webhookSecret ? 'on' : 'add <code>WEBHOOK_SECRET</code>'}</div>
            <div>🌐 Public URL: <code>${esc(i.publicUrl)}</code></div>
          </div>
        </div>
        <div class="card">
          <h3>🧪 Demo data</h3>
          <p class="small muted">Load a fake team with two weeks of activity to train new reps or show off the board. Demo reps' PIN is <b>1234</b>.</p>
          <div class="row"><button class="btn primary" data-act="demo-load">Load demo team</button><button class="btn danger" data-act="demo-clear">Remove demo data</button></div>
        </div>
      </div>
    </div>`;
  }

  function profileModal() {
    const muted = store.get('sb_mute', '0') === '1';
    modal(`<div class="center stack">
      <span class="avatar xl" style="--c:${esc(S.user.color)};margin:0 auto">${esc(S.user.avatar)}</span>
      <h2>${esc(S.user.name)}</h2>
      <p class="muted">${S.stats ? `${S.stats.level.emoji} ${esc(S.stats.level.name)} · ${S.stats.points.toLocaleString()} pts` : ''}</p>
      <button class="btn block" data-act="toggle-mute">${muted ? '🔇 Sounds off. Tap to turn on' : '🔊 Sounds on. Tap to mute'}</button>
      <button class="btn danger block" data-act="logout">🚪 Log out</button>
    </div>`);
  }

  // ---------------------------------------------------------------- events
  const actions = {
    'modal-bg': (el, e) => { if (e.target === el) closeModal(); },
    'close-modal': () => closeModal(),
    'pick-user': (el) => { S.login = { userId: el.dataset.id || null, pin: '' }; renderLogin(); },
    pin: (el) => {
      const k = el.dataset.k;
      if (k === 'back') S.login.pin = S.login.pin.slice(0, -1);
      else if (k === 'go') return submitPin();
      else if (S.login.pin.length < 8) S.login.pin += k;
      renderLogin();
    },
    profile: () => profileModal(),
    logout: () => logout(),
    'toggle-mute': () => { store.set('sb_mute', store.get('sb_mute', '0') === '1' ? '0' : '1'); profileModal(); },
    'start-calling': () => startCalling().catch(fail),
    'open-lead': (el) => go(`call/${el.dataset.id}`),
    'go-lead': (el) => { S.onModalClose = null; closeModal(); go(`call/${el.dataset.id}`); },
    'go-leads': () => { S.onModalClose = null; closeModal(); go('leads'); },
    'pick-industry': (el) => { S.search.industry = el.dataset.key; store.set('sb_industry', el.dataset.key); document.querySelectorAll('[data-act="pick-industry"]').forEach((c) => c.classList.toggle('on', c === el)); },
    'more-leads': () => doSearch(true),
    claim: (el) => claimLead(S.search.results[Number(el.dataset.i)]),
    'manual-lead': () => manualLeadModal(),
    'mine-tab': (el) => { S.mine.tab = el.dataset.k; viewMine(document.getElementById('view')).catch(fail); },
    step: (el) => { S.call.step = Number(el.dataset.i); drawCall(); },
    'toggle-wf': (el) => {
      const id = el.dataset.id; const sel = S.call.selected;
      S.call.selected = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
      S.call.roi = {};
      drawCall();
    },
    'show-all-wf': () => { S.call.showAll = !S.call.showAll; drawCall(); },
    bundle: (el) => { const b = S.catalog.bundles.find((x) => x.id === el.dataset.id); S.call.selected = b.workflows.filter(wfById); S.call.showAll = true; S.call.roi = {}; drawCall(); toast(`${b.emoji} ${esc(b.name)} bundle loaded`, 'good', 1500); },
    obj: (el) => { const i = Number(el.dataset.i); S.call.obj = S.call.obj === i ? null : i; drawCall(); },
    outcome: (el) => {
      const o = el.dataset.o;
      if (o === 'callback') return callbackModal();
      if (o === 'not_interested') return notInterestedModal();
      logOutcome(o);
    },
    'cb-quick': (el) => { closeModal(); logOutcome('callback', { callbackAt: Number(el.dataset.ts) }); },
    'ni-reason': (el) => { closeModal(); logOutcome('not_interested', { note: el.dataset.r }); },
    yes: () => yesModal(),
    'yes-wf': () => { yesDraftFromForm(); S.redrawYes(); },
    copy: (el) => copy(el.dataset.text),
    'next-after-win': () => { S.onModalClose = null; S.success = null; closeModal(); S.call.leadId = null; startCalling().catch(fail); },
    release: async () => {
      if (!confirm('Give this lead back so someone else can call it?')) return;
      try { await api('POST', `/api/leads/${S.call.lead.id}/release`); toast('↩️ Lead released'); go('mine'); } catch (err) { fail(err); }
    },
    'board-period': (el) => { S.board.period = el.dataset.k; viewBoard(document.getElementById('view')).catch(fail); },
    'admin-tab': (el) => { S.admin.tab = el.dataset.k; viewAdmin(document.getElementById('view')).catch(fail); },
    'admin-open': (el) => { S.admin.open = S.admin.open === el.dataset.id ? null : el.dataset.id; viewAdmin(document.getElementById('view')).catch(fail); },
    'deal-paid': (el) => adminAction(`/api/admin/deals/${el.dataset.id}/paid`, '💵 Marked paid. Rep\'s commission is now earned.'),
    'deal-payout': (el) => adminAction(`/api/admin/deals/${el.dataset.id}/payout`, '💸 Commission marked as paid out.'),
    'deal-retry': (el) => { el.disabled = true; el.textContent = '⏳ Retrying…'; adminAction(`/api/admin/deals/${el.dataset.id}/retry`, '🔁 Setup re-run. Check the steps.'); },
    'deal-cancel': (el) => { if (confirm('Cancel this deal? Points and commission will be removed from the rep.')) adminAction(`/api/admin/deals/${el.dataset.id}/cancel`, 'Deal cancelled.'); },
    task: (el) => adminAction(`/api/admin/deals/${el.dataset.deal}/workflow/${el.dataset.wf}`, null, { taskIndex: Number(el.dataset.i), done: el.checked }),
    'wf-live': (el) => adminAction(`/api/admin/deals/${el.dataset.deal}/workflow/${el.dataset.wf}`, '✅ Workflow is live!', { status: 'live' }),
    'rep-payout': (el) => { if (confirm(`Confirm you've paid ${el.dataset.name} ${money(el.dataset.amt)}?`)) adminAction(`/api/admin/reps/${el.dataset.id}/payout`, `💸 ${esc(el.dataset.name)}'s payout recorded.`); },
    'reset-pin': async (el) => {
      const pin = prompt(`New PIN for ${el.dataset.name} (4–8 digits):`);
      if (!pin) return;
      try { await api('PATCH', `/api/admin/users/${el.dataset.id}`, { pin }); toast('🔑 PIN updated', 'good'); } catch (err) { fail(err); }
    },
    'toggle-user': async (el) => {
      try { await api('PATCH', `/api/admin/users/${el.dataset.id}`, { active: !el.dataset.active }); viewAdmin(document.getElementById('view')); } catch (err) { fail(err); }
    },
    'save-price': async (el) => {
      const id = el.dataset.id;
      const get = (k) => document.querySelector(`[data-price="${id}"][data-k="${k}"]`);
      try {
        const r = await api('PATCH', `/api/admin/workflows/${id}`, { setupFee: Number(get('setupFee').value), monthlyFee: Number(get('monthlyFee').value), costSetup: Number(get('costSetup').value), costMonthly: Number(get('costMonthly').value), enabled: get('enabled').checked });
        S.catalog = await api('GET', '/api/catalog');
        toast(`🏷️ Saved. Profit: ${money(r.profit.setupProfit)} on setup + ${money(r.profit.monthlyProfit)}/mo`, 'good', 4500);
        viewAdmin(document.getElementById('view'));
      } catch (err) { fail(err); }
    },
    'test-webhook': async () => {
      try { const r = await api('POST', '/api/admin/test-webhook'); toast(r.status === 'sent' ? '✅ Test webhook delivered' : `❌ ${esc(r.error || r.status)}`, r.status === 'sent' ? 'good' : 'bad'); } catch (err) { fail(err); }
    },
    'drip-stop': async () => {
      if (!confirm('Stop sending emails to this lead?')) return;
      try { const r = await api('POST', `/api/leads/${S.call.lead.id}/drip/stop`); S.call.drip = r.drip; drawCall(); toast('🛑 Emails stopped'); } catch (err) { fail(err); }
    },
    'load-snapshots': async () => {
      try { const r = await api('GET', '/api/admin/ghl/snapshots'); S.admin.snapshots = r.snapshots; viewAdmin(document.getElementById('view')); } catch (err) { fail(err); }
    },
    'admin-drip-stop': (el) => adminAction(`/api/admin/drips/${el.dataset.id}/stop`, '🛑 Drip stopped'),
    'drip-run': async () => {
      try { const r = await api('POST', '/api/admin/drips/run'); toast(r.reason ? `⏸️ Not sending yet: ${esc(r.reason)}` : `📨 Sent ${r.sent} email${r.sent === 1 ? '' : 's'}`, r.reason ? 'bad' : 'good', 5000); viewAdmin(document.getElementById('view')); } catch (err) { fail(err); }
    },
    'demo-load': async () => { try { const r = await api('POST', '/api/admin/demo'); toast(`🧪 Loaded ${r.reps} demo reps`, 'good'); refreshAfterAdmin(); } catch (err) { fail(err); } },
    'demo-clear': async () => { if (!confirm('Remove all demo reps, leads and deals?')) return; try { await api('DELETE', '/api/admin/demo'); toast('Demo data removed'); refreshAfterAdmin(); } catch (err) { fail(err); } },
  };

  async function adminAction(path, msg, body) {
    try {
      await api('POST', path, body || {});
      if (msg) toast(msg, 'good');
      await viewAdmin(document.getElementById('view'));
    } catch (err) { fail(err); }
  }
  async function refreshAfterAdmin() {
    S.feed.since = 0;
    await pollFeed(true);
    viewAdmin(document.getElementById('view'));
  }

  const forms = {
    'first-setup': async (fd) => {
      try {
        const { token, user } = await api('POST', '/api/setup-first', Object.fromEntries(fd));
        S.token = token; store.set('sb_token', token); S.user = user;
        app.innerHTML = '';
        S.admin.tab = 'launch';
        location.hash = '#/admin';
        render();
        setTimeout(() => toast('👋 Welcome! This checklist shows exactly what to do next, one step at a time.', 'gold', 7000), 600);
      } catch (err) { fail(err); }
    },
    search: (fd) => { S.search.city = String(fd.get('city')).trim(); store.set('sb_city', S.search.city); doSearch(false); },
    'manual-lead': (fd) => {
      const lead = Object.fromEntries(fd);
      closeModal();
      claimLead(lead);
    },
    note: async (fd, form) => {
      try { const { lead } = await api('POST', `/api/leads/${S.call.lead.id}/note`, { note: fd.get('note') }); S.call.lead = lead; form.reset(); drawCall(); } catch (err) { fail(err); }
    },
    callback: (fd) => {
      const at = fd.get('at');
      if (!at) return toast('Pick a time, or tap a quick button ☝️', 'bad');
      closeModal();
      logOutcome('callback', { callbackAt: new Date(at).getTime(), note: fd.get('note') });
    },
    yes: (fd, form) => submitYes(form),
    'lead-email': async (fd) => {
      try {
        const before = S.stats;
        const r = await api('POST', `/api/leads/${S.call.lead.id}/email`, { email: fd.get('email'), name: fd.get('name'), pitched: S.call.selected });
        S.call.lead = r.lead; S.call.drip = r.drip; S.stats = r.stats;
        celebrateChanges(before, r.stats); updateChrome('call');
        if (r.pointsEarned) FX.sound('point');
        toast(r.suppressed ? '📧 Saved. They unsubscribed before, so no emails will go out.' : `📨 Added to the email drip!${r.pointsEarned ? ` <b>+${r.pointsEarned} pts</b>` : ''}`, r.suppressed ? '' : 'gold');
        drawCall();
      } catch (err) { fail(err); }
    },
    snapshot: async (fd) => {
      try { await api('PATCH', '/api/admin/settings', { ghlSnapshotId: fd.get('ghlSnapshotId') }); S.catalog = await api('GET', '/api/catalog'); toast('✅ Template saved. New clients get built from it.', 'good'); viewAdmin(document.getElementById('view')); } catch (err) { fail(err); }
    },
    'email-settings': async (fd) => {
      try { await api('PATCH', '/api/admin/settings', Object.fromEntries(fd)); toast('💾 Sender details saved', 'good'); viewAdmin(document.getElementById('view')); } catch (err) { fail(err); }
    },
    'test-email': async (fd) => {
      try { await api('POST', '/api/admin/test-email', { to: fd.get('to') }); toast('📨 Test email sent. Check your inbox (and spam folder).', 'good', 5000); } catch (err) { fail(err); }
    },
    'add-user': async (fd, form) => {
      try { const { user } = await api('POST', '/api/admin/users', Object.fromEntries(fd)); toast(`${esc(user.avatar)} ${esc(user.name)} added! Their PIN is what you typed.`, 'good', 5000); form.reset(); viewAdmin(document.getElementById('view')); } catch (err) { fail(err); }
    },
    settings: async (fd) => {
      const body = Object.fromEntries(fd);
      body.commissionRate = Number(body.commissionPct) / 100;
      delete body.commissionPct;
      try {
        await api('PATCH', '/api/admin/settings', body);
        S.catalog = await api('GET', '/api/catalog');
        await refreshMe();
        toast('💾 Saved', 'good');
      } catch (err) { fail(err); }
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = actions[el.dataset.act];
    if (!fn) return;
    // Inputs and the modal backdrop must keep their default behaviour
    // (checkbox toggles, links inside modals).
    if (el.tagName === 'INPUT' || el.dataset.act === 'modal-bg') { fn(el, e); return; }
    e.preventDefault();
    fn(el, e);
  });

  document.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const fn = forms[form.dataset.form];
    if (fn) fn(new FormData(form), form);
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.roi) {
      S.call.roi[el.dataset.roi] = el.value;
      const w = wfById(S.call.selected[0]);
      const out = document.getElementById('roi-out');
      if (w && out) out.textContent = roiValue(w, S.call.lead, S.call.roi);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalRoot.innerHTML) return closeModal();
    // Type your PIN on a keyboard too.
    if (!S.token && S.login.userId && !e.target.closest('input')) {
      if (/^\d$/.test(e.key) && S.login.pin.length < 8) { S.login.pin += e.key; renderLogin(); } else if (e.key === 'Backspace') { S.login.pin = S.login.pin.slice(0, -1); renderLogin(); } else if (e.key === 'Enter') submitPin();
    }
  });

  render();
})();
