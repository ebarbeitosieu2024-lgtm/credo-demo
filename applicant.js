// Applicant experience: dashboard, profile, vault, requests, applications, packages, settings.
import {
  get, post, put, del, icon, esc, statusBadge, docIcon, fmtDate, fmtDateTime, dueLabel, daysUntil, relTime, initials,
  modal, confirmDialog, toast, on, busy, formData, copyText, fileToB64, simTag, REQ_STATE, reqStatusLabel, DOC_LABEL,
} from '../ui.js';
import { state, refreshSession } from '../app.js';

const TYPE_LABEL = { university: 'University', graduate: 'Graduate program', internship: 'Internship', job: 'Job', scholarship: 'Scholarship' };
const ACTION_ICONS = { 'Request recommendation': 'pen', 'Request from your school': 'cap', 'Upload document': 'upload' };
const CATS = {
  academic: ['transcript', 'diploma', 'enrollment_cert'],
  recommendations: ['recommendation'],
  professional: ['employment_cert', 'certificate'],
  language: ['language_cert'],
  personal: ['personal_statement', 'cv', 'other'],
};
const CAT_LABEL = { academic: 'Academic records', recommendations: 'Recommendation letters', professional: 'Professional', language: 'Language tests', personal: 'Personal documents' };
const catOf = (t) => Object.keys(CATS).find((k) => CATS[k].includes(t)) || 'personal';

function appStatus(a) {
  if (a.package) return '<span class="badge b-accent">' + icon('send') + 'Shared</span>';
  if (a.ready) return '<span class="badge b-verified">' + icon('check') + 'Ready to share</span>';
  return '<span class="badge b-plain">In progress</span>';
}
function deadlineChip(d) {
  const n = daysUntil(d);
  const cls = n !== null && n <= 14 ? 'b-pending' : 'b-plain';
  return `<span class="badge ${cls}">${icon('calendar')}${fmtDate(d)} · ${dueLabel(d)}</span>`;
}
const orgAvatar = (name) => `<div class="avatar org">${esc(initials(name))}</div>`;

// ---------------------------------------------------------------- dashboard
export async function dashboard({ el }) {
  const d = await get('/api/me/dashboard');
  const u = state.session.user;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const nextApp = d.applications.find((a) => a.next_step && ['missing', 'needs_verification'].includes(a.next_step.state));
  const ns = nextApp?.next_step;
  el.innerHTML = `
  <div class="page-h"><div><h1>${greet}, ${esc(u.name.split(' ')[0])}</h1><p>Here’s where your applications stand today.</p></div>
    <div class="row wrap"><a class="btn" href="#/vault">${icon('upload')}Upload</a><a class="btn primary" href="#/request?type=recommendation">${icon('pen')}Request recommendation</a></div></div>
  ${ns ? `<div class="card pad" style="margin-bottom:16px;border-color:#c7d2fe;background:linear-gradient(90deg,#f5f6ff,#fff)">
    <div class="row wrap"><div class="doc-ico" style="background:var(--accent);color:#fff">${icon('sparkles')}</div>
    <div class="grow"><div class="xs" style="color:var(--accent-ink);font-weight:650;text-transform:uppercase;letter-spacing:.05em">Suggested next step</div>
    <div style="font-weight:600">${esc(nextApp.org.name)} needs: ${esc(ns.label)}</div><div class="small muted">${esc(nextApp.title)} · ${dueLabel(nextApp.deadline)}</div></div>
    ${ns.action?.link ? `<a class="btn accent" href="${esc(ns.action.link)}">${esc(ns.action.label)} ${icon('arrow-right')}</a>` : `<a class="btn" href="#/applications/${nextApp.id}">Review</a>`}</div></div>` : ''}
  <div class="grid g4">
    <div class="card stat"><div class="row"><div class="ring" style="--p:${d.profile_completion}"><b>${d.profile_completion}%</b></div><div><div class="k">Profile completion</div><a class="small" href="#/profile">Complete profile</a></div></div></div>
    <div class="card stat"><div class="k">${icon('shield-check')}Verified credentials</div><div class="v">${d.verified_count}</div><div class="s">of ${d.credential_count} documents in your vault</div></div>
    <div class="card stat"><div class="k">${icon('briefcase')}Active applications</div><div class="v">${d.applications.length}</div><div class="s">${d.applications.filter((a) => a.ready).length} ready · ${d.applications.filter((a) => a.package).length} shared</div></div>
    <div class="card stat"><div class="k">${icon('clock')}Pending requests</div><div class="v">${d.pending_recommendations + d.pending_documents}</div><div class="s">${d.pending_recommendations} recommendation · ${d.pending_documents} document</div></div>
  </div>
  <div class="grid g3" style="margin-top:16px">
    <div class="card span2"><div class="card-h"><h2>Applications</h2><a class="small" href="#/applications">View all</a></div>
      <div class="list">${d.applications.length ? d.applications.map((a) => `<a class="list-item" href="#/applications/${a.id}">
        <div class="row">${orgAvatar(a.org.name)}<div class="grow"><div class="row between wrap"><b class="title-line">${esc(a.org.name)}</b>${appStatus(a)}</div>
        <div class="small muted title-line">${esc(a.title)}</div>
        <div class="row" style="margin-top:8px"><div class="bar grow ${a.ready ? 'ok' : ''}"><i style="width:${a.progress}%"></i></div><span class="xs muted" style="min-width:86px;text-align:right">${a.done}/${a.total} requirements</span></div>
        <div class="xs muted" style="margin-top:6px">${a.missing ? `<span style="color:var(--bad);font-weight:600">${a.missing} missing</span> · ` : ''}${a.pending ? `${a.pending} pending · ` : ''}Due ${fmtDate(a.deadline)} (${dueLabel(a.deadline)})</div></div></div></a>`).join('')
        : `<div class="empty">${icon('briefcase')}<p>No applications yet.</p><a class="btn" href="#/applications" style="margin-top:12px">Add an application</a></div>`}</div></div>
    <div class="stack">
      <div class="card"><div class="card-h"><h2>Upcoming deadlines</h2></div><div class="list">${d.deadlines.length ? d.deadlines.map((x) => `<a class="list-item" href="${esc(x.link)}">
        <div class="row"><div style="text-align:center;min-width:44px"><div class="xs muted">${fmtDate(x.date, { month: 'short' })}</div><div style="font-size:20px;font-weight:700;line-height:1">${fmtDate(x.date, { day: 'numeric' })}</div></div>
        <div class="grow"><div class="small title-line" style="font-weight:600">${esc(x.label)}</div><div class="xs muted">${esc(x.org || '')} · ${dueLabel(x.date)}</div></div></div></a>`).join('') : '<div class="empty small">No upcoming deadlines.</div>'}</div></div>
      <div class="card"><div class="card-h"><h2>Quick actions</h2></div><div class="card-b grid g2" style="gap:8px">
        ${[['#/request?type=recommendation', 'pen', 'Recommendation'], ['#/request?type=transcript', 'cap', 'Transcript'], ['#/vault?upload=other', 'upload', 'Upload document'], ['#/applications', 'plus', 'Add application'], ['#/packages', 'package', 'Packages'], ['#/settings', 'lock', 'Privacy']].map(([h, i, t]) => `<a class="btn sm" style="justify-content:flex-start" href="${h}">${icon(i)}${t}</a>`).join('')}
      </div></div>
    </div>
  </div>
  <div class="card" style="margin-top:16px"><div class="card-h"><h2>Recent activity</h2><a class="small" href="#/settings?s=audit">Full audit log</a></div>
    <div class="card-b"><ul class="timeline">${d.activity.map((a) => `<li><b>${esc(a.actor_label || 'System')}</b> <span class="muted">${esc(a.action.replace(/[._]/g, ' '))}</span>${a.detail ? ` — ${esc(a.detail)}` : ''}<div class="xs faint">${fmtDateTime(a.created_at)}</div></li>`).join('') || '<li class="muted">No activity yet.</li>'}</ul></div></div>`;
}

