// Recommender invite flow: token link, no account needed.
import { get, post, icon, esc, fmtDate, toast, busy, fileToB64, simTag, initials, dueLabel } from '../ui.js';

const STEPS = ['Verify', 'Review request', 'Write letter', 'Permissions', 'Done'];

export async function invite({ el, params }) {
  const base = '/api/invite/' + params.token;
  let d;
  try { d = await get(base); }
  catch (e) { el.innerHTML = page(`<div class="card pad"><div class="empty">${icon('ban')}<h2>Invitation unavailable</h2><p style="margin-top:8px">${esc(e.message)}</p></div></div>`); return; }
  const draft = { mode: 'write', content: '', title: '', relationship: '', position: '', confidential: d.confidential, reuse_policy: 'recipient_specific', permitted: d.application?.org_id ? [d.application.org_id] : [], expires_at: '', file: null };
  let code = null;

  function stepIndex() {
    if (d.status === 'submitted') return 4;
    if (d.status === 'declined') return -1;
    if (!(d.steps.email_code && d.steps.affiliation && d.steps.identity)) return 0;
    if (d.status !== 'accepted') return 1;
    return draft.stage === 'perm' ? 3 : 2;
  }
  function page(inner) {
    return `<div class="pub-top"><a class="brand" href="#/" style="padding:0"><span class="logo">${icon('check')}</span>Credo</a><span class="badge b-plain">${icon('pen')}Recommender portal</span><div class="grow"></div>${simTag('Prototype')}</div><div class="pub">${inner}</div>`;
  }
  function stepper(i) {
    return `<div class="steps">${STEPS.map((t, n) => `${n ? '<span class="sep"></span>' : ''}<span class="s ${n < i ? 'done' : n === i ? 'on' : ''}"><i>${n < i ? '✓' : n + 1}</i>${t}</span>`).join('')}</div>`;
  }
  const requestCard = () => `<div class="card pad"><div class="row wrap" style="gap:14px"><div class="avatar">${esc(initials(d.applicant.name))}</div><div class="grow">
    <div class="xs muted">Recommendation request for</div><h2>${esc(d.applicant.name)}</h2><div class="small muted">${esc(d.applicant.headline || '')}</div></div>
    ${d.deadline ? `<span class="badge b-pending">${icon('calendar')}Due ${fmtDate(d.deadline)} · ${dueLabel(d.deadline)}</span>` : ''}</div>
    <hr class="hr"><dl class="kv"><dt>Addressed to</dt><dd>${esc(d.recommender_name)} · ${esc(d.recommender_email)}</dd><dt>Your institution</dt><dd>${esc(d.institution?.name || '—')}</dd>
    ${d.application ? `<dt>For</dt><dd>${esc(d.application.org_name)} — ${esc(d.application.title)}</dd>` : ''}<dt>Confidentiality</dt><dd>${d.confidential ? `${icon('lock')} The applicant waived the right to read this letter` : 'The applicant may read this letter'}</dd></dl>
    ${d.purpose ? `<div class="callout small" style="margin-top:14px">${icon('mail')}<span><b>Message from ${esc(d.applicant.name.split(' ')[0])}:</b> ${esc(d.purpose)}</span></div>` : ''}</div>`;

  function draw() {
    const i = stepIndex();
    let body = '';
    if (i === -1) body = `<div class="card pad"><div class="empty">${icon('check-circle')}<h2>You declined this request</h2><p style="margin-top:6px">${esc(d.applicant.name)} has been notified. Thank you for responding.</p></div></div>`;
    if (i === 0) {
      const v = d.verification || {};
      body = `${requestCard()}<div class="card" style="margin-top:16px"><div class="card-h"><h2>Confirm who you are</h2><span class="xs muted">Takes about a minute</span></div>
        <div class="vcheck"><div class="vi ${d.steps.email_code ? 'ok' : 'na'}">${icon(d.steps.email_code ? 'check' : 'mail')}</div><div class="grow"><b class="small">1. Email one-time code</b>
          <div class="xs muted">We send a code to ${esc(d.recommender_email)}.</div>
          ${d.steps.email_code ? '<div class="small" style="color:var(--ok);margin-top:4px">Email confirmed</div>' : `<div class="row wrap" style="margin-top:10px"><button class="btn sm" id="send">${icon('send')}Send code</button>
            ${code ? `<span class="code-box" style="font-size:16px;padding:4px 10px">${esc(code)}</span><span class="sim">${icon('flask')}Simulated inbox</span>` : ''}</div>
            <div class="row" style="margin-top:10px;max-width:320px"><input type="text" id="code" inputmode="numeric" maxlength="6" placeholder="6-digit code" aria-label="One-time code"><button class="btn primary sm" id="check">Verify</button></div>`}</div></div>
        <div class="vcheck"><div class="vi ${d.steps.affiliation ? 'ok' : 'na'}">${icon(d.steps.affiliation ? 'check' : 'building')}</div><div class="grow"><b class="small">2. Institutional affiliation</b>
          <div class="xs muted">${d.steps.affiliation ? esc(v.affiliation_method || 'Confirmed') : d.domain_match ? `Your email domain matches ${esc(d.institution.name)} (${esc(d.institution.domain)}). Confirmed after the email code.` : `Your email domain doesn’t match ${esc(d.institution?.name || 'the institution')}. Use SSO or registrar confirmation below.`}</div></div></div>
        <div class="vcheck"><div class="vi ${d.steps.identity ? 'ok' : 'na'}">${icon(d.steps.identity ? 'check' : 'fingerprint')}</div><div class="grow"><b class="small">3. Identity assurance</b>
          <div class="xs muted">An email address alone is not proof of identity. Choose one method.</div>
          ${d.steps.identity ? `<div class="small" style="color:var(--ok);margin-top:4px">${esc(v.identity_method)}</div>` : `<div class="grid g3" style="margin-top:10px;gap:8px">
            ${[['sso', 'building', 'Institutional SSO'], ['id_document', 'fingerprint', 'ID document check'], ['registrar', 'users', 'Registrar confirms']].map(([k, ic, l]) => `<button class="choice" data-am="${k}" ${d.steps.email_code ? '' : 'disabled style="opacity:.5"'}>${icon(ic)}<span class="small"><b>${l}</b><br><span class="xs muted">Simulated</span></span></button>`).join('')}</div>`}</div></div>
        </div>
        <div class="callout sim-c small" style="margin-top:16px">${icon('flask')}<span>Email delivery, SSO and ID checks are simulated in this prototype. In production, codes are emailed and identity is confirmed by your institution’s identity provider or a certified ID service.</span></div>`;
    }
    if (i === 1) body = `${requestCard()}<div class="card pad" style="margin-top:16px"><div class="row" style="gap:10px;margin-bottom:12px"><span class="badge b-verified">${icon('check')}Identity & affiliation verified</span></div>
      <h2>Will you write this recommendation?</h2><p class="muted small" style="margin-top:6px">If you accept, you’ll write or upload your letter next. You can decline politely — the applicant will only see that you declined.</p>
      <div class="row wrap" style="margin-top:16px"><button class="btn accent" id="accept">${icon('check')}Accept request</button><button class="btn" id="decline">Decline</button></div></div>`;
    if (i === 2) body = `${requestCard()}<div class="card" style="margin-top:16px"><div class="card-h"><h2>Your letter</h2><div class="seg"><button data-mode="write" aria-pressed="${draft.mode === 'write'}">Write here</button><button data-mode="upload" aria-pressed="${draft.mode === 'upload'}">Upload file</button></div></div>
      <div class="card-b stack">
        <div class="grid g2"><label class="field"><span>Your position</span><input type="text" id="position" value="${esc(draft.position)}" placeholder="e.g. Economics Teacher"></label>
        <label class="field"><span>Relationship to applicant</span><input type="text" id="relationship" value="${esc(draft.relationship)}" placeholder="e.g. Taught Alex for 2 years"></label></div>
        ${draft.mode === 'write' ? `<label class="field"><span>Letter</span><textarea id="content" style="min-height:260px" placeholder="To the Admissions Committee, …">${esc(draft.content)}</textarea><div class="hint" id="wc"></div></label>
          ${d.previous_letters?.length ? `<details><summary class="small" style="cursor:pointer;font-weight:600">Reuse text from a previous letter</summary><div class="stack" style="margin-top:8px">${d.previous_letters.map((p, n) => `<button class="choice" data-prev="${n}">${icon('copy')}<span class="small"><b>${esc(p.title)}</b><br><span class="xs muted">${fmtDate(p.issued_at)}</span></span></button>`).join('')}</div></details>` : ''}`
          : `<label class="field"><span>Letter file (PDF preferred)</span><input type="file" id="file" accept=".pdf,.doc,.docx,.txt" style="padding:8px;height:auto;border:1px dashed var(--line-2);border-radius:10px;width:100%"></label>${draft.file ? `<div class="small">Selected: <b>${esc(draft.file.name)}</b></div>` : ''}`}
        <div class="row" style="justify-content:flex-end"><button class="btn primary" id="next">Continue ${icon('arrow-right')}</button></div></div></div>`;
    if (i === 3) body = `<div class="card"><div class="card-h"><h2>Who may receive this letter?</h2></div><div class="card-b stack">
      <label class="row between" style="padding:14px;border:1px solid var(--line);border-radius:12px;gap:16px"><span><b class="small">Confidential</b><div class="xs muted">The applicant can see that you submitted, but not the content.</div></span><span class="toggle"><input type="checkbox" id="conf" ${draft.confidential ? 'checked' : ''}><span></span></span></label>
      <div class="stack"><label class="choice"><input type="radio" name="reuse" value="recipient_specific" class="sr-only" ${draft.reuse_policy === 'recipient_specific' ? 'checked' : ''}>${icon('lock')}<span><b class="small">Only the organizations I choose</b><div class="xs muted">Recommended. The applicant can’t send it anywhere else.</div></span></label>
        <label class="choice"><input type="radio" name="reuse" value="any" class="sr-only" ${draft.reuse_policy === 'any' ? 'checked' : ''}>${icon('globe')}<span><b class="small">Any application the applicant chooses</b><div class="xs muted">Every share is still logged.</div></span></label></div>
      <fieldset style="border:0;padding:0;margin:0" ${draft.reuse_policy === 'any' ? 'disabled style="opacity:.5;border:0;padding:0;margin:0"' : ''}><legend class="small" style="font-weight:600;margin-bottom:8px">Permitted recipients</legend>
        <div class="grid g2" style="gap:8px">${d.recipient_options.map((o) => `<label class="check small" style="padding:10px;border:1px solid var(--line);border-radius:10px"><input type="checkbox" data-org="${o.id}" ${draft.permitted.includes(o.id) ? 'checked' : ''}>${esc(o.name)}</label>`).join('')}</div></fieldset>
      <label class="field" style="max-width:260px"><span>Letter expires (optional)</span><input type="date" id="exp" value="${esc(draft.expires_at)}"></label>
      <div class="callout info small">${icon('shield-check')}<span>On submit, Credo records your verified identity, affiliation, a SHA-256 fingerprint of the letter and your signature (simulated). You can revoke the letter later.</span></div>
      <div class="row between"><button class="btn ghost" id="back">${icon('arrow-left')}Back</button><button class="btn accent" id="submit">${icon('pen')}Sign & submit</button></div></div></div>`;
    if (i === 4) body = `<div class="card pad" style="text-align:center;padding:48px 24px"><div class="doc-ico verified" style="margin:0 auto;width:56px;height:56px">${icon('check')}</div>
      <h1 style="margin-top:16px">Recommendation submitted</h1><p class="muted" style="margin-top:8px">${esc(d.applicant.name)} has been notified. Thank you.</p>
      ${draft.hash ? `<div class="small muted" style="margin-top:16px">Integrity fingerprint (SHA-256)<div class="mono" style="margin-top:4px">${esc(draft.hash)}</div></div>` : ''}
      <div class="row" style="justify-content:center;margin-top:24px"><a class="btn" href="#/login">See all your requests (sign in)</a></div></div>`;
    window.scrollTo(0, 0);
    if (!el.querySelector('#invb')) el.innerHTML = page('<div id="invb"></div>');
    el.querySelector('#invb').innerHTML = `<h1 style="margin-bottom:6px">Hello, ${esc(d.recommender_name.split(' ').slice(-2).join(' '))}</h1><p class="muted" style="margin-bottom:24px">No account needed — this secure link is just for this request.</p>${i >= 0 ? stepper(i) : ''}${body}`;
    bind();
  }
  const refresh = (nd) => { d = nd; draw(); };
  function bind() {
    const $ = (s) => el.querySelector(s);
    $('#send')?.addEventListener('click', (e) => busy(e.currentTarget, async () => { const r = await post(base + '/send-code'); code = r.simulated_code; toast('Code sent (simulated)'); draw(); }));
    $('#check')?.addEventListener('click', (e) => busy(e.currentTarget, async () => refresh(await post(base + '/verify-code', { code: $('#code').value }))));
    el.querySelectorAll('[data-am]').forEach((b) => b.addEventListener('click', () => busy(b, async () => refresh(await post(base + '/assurance', { method: b.dataset.am })))));
    $('#accept')?.addEventListener('click', (e) => busy(e.currentTarget, async () => refresh(await post(base + '/respond', { accept: true }))));
    $('#decline')?.addEventListener('click', (e) => busy(e.currentTarget, async () => refresh(await post(base + '/respond', { accept: false }))));
    const keep = () => { if ($('#content')) draft.content = $('#content').value; if ($('#position')) draft.position = $('#position').value; if ($('#relationship')) draft.relationship = $('#relationship').value; };
    const wc = () => { if ($('#wc')) $('#wc').textContent = `${($('#content').value.trim().match(/\S+/g) || []).length} words`; };
    $('#content')?.addEventListener('input', wc); wc();
    el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { keep(); draft.mode = b.dataset.mode; draw(); }));
    el.querySelectorAll('[data-prev]').forEach((b) => b.addEventListener('click', () => { keep(); draft.content = d.previous_letters[+b.dataset.prev].content || ''; draw(); }));
    $('#file')?.addEventListener('change', (e) => { draft.file = e.target.files[0] || null; keep(); draw(); });
    $('#next')?.addEventListener('click', () => {
      keep();
      if (draft.mode === 'write' && draft.content.trim().length < 80) { toast('Please write at least a few sentences.', 'err'); return; }
      if (draft.mode === 'upload' && !draft.file) { toast('Choose a file to upload.', 'err'); return; }
      draft.stage = 'perm'; draw();
    });
    $('#back')?.addEventListener('click', () => { draft.stage = null; draw(); });
    $('#conf')?.addEventListener('change', (e) => { draft.confidential = e.target.checked; });
    el.querySelectorAll('input[name=reuse]').forEach((r) => r.addEventListener('change', () => { draft.reuse_policy = r.value; draw(); }));
    el.querySelectorAll('[data-org]').forEach((c) => c.addEventListener('change', () => { draft.permitted = [...el.querySelectorAll('[data-org]:checked')].map((x) => x.dataset.org); }));
    $('#exp')?.addEventListener('change', (e) => { draft.expires_at = e.target.value; });
    $('#submit')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const body = { confidential: draft.confidential, reuse_policy: draft.reuse_policy, permitted_recipients: draft.permitted, expires_at: draft.expires_at || null,
        relationship: draft.relationship, position: draft.position, title: `Recommendation — ${d.recommender_name}` };
      if (draft.mode === 'upload') Object.assign(body, { data_b64: await fileToB64(draft.file), file_name: draft.file.name, mime: draft.file.type });
      else body.content = draft.content;
      const r = await post(base + '/submit', body);
      draft.hash = r.integrity_hash;
      refresh(await get(base));
    }));
  }
  draw();
}
