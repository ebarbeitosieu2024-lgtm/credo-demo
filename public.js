// Public pages: landing, demo sign-in, applicant onboarding.
import { get, post, icon, esc, initials, statusBadge, on, busy, formData, fmtDate, toast } from '../ui.js';
import { refreshSession, state, ROLE_HOME, ROLE_LABEL } from '../app.js';

const logo = `<a class="brand" href="#/" style="padding:0"><span class="logo">${icon('check')}</span>Credo</a>`;

function heroMock() {
  const docs = [
    ['transcript', 'High School Transcript', 'Example International School', 'verified'],
    ['recommendation', 'Mathematics Recommendation', 'Dr. Elena Ruiz · Confidential', 'verified'],
    ['recommendation', 'Economics Recommendation', 'James Okafor', 'pending'],
    ['cv', 'CV — Alex Morgan', 'Uploaded by applicant', 'self_uploaded'],
  ];
  const ic = { transcript: 'file-text', recommendation: 'pen', cv: 'user' };
  return `<div class="mock"><div class="mock-bar"><i></i><i></i><i></i><span class="xs muted" style="margin-left:10px">credo.app/applications/ie-university</span></div>
    <div style="display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:0" class="mock-grid">
      <div style="padding:22px;border-right:1px solid var(--line)">
        <div class="row between"><div><div class="xs muted">IE University · Bachelor's Program</div><h3 style="margin-top:2px">Application requirements</h3></div><span class="badge b-accent">5 of 7 ready</span></div>
        <div class="bar" style="margin:14px 0 6px"><i style="width:71%"></i></div>
        <div style="margin-top:12px">${docs.map(([t, n, by, s]) => `<div class="row" style="padding:10px 0;border-top:1px solid var(--line)">
          <div class="doc-ico ${s}">${icon(ic[t])}</div><div class="grow"><div class="title-line small">${n}</div><div class="xs muted title-line">${by}</div></div>${statusBadge(s, true)}</div>`).join('')}</div>
      </div>
      <div style="padding:22px;background:var(--surface)">
        <div class="xs muted" style="font-weight:600;text-transform:uppercase;letter-spacing:.05em">Verification evidence</div>
        <div style="margin-top:12px" class="stack">
          ${[['building', 'Issuer', 'Verified institution'], ['fingerprint', 'Signer identity', 'Registrar · SSO'], ['hash', 'Integrity', 'SHA-256 matches'], ['history', 'Status', 'Active · not revoked']].map(([i, k, v]) => `
          <div class="row"><div class="doc-ico verified" style="width:32px;height:32px">${icon(i)}</div><div><div class="xs muted">${k}</div><div class="small" style="font-weight:600">${v}</div></div></div>`).join('')}
        </div>
        <div class="callout info xs" style="margin-top:16px;padding:10px 12px">${icon('info')}<span>Verified origin ≠ admissions decision. Each institution decides.</span></div>
      </div>
    </div></div>
    <style>@media(max-width:700px){.mock-grid{grid-template-columns:1fr!important}}</style>`;
}