// ---------------------------------------------------------------- profile
export async function profile({ el, rerender }) {
  const p = await get('/api/me/profile');
  const pr = p.profile || {};
  const credFor = (entry) => entry.credential_type && p.credentials.find((c) => c.type === entry.credential_type && c.issuer_org?.id === entry.org_id);
  const vbadge = (entry) => {
    const c = credFor(entry);
    return c ? `<a href="#/credential/${c.id}" title="View verification details">${statusBadge(c.status, true)}</a>` : '<span class="badge b-self">Self-reported</span>';
  };
  const idOk = ['substantial', 'high'].includes(p.identity_level);
  el.innerHTML = `
  <div class="page-h"><div><h1>My Profile</h1><p>What recipients see when you share. Verified items link to their evidence.</p></div><button class="btn" id="edit">${icon('pen')}Edit profile</button></div>
  <div class="card pad"><div class="row wrap" style="gap:18px"><div class="avatar lg">${esc(initials(p.name))}</div>
    <div class="grow"><div class="row wrap"><h1 style="font-size:24px">${esc(p.name)}</h1>
      <span class="badge ${idOk ? 'b-verified' : 'b-self'}">${icon(idOk ? 'fingerprint' : 'user')}${idOk ? 'Identity verified' : 'Identity not verified'}</span>${idOk ? simTag() : ''}</div>
      <div class="muted">${esc(p.headline || 'Add a headline')}</div>
      <div class="row wrap small muted" style="margin-top:6px"><span class="row" style="gap:6px">${icon('globe')}${esc(p.location || '—')}</span><span class="row" style="gap:6px">${icon('mail')}${esc(p.email)}</span></div></div>
    <div style="text-align:right"><div class="xs muted">Verified credentials</div><div style="font-size:28px;font-weight:700">${p.credentials.filter((c) => c.status === 'verified').length}</div></div></div>
    ${p.summary ? `<p style="margin-top:16px">${esc(p.summary)}</p>` : ''}
    <div class="xs muted" style="margin-top:12px">Identity method: ${esc(p.identity_method || 'none')}</div></div>
  <div class="grid g3" style="margin-top:16px">
    <div class="span2 stack">
      <div class="card"><div class="card-h"><h2 class="row">${icon('cap')}Academic background</h2><button class="btn sm" data-add="education">${icon('plus')}Add</button></div><div class="list">
        ${(pr.education || []).map((e, i) => `<div><div class="row between wrap"><div><b>${esc(e.institution)}</b><div class="small">${esc(e.degree)}${e.field ? ' · ' + esc(e.field) : ''}</div></div>${vbadge(e)}</div>
          <div class="xs muted" style="margin-top:4px">${esc(e.start || '')} – ${esc(e.end || 'present')}${e.result ? ' · ' + esc(e.result) : ''}</div>
          ${(e.achievements || []).length ? `<ul class="small" style="margin:8px 0 0;padding-left:18px">${e.achievements.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
          <button class="link-btn xs" data-del="education" data-i="${i}" style="margin-top:6px">Remove</button></div>`).join('') || '<div class="muted small">No education added.</div>'}</div></div>
      <div class="card"><div class="card-h"><h2 class="row">${icon('briefcase')}Professional background</h2><button class="btn sm" data-add="experience">${icon('plus')}Add</button></div><div class="list">
        ${(pr.experience || []).map((e, i) => `<div><div class="row between wrap"><div><b>${esc(e.title)}</b><div class="small">${esc(e.organization)}${e.type ? ' · ' + esc(e.type) : ''}</div></div>${vbadge(e)}</div>
          <div class="xs muted" style="margin-top:4px">${esc(e.start || '')} – ${esc(e.end || 'present')}</div>${e.description ? `<p class="small" style="margin-top:6px">${esc(e.description)}</p>` : ''}
          <button class="link-btn xs" data-del="experience" data-i="${i}" style="margin-top:6px">Remove</button></div>`).join('') || '<div class="muted small">No experience added.</div>'}</div></div>
      ${(pr.projects || []).length ? `<div class="card"><div class="card-h"><h2>Projects</h2></div><div class="list">${pr.projects.map((x) => `<div><b>${esc(x.name)}</b><p class="small muted">${esc(x.description)}</p></div>`).join('')}</div></div>` : ''}
    </div>
    <div class="stack">
      <div class="card"><div class="card-h"><h2>Languages</h2></div><div class="card-b chips">${(p.languages || []).map((l) => `<span class="chip">${esc(l.language)} · ${esc(l.level)}</span>`).join('') || '<span class="muted small">None added</span>'}</div></div>
      <div class="card"><div class="card-h"><h2>Skills</h2></div><div class="card-b chips">${(pr.skills || []).map((s) => `<span class="chip">${esc(s)}</span>`).join('') || '<span class="muted small">None added</span>'}</div></div>
      <div class="card"><div class="card-h"><h2>Credentials on file</h2><a class="small" href="#/vault">Vault</a></div><div class="list">${p.credentials.map((c) => `<a class="list-item" href="#/credential/${c.id}"><div class="small title-line" style="font-weight:600">${esc(c.title)}</div><div style="margin-top:4px">${statusBadge(c.status, true)}</div></a>`).join('')}</div></div>
    </div>
  </div>`;
  const save = async (patch) => { await put('/api/me/profile', patch); toast('Profile saved'); rerender(); };
  el.querySelector('#edit').addEventListener('click', () => modal({
    title: 'Edit profile', wide: true,
    body: `<form id="pf" class="stack"><div class="grid g2"><label class="field"><span>Full name</span><input type="text" name="name" value="${esc(p.name)}"></label>
      <label class="field"><span>Location</span><input type="text" name="location" value="${esc(p.location || '')}"></label></div>
      <label class="field"><span>Headline</span><input type="text" name="headline" value="${esc(p.headline || '')}"></label>
      <label class="field"><span>Professional summary</span><textarea name="summary">${esc(p.summary || '')}</textarea></label>
      <div class="grid g2"><label class="field"><span>Phone</span><input type="text" name="phone" value="${esc(p.phone || '')}"></label>
      <label class="field"><span>Skills</span><input type="text" name="skills" value="${esc((pr.skills || []).join(', '))}"><div class="hint">Comma-separated</div></label></div>
      <label class="field"><span>Languages</span><input type="text" name="languages" value="${esc((p.languages || []).map((l) => `${l.language}:${l.level}`).join(', '))}"><div class="hint">e.g. English:C1, Spanish:Native</div></label></form>
      <p class="xs muted" style="margin-top:12px">Profile fields are self-reported. Only documents issued through Credo carry verification.</p>`,
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="sv">Save</button>',
    onMount: (box, close) => box.querySelector('#sv').addEventListener('click', async () => {
      const f = formData(box.querySelector('#pf'));
      close(); await save({ name: f.name, location: f.location, headline: f.headline, summary: f.summary, phone: f.phone,
        languages: f.languages.split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const [language, level = ''] = x.split(':'); return { language: language.trim(), level: level.trim() }; }),
        profile: { ...pr, skills: f.skills.split(',').map((s) => s.trim()).filter(Boolean) } });
    }),
  }));
  on(el, '[data-add]', (e, b) => {
    const kind = b.dataset.add;
    const fields = kind === 'education'
      ? [['institution', 'Institution'], ['degree', 'Degree / qualification'], ['field', 'Field'], ['start', 'Start (YYYY-MM)'], ['end', 'End (YYYY-MM)'], ['result', 'GPA / result']]
      : [['title', 'Role title'], ['organization', 'Organization'], ['type', 'Type (Internship, Job…)'], ['start', 'Start (YYYY-MM)'], ['end', 'End (YYYY-MM)'], ['description', 'Description']];
    modal({ title: kind === 'education' ? 'Add education' : 'Add experience',
      body: `<form id="af" class="grid g2">${fields.map(([k, l]) => `<label class="field"><span>${l}</span><input type="text" name="${k}"></label>`).join('')}</form>
        <div class="callout small" style="margin-top:14px">${icon('info')}<span>This entry will show as <b>Self-reported</b> until the institution or employer issues a matching credential.</span></div>`,
      foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="sv">Add</button>',
      onMount: (box, close) => box.querySelector('#sv').addEventListener('click', async () => {
        const entry = formData(box.querySelector('#af'));
        close(); await save({ profile: { ...pr, [kind]: [...(pr[kind] || []), entry] } });
      }) });
  });
  on(el, '[data-del]', async (e, b) => {
    const kind = b.dataset.del; const list = [...(pr[kind] || [])]; list.splice(+b.dataset.i, 1);
    await save({ profile: { ...pr, [kind]: list } });
  });
}

// ---------------------------------------------------------------- vault
function recRow(r) {
  const open = ['sent', 'opened', 'accepted'].includes(r.status);
  return `<div class="row wrap">${docIcon('recommendation', open ? 'pending' : r.status === 'declined' ? 'failed' : '')}
    <div class="grow"><div class="title-line" style="font-weight:600">Recommendation — ${esc(r.recommender_name)}</div>
    <div class="small muted title-line">${esc(r.org_name || '')}${r.app_title ? ' · for ' + esc(r.app_title) : ''}${r.deadline ? ' · due ' + fmtDate(r.deadline) : ''}</div></div>
    <span class="badge ${open ? 'b-pending' : r.status === 'submitted' ? 'b-verified' : 'b-plain'}">${icon(open ? 'clock' : 'check')}${esc(reqStatusLabel(r.status))}</span>
    ${open ? `<div class="row"><button class="btn sm" data-remind="${r.id}">${icon('mail')}Remind</button>
      <a class="btn sm ghost" href="${esc(r.invite_link)}" title="Demo shortcut: in production this link is emailed only to the recommender">${icon('external')}Open as recommender</a>
      <button class="btn sm ghost" data-cancel="${r.id}" aria-label="Cancel request">${icon('x')}</button></div>` : ''}
    ${r.status === 'submitted' && r.credential_id ? `<a class="btn sm" href="#/credential/${r.credential_id}">View</a>` : ''}</div>`;
}
function docReqRow(d) {
  const open = d.status === 'requested';
  return `<div class="row wrap">${docIcon(d.type === 'verify_upload' ? 'other' : d.type, open ? 'pending' : d.status === 'rejected' ? 'failed' : '')}
    <div class="grow"><div class="title-line" style="font-weight:600">${esc(d.type === 'verify_upload' ? 'Issuer verification of uploaded document' : d.type_label)}</div>
    <div class="small muted title-line">${esc(d.org_name || '')} · requested ${fmtDate(d.created_at)}${d.response_note ? ' · “' + esc(d.response_note) + '”' : ''}</div></div>
    <span class="badge ${open ? 'b-pending' : d.status === 'issued' ? 'b-verified' : 'b-failed'}">${icon(open ? 'clock' : d.status === 'issued' ? 'check' : 'x')}${esc(reqStatusLabel(d.status))}</span>
    ${d.credential_id && d.status === 'issued' ? `<a class="btn sm" href="#/credential/${d.credential_id}">View</a>` : ''}</div>`;
}
export function credRow(c, extra = '') {
  return `<a class="list-item" href="#/credential/${c.id}"><div class="row">${docIcon(c.type, c.status)}
    <div class="grow"><div class="row" style="gap:8px"><span class="title-line" style="font-weight:600">${esc(c.title)}</span>${c.confidential ? `<span class="badge b-plain" title="Confidential">${icon('lock')}Confidential</span>` : ''}</div>
    <div class="small muted title-line">${esc(c.source === 'self' ? 'Uploaded by you' : c.issuer_name || '')} · ${fmtDate(c.issued_at)}${c.expires_at ? ' · expires ' + fmtDate(c.expires_at) : ''}</div></div>
    ${extra}${statusBadge(c.status)}<span class="faint">${icon('chevron-right')}</span></div></a>`;
}

export async function vault({ el, query, rerender }) {
  const d = await get('/api/credentials');
  let cat = 'all', status = 'all', q = '';
  const openRecs = d.recommendations.filter((r) => ['sent', 'opened', 'accepted', 'declined'].includes(r.status));
  const openDocs = d.document_requests.filter((x) => x.status !== 'issued');
  const counts = {};
  d.credentials.forEach((c) => { counts[c.status] = (counts[c.status] || 0) + 1; });
  el.innerHTML = `
  <div class="page-h"><div><h1>Document Vault</h1><p>Every document with its verification status. Click one to inspect evidence and manage access.</p></div>
    <div class="row wrap"><button class="btn" id="up">${icon('upload')}Upload document</button><a class="btn primary" href="#/request">${icon('send')}Request verified document</a></div></div>
  <div class="row wrap" style="margin-bottom:16px">
    <div class="grow" style="min-width:220px;position:relative"><span style="position:absolute;left:12px;top:11px;color:var(--faint)">${icon('search')}</span><input type="search" id="q" placeholder="Search documents, issuers…" style="padding-left:38px" aria-label="Search documents"></div>
    <div class="seg" role="group" aria-label="Category">${[['all', 'All'], ...Object.entries(CAT_LABEL).map(([k, v]) => [k, v.split(' ')[0]])].map(([k, v]) => `<button data-cat="${k}" aria-pressed="${k === 'all'}">${esc(v)}</button>`).join('')}</div>
    <select id="st" style="width:auto" aria-label="Verification status"><option value="all">All statuses</option>${['verified', 'pending', 'self_uploaded', 'expired', 'revoked', 'failed'].map((s) => `<option value="${s}">${esc({ verified: 'Verified by Issuer', pending: 'Verification Pending', self_uploaded: 'Self-Uploaded / Unverified', expired: 'Expired', revoked: 'Revoked', failed: 'Verification Failed' }[s])} (${counts[s] || 0})</option>`).join('')}</select>
  </div>
  ${openRecs.length + openDocs.length ? `<div class="card" style="margin-bottom:16px"><div class="card-h"><h2 class="row">${icon('clock')}In progress</h2><span class="xs muted">Requests waiting on recommenders and issuers</span></div>
    <div class="list">${openRecs.map((r) => `<div>${recRow(r)}</div>`).join('')}${openDocs.map((x) => `<div>${docReqRow(x)}</div>`).join('')}</div></div>` : ''}
  <div id="docs"></div>`;
  const draw = () => {
    const list = d.credentials.filter((c) => (cat === 'all' || catOf(c.type) === cat) && (status === 'all' || c.status === status) &&
      (!q || `${c.title} ${c.issuer_name} ${c.type_label}`.toLowerCase().includes(q)));
    const groups = Object.keys(CAT_LABEL).map((k) => [k, list.filter((c) => catOf(c.type) === k)]).filter(([, l]) => l.length);
    el.querySelector('#docs').innerHTML = groups.length ? groups.map(([k, l]) => `<div class="card" style="margin-bottom:16px"><div class="card-h"><h2>${CAT_LABEL[k]}</h2><span class="xs muted">${l.length}</span></div>
      <div class="list">${l.map((c) => credRow(c)).join('')}</div></div>`).join('') : `<div class="card"><div class="empty">${icon('folder')}<p>No documents match.</p></div></div>`;
  };
  draw();
  el.querySelector('#q').addEventListener('input', (e) => { q = e.target.value.toLowerCase(); draw(); });
  el.querySelector('#st').addEventListener('change', (e) => { status = e.target.value; draw(); });
  on(el, '[data-cat]', (e, b) => { cat = b.dataset.cat; el.querySelectorAll('[data-cat]').forEach((x) => x.setAttribute('aria-pressed', x === b)); draw(); });
  on(el, '[data-remind]', async (e, b) => busy(b, async () => { const r = await post(`/api/recommendations/${b.dataset.remind}/remind`); toast(`Reminder sent to ${r.simulated_email.to} (simulated email)`); }));
  on(el, '[data-cancel]', async (e, b) => { if (await confirmDialog('Cancel this request?', 'The recommender’s link will stop working.', { okLabel: 'Cancel request', danger: true })) { await post(`/api/recommendations/${b.dataset.cancel}/cancel`); toast('Request cancelled'); rerender(); } });
  el.querySelector('#up').addEventListener('click', () => uploadModal(d.doc_types).then((id) => id && (location.hash = '/credential/' + id)));
  if (query.upload) uploadModal(d.doc_types, query.upload).then((id) => id && (location.hash = '/credential/' + id));
}

export function uploadModal(types, preset = 'other') {
  return modal({
    title: 'Upload a document', sub: 'Self-uploaded documents are labelled <b>Self-Uploaded / Unverified</b> until an issuer confirms them.',
    body: `<form id="uf" class="stack">
      <div class="grid g2"><label class="field"><span>Title</span><input type="text" name="title" required placeholder="e.g. Personal Statement"></label>
      <label class="field"><span>Document type</span><select name="type">${Object.entries(types || DOC_LABEL).map(([k, v]) => `<option value="${k}" ${k === preset ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label></div>
      <label class="field"><span>File</span><input type="file" name="file" style="padding:8px;height:auto;border:1px dashed var(--line-2);border-radius:10px;width:100%"><div class="hint">PDF, image or text · max 8 MB. A SHA-256 fingerprint is recorded on upload.</div></label>
      <label class="field"><span>…or paste text</span><textarea name="content" placeholder="Paste the text of your statement or CV"></textarea></label></form>`,
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Upload</button>',
    onMount: (box, close) => box.querySelector('#go').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const f = box.querySelector('#uf');
      const file = f.file.files[0];
      const body = { title: f.title.value.trim(), type: f.type.value };
      if (file) Object.assign(body, { data_b64: await fileToB64(file), file_name: file.name, mime: file.type });
      else body.content = f.content.value;
      const r = await post('/api/credentials/upload', body);
      toast('Uploaded — marked as Self-Uploaded / Unverified');
      close(r.id);
    })),
  });
}

