// Institution / employer portal, package review, recommender dashboard, admin console.
import { get, post, put, icon, esc, statusBadge, docIcon, fmtDate, fmtDateTime, relTime, modal, confirmDialog, toast, on, busy, formData, simTag, initials, DOC_LABEL, reqStatusLabel, REQ_STATE, dueLabel } from '../ui.js';
import { evidence, renderContent, bindVerifyCopy } from './credential.js';
import { state } from '../app.js';

const REVIEW = { received: ['Received', 'b-plain'], in_review: ['In review', 'b-accent'], info_requested: ['Info requested', 'b-pending'], review_complete: ['Review complete', 'b-verified'] };
const reviewBadge = (s) => `<span class="badge ${REVIEW[s]?.[1] || 'b-plain'}">${esc(REVIEW[s]?.[0] || s)}</span>`;
const ISSUE_FIELDS = {
  transcript: [['program', 'Program'], ['period', 'Period (e.g. 2022–2026)'], ['gpa', 'GPA / overall result'], ['courses', 'Courses — one per line as “Course | Grade”', 'textarea']],
  diploma: [['qualification', 'Qualification'], ['graduation_date', 'Graduation date', 'date'], ['honours', 'Honours / distinction']],
  enrollment_cert: [['program', 'Program'], ['enrollment_status', 'Status (e.g. Full-time, enrolled)'], ['start_date', 'Start date', 'date'], ['expected_end', 'Expected completion', 'date']],
  employment_cert: [['role', 'Role / title'], ['start', 'Start date', 'date'], ['end', 'End date', 'date'], ['summary', 'Summary of responsibilities', 'textarea']],
  certificate: [['name', 'Certificate name'], ['result', 'Result / level'], ['date', 'Date awarded', 'date']],
  language_cert: [['level', 'Level (CEFR)'], ['overall', 'Overall score'], ['test_date', 'Test date', 'date']],
};

function issueModal({ type, title = '', subject = null, requestId = null, details = '', orgType, subjectEmail = '' }) {
  const types = orgType === 'employer' ? ['employment_cert', 'certificate'] : orgType === 'test_provider' ? ['language_cert', 'certificate'] : ['transcript', 'diploma', 'enrollment_cert', 'certificate'];
  let t = type || types[0];
  return modal({ title: requestId ? `Issue ${DOC_LABEL[t]}` : 'Issue a credential', wide: true,
    sub: subject ? `To ${esc(subject)}${details ? ` · “${esc(details)}”` : ''}` : 'Issue directly to an applicant’s Credo vault.',
    body: '<div id="ib"></div>',
    foot: `<span class="xs muted grow">Signed with your organization’s key (simulated) and fingerprinted with SHA-256.</span><button class="btn" data-close>Cancel</button><button class="btn accent" id="iss">${icon('award')}Sign & issue</button>`,
    onMount: (box, close) => {
      const drawBody = () => {
        box.querySelector('#ib').innerHTML = `<form id="if" class="stack">
          ${requestId ? '' : `<div class="grid g2"><label class="field"><span>Applicant email</span><input type="email" name="subject_email" required placeholder="alex.morgan@example.com" value="${esc(subjectEmail)}"></label>
            <label class="field"><span>Credential type</span><select name="type" id="ty">${types.map((x) => `<option value="${x}" ${x === t ? 'selected' : ''}>${DOC_LABEL[x]}</option>`).join('')}</select></label></div>`}
          <div class="grid g2"><label class="field"><span>Title shown to recipients</span><input type="text" name="title" value="${esc(title || DOC_LABEL[t])}" required></label>
          <label class="field"><span>Expires (optional)</span><input type="date" name="expires_at"></label></div>
          <div class="grid g2">${(ISSUE_FIELDS[t] || []).map(([k, l, kind]) => kind === 'textarea' ? `<label class="field span2" style="grid-column:1/-1"><span>${l}</span><textarea name="f_${k}"></textarea></label>` : `<label class="field"><span>${l}</span><input type="${kind || 'text'}" name="f_${k}"></label>`).join('')}</div>
          <label class="check small"><input type="checkbox" required id="att"><span>I am authorized to issue this credential and confirm its contents are accurate according to our records.</span></label></form>`;
        box.querySelector('#ty')?.addEventListener('change', (e) => { t = e.target.value; drawBody(); });
      };
      drawBody();
      box.querySelector('#iss').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const f = box.querySelector('#if');
        if (!f.querySelector('#att').checked) { toast('Confirm your authorization first.', 'err'); return; }
        const data = formData(f); const fields = {};
        Object.entries(data).forEach(([k, v]) => { if (k.startsWith('f_') && v) fields[k.slice(2)] = v; });
        if (fields.courses) fields.courses = fields.courses.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((x) => x[0]).map(([c, g = '']) => [c, g]);
        const body = { title: data.title, expires_at: data.expires_at || null, fields, type: t, subject_email: data.subject_email };
        const r = await post(requestId ? `/api/org/requests/${requestId}/issue` : '/api/org/credentials/issue', body);
        toast('Credential issued to the applicant’s vault'); close(r.id);
      }));
    } });
}