export async function landing({ el }) {
  const s = state.session;
  el.innerHTML = `<div class="lp">
  <nav class="lp-nav" aria-label="Site">${logo}
    <div class="links"><a href="#/" data-scroll="problem">Problem</a><a href="#/" data-scroll="how">How it works</a><a href="#/" data-scroll="students">Students</a><a href="#/" data-scroll="institutions">Institutions</a></div>
    <div class="grow"></div>
    ${s?.user ? `<a class="btn primary sm" href="#${ROLE_HOME[s.user.role]}">Open app ${icon('arrow-right')}</a>` : `<a class="btn ghost sm" href="#/login">Try the demo</a><a class="btn primary sm" href="#/signup">Create your profile</a>`}
  </nav>
  <header class="hero">
    <span class="eyebrow">${icon('shield-check')}Verified credentials for every application</span>
    <h1>One Profile.<br><em>Every Opportunity.</em></h1>
    <p class="lead">Your academic and professional credentials, verified once and ready for your next opportunity.</p>
    <div class="ctas"><a class="btn primary lg" href="#/signup">Create Your Profile ${icon('arrow-right')}</a><button class="btn lg" data-scroll="how">Explore How It Works</button></div>
    <p class="xs muted" style="margin-top:18px">Prototype · all institutions, people and credentials shown are demo data · integrations are simulated</p>
  </header>
  <div class="hero-visual">${heroMock()}</div>

  <section class="section" id="problem">
    <div class="section-h"><div class="kick">The problem</div><h2>Applying shouldn’t mean proving yourself from scratch every time.</h2>
    <p>Applicants chase the same letters, transcripts and certificates for every application. Admissions and HR teams spend weeks checking them.</p></div>
    <div class="vs">
      <div class="card pad"><h3 class="row">${icon('x-circle')}Today</h3><ul>
        ${['Ask each professor for a new letter, for every school', 'Order official transcripts again and again', 'Re-upload diplomas and certificates to every portal', 'Wait for third parties to confirm your records', 'Reviewers manually check documents for fraud'].map((t) => `<li style="color:var(--muted)">${icon('x')}${t}</li>`).join('')}</ul></div>
      <div class="card pad" style="border-color:#c7d2fe;background:linear-gradient(180deg,#fff, #f8f9ff)"><h3 class="row" style="color:var(--accent-ink)">${icon('check-circle')}With Credo</h3><ul>
        ${['Recommenders write once, sign once, and decide where it can be reused', 'Schools issue signed transcripts straight to your vault', 'Requirements match automatically against your documents', 'Share a package in a click, revoke it any time', 'Reviewers see issuer, signature and integrity evidence'].map((t) => `<li>${icon('check')}${t}</li>`).join('')}</ul></div>
    </div>
  </section>

  <section class="section" id="how">
    <div class="section-h"><div class="kick">How verification works</div><h2>Evidence travels with every document.</h2>
    <p>Documents come from the source, not from a screenshot. Every claim is backed by a record you can inspect.</p></div>
    <div class="flow">
      <div class="card"><h3>Issuer is vetted</h3><p class="muted small" style="margin-top:6px">Institutions and employers are verified before they can issue. Representatives are authorized individually.</p></div>
      <div class="card"><h3>Signer proves who they are</h3><p class="muted small" style="margin-top:6px">Professors confirm email, institutional affiliation and identity. An email address alone is never enough.</p></div>
      <div class="card"><h3>Document is sealed</h3><p class="muted small" style="margin-top:6px">A SHA-256 fingerprint and issuer signature are recorded at issuance. Any change is detected.</p></div>
      <div class="card"><h3>You control sharing</h3><p class="muted small" style="margin-top:6px">Recipients only see what you authorize — for as long as you allow. Every access is logged.</p></div>
    </div>
    <div class="grid g4" style="margin-top:16px">
      ${[['fingerprint', 'Identity verified', 'Who the person is'], ['building', 'Issuer verified', 'Which organization stands behind it'], ['hash', 'Integrity intact', 'Not altered since issuance'], ['briefcase', 'Accepted by recipient', 'Always the recipient’s own decision']].map(([i, t, d], n) => `
        <div class="card pad soft"><div class="row">${icon(i)}<b class="small">${t}</b></div><p class="xs muted" style="margin-top:6px">${d}</p>${n === 3 ? '<p class="xs" style="margin-top:6px;color:var(--accent-ink);font-weight:600">Credo never claims this for you.</p>' : ''}</div>`).join('')}
    </div>
  </section>

  <section class="section" id="students">
    <div class="section-h"><div class="kick">For applicants</div><h2>Know what you have, what you need, and what to do next.</h2></div>
    <div class="grid g3">
      ${[['folder', 'A vault that proves itself', 'Transcripts, diplomas, letters and certificates, each with a clear verification status.'],
        ['pen', 'Recommendations without the chase', 'Invite a professor in 30 seconds. They respond from a secure link — no account needed.'],
        ['sparkles', 'Smart requirement matching', 'Add an application and instantly see which requirements are covered and which are missing.'],
        ['package', 'One-click application packages', 'Bundle exactly the documents a program needs, share a secure link, revoke whenever you want.'],
        ['lock', 'Confidential when it should be', 'Confidential letters stay sealed — you see that they arrived, not what they say.'],
        ['history', 'Full transparency', 'See who accessed which document and when, in your personal audit log.']].map(([i, t, d]) => `<div class="card feature"><div class="fi">${icon(i)}</div><h3>${t}</h3><p>${d}</p></div>`).join('')}
    </div>
  </section>

  <section class="section" id="institutions">
    <div class="section-h"><div class="kick">For institutions & employers</div><h2>Less document chasing. Faster, safer review.</h2></div>
    <div class="grid g3">
      ${[['award', 'Issue once, verifiable everywhere', 'Issue signed transcripts, diplomas and employment certificates. Revoke or correct them at any time.'],
        ['inbox', 'Structured application packages', 'Receive exactly the documents you require, mapped to your requirement list.'],
        ['shield-check', 'Evidence, not trust', 'Inspect issuer status, signer identity, signature and integrity for every document.'],
        ['layers', 'Define requirements', 'Publish what each program or opening needs — applicants see gaps before they apply.'],
        ['users', 'Authorized reviewers', 'Control which staff can review and issue, with every action audit-logged.'],
        ['globe', 'Built for interoperability', 'Designed around W3C Verifiable Credentials and Open Badges, ready for SIS and ATS integrations.']].map(([i, t, d]) => `<div class="card feature"><div class="fi">${icon(i)}</div><h3>${t}</h3><p>${d}</p></div>`).join('')}
    </div>
  </section>

  <div style="padding:0 24px"><div class="cta-band">
    <h2>Build your verified profile in minutes.</h2>
    <p>Explore the full prototype as an applicant, professor, registrar, admissions reviewer or recruiter.</p>
    <div class="row wrap" style="justify-content:center;margin-top:26px"><a class="btn lg" href="#/signup" style="border:0">Create Your Profile</a><a class="btn lg" href="#/login" style="background:transparent;color:#fff;border-color:rgba(255,255,255,.35)">Try a demo persona</a></div>
  </div></div>
  <footer class="lp-foot"><div class="row">${logo}<span>Prototype for demonstration.</span></div>
    <div style="max-width:620px">Demo data only. Organizations named are used as illustrative destinations and are not partners or live integrations. Designed with GDPR principles in mind; not certified as compliant without legal and technical validation.</div></footer>
  </div>`;
  on(el, '[data-scroll]', (e, b) => { e.preventDefault(); document.getElementById(b.dataset.scroll)?.scrollIntoView({ behavior: 'smooth' }); });
}