// ---------------------------------------------------------------- request a document
const REQ_TYPES = [
  ['recommendation', 'pen', 'Recommendation letter', 'Invite a professor, teacher or supervisor'],
  ['transcript', 'file-text', 'Academic transcript', 'Official grades from your school or university'],
  ['diploma', 'award', 'Diploma', 'Proof of graduation'],
  ['enrollment_cert', 'cap', 'Enrollment verification', 'Confirms you are currently enrolled'],
  ['employment_cert', 'briefcase', 'Employment verification', 'Confirms a past or current role'],
  ['certificate', 'award', 'Other certificate', 'Courses, awards, language tests'],
];
export async function request({ el, query, go }) {
  const [{ orgs }, { applications }] = await Promise.all([get('/api/orgs'), get('/api/applications')]);
  let type = query.type || '';
  const draw = () => {
    const t = REQ_TYPES.find((x) => x[0] === type);
    const orgFilter = { transcript: ['school', 'university'], diploma: ['school', 'university'], enrollment_cert: ['school', 'university'], employment_cert: ['employer'], recommendation: ['school', 'university', 'employer'], certificate: ['test_provider', 'school', 'university', 'employer'] }[type] || [];
    const orgOpts = orgs.filter((o) => orgFilter.includes(o.type)).map((o) => `<option value="${o.id}">${esc(o.name)}${o.verification_status === 'verified' ? '' : ' (not yet verified)'}</option>`).join('');
    const appOpts = `<option value="">Not linked to a specific application</option>` + applications.map((a) => `<option value="${a.id}" ${query.app === a.id ? 'selected' : ''}>${esc(a.org.name)} — ${esc(a.title)}</option>`).join('');
    el.innerHTML = `<div class="page-h"><div><h1>Request a Document</h1><p>Verified documents come directly from the source — you never handle the original.</p></div></div>
    <div class="grid g3" style="margin-bottom:20px">${REQ_TYPES.map(([k, i, l, d]) => `<button class="choice" data-type="${k}" aria-pressed="${k === type}">${icon(i)}<div><b>${l}</b><div class="small muted">${d}</div></div></button>`).join('')}</div>
    ${!t ? `<div class="card pad soft"><div class="empty" style="padding:20px">${icon('send')}<p>Choose what you need above.</p></div></div>` : type === 'recommendation' ? `
    <div class="grid g3"><form class="card span2" id="rf"><div class="card-h"><h2>Recommendation request</h2>${simTag('Email delivery simulated')}</div><div class="card-b stack">
      <div class="grid g2"><label class="field"><span>Recommender’s name</span><input type="text" name="recommender_name" required placeholder="e.g. Prof. Maria Lopez"></label>
      <label class="field"><span>Institutional email</span><input type="email" name="recommender_email" required placeholder="name@school.edu"><div class="hint">Use their official institutional address.</div></label></div>
      <label class="field"><span>Institution</span><select name="org_id" required>${orgOpts}</select></label>
      <label class="field"><span>Purpose</span><textarea name="purpose" required placeholder="What should the letter focus on? Which program or role?"></textarea></label>
      <div class="grid g2"><label class="field"><span>Application</span><select name="application_id">${appOpts}</select></label>
      <label class="field"><span>Deadline</span><input type="date" name="deadline" required min="${new Date().toISOString().slice(0, 10)}"></label></div>
      <label class="row between" style="padding:14px;border:1px solid var(--line);border-radius:12px;gap:16px"><span><b class="small">Waive my right to read this letter (confidential)</b><div class="xs muted">Many universities require confidential letters. You will see that it arrived and its verification status, not its content.</div></span>
        <span class="toggle"><input type="checkbox" name="confidential" checked><span></span></span></label>
      <div class="row between wrap"><span class="xs muted">The recommender gets a secure single-purpose link. No account required.</span><button class="btn primary">${icon('send')}Send request</button></div></div></form>
      <div class="card pad soft stack"><h3>What happens next</h3><ol class="small muted" style="padding-left:18px;margin:0;display:grid;gap:8px">
        <li>Your recommender receives a secure link.</li><li>They confirm their email, institutional affiliation and identity.</li><li>They accept, then write or upload the letter.</li><li>They choose which organizations may receive it.</li><li>The signed letter appears in your vault.</li></ol></div></div>` : `
    <div class="grid g3"><form class="card span2" id="df"><div class="card-h"><h2>${esc(t[2])} request</h2>${simTag('Demo issuers')}</div><div class="card-b stack">
      <label class="field"><span>Issuing organization</span><select name="org_id" required>${orgOpts}</select><div class="hint">Only verified organizations can issue verified credentials.</div></label>
      <label class="field"><span>Application (optional)</span><select name="application_id">${appOpts}</select></label>
      <label class="field"><span>Details for the issuer</span><textarea name="details" placeholder="Student ID, program, dates attended, role title…"></textarea><div class="hint">Share only what the issuer needs to find your record.</div></label>
      <div class="row" style="justify-content:flex-end"><button class="btn primary">${icon('send')}Send request</button></div></div></form>
      <div class="card pad soft stack"><h3>How issuance works</h3><p class="small muted">An authorized representative of the organization reviews your request, then issues the document directly to your vault with a digital signature and integrity fingerprint.</p>
      <p class="small muted">You can then share it with any application — the recipient sees who issued it and that it hasn’t been altered.</p></div></div>`}`;
    on(el, '[data-type]', (e, b) => { type = b.dataset.type; draw(); });
    el.querySelector('#rf')?.addEventListener('submit', (e) => { e.preventDefault(); busy(e.target.querySelector('.btn.primary'), async () => {
      const f = formData(e.target);
      const r = await post('/api/recommendations', { ...f, confidential: !!e.target.confidential.checked });
      await modal({ title: 'Request sent', body: `<div class="callout sim-c" style="margin-bottom:16px">${icon('flask')}<span>Email is simulated. In production this message goes only to the recommender’s inbox.</span></div>
        <div class="card flat pad soft"><div class="xs muted">To: ${esc(r.simulated_email.to)}</div><div style="font-weight:600;margin-top:4px">${esc(r.simulated_email.subject)}</div><p class="small muted" style="margin-top:6px">${esc(r.simulated_email.body)}</p></div>`,
        foot: `<a class="btn" href="#/vault" data-close>Back to vault</a><a class="btn primary" href="${esc(r.invite_link)}">${icon('external')}Open as recommender (demo)</a>`,
        onMount: (box, close) => box.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => close())) });
    }); });
    el.querySelector('#df')?.addEventListener('submit', (e) => { e.preventDefault(); busy(e.target.querySelector('.btn.primary'), async () => {
      const r = await post('/api/doc-requests', { ...formData(e.target), type });
      toast(r.note || 'Request sent to the issuer');
      go('/vault');
    }); });
  };
  draw();
}

