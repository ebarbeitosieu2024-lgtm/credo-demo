// Router, session and app shell.
import { get, post, icon, esc, initials, modal, toast, relTime, errorBox, loading, on } from './ui.js';
import * as pub from './views/public.js';
import * as ap from './views/applicant.js';
import * as cred from './views/credential.js';
import * as inv from './views/invite.js';
import * as org from './views/org.js';

export const state = { session: null };

const ROLE_HOME = { applicant: '/dashboard', recommender: '/recommender', institution_rep: '/org', employer_rep: '/org', admin: '/admin' };
const ROLE_LABEL = { applicant: 'Applicant', recommender: 'Recommender', institution_rep: 'Institution', employer_rep: 'Employer', admin: 'Platform admin' };

// [pattern, view, {shell, roles}]
const ROUTES = [
  ['/', pub.landing, { shell: false }],
  ['/login', pub.login, { shell: false }],
  ['/signup', pub.signup, { shell: false }],
  ['/share/:token', cred.share, { shell: false }],
  ['/invite/:token', inv.invite, { shell: false }],
  ['/dashboard', ap.dashboard, { roles: ['applicant'] }],
  ['/profile', ap.profile, { roles: ['applicant'] }],
  ['/vault', ap.vault, { roles: ['applicant'] }],
  ['/credential/:id', cred.detail, { roles: Object.keys(ROLE_HOME) }],
  ['/request', ap.request, { roles: ['applicant'] }],
  ['/applications', ap.applications, { roles: ['applicant'] }],
  ['/applications/:id', ap.applicationDetail, { roles: ['applicant'] }],
  ['/packages', ap.packages, { roles: ['applicant'] }],
  ['/packages/new', ap.packageBuilder, { roles: ['applicant'] }],
  ['/settings', ap.settings, { roles: Object.keys(ROLE_HOME) }],
  ['/recommender', org.recommender, { roles: ['recommender'] }],
  ['/org', org.portal, { roles: ['institution_rep', 'employer_rep'] }],
  ['/org/package/:id', org.packageReview, { roles: ['institution_rep', 'employer_rep'] }],
  ['/admin', org.admin, { roles: ['admin'] }],
];

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs || '')) };
}
function match(path) {
  for (const [pat, view, opts] of ROUTES) {
    const keys = [];
    const rx = new RegExp('^' + pat.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    const m = path.match(rx);
    if (m) return { view, opts: { shell: true, ...opts }, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

export const go = (path) => { if (location.hash === '#' + path) render(); else location.hash = path; };
export async function refreshSession() { state.session = await get('/api/session'); return state.session; }

function navFor(s) {
  const u = s.user;
  const L = (href, ic, label, count) => ({ href, ic, label, count });
  if (u.role === 'applicant') return [
    ['Overview', [L('/dashboard', 'grid', 'Dashboard'), L('/profile', 'user', 'My Profile')]],
    ['Credentials', [L('/vault', 'folder', 'Document Vault'), L('/request', 'send', 'Request a Document')]],
    ['Applications', [L('/applications', 'briefcase', 'My Applications'), L('/packages', 'package', 'Shared Packages')]],
    ['Account', [L('/settings', 'lock', 'Settings & Privacy')]],
  ];
  if (u.role === 'recommender') return [['Recommender', [L('/recommender', 'inbox', 'My Requests')]], ['Account', [L('/settings', 'lock', 'Settings')]]];
  if (u.role === 'admin') return [['Platform', [L('/admin', 'shield', 'Admin Console')]], ['Account', [L('/settings', 'lock', 'Settings')]]];
  const isUni = s.orgs?.[0]?.type !== 'employer';
  return [[s.orgs?.[0]?.name || 'Organization', [
    L('/org', 'grid', 'Overview'),
    L('/org?tab=inbox', 'inbox', isUni ? 'Admissions Inbox' : 'Applications Inbox'),
    L('/org?tab=requests', 'send', 'Document Requests'),
    L('/org?tab=issued', 'award', 'Issued Credentials'),
    L('/org?tab=programs', 'layers', isUni ? 'Programs & Requirements' : 'Openings & Requirements'),
    L('/org?tab=team', 'users', 'Authorized Team'),
  ]], ['Account', [L('/settings', 'lock', 'Settings')]]];
}

function shell(s) {
  const u = s.user;
  const cur = location.hash.replace(/^#/, '');
  const curPath = cur.split('?')[0];
  const nav = navFor(s).map(([label, items]) => `<div class="nav-label">${esc(label)}</div><div class="nav">${items.map((i) => {
    const active = i.href.includes('?') ? cur === i.href
      : i.href === '/org' ? (cur === '/org' || cur === '/org?tab=overview')
        : (curPath === i.href || curPath.startsWith(i.href + '/'));
    return `<a href="#${i.href}" ${active ? 'aria-current="page"' : ''}>${icon(i.ic)}<span>${esc(i.label)}</span></a>`;
  }).join('')}</div>`).join('');
  const orgName = s.orgs?.[0]?.name;
  return `<div class="shell">
    <aside class="side" id="side" aria-label="Main navigation">
      <a class="brand" href="#${ROLE_HOME[u.role]}"><span class="logo">${icon('check')}</span>Credo</a>
      ${nav}
      <div class="side-foot">
        <div class="me"><div class="avatar">${esc(initials(u.name))}</div><div class="grow"><div class="title-line small">${esc(u.name)}</div>
          <div class="xs muted title-line">${esc(ROLE_LABEL[u.role])}${orgName ? ' · ' + esc(orgName) : ''}</div></div></div>
        <button class="btn ghost sm" style="width:100%;justify-content:flex-start" id="switch">${icon('users')}Switch demo persona</button>
        <button class="btn ghost sm" style="width:100%;justify-content:flex-start" id="logout">${icon('logout')}Sign out</button>
      </div>
    </aside>
    <div class="main">
      <div class="demo-strip">${icon('flask')}<span><b>Prototype.</b> People, organizations and credentials are fictional demo data. Email, SSO, identity checks and issuer signatures are simulated.</span></div>
      <header class="topbar">
        <button class="icon-btn menu-btn" id="menu" aria-label="Open menu">${icon('menu')}</button>
        <div class="grow"></div>
        ${u.role === 'applicant' ? `<a class="btn sm accent" href="#/request">${icon('plus')}Request document</a>` : ''}
        <div style="position:relative"><button class="icon-btn" id="bell" aria-label="Notifications${s.unread ? ` (${s.unread} unread)` : ''}">${icon('bell')}${s.unread ? '<span class="dot"></span>' : ''}</button><div id="notif"></div></div>
      </header>
      <main id="main" class="content" tabindex="-1"></main>
    </div>
  </div>`;
}

export async function switchPersona() {
  const { personas } = await get('/api/personas');
  return modal({
    title: 'Switch demo persona', sub: 'Each persona sees the platform from a different side. No passwords in the demo.', wide: true,
    body: pub.personaGrid(personas),
    onMount: (box, close) => on(box, '[data-persona]', async (e, el) => {
      await post('/api/login', { user_id: el.dataset.persona });
      close(true);
      await refreshSession();
      go(ROLE_HOME[state.session.user.role]);
    }),
  });
}

async function showNotifications(btn) {
  const host = document.getElementById('notif');
  if (host.innerHTML) { host.innerHTML = ''; return; }
  const { notifications } = await get('/api/notifications');
  host.innerHTML = `<div class="card notif-pop"><div class="card-h"><h3>Notifications</h3><span class="sim">${icon('flask')}In-app only</span></div>
    <div class="list" style="max-height:380px;overflow:auto">${notifications.length ? notifications.map((n) => `<a class="list-item" href="${esc(n.link || '#')}">
      <div class="row between"><b class="small">${esc(n.title)}</b>${n.read ? '' : '<span class="badge b-accent">New</span>'}</div>
      <div class="small muted">${esc(n.body)}</div><div class="xs faint">${relTime(n.created_at)}</div></a>`).join('') : '<div class="empty small">You’re all caught up.</div>'}</div></div>`;
  on(host, 'a', () => { host.innerHTML = ''; });
  await post('/api/notifications/read');
  btn.querySelector('.dot')?.remove();
  state.session.unread = 0;
}

let renderSeq = 0;
export async function render() {
  const seq = ++renderSeq;
  const app = document.getElementById('app');
  const { path, query } = parseHash();
  const m = match(path);
  if (!state.session) { try { await refreshSession(); } catch { state.session = { user: null }; } }
  const s = state.session;
  if (!m) { go(s.user ? ROLE_HOME[s.user.role] : '/'); return; }
  if (m.opts.shell) {
    if (!s.user) { go('/login'); return; }
    if (m.opts.roles && !m.opts.roles.includes(s.user.role)) { go(ROLE_HOME[s.user.role]); return; }
    app.innerHTML = shell(s);
    const side = app.querySelector('#side');
    app.querySelector('#menu').addEventListener('click', () => {
      side.classList.add('open');
      const scrim = document.createElement('div'); scrim.className = 'scrim';
      scrim.onclick = () => { side.classList.remove('open'); scrim.remove(); };
      document.body.appendChild(scrim);
    });
    side.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => { side.classList.remove('open'); document.querySelector('.scrim')?.remove(); }));
    app.querySelector('#logout').addEventListener('click', async () => { await post('/api/logout'); state.session = { user: null }; go('/'); });
    app.querySelector('#switch').addEventListener('click', switchPersona);
    app.querySelector('#bell').addEventListener('click', (e) => showNotifications(e.currentTarget));
    const el = app.querySelector('#main');
    el.innerHTML = loading();
    try { await m.view({ el, params: m.params, query, state, go, rerender: render, isCurrent: () => seq === renderSeq }); }
    catch (e) {
      if (seq !== renderSeq) return;
      // Session may have changed in another tab — resync instead of showing a role error.
      if ((e.status === 401 || e.status === 403) && !render.retried) {
        render.retried = true;
        await refreshSession().catch(() => { state.session = { user: null }; });
        render.retried = false;
        if (state.session.user?.id !== s.user.id) { go(state.session.user ? ROLE_HOME[state.session.user.role] : '/login'); return; }
      }
      el.innerHTML = errorBox(e);
    }
  } else {
    app.innerHTML = '';
    try { await m.view({ el: app, params: m.params, query, state, go, rerender: render }); }
    catch (e) { app.innerHTML = `<div class="pub">${errorBox(e)}</div>`; }
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', render);
document.addEventListener('click', (e) => { if (!e.target.closest('#bell') && !e.target.closest('#notif')) { const n = document.getElementById('notif'); if (n) n.innerHTML = ''; } });
export { ROLE_HOME, ROLE_LABEL, toast };
render();