export function personaGrid(personas) {
  const desc = {
    applicant: 'Vault, applications, packages, recommendation requests',
    recommender: 'Requests received, invite flow, letters issued',
    institution_rep: 'Issue credentials, review admissions packages',
    employer_rep: 'Review candidate packages, verify employment',
    admin: 'Organization vetting, integrity monitor, audit log',
  };
  return `<div class="grid g2">${personas.map((p) => `<button class="persona" data-persona="${esc(p.id)}">
    <div class="avatar">${esc(initials(p.name))}</div><div class="grow"><div class="row between"><b>${esc(p.name)}</b><span class="badge b-plain">${esc(ROLE_LABEL[p.role])}</span></div>
    <div class="small muted title-line">${esc(p.headline || '')}</div><div class="xs faint" style="margin-top:2px">${esc(desc[p.role])}</div></div></button>`).join('')}</div>`;
}

export async function login({ el, go }) {
  const { personas } = await get('/api/personas');
  el.innerHTML = `<div class="auth"><div class="card pad" style="padding:32px">
    <div class="row between">${logo}<a class="small" href="#/">Back to site</a></div>
    <h1 style="margin-top:28px">Explore the demo</h1>
    <p class="muted" style="margin-top:6px">Choose a persona. In production every role signs in with strong authentication (SSO + MFA for issuers); the demo skips passwords.</p>
    <div style="margin-top:24px">${personaGrid(personas)}</div>
    <hr class="hr"><div class="row between wrap"><span class="small muted">New here?</span><a class="btn" href="#/signup">${icon('plus')}Create your own applicant profile</a></div>
    <div class="row between wrap" style="margin-top:12px"><span class="xs muted">Restore all demo data to its original state.</span><button class="btn sm ghost" id="reset">${icon('refresh')}Reset demo data</button></div>
  </div></div>`;
  on(el, '[data-persona]', async (e, b) => busy(b, async () => {
    await post('/api/login', { user_id: b.dataset.persona });
    const s = await refreshSession();
    go(ROLE_HOME[s.user.role]);
  }));
  el.querySelector('#reset').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    await post('/api/demo/reset'); state.session = null; toast('Demo data reset');
  }));
}