// ---------------------------------------------------------------- applications
export async function applications({ el, rerender, go }) {
  const { applications: apps } = await get('/api/applications');
  el.innerHTML = `<div class="page-h"><div><h1>My Applications</h1><p>Requirements are matched automatically against your vault.</p></div><button class="btn primary" id="add">${icon('plus')}Add application</button></div>
  ${apps.length ? `<div class="grid g2">${apps.map((a) => `<a class="card list-item" href="#/applications/${a.id}" style="padding:20px">
    <div class="row">${orgAvatar(a.org.name)}<div class="grow"><b class="title-line">${esc(a.org.name)}</b><div class="small muted title-line">${esc(a.title)}</div></div>${appStatus(a)}</div>
    <div class="row wrap" style="margin-top:14px;gap:8px"><span class="badge b-plain">${icon(a.type === 'university' || a.type === 'graduate' ? 'cap' : 'briefcase')}${esc(TYPE_LABEL[a.type] || a.type)}</span>${deadlineChip(a.deadline)}</div>
    <div class="row" style="margin-top:14px"><div class="bar grow ${a.ready ? 'ok' : ''}"><i style="width:${a.progress}%"></i></div><b class="small">${a.progress}%</b></div>
    <div class="row wrap small" style="margin-top:10px;gap:14px"><span style="color:var(--ok)">${icon('check')} ${a.done} complete</span>${a.pending ? `<span style="color:var(--warn)">${a.pending} pending</span>` : ''}${a.needs_verification ? `<span class="muted">${a.needs_verification} need verification</span>` : ''}${a.missing ? `<span style="color:var(--bad)">${a.missing} missing</span>` : ''}</div>
    ${a.next_step ? `<div class="xs muted" style="margin-top:10px">Next: <b>${esc(a.next_step.label)}</b> — ${esc(REQ_STATE[a.next_step.state].label.toLowerCase())}</div>` : ''}</a>`).join('')}</div>`
    : `<div class="card"><div class="empty">${icon('briefcase')}<p>You’re not tracking any applications yet.</p></div></div>`}`;
  el.querySelector('#add').addEventListener('click', () => addApplicationModal(apps).then((id) => id && go('/applications/' + id)));
}