export async function portal({ el, query, rerender }) {
  const d = await get('/api/org/overview');
  const tab = query.tab || 'overview';
  const o = d.org; const isEmp = o.type === 'employer';
  const open = d.requests.filter((r) => r.status === 'requested');
  const tabs = [['overview', 'Overview'], ['inbox', isEmp ? 'Applications' : 'Admissions inbox'], ['requests', `Requests${open.length ? ` (${open.length})` : ''}`], ['issued', 'Issued'], ['programs', isEmp ? 'Openings' : 'Programs'], ['team', 'Team']];
  const pkgTable = (list) => list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Applicant</th><th>${isEmp ? 'Opening' : 'Program'}</th><th>Documents</th><th>Received</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map((p) => `<tr><td><div class="row"><div class="avatar" style="width:30px;height:30px;font-size:11px">${esc(initials(p.applicant_name))}</div><div><b>${esc(p.applicant_name)}</b><div class="xs muted">${esc(p.headline || '')}</div></div></div></td>
    <td class="small">${esc(p.app_title || '')}</td><td><span class="badge ${p.verified_count === p.doc_count ? 'b-verified' : 'b-plain'}">${icon('shield-check')}${p.verified_count}/${p.doc_count} verified</span></td>
    <td class="small">${fmtDate(p.created_at)}</td><td>${reviewBadge(p.review_status)}</td><td><a class="btn sm" href="#/org/package/${p.id}">Review ${icon('arrow-right')}</a></td></tr>`).join('')}</tbody></table></div>`
    : `<div class="empty">${icon('inbox')}<p>No application packages yet.</p></div>`;
  const reqList = (list) => list.length ? `<div class="list">${list.map((r) => `<div class="row wrap">${docIcon(r.type === 'verify_upload' ? 'other' : r.type, r.status === 'requested' ? 'pending' : r.status === 'issued' ? 'verified' : 'failed')}
    <div class="grow"><b class="small">${esc(r.type_label)}</b> <span class="small muted">for ${esc(r.applicant_name)}</span><div class="xs muted">${esc(r.details || '')} · ${relTime(r.created_at)}</div>
    ${r.upload ? `<div class="xs muted" style="margin-top:4px">Uploaded file: ${esc(r.upload.title)} · SHA-256 <span class="mono">${esc(r.upload.integrity_hash.slice(0, 20))}…</span></div>` : ''}</div>
    ${r.status === 'requested' ? `<div class="row">${r.type === 'verify_upload' ? `<button class="btn sm" data-preview="${r.id}">${icon('eye')}Inspect</button><button class="btn sm accent" data-issue="${r.id}">${icon('check')}Confirm authentic</button>` : `<button class="btn sm accent" data-issue="${r.id}">${icon('award')}Issue</button>`}<button class="btn sm ghost danger" data-reject="${r.id}">Decline</button></div>`
      : `<span class="badge ${r.status === 'issued' ? 'b-verified' : 'b-plain'}">${esc(reqStatusLabel(r.status))}</span>`}</div>`).join('')}</div>` : `<div class="empty">${icon('send')}<p>No document requests.</p></div>`;
  let body = '';
  if (tab === 'overview') body = `<div class="grid g4">
      <div class="card stat"><div class="k">${icon('inbox')}Packages received</div><div class="v">${d.packages.length}</div><div class="s">${d.packages.filter((p) => p.review_status === 'received').length} not yet reviewed</div></div>
      <div class="card stat"><div class="k">${icon('send')}Open requests</div><div class="v">${open.length}</div><div class="s">documents to issue or verify</div></div>
      <div class="card stat"><div class="k">${icon('award')}Credentials issued</div><div class="v">${d.issued.length}</div><div class="s">${d.issued.filter((c) => c.status === 'revoked').length} revoked</div></div>
      <div class="card stat"><div class="k">${icon('layers')}${isEmp ? 'Openings' : 'Programs'}</div><div class="v">${d.programs.length}</div><div class="s">${d.programs.reduce((n, p) => n + p.applicants, 0)} tracking applicants</div></div></div>
    <div class="grid g2" style="margin-top:16px"><div class="card"><div class="card-h"><h2>Latest packages</h2><a class="small" href="#/org?tab=inbox">All</a></div>${pkgTable(d.packages.slice(0, 4))}</div>
      <div class="card"><div class="card-h"><h2>Open document requests</h2><a class="small" href="#/org?tab=requests">All</a></div>${reqList(open.slice(0, 4))}</div></div>`;
  if (tab === 'inbox') body = `<div class="card">${pkgTable(d.packages)}</div><p class="xs muted" style="margin-top:12px">Packages arrive when an applicant authorizes sharing. Review status is your internal tracking and is visible to the applicant.</p>`;
  if (tab === 'requests') body = `<div class="row between wrap" style="margin-bottom:12px"><p class="muted small">Applicants request official documents here. Issued credentials go straight to their vault.</p><button class="btn primary" id="direct">${icon('plus')}Issue directly</button></div><div class="card">${reqList(d.requests)}</div>`;
  if (tab === 'issued') body = `<div class="card">${d.issued.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Credential</th><th>Holder</th><th>Issued</th><th>Status</th><th></th></tr></thead><tbody>
    ${d.issued.map((c) => `<tr><td><a href="#/credential/${c.id}"><b>${esc(c.title)}</b></a><div class="xs muted">${esc(c.type_label)}</div></td><td>${esc(c.subject_name)}</td><td class="small">${fmtDate(c.issued_at)}</td><td>${statusBadge(c.status, true)}</td>
    <td style="white-space:nowrap">${c.status !== 'revoked' ? `<button class="btn sm" data-correct="${c.id}">Correct</button> <button class="btn sm danger" data-revoke="${c.id}">Revoke</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${icon('award')}<p>Nothing issued yet.</p></div>`}</div>
    <p class="xs muted" style="margin-top:12px">Revocation takes effect immediately everywhere the credential is shared. “Correct” revokes the credential and issues a replacement.</p>`;
  if (tab === 'programs') body = `<div class="stack">${d.programs.length ? d.programs.map((p) => `<div class="card"><div class="card-h"><div><h2>${esc(p.title)}</h2><div class="xs muted">Deadline ${fmtDate(p.deadline)} · ${p.applicants} applicant${p.applicants === 1 ? '' : 's'} tracking</div></div><button class="btn sm" data-edit="${p.id}">${icon('pen')}Edit requirements</button></div>
    <div class="card-b chips">${p.requirements.map((r) => `<span class="badge ${r.min_status === 'verified' ? 'b-verified' : 'b-plain'}">${icon(r.min_status === 'verified' ? 'shield-check' : 'upload')}${esc(r.label)}</span>`).join('')}</div></div>`).join('')
    : `<div class="card"><div class="empty">${icon('layers')}<p>No ${isEmp ? 'openings' : 'programs'} published.</p></div></div>`}</div>
    <p class="xs muted" style="margin-top:12px">Green = issuer verification required. Grey = applicant upload accepted.</p>`;
  if (tab === 'team') body = `<div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Member</th><th>Role</th><th>Identity assurance</th><th>Authorization</th></tr></thead><tbody>
    ${d.members.map((m) => `<tr><td><b>${esc(m.name)}</b><div class="xs muted">${esc(m.email)}</div></td><td>${esc(m.role)}</td><td class="small">${esc(m.identity_level || '—')} · ${esc(m.identity_method || '')}</td><td><span class="badge ${m.authorization_status === 'authorized' ? 'b-verified' : 'b-pending'}">${esc(m.authorization_status)}</span></td></tr>`).join('')}</tbody></table></div></div>
    <div class="callout sim-c small" style="margin-top:12px">${icon('flask')}<span>In production, adding issuers requires SSO + MFA and approval by an organization admin. Member management is read-only in this prototype.</span></div>`;
  el.innerHTML = `<div class="page-h"><div class="row"><div class="avatar org lg" style="width:52px;height:52px;font-size:18px">${esc(initials(o.name))}</div><div><h1>${esc(o.name)}</h1>
    <div class="row wrap" style="margin-top:6px;gap:8px"><span class="badge ${o.verification_status === 'verified' ? 'b-verified' : 'b-pending'}">${icon('shield-check')}${o.verification_status === 'verified' ? 'Verified organization' : 'Verification pending'}</span><span class="badge b-plain">${esc(o.type.replace('_', ' '))}</span>${simTag('Demo account')}</div></div></div></div>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<a role="tab" href="#/org?tab=${k}" aria-selected="${k === tab}">${esc(l)}</a>`).join('')}</div>${body}`;

  on(el, '[data-issue]', async (e, b) => {
    const r = d.requests.find((x) => x.id === b.dataset.issue);
    if (r.type === 'verify_upload') {
      if (await confirmDialog('Confirm this document is authentic?', `You are attesting that “${esc(r.upload?.title)}” (SHA-256 ${esc(r.upload?.integrity_hash.slice(0, 16))}…) matches ${esc(o.name)}’s records. It will be marked Verified by Issuer.`, { okLabel: 'Confirm & sign' })) {
        await busy(b, () => post(`/api/org/requests/${r.id}/issue`, {})); toast('Document verified'); rerender();
      }
      return;
    }
    if (await issueModal({ type: r.type, requestId: r.id, subject: r.applicant_name, details: r.details, orgType: o.type })) rerender();
  });
  on(el, '[data-preview]', (e, b) => { const r = d.requests.find((x) => x.id === b.dataset.preview); modal({ title: r.upload.title, wide: true, body: r.upload.content ? renderContent(r.upload.content) : '<p class="muted">File upload — open from the credential page.</p>' }); });
  on(el, '[data-reject]', async (e, b) => { const r = await confirmDialog('Decline this request?', 'The applicant will be notified with your reason.', { okLabel: 'Decline', danger: true, input: 'Reason' }); if (r) { await post(`/api/org/requests/${b.dataset.reject}/reject`, { reason: r.value }); toast('Request declined'); rerender(); } });
  el.querySelector('#direct')?.addEventListener('click', async () => { if (await issueModal({ orgType: o.type })) rerender(); });
  on(el, '[data-revoke]', async (e, b) => { const r = await confirmDialog('Revoke credential?', 'It will show as Revoked everywhere it has been shared. This cannot be undone.', { okLabel: 'Revoke', danger: true, input: 'Reason (shown to holder and recipients)' }); if (r) { await post(`/api/org/credentials/${b.dataset.revoke}/revoke`, { reason: r.value }); toast('Credential revoked'); rerender(); } });
  on(el, '[data-correct]', async (e, b) => {
    const c = d.issued.find((x) => x.id === b.dataset.correct);
    if (!await confirmDialog('Issue a corrected version?', `“${esc(c.title)}” will be revoked as superseded, then you can issue a replacement to ${esc(c.subject_name)}.`, { okLabel: 'Continue' })) return;
    await post(`/api/org/credentials/${c.id}/revoke`, { reason: 'Superseded by corrected version' });
    await issueModal({ type: c.type, title: c.title, orgType: o.type, subjectEmail: c.subject_email });
    rerender();
  });
  on(el, '[data-edit]', (e, b) => {
    const p = d.programs.find((x) => x.id === b.dataset.edit);
    let reqs = p.requirements.map((r) => ({ ...r }));
    modal({ title: 'Edit requirements', sub: esc(p.title), wide: true, body: '<div id="rq"></div>',
      foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="sv">Save requirements</button>',
      onMount: (box, close) => {
        const draw = () => {
          box.querySelector('#rq').innerHTML = `<div class="stack">${reqs.map((r, i) => `<div class="row wrap" style="gap:8px">
            <select data-k="doc_type" data-i="${i}" style="width:200px">${Object.entries(DOC_LABEL).map(([k, v]) => `<option value="${k}" ${k === r.doc_type ? 'selected' : ''}>${v}</option>`).join('')}</select>
            <input type="text" data-k="label" data-i="${i}" value="${esc(r.label)}" class="grow" style="min-width:160px;width:auto">
            <select data-k="min_status" data-i="${i}" style="width:170px"><option value="verified" ${r.min_status === 'verified' ? 'selected' : ''}>Verified required</option><option value="any" ${r.min_status === 'any' ? 'selected' : ''}>Upload accepted</option></select>
            <button class="btn sm ghost" data-rm="${i}" aria-label="Remove">${icon('trash')}</button></div>`).join('')}
            <button class="btn sm" id="addr" style="align-self:flex-start">${icon('plus')}Add requirement</button></div>`;
          box.querySelectorAll('[data-k]').forEach((x) => x.addEventListener('change', () => { reqs[+x.dataset.i][x.dataset.k] = x.value; }));
          box.querySelectorAll('[data-rm]').forEach((x) => x.addEventListener('click', () => { reqs.splice(+x.dataset.rm, 1); draw(); }));
          box.querySelector('#addr').addEventListener('click', () => { reqs.push({ doc_type: 'other', label: 'New requirement', min_status: 'verified' }); draw(); });
        };
        draw();
        box.querySelector('#sv').addEventListener('click', async () => { const r = await put(`/api/org/programs/${p.id}`, { requirements: reqs }); toast(r.note); close(); rerender(); });
      } });
  });
}

export async function packageReview({ el, params, rerender }) {
  const d = await get('/api/org/packages/' + params.id);
  const a = d.applicant;
  el.innerHTML = `<div class="crumbs"><a href="#/org?tab=inbox">Inbox</a> / ${esc(a.name)}</div>
  <div class="page-h"><div class="row"><div class="avatar lg">${esc(initials(a.name))}</div><div><h1>${esc(a.name)}</h1><p style="margin-top:2px">${esc(d.application?.title || '')} · received ${fmtDate(d.package.created_at)}</p></div></div>
    <div class="row wrap">${reviewBadge(d.package.review_status)}<select id="rs" style="width:auto" aria-label="Review status">${Object.entries(REVIEW).map(([k, [l]]) => `<option value="${k}" ${k === d.package.review_status ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <button class="btn primary" id="more">${icon('mail')}Request documents</button></div></div>
  <div class="grid g3"><div class="span2 stack">
    <div class="card"><div class="card-h"><h2>Requirement coverage</h2><span class="xs muted">Your published requirements vs. this package</span></div>
      ${d.requirements.map((r) => `<div class="req"><div class="st ${r.in_package && r.state === 'complete' ? 'complete' : r.in_package ? 'needs_verification' : 'missing'}">${icon(r.in_package ? (r.state === 'complete' ? 'check' : 'alert') : 'x')}</div>
        <div class="grow"><b class="small">${esc(r.label)}</b><div class="xs muted">${r.in_package ? esc(r.credential.title) : 'Not included in package'}</div></div>${r.in_package ? statusBadge(r.credential.status, true) : '<span class="badge b-failed">Missing</span>'}</div>`).join('')}</div>
    ${d.credentials.map((c) => `<div class="card"><div class="card-h"><div class="row grow">${docIcon(c.type, c.status)}<div class="grow"><b>${esc(c.title)}</b><div class="xs muted">${esc(c.type_label)} · ${esc(c.source === 'self' ? 'uploaded by applicant' : 'issued by ' + c.issuer_name)}</div></div></div>${statusBadge(c.status)}</div>
      <details ${c.status !== 'verified' ? 'open' : ''}><summary class="small" style="padding:12px 20px;cursor:pointer;font-weight:600;color:var(--accent)">Verification evidence</summary>${evidence(c)}</details>
      <div class="card-b" style="border-top:1px solid var(--line)">${!c.grant_active ? `<div class="callout bad small">${icon('ban')}<span>The applicant revoked access to this document.</span></div>`
        : c.can_view_content ? `${c.confidential ? `<div class="callout warn small" style="margin-bottom:12px">${icon('lock')}<span><b>Confidential letter.</b> The applicant has not seen this content. Do not disclose it to them.</span></div>` : ''}${c.has_file ? '' : renderContent(c.content || '')}
          <div class="row" style="margin-top:12px"><a class="btn sm" href="/api/credentials/${c.id}/download">${icon('download')}Download</a><a class="btn sm ghost" href="#/credential/${c.id}">Full verification page</a></div>`
        : `<div class="sealed">${icon('lock')}<p class="small" style="margin-top:6px">The recommender has not permitted your organization to read this letter.</p></div>`}</div></div>`).join('')}
  </div><div class="stack">
    <div class="card"><div class="card-h"><h2>Applicant</h2></div><div class="card-b"><dl class="kv" style="grid-template-columns:110px minmax(0,1fr)"><dt>Email</dt><dd>${esc(a.email)}</dd><dt>Location</dt><dd>${esc(a.location || '—')}</dd>
      <dt>Identity</dt><dd>${esc(a.identity_level || 'not verified')} <span class="xs muted">· ${esc(a.identity_method || '')}</span></dd></dl>${a.summary ? `<p class="small muted" style="margin-top:12px">${esc(a.summary)}</p>` : ''}</div></div>
    ${d.package.message ? `<div class="card pad small"><div class="xs muted">Message from applicant</div>“${esc(d.package.message)}”</div>` : ''}
    <div class="card pad soft small stack"><b>Reviewer reminder</b><p class="muted">Verification confirms origin and integrity only. Admission or hiring decisions, and any equivalence assessment, remain with your team.</p></div>
    <div class="card"><div class="card-h"><h2>Package history</h2></div><div class="card-b"><ul class="timeline">${d.history.map((h) => `<li><b>${esc(h.actor_label || 'System')}</b> <span class="muted">${esc(h.action.replace(/[._]/g, ' '))}</span>${h.detail ? ` — ${esc(h.detail)}` : ''}<div class="xs faint">${fmtDateTime(h.created_at)}</div></li>`).join('')}</ul></div></div>
  </div></div>`;
  el.querySelector('#rs').addEventListener('change', async (e) => { await post(`/api/org/packages/${params.id}/status`, { review_status: e.target.value }); toast('Status updated — visible to applicant'); rerender(); });
  el.querySelector('#more').addEventListener('click', async () => {
    const r = await confirmDialog('Request additional documents', 'The applicant receives an in-app notification (email simulated).', { okLabel: 'Send request', input: 'What do you need?' });
    if (r) { await post(`/api/org/packages/${params.id}/status`, { review_status: 'info_requested', message: r.value }); toast('Request sent to applicant'); rerender(); }
  });
}

export async function recommender({ el, rerender }) {
  const d = await get('/api/recommender/requests');
  const open = d.requests.filter((r) => ['sent', 'opened', 'accepted'].includes(r.status));
  el.innerHTML = `<div class="page-h"><div><h1>Recommendation requests</h1><p>Requests sent to ${esc(state.session.user.email)}. Each opens in a secure, single-purpose link.</p></div></div>
  <div class="grid g3" style="margin-bottom:16px"><div class="card stat"><div class="k">${icon('inbox')}Awaiting you</div><div class="v">${open.length}</div></div>
    <div class="card stat"><div class="k">${icon('pen')}Letters issued</div><div class="v">${d.issued.length}</div></div>
    <div class="card stat"><div class="k">${icon('lock')}Confidential</div><div class="v">${d.issued.filter((c) => c.confidential).length}</div></div></div>
  <div class="card"><div class="card-h"><h2>Requests</h2></div>${d.requests.length ? `<div class="list">${d.requests.map((r) => `<div class="row wrap"><div class="avatar">${esc(initials(r.applicant_name))}</div>
    <div class="grow"><b>${esc(r.applicant_name)}</b><div class="small muted">${esc(r.app_title || 'General recommendation')}${r.deadline ? ` · due ${fmtDate(r.deadline)} (${dueLabel(r.deadline)})` : ''}</div></div>
    <span class="badge ${['sent', 'opened', 'accepted'].includes(r.status) ? 'b-pending' : r.status === 'submitted' ? 'b-verified' : 'b-plain'}">${esc(reqStatusLabel(r.status))}</span>
    ${['sent', 'opened', 'accepted'].includes(r.status) ? `<a class="btn sm accent" href="${esc(r.invite_link)}">Respond ${icon('arrow-right')}</a>` : ''}</div>`).join('')}</div>` : `<div class="empty">${icon('inbox')}<p>No requests yet.</p></div>`}</div>
  <div class="card" style="margin-top:16px"><div class="card-h"><h2>Letters you issued</h2></div>${d.issued.length ? `<div class="list">${d.issued.map((c) => `<div class="row wrap">${docIcon('recommendation', c.revoked_at ? 'revoked' : 'verified')}
    <div class="grow"><a href="#/credential/${c.id}"><b>${esc(c.title)}</b></a><div class="xs muted">${fmtDate(c.issued_at)}${c.confidential ? ' · confidential' : ''}</div></div>
    ${c.revoked_at ? statusBadge('revoked', true) : `<button class="btn sm danger" data-rv="${c.id}">Withdraw</button>`}</div>`).join('')}</div>` : '<div class="empty small">None yet.</div>'}</div>`;
  on(el, '[data-rv]', async (e, b) => { const r = await confirmDialog('Withdraw this letter?', 'It will show as Revoked to the applicant and every recipient.', { okLabel: 'Withdraw', danger: true, input: 'Reason (optional)' }); if (r) { await post(`/api/recommender/credentials/${b.dataset.rv}/revoke`, { reason: r.value }); toast('Letter withdrawn'); rerender(); } });
}

export async function admin({ el, rerender }) {
  const d = await get('/api/admin/overview');
  const c = d.counts;
  el.innerHTML = `<div class="page-h"><div><h1>Admin Console</h1><p>Organization vetting, integrity monitoring and platform audit.</p></div></div>
  <div class="grid g4">${[['users', 'Users', c.users, `${c.applicants} applicants`], ['building', 'Organizations', c.organizations, `${d.orgs.filter((o) => o.verification_status === 'pending').length} awaiting review`],
    ['shield-check', 'Verified credentials', c.verified_credentials, `of ${c.credentials} total`], ['package', 'Active packages', c.packages, `${c.recommendations} recommendation requests`]]
    .map(([i, k, v, s]) => `<div class="card stat"><div class="k">${icon(i)}${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join('')}</div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><div class="card-h"><h2>Organization verification</h2></div><div class="list">${d.orgs.map((o) => `<div class="row wrap"><div class="avatar org">${esc(initials(o.name))}</div>
      <div class="grow"><b>${esc(o.name)}</b><div class="xs muted">${esc(o.type.replace('_', ' '))} · ${esc(o.domain || '')} · ${esc(o.country || '')}</div></div>
      ${o.verification_status === 'pending' ? `<button class="btn sm accent" data-org="${o.id}" data-dec="verified">Approve</button><button class="btn sm danger" data-org="${o.id}" data-dec="rejected">Reject</button>`
        : `<span class="badge ${o.verification_status === 'verified' ? 'b-verified' : 'b-failed'}">${esc(o.verification_status)}</span>`}</div>`).join('')}</div>
      <div class="card-b xs muted" style="border-top:1px solid var(--line)">Production vetting: legal entity registry check, domain control proof, accreditation lookup and signed agreement before issuing rights are granted.</div></div>
    <div class="card"><div class="card-h"><h2>Integrity monitor</h2><span class="xs muted">All stored credentials re-hashed on load</span></div><div class="card-b">
      ${d.integrity_failures.length ? `<div class="stack">${d.integrity_failures.map((f) => `<div class="callout bad small">${icon('shield-x')}<span><a href="#/credential/${f.id}"><b>${esc(f.title)}</b></a> — integrity ${f.integrity ? 'ok' : 'FAILED'}, signature ${f.signature === null ? 'n/a' : f.signature ? 'ok' : 'INVALID'}</span></div>`).join('')}</div>`
        : `<div class="callout ok small">${icon('check-circle')}<span>All ${c.credentials} credentials match their recorded fingerprints and signatures.</span></div>`}
      <p class="xs muted" style="margin-top:12px">Demo: open any credential as admin and use “Tamper” to see detection in action.</p></div></div>
  </div>
  <div class="card" style="margin-top:16px"><div class="card-h"><h2>Platform audit log</h2><span class="xs muted">Latest 60 events</span></div><div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Resource</th><th>Detail</th></tr></thead><tbody>
    ${d.audit.map((e) => `<tr><td class="small" style="white-space:nowrap">${fmtDateTime(e.created_at)}</td><td class="small">${esc(e.actor_label || 'System')}</td><td><span class="kbd">${esc(e.action)}</span></td>
    <td class="small">${e.resource_type === 'credential' && e.resource_id ? `<a href="#/credential/${esc(e.resource_id)}">${esc(e.resource_id)}</a>` : esc(e.resource_type || '')}</td><td class="small muted">${esc(e.detail || '')}</td></tr>`).join('')}</tbody></table></div></div>`;
  on(el, '[data-org]', async (e, b) => { await post(`/api/admin/orgs/${b.dataset.org}/verify`, { decision: b.dataset.dec }); toast('Organization ' + b.dataset.dec); rerender(); });
}