export async function signup({ el, go }) {
  const [{ orgs }, { programs }] = await Promise.all([get('/api/orgs'), get('/api/programs')]);
  const schools = orgs.filter((o) => ['school', 'university'].includes(o.type));
  const data = { program_ids: [] };
  let step = 1;
  const stepper = () => `<div class="steps">${['Account', 'Education', 'Applications'].map((t, i) => `${i ? '<span class="sep"></span>' : ''}<span class="s ${i + 1 < step ? 'done' : i + 1 === step ? 'on' : ''}"><i>${i + 1 < step ? '✓' : i + 1}</i>${t}</span>`).join('')}</div>`;
  const draw = () => {
    let body = '';
    if (step === 1) body = `<form id="f" class="stack">
      <h1>Create your profile</h1><p class="muted">Your universal application profile. You decide who sees what.</p>
      <div class="grid g2" style="margin-top:16px"><label class="field"><span>Full name</span><input type="text" name="name" required autocomplete="name" value="${esc(data.name || '')}"></label>
      <label class="field"><span>Email</span><input type="email" name="email" required autocomplete="email" value="${esc(data.email || '')}"></label></div>
      <div class="grid g2"><label class="field"><span>Location</span><input type="text" name="location" placeholder="City, Country" value="${esc(data.location || '')}"></label>
      <label class="field"><span>Headline</span><input type="text" name="headline" placeholder="e.g. Final-year student applying to business programs" value="${esc(data.headline || '')}"></label></div>
      <div class="callout sim-c small">${icon('flask')}<span>Account creation is real in this prototype; email confirmation and identity verification are simulated. Use a demo email, not personal data.</span></div>
      <div class="row between"><a href="#/login" class="small">I want to try a demo persona instead</a><button class="btn primary">Continue ${icon('arrow-right')}</button></div></form>`;
    if (step === 2) body = `<form id="f" class="stack">
      <h1>Your education</h1><p class="muted">Pick your school if it’s on Credo — it can then issue verified records directly to you.</p>
      <label class="field" style="margin-top:16px"><span>School or university</span><select name="org_id"><option value="">Not listed / I’ll add it later</option>${schools.map((o) => `<option value="${o.id}" ${data.org_id === o.id ? 'selected' : ''}>${esc(o.name)}${o.verification_status === 'verified' ? ' — verified issuer' : ' — verification pending'}</option>`).join('')}</select></label>
      <div class="grid g2"><label class="field"><span>Qualification</span><input type="text" name="degree" placeholder="e.g. Upper Secondary Diploma" value="${esc(data.degree || '')}"></label>
      <label class="field"><span>Field / track</span><input type="text" name="field" value="${esc(data.field || '')}"></label></div>
      <div class="grid g2"><label class="field"><span>Start</span><input type="text" name="start" placeholder="YYYY-MM" value="${esc(data.start || '')}"></label><label class="field"><span>End (or expected)</span><input type="text" name="end" placeholder="YYYY-MM" value="${esc(data.end || '')}"></label></div>
      <div class="row between"><button type="button" class="btn ghost" id="back">${icon('arrow-left')}Back</button><button class="btn primary">Continue ${icon('arrow-right')}</button></div></form>`;
    if (step === 3) body = `<form id="f" class="stack">
      <h1>What are you applying to?</h1><p class="muted">We’ll map each program’s requirements against your vault. You can add more later.</p>
      <div class="stack" style="margin-top:16px">${programs.map((p) => `<label class="choice"><input type="checkbox" class="sr-only" name="p" value="${p.id}" ${data.program_ids.includes(p.id) ? 'checked' : ''}>
        ${icon(p.type === 'university' || p.type === 'graduate' ? 'cap' : 'briefcase')}<div class="grow"><div class="row between wrap"><b>${esc(p.org_name)}</b><span class="xs muted">Deadline ${fmtDate(p.deadline)}</span></div>
        <div class="small">${esc(p.title)}</div><div class="xs muted" style="margin-top:4px">${p.requirements.length} requirements · ${esc(p.requirements.map((r) => r.label).slice(0, 4).join(', '))}${p.requirements.length > 4 ? '…' : ''}</div></div></label>`).join('')}</div>
      <label class="check small"><input type="checkbox" required name="consent"><span>I agree to the demo terms and understand my data is stored in this local prototype only.</span></label>
      <div class="row between"><button type="button" class="btn ghost" id="back">${icon('arrow-left')}Back</button><button class="btn accent">${icon('check')}Create profile</button></div></form>`;
    el.innerHTML = `<div class="auth"><div class="card pad" style="padding:32px"><div class="row between" style="margin-bottom:24px">${logo}<a class="small" href="#/">Cancel</a></div>${stepper()}${body}</div></div>`;
    el.querySelector('#back')?.addEventListener('click', () => { step--; draw(); });
    el.querySelector('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      Object.assign(data, formData(f));
      if (step === 3) {
        data.program_ids = [...f.querySelectorAll('input[name=p]:checked')].map((i) => i.value);
        const org = schools.find((o) => o.id === data.org_id);
        await busy(f.querySelector('.btn.accent'), async () => {
          await post('/api/signup', { name: data.name, email: data.email, location: data.location, headline: data.headline, program_ids: data.program_ids,
            education: org || data.degree ? { institution: org?.name || 'My school', org_id: data.org_id || null, degree: data.degree, field: data.field, start: data.start, end: data.end } : null });
          await refreshSession();
          toast('Profile created — welcome to Credo');
          go('/dashboard');
        });
        return;
      }
      step++; draw();
    });
  };
  draw();
}