async function addApplicationModal(existing) {
  const { programs } = await get('/api/programs');
  const have = new Set(existing.map((a) => a.program_id));
  return modal({ title: 'Add an application', sub: 'Requirements come from the organization’s published list (demo listings).', wide: true,
    body: `<div class="stack">${programs.map((p) => `<button class="choice" data-p="${p.id}" ${have.has(p.id) ? 'disabled style="opacity:.55;cursor:default"' : ''}>${icon(['university', 'graduate'].includes(p.type) ? 'cap' : 'briefcase')}
      <div class="grow"><div class="row between wrap"><b>${esc(p.org_name)}</b><span class="xs muted">${have.has(p.id) ? 'Already tracking' : 'Deadline ' + fmtDate(p.deadline)}</span></div><div class="small">${esc(p.title)}</div>
      <div class="chips" style="margin-top:8px">${p.requirements.map((r) => `<span class="badge b-plain">${esc(r.label)}</span>`).join('')}</div></div></button>`).join('')}</div>`,
    onMount: (box, close) => on(box, '[data-p]:not([disabled])', async (e, b) => { const r = await post('/api/applications', { program_id: b.dataset.p }); toast('Application added — requirements matched'); close(r.id); }) });
}

function reqRow(r) {
  const st = REQ_STATE[r.state];
  let mid = '';
  if (r.credential) mid = `<a href="#/credential/${r.credential.id}" class="small">${esc(r.credential.title)}</a> <span class="xs muted">· ${esc(r.credential.issuer_name || '')}</span>${r.credential.confidential ? ` <span class="xs muted">${icon('lock')}</span>` : ''}`;
  else if (r.pending_request) mid = `<span class="small muted">${r.pending_request.kind === 'recommendation' ? 'Requested from ' : 'Requested from '}<b>${esc(r.pending_request.who || '')}</b> · ${esc(reqStatusLabel(r.pending_request.status))}${r.pending_request.deadline ? ' · due ' + fmtDate(r.pending_request.deadline) : ''}</span>`;
  else mid = '<span class="small muted">No matching document in your vault</span>';
  const badge = r.credential ? statusBadge(r.credential.status, true) : `<span class="badge ${r.state === 'pending' ? 'b-pending' : 'b-failed'}">${st.label}</span>`;
  const act = r.next_action ? (r.next_action.link ? `<a class="btn sm ${r.state === 'missing' ? 'accent' : ''}" href="${esc(r.next_action.link)}">${icon(ACTION_ICONS[r.next_action.label] || 'arrow-right')}${esc(r.next_action.label)}</a>`
    : `<button class="btn sm" data-remind="${r.next_action.rec_id}">${icon('mail')}${esc(r.next_action.label)}</button>`) : '';
  return `<div class="req"><div class="st ${r.state}" title="${st.label}">${icon(st.icon)}</div>
    <div class="grow"><div class="row wrap" style="gap:8px"><b class="small">${esc(r.label)}</b>${r.min_status === 'verified' ? '<span class="xs muted">verified required</span>' : '<span class="xs muted">upload accepted</span>'}</div><div>${mid}</div></div>
    ${badge}<div class="act">${act}</div></div>`;
}

export async function applicationDetail({ el, params, rerender, go }) {
  const a = await get('/api/applications/' + params.id);
  const order = { missing: 0, needs_verification: 1, pending: 2, complete: 3 };
  const actions = a.requirements.filter((r) => r.state !== 'complete').sort((x, y) => order[x.state] - order[y.state]);
  const pk = a.packages.find((p) => p.status === 'active');
  el.innerHTML = `<div class="crumbs"><a href="#/applications">My Applications</a> / ${esc(a.org.name)}</div>
  <div class="page-h"><div class="row">${orgAvatar(a.org.name)}<div><h1>${esc(a.org.name)}</h1><p style="margin-top:2px">${esc(a.title)}</p></div></div>
    <div class="row wrap">${deadlineChip(a.deadline)}${appStatus(a)}</div></div>
  <div class="grid g3">
    <div class="span2 stack">
      <div class="card pad"><div class="row between"><div><div class="small muted">Requirements complete</div><div style="font-size:28px;font-weight:700">${a.done} <span class="muted" style="font-size:18px">/ ${a.total}</span></div></div>
        <div class="row small wrap" style="gap:14px"><span style="color:var(--ok)">${a.done} complete</span><span style="color:var(--warn)">${a.pending} pending</span><span class="muted">${a.needs_verification} unverified</span><span style="color:var(--bad)">${a.missing} missing</span></div></div>
        <div class="bar ${a.ready ? 'ok' : ''}" style="margin-top:12px;height:10px"><i style="width:${a.progress}%"></i></div></div>
      <div class="card"><div class="card-h"><h2>Required documents</h2><span class="xs muted">Matched automatically from your vault</span></div>${a.requirements.map(reqRow).join('')}</div>
      ${a.program?.description ? `<div class="card pad soft small muted">${icon('info')} ${esc(a.program.description)} Requirements shown are demo data defined by the organization.</div>` : ''}
    </div>
    <div class="stack">
      <div class="card"><div class="card-h"><h2>Next actions</h2></div><div class="list">${actions.length ? actions.map((r) => `<div class="small"><div class="row"><div class="st ${r.state}" style="width:22px;height:22px;border-radius:50%;display:grid;place-items:center">${icon(REQ_STATE[r.state].icon)}</div><b>${esc(r.label)}</b></div>
        <div class="muted xs" style="margin:4px 0 0 34px">${r.state === 'missing' ? 'Not in your vault yet.' : r.state === 'pending' ? 'Waiting on ' + esc(r.pending_request?.who || 'issuer') + '.' : 'Self-uploaded — this requirement needs issuer verification.'}</div></div>`).join('')
        : `<div class="small"><div class="callout ok">${icon('check-circle')}<span>All requirements are covered. Build your package.</span></div></div>`}</div></div>
      <div class="card"><div class="card-h"><h2>Application package</h2></div><div class="card-b stack">
        ${pk ? `<div class="callout ok small">${icon('send')}<span>Shared on ${fmtDate(pk.created_at)} · ${JSON.parse(pk.credential_ids).length} documents · ${pk.views} views · expires ${fmtDate(pk.expires_at)}</span></div>
          <div class="small">Recipient status: <b>${esc((pk.review_status || 'received').replace('_', ' '))}</b> <span class="xs muted">(set by ${esc(a.org.name)})</span></div>
          <div class="row wrap"><a class="btn sm" href="#/packages">${icon('link')}Manage link</a><a class="btn sm" href="#/packages/new?app=${a.id}">${icon('refresh')}Update package</a></div>`
        : `<p class="small muted">Bundle the documents this application needs into one secure, revocable package.</p>
          <a class="btn ${a.ready ? 'accent' : 'primary'}" href="#/packages/new?app=${a.id}">${icon('package')}Build package${a.ready ? '' : ' (with gaps)'}</a>`}
        <p class="xs muted">A package shares verified documents. It is not an official submission unless ${esc(a.org.name)} confirms an integration.</p></div></div>
      <button class="btn ghost danger sm" id="rm">${icon('trash')}Stop tracking this application</button>
    </div>
  </div>`;
  on(el, '[data-remind]', (e, b) => busy(b, async () => { const r = await post(`/api/recommendations/${b.dataset.remind}/remind`); toast(`Reminder sent to ${r.simulated_email.to} (simulated)`); }));
  el.querySelector('#rm').addEventListener('click', async () => {
    if (await confirmDialog('Stop tracking?', 'This removes the application from your dashboard and revokes any package shared for it. Your documents stay in your vault.', { okLabel: 'Remove', danger: true })) {
      await del('/api/applications/' + a.id); toast('Application removed'); go('/applications');
    }
  });
}

// ---------------------------------------------------------------- packages
export async function packages({ el, rerender }) {
  const { packages: pk } = await get('/api/packages');
  const live = (p) => p.status === 'active' && p.expires_at >= new Date().toISOString().slice(0, 10);
  el.innerHTML = `<div class="page-h"><div><h1>Shared Packages</h1><p>Every package you’ve shared. Revoke access at any time — recipients lose access immediately.</p></div><a class="btn primary" href="#/applications">${icon('package')}New package</a></div>
  <div class="card">${pk.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Recipient</th><th>Documents</th><th>Shared</th><th>Expires</th><th>Views</th><th>Status</th><th></th></tr></thead><tbody>
    ${pk.map((p) => `<tr><td><b>${esc(p.org_name)}</b><div class="xs muted">${esc(p.app_title || '')}</div></td><td>${p.credential_ids.length}</td><td>${fmtDate(p.created_at)}</td><td>${fmtDate(p.expires_at)}</td><td>${p.views}</td>
    <td>${live(p) ? '<span class="badge b-verified">Active</span>' : `<span class="badge b-plain">${esc(p.status === 'active' ? 'Expired' : p.status === 'superseded' ? 'Replaced' : 'Revoked')}</span>`}${live(p) ? `<div class="xs muted" style="margin-top:4px">Recipient: ${esc((p.review_status || '').replace('_', ' '))}</div>` : ''}</td>
    <td style="white-space:nowrap">${live(p) ? `<button class="btn sm" data-copy="${esc(p.share_link)}" aria-label="Copy link">${icon('copy')}</button> <a class="btn sm" href="${esc(p.share_link)}" target="_blank" rel="noopener" aria-label="Open recipient view">${icon('external')}</a> <button class="btn sm danger" data-revoke="${p.id}">Revoke</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : `<div class="empty">${icon('package')}<p>No packages yet. Open an application to build one.</p></div>`}</div>
  <div class="callout info small" style="margin-top:16px">${icon('info')}<span>Share links are bearer links: anyone with the link can view non-confidential documents until it expires or you revoke it. Confidential letters are only visible to authorized reviewers signed in at the recipient organization.</span></div>`;
  on(el, '[data-copy]', (e, b) => copyText(location.origin + '/' + b.dataset.copy));
  on(el, '[data-revoke]', async (e, b) => { if (await confirmDialog('Revoke this package?', 'The share link stops working and the recipient loses access to every document in it.', { okLabel: 'Revoke access', danger: true })) { await post(`/api/packages/${b.dataset.revoke}/revoke`); toast('Access revoked'); rerender(); } });
}

export async function packageBuilder({ el, query, go }) {
  if (!query.app) { go('/applications'); return; }
  const [a, v, s] = await Promise.all([get('/api/applications/' + query.app), get('/api/credentials'), get('/api/me/settings')]);
  const creds = v.credentials;
  const usable = (c) => !['revoked', 'expired', 'failed'].includes(c.status) && (c.reuse_policy === 'any' || c.permitted_recipients.includes(a.org.id));
  const selected = new Set(a.requirements.filter((r) => r.credential).map((r) => r.credential.id));
  const reqTypes = new Set(a.requirements.map((r) => r.doc_type));
  const draw = () => {
    const sel = creds.filter((c) => selected.has(c.id));
    const missing = a.requirements.filter((r) => r.state === 'missing' || r.state === 'pending');
    const pick = (c) => `<label class="check" style="padding:10px 12px;border:1px solid var(--line);border-radius:10px;align-items:center;${usable(c) ? '' : 'opacity:.55'}">
      <input type="checkbox" data-c="${c.id}" ${selected.has(c.id) ? 'checked' : ''} ${usable(c) ? '' : 'disabled'}>
      <div class="grow"><div class="small" style="font-weight:600">${esc(c.title)} ${c.confidential ? icon('lock') : ''}</div><div class="xs muted">${esc(c.source === 'self' ? 'Uploaded by you' : c.issuer_name)}${usable(c) ? '' : c.reuse_policy !== 'any' && !c.permitted_recipients.includes(a.org.id) ? ' · recommender has not permitted this recipient' : ' · cannot be shared (' + c.status + ')'}</div></div>${statusBadge(c.status, true)}</label>`;
    el.innerHTML = `<div class="crumbs"><a href="#/applications/${a.id}">${esc(a.org.name)}</a> / Package</div>
    <div class="page-h"><div><h1>Application Package</h1><p>For ${esc(a.org.name)} — ${esc(a.title)}</p></div></div>
    <div class="grid g3"><div class="span2 stack">
      <div class="card"><div class="card-h"><h2>1 · Select documents per requirement</h2></div><div class="card-b stack">
        ${[...reqTypes].map((t) => { const rs = a.requirements.filter((r) => r.doc_type === t); const opts = creds.filter((c) => c.type === t); const done = rs.filter((r) => r.state === 'complete').length;
          return `<div><div class="row between"><b class="small">${rs.map((r) => esc(r.label)).join(' · ')}</b><span class="xs" style="color:${done === rs.length ? 'var(--ok)' : 'var(--warn)'}">${done}/${rs.length} matched${rs.length > 1 ? ` · select ${rs.length}` : ''}</span></div>
          <div class="stack" style="margin-top:8px">${opts.length ? opts.map(pick).join('') : `<div class="small muted">Nothing in your vault yet.</div>`}</div></div>`; }).join('<hr class="hr" style="margin:6px 0">')}
        ${creds.filter((c) => !reqTypes.has(c.type)).length ? `<details><summary class="small" style="cursor:pointer;font-weight:600">Optional: add other documents</summary><div class="stack" style="margin-top:10px">${creds.filter((c) => !reqTypes.has(c.type)).map(pick).join('')}</div></details>` : ''}
      </div></div>
      ${missing.length ? `<div class="card"><div class="card-h"><h2>2 · Missing credentials</h2></div><div class="list">${missing.map((r) => `<div class="row between wrap"><span class="small"><b>${esc(r.label)}</b> — ${r.state === 'pending' ? 'requested, waiting' : 'not yet requested'}</span>${r.next_action?.link ? `<a class="btn sm" href="${esc(r.next_action.link)}">${esc(r.next_action.label)}</a>` : ''}</div>`).join('')}</div>
        <div class="card-b xs muted" style="border-top:1px solid var(--line)">You can share now and update the package when these arrive.</div></div>` : ''}
      <div class="card"><div class="card-h"><h2>3 · Preview — what ${esc(a.org.name)} will see</h2></div><div class="list">${sel.length ? sel.map((c) => `<div class="row">${docIcon(c.type, c.status)}<div class="grow"><div class="small" style="font-weight:600">${esc(c.title)}</div>
        <div class="xs muted">${c.confidential ? 'Sealed letter — readable only by authorized reviewers. Not shown to you or on the link.' : esc(c.source === 'self' ? 'Self-uploaded' : 'Issued by ' + c.issuer_name) + ' · SHA-256 ' + esc(c.integrity_hash.slice(0, 16)) + '…'}</div></div>${statusBadge(c.status, true)}</div>`).join('') : '<div class="small muted">No documents selected.</div>'}</div></div>
    </div>
    <div class="stack"><div class="card" style="position:sticky;top:76px"><div class="card-h"><h2>4 · Authorize sharing</h2></div><div class="card-b stack">
      <div class="row between small"><span class="muted">Documents</span><b>${sel.length}</b></div>
      <div class="row between small"><span class="muted">Verified by issuer</span><b>${sel.filter((c) => c.status === 'verified').length}</b></div>
      <div class="row between small"><span class="muted">Confidential (sealed)</span><b>${sel.filter((c) => c.confidential).length}</b></div>
      <label class="field"><span>Access expires after</span><select id="exp">${[7, 14, 30, 60, 90].map((d) => `<option value="${d}" ${d === (s.settings.default_share_days || 30) ? 'selected' : ''}>${d} days</option>`).join('')}</select></label>
      <label class="field"><span>Message to reviewer (optional)</span><textarea id="msg" style="min-height:70px"></textarea></label>
      <label class="check small"><input type="checkbox" id="consent"><span>I authorize Credo to share these ${sel.length} documents with <b>${esc(a.org.name)}</b> for this application. I can revoke access at any time.</span></label>
      <button class="btn accent" id="gen" ${sel.length ? '' : 'disabled'}>${icon('link')}Generate secure package</button>
      <p class="xs muted">Creates a revocable share link and delivers the package to ${esc(a.org.name)}’s demo reviewer inbox. Not an official submission.</p></div></div></div></div>`;
    el.querySelectorAll('[data-c]').forEach((cb) => cb.addEventListener('change', () => { cb.checked ? selected.add(cb.dataset.c) : selected.delete(cb.dataset.c); draw(); }));
    el.querySelector('#gen').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const r = await post('/api/packages', { application_id: a.id, credential_ids: [...selected], consent: el.querySelector('#consent').checked, expires_days: +el.querySelector('#exp').value, message: el.querySelector('#msg').value });
      const url = location.origin + '/' + r.share_link;
      await modal({ title: 'Package ready', sub: `Shared with ${esc(a.org.name)}.`,
        body: `<label class="field"><span>Secure share link</span><div class="row"><input type="text" readonly value="${esc(url)}" id="lnk"><button class="btn" id="cp">${icon('copy')}</button></div></label>
          <p class="xs muted" style="margin-top:10px">Anyone with this link can view the non-confidential documents until it expires. Revoke it from Shared Packages.</p>`,
        foot: `<a class="btn" href="#/packages" data-close>Manage packages</a><a class="btn primary" href="${esc(r.share_link)}" target="_blank" rel="noopener">${icon('external')}Open recipient view</a>`,
        onMount: (box) => box.querySelector('#cp').addEventListener('click', () => copyText(url)) });
      go('/applications/' + a.id);
    }));
  };
  draw();
}

// ---------------------------------------------------------------- settings & privacy
export async function settings({ el, rerender, query }) {
  const isApplicant = state.session.user.role === 'applicant';
  const [s, g, au] = await Promise.all([get('/api/me/settings'), isApplicant ? get('/api/grants') : { grants: [] }, get('/api/audit')]);
  const st = s.settings;
  const tog = (k, label, hint) => `<label class="row between" style="padding:14px 0;border-top:1px solid var(--line);gap:16px"><span><b class="small">${label}</b><div class="xs muted">${hint}</div></span><span class="toggle"><input type="checkbox" data-set="${k}" ${st[k] ? 'checked' : ''}><span></span></span></label>`;
  const active = g.grants.filter((x) => x.active);
  el.innerHTML = `<div class="page-h"><div><h1>Settings & Privacy</h1><p>Control security, consent and who can access your information.</p></div></div>
  <div class="grid g2">
    <div class="card"><div class="card-h"><h2 class="row">${icon('key')}Account security</h2></div><div class="card-b">
      <dl class="kv"><dt>Email</dt><dd>${esc(s.email)}</dd><dt>Identity assurance</dt><dd>${esc(s.identity_level || 'none')} ${simTag()}</dd><dt>Method</dt><dd>${esc(s.identity_method || '—')}</dd></dl>
      <div style="margin-top:8px">${tog('two_factor', 'Two-factor authentication', 'Required for issuers; recommended for applicants (simulated).')}</div>
      ${isApplicant && !['substantial', 'high'].includes(s.identity_level) ? `<div class="callout sim-c small" style="margin-top:8px">${icon('fingerprint')}<span>Identity verification (ID document + liveness) would be offered here via a certified provider. Not connected in this prototype.</span></div>` : ''}
    </div></div>
    <div class="card"><div class="card-h"><h2 class="row">${icon('bell')}Notifications</h2></div><div class="card-b" style="padding-top:6px">
      ${tog('notify_email', 'Email notifications', 'Requests, issued documents and reviewer messages (simulated delivery).')}
      ${tog('notify_deadlines', 'Deadline reminders', '14 and 3 days before each application deadline.')}
    </div></div>
    ${isApplicant ? `<div class="card"><div class="card-h"><h2 class="row">${icon('eye')}Privacy preferences</h2></div><div class="card-b" style="padding-top:6px">
      <label class="row between" style="padding:14px 0;gap:16px"><span><b class="small">Profile visibility</b><div class="xs muted">Private: only organizations you share a package with see your profile.</div></span>
        <select data-sel="profile_visibility" style="width:auto"><option value="private" ${st.profile_visibility === 'private' ? 'selected' : ''}>Private</option><option value="recipients" ${st.profile_visibility === 'recipients' ? 'selected' : ''}>Recipients only</option></select></label>
      <label class="row between" style="padding:14px 0;border-top:1px solid var(--line);gap:16px"><span><b class="small">Default sharing period</b><div class="xs muted">Data minimization: access ends automatically.</div></span>
        <select data-sel="default_share_days" style="width:auto">${[7, 14, 30, 60, 90].map((d) => `<option value="${d}" ${+st.default_share_days === d ? 'selected' : ''}>${d} days</option>`).join('')}</select></label>
      ${tog('allow_reuse_prompts', 'Ask before reusing letters', 'Prompt me when a recommender’s permission is needed for a new recipient.')}
    </div></div>
    <div class="card"><div class="card-h"><h2 class="row">${icon('download')}Your data rights</h2></div><div class="card-b stack">
      <p class="small muted">Download everything Credo holds about you, or ask us to erase your account. Some issuer records may need to be retained where law requires.</p>
      <div class="row wrap"><a class="btn" href="/api/me/export" download>${icon('download')}Export my data (JSON)</a><button class="btn danger" id="delreq">${icon('trash')}Request account deletion</button></div>
      <p class="xs muted">Designed with GDPR principles (access, portability, erasure, minimization). Not legally certified.</p></div></div>
    <div class="card span2" style="grid-column:1/-1"><div class="card-h"><h2 class="row">${icon('shield')}Document access</h2><span class="xs muted">${active.length} active grant${active.length === 1 ? '' : 's'}</span></div>
      ${g.grants.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Document</th><th>Recipient</th><th>Scope</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>
      ${g.grants.map((x) => `<tr><td><a href="#/credential/${x.credential_id}">${esc(x.cred_title)}</a></td><td>${esc(x.org_name)}</td><td class="small">${esc(x.scope.replace('_', ' + '))}</td><td>${fmtDate(x.expires_at)}</td>
        <td>${x.active ? '<span class="badge b-verified">Active</span>' : '<span class="badge b-plain">Ended</span>'}</td><td>${x.active ? `<button class="btn sm danger" data-rv="${x.id}">Revoke</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty small">No organization has access to your documents.</div>'}</div>` : ''}
    <div class="card" id="audit" style="grid-column:1/-1"><div class="card-h"><h2 class="row">${icon('history')}Audit log</h2><span class="xs muted">Every access and change involving your data</span></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead><tbody>
      ${au.events.map((e) => `<tr><td class="small" style="white-space:nowrap">${fmtDateTime(e.created_at)}</td><td class="small">${esc(e.actor_label || 'System')}</td><td><span class="kbd">${esc(e.action)}</span></td><td class="small muted">${esc(e.detail || '')}</td></tr>`).join('')}</tbody></table></div></div>
  </div>`;
  const save = async (patch) => { await put('/api/me/settings', patch); toast('Preference saved'); };
  el.querySelectorAll('[data-set]').forEach((i) => i.addEventListener('change', () => save({ [i.dataset.set]: i.checked })));
  el.querySelectorAll('[data-sel]').forEach((i) => i.addEventListener('change', () => save({ [i.dataset.sel]: i.dataset.sel === 'default_share_days' ? +i.value : i.value })));
  on(el, '[data-rv]', async (e, b) => { if (await confirmDialog('Revoke access?', 'The organization will no longer be able to view this document.', { okLabel: 'Revoke', danger: true })) { await post(`/api/grants/${b.dataset.rv}/revoke`); toast('Access revoked'); rerender(); } });
  el.querySelector('#delreq')?.addEventListener('click', async () => { if (await confirmDialog('Request account deletion?', 'This is simulated in the prototype — it records the request in your audit log only.', { okLabel: 'Record request', danger: true })) { const r = await post('/api/me/delete-request'); toast(r.message); rerender(); } });
  if (query.s === 'audit') el.querySelector('#audit')?.scrollIntoView();
}
