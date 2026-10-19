// Verification details page + public package share view.
import { get, post, icon, esc, statusBadge, docIcon, fmtDate, fmtDateTime, modal, confirmDialog, toast, on, busy, simTag, sha256Hex, initials, STATUS } from '../ui.js';
import { state } from '../app.js';

const REUSE = { any: 'Reusable for any application the applicant chooses', recipient_specific: 'Only for the recipients named by the issuer' };
const ORG_TYPE = { school: 'School', university: 'University', employer: 'Employer', test_provider: 'Test provider' };

export function renderContent(content) {
  let j = null;
  try { j = JSON.parse(content); } catch { /* plain text */ }
  if (!j || typeof j !== 'object') return `<div class="doc-preview">${esc(content)}</div>`;
  const skip = new Set(['kind', 'courses', 'notice']);
  const human = (k) => ({ gpa: 'GPA' }[k] || k).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return `<div class="doc-preview" style="white-space:normal">
    ${j.notice ? `<div class="sim" style="margin-bottom:12px">${icon('flask')}${esc(j.notice)}</div>` : ''}
    <dl class="kv">${Object.entries(j).filter(([k, v]) => !skip.has(k) && typeof v !== 'object').map(([k, v]) => `<dt>${esc(human(k))}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${Array.isArray(j.courses) ? `<table class="table" style="margin-top:16px;background:#fff;border:1px solid var(--line);border-radius:10px"><thead><tr><th>Course</th><th>Grade</th></tr></thead><tbody>${j.courses.map(([c, g]) => `<tr><td>${esc(c)}</td><td><b>${esc(g)}</b></td></tr>`).join('')}</tbody></table>` : ''}
  </div>`;
}

function checkRow(kind, title, text, sub = '') {
  const ic = { ok: 'check', bad: 'x', na: 'info', warn: 'clock' }[kind];
  return `<div class="vcheck"><div class="vi ${kind}">${icon(ic)}</div><div class="grow"><div class="row between wrap"><b class="small">${title}</b>
    <span class="small" style="font-weight:600;color:${kind === 'ok' ? 'var(--ok)' : kind === 'bad' ? 'var(--bad)' : kind === 'warn' ? 'var(--warn)' : 'var(--muted)'}">${text}</span></div>${sub ? `<div class="xs muted" style="margin-top:3px">${sub}</div>` : ''}</div></div>`;
}

export function evidence(c) {
  const org = c.issuer_org; const iu = c.issuer_user; const self = c.source === 'self';
  const orgOk = org?.verification_status === 'verified';
  const idOk = iu && ['substantial', 'high'].includes(iu.identity_level);
  return [
    checkRow(self ? 'na' : orgOk ? 'ok' : 'warn', 'Issuer verification', self ? 'Not applicable' : orgOk ? 'Verified organization' : 'Issuer not verified',
      self ? 'Uploaded by the applicant. No third party has confirmed it.' + (c.status === 'pending' && org ? ` Verification requested from ${esc(org.name)}.` : '')
        : `${esc(org?.name || c.issuer_name)} · ${esc(ORG_TYPE[org?.type] || '')}${org?.domain ? ' · ' + esc(org.domain) : ''}`),
    checkRow(self ? 'na' : idOk ? 'ok' : 'warn', 'Signer identity', self ? 'Not applicable' : idOk ? 'Verified' : 'Not verified',
      iu ? `${esc(iu.name)} · ${esc(iu.identity_method || 'no method recorded')} <span class="sim" style="margin-left:4px">${icon('flask')}Simulated</span>` : self ? '' : 'Issued by the organization.'),
    checkRow(c.checks.integrity ? 'ok' : 'bad', 'Document integrity', c.checks.integrity ? 'Passed' : 'Failed — content changed',
      `SHA-256 <span class="mono">${esc(c.integrity_hash)}</span>`),
    checkRow(c.checks.signature === null ? 'na' : c.checks.signature ? 'ok' : 'bad', 'Digital signature', c.checks.signature === null ? 'None' : c.checks.signature ? 'Valid' : 'Invalid',
      c.signature_method ? `${esc(c.signature_method)}` : 'Self-uploaded documents are not signed.'),
    checkRow(c.status === 'revoked' || c.status === 'failed' ? 'bad' : c.status === 'expired' ? 'warn' : 'ok', 'Credential status',
      c.status === 'revoked' ? 'Revoked' : c.status === 'expired' ? 'Expired' : c.status === 'failed' ? 'Failed' : 'Active',
      c.revoked_at ? `Revoked ${fmtDate(c.revoked_at)}: ${esc(c.revocation_reason || '')}` : c.expires_at ? `Valid until ${fmtDate(c.expires_at)}` : 'No expiry set'),
    checkRow('na', 'Acceptance by receiving institution', 'Decided by each recipient',
      'Verification proves origin and integrity. It does not mean any institution has accepted this document or waived its requirements.'),
  ].join('');
}

function statusCallout(c) {
  if (c.status === 'revoked') return `<div class="callout bad">${icon('ban')}<span><b>Revoked by the issuer</b> on ${fmtDate(c.revoked_at)}. Reason: ${esc(c.revocation_reason || 'not given')}. It can no longer be shared.</span></div>`;
  if (c.status === 'failed') return `<div class="callout bad">${icon('shield-x')}<span><b>Verification failed.</b> ${c.checks.integrity ? esc(c.verification_method || 'The issuer could not confirm this document.') : 'The stored content no longer matches the fingerprint recorded at issuance. Treat this document as untrusted.'}</span></div>`;
  if (c.status === 'expired') return `<div class="callout warn">${icon('calendar')}<span><b>Expired</b> on ${fmtDate(c.expires_at)}. Request a current version from the issuer.</span></div>`;
  if (c.status === 'pending') return `<div class="callout warn">${icon('clock')}<span><b>Verification pending.</b> Waiting for ${esc(c.issuer_org?.name || 'the issuer')} to confirm this document.</span></div>`;
  if (c.status === 'self_uploaded') return `<div class="callout">${icon('upload')}<span><b>Self-uploaded / unverified.</b> You uploaded this document. Recipients will see that no third party has confirmed it.</span></div>`;
  return `<div class="callout ok">${icon('shield-check')}<span><b>Verified by issuer.</b> Origin, signer and integrity are authenticated by ${esc(c.issuer_name)}${c.simulated ? ' (simulated demo issuance)' : ''}.</span></div>`;
}

function verifyCopyBox(c) {
  return `<div class="card"><div class="card-h"><h3 class="row">${icon('hash')}Verify a copy</h3></div><div class="card-b stack">
    <p class="small muted">Got this document by email or download? Check it against the fingerprint recorded at issuance. The file never leaves your browser.</p>
    <input type="file" data-verify="${esc(c.integrity_hash)}" aria-label="Choose a file to verify" style="padding:8px;height:auto;border:1px dashed var(--line-2);border-radius:10px;width:100%">
    <div data-verify-out></div></div></div>`;
}
export function bindVerifyCopy(root) {
  root.querySelectorAll('[data-verify]').forEach((inp) => inp.addEventListener('change', async () => {
    const f = inp.files[0]; if (!f) return;
    const h = await sha256Hex(await f.arrayBuffer());
    const out = inp.parentElement.querySelector('[data-verify-out]');
    out.innerHTML = h === inp.dataset.verify
      ? `<div class="callout ok small">${icon('check-circle')}<span><b>Match.</b> This file is identical to the issued document.</span></div>`
      : `<div class="callout bad small">${icon('x-circle')}<span><b>No match.</b> This file differs from the issued document.<br><span class="mono">${h}</span></span></div>`;
  }));
}

export async function detail({ el, params, rerender }) {
  const c = await get('/api/credentials/' + params.id);
  const role = state.session.user.role;
  const isSubject = c.access_reason === 'subject';
  const back = role === 'applicant' ? '<a href="#/vault">Document Vault</a>' : role === 'admin' ? '<a href="#/admin">Admin</a>' : role === 'recommender' ? '<a href="#/recommender">My Requests</a>' : '<a href="#/org">Portal</a>';
  const orgs = isSubject && c.source === 'self' && c.status === 'self_uploaded' ? (await get('/api/orgs')).orgs.filter((o) => o.verification_status === 'verified') : [];
  el.innerHTML = `<div class="crumbs">${back} / Verification details</div>
  <div class="page-h"><div class="row">${docIcon(c.type, c.status)}<div><h1>${esc(c.title)}</h1><div class="row wrap" style="margin-top:6px;gap:8px">${statusBadge(c.status)}<span class="badge b-plain">${esc(c.type_label)}</span>${c.confidential ? `<span class="badge b-plain">${icon('lock')}Confidential</span>` : ''}${c.simulated ? simTag('Demo credential') : ''}</div></div></div>
    <div class="row wrap">${c.can_view_content ? `<a class="btn" href="/api/credentials/${c.id}/download" download>${icon('download')}Download</a>` : ''}<button class="btn" id="vc">${icon('globe')}VC export</button><button class="btn primary" id="recheck">${icon('refresh')}Re-run checks</button></div></div>
  <div style="margin-bottom:16px">${statusCallout(c)}</div>
  <div class="grid g3">
    <div class="span2 stack">
      <div class="card"><div class="card-h"><h2>Verification evidence</h2><span class="xs muted">Checked ${fmtDateTime(new Date().toISOString())}</span></div>${evidence(c)}</div>
      <div class="card"><div class="card-h"><h2>Document</h2>${c.file_name ? `<span class="xs muted">${esc(c.file_name)}</span>` : ''}</div><div class="card-b">
        ${c.can_view_content ? (c.has_file ? `<div class="callout small">${icon('file')}<span>File document — download to view. Fingerprint shown above.</span></div>` : renderContent(c.content || ''))
          : `<div class="sealed">${icon('lock')}<h3 style="margin-top:10px">Sealed confidential letter</h3><p class="small" style="margin-top:6px">${isSubject ? 'You waived the right to read this letter. You can see that it was submitted and verified, and share it with permitted recipients.' : 'Only authorized reviewers at permitted recipient organizations can read this letter.'}</p></div>`}</div></div>
      ${isSubject && c.source === 'self' && c.status === 'self_uploaded' ? `<div class="card"><div class="card-h"><h2>Request issuer verification</h2></div><div class="card-b stack">
        <p class="small muted">Ask the organization that originally issued this document to confirm it. If they confirm, it becomes <b>Verified by Issuer</b>; if not, it is marked <b>Verification Failed</b>.</p>
        <div class="row wrap"><select id="vorg" style="max-width:340px">${orgs.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select><button class="btn primary" id="vreq">${icon('send')}Send for verification</button></div></div></div>` : ''}
      ${c.can_view_content ? verifyCopyBox(c) : ''}
    </div>
    <div class="stack">
      <div class="card"><div class="card-h"><h2>Details</h2></div><div class="card-b"><dl class="kv" style="grid-template-columns:120px minmax(0,1fr)">
        <dt>Issued by</dt><dd>${esc(c.issuer_name || '—')}</dd>
        <dt>Issuer status</dt><dd>${c.source === 'self' ? 'Self-uploaded' : c.issuer_org?.verification_status === 'verified' ? 'Verified institution' : esc(c.issuer_org?.verification_status || '—')}</dd>
        ${c.issuer_user ? `<dt>Signed by</dt><dd>${esc(c.issuer_user.name)}</dd>` : ''}
        <dt>Issued on</dt><dd>${fmtDate(c.issued_at)}</dd><dt>Expires</dt><dd>${c.expires_at ? fmtDate(c.expires_at) : 'No expiry'}</dd>
        <dt>Status</dt><dd>${esc(STATUS[c.status]?.label || c.status)}</dd><dt>Method</dt><dd class="small">${esc(c.verification_method || '—')}</dd>
        ${c.subject && !isSubject ? `<dt>Subject</dt><dd>${esc(c.subject.name)}</dd>` : ''}<dt>Credential ID</dt><dd class="mono">${esc(c.id)}</dd></dl></div></div>
      <div class="card"><div class="card-h"><h2>Permitted uses</h2></div><div class="card-b stack small">
        <div>${icon(c.reuse_policy === 'any' ? 'globe' : 'lock')} ${esc(REUSE[c.reuse_policy] || c.reuse_policy)}</div>
        ${c.permitted_orgs?.length ? `<div class="chips">${c.permitted_orgs.map((o) => `<span class="chip">${esc(o)}</span>`).join('')}</div>` : ''}
        ${c.confidential ? '<div class="muted xs">Confidential: content hidden from the applicant and from share links.</div>' : ''}</div></div>
      ${isSubject ? `<div class="card"><div class="card-h"><h2>Who has access</h2><a class="xs" href="#/settings">Manage all</a></div><div class="list">${c.grants.length ? c.grants.map((g) => {
        const live = !g.revoked && g.package_status === 'active' && (!g.expires_at || g.expires_at >= new Date().toISOString().slice(0, 10));
        return `<div class="row between"><div><div class="small" style="font-weight:600">${esc(g.org_name)}</div><div class="xs muted">${esc(g.app_title || '')} · until ${fmtDate(g.expires_at)}</div></div>${live ? `<button class="btn sm danger" data-rv="${g.id}">Revoke</button>` : '<span class="badge b-plain">Ended</span>'}</div>`; }).join('') : '<div class="small muted">Not shared with anyone.</div>'}</div></div>` : ''}
      <div class="card"><div class="card-h"><h2>Audit trail</h2></div><div class="card-b"><ul class="timeline">${c.audit.length ? c.audit.map((a) => `<li><b>${esc(a.actor_label || 'System')}</b> <span class="muted">${esc(a.action.replace(/[._]/g, ' '))}</span><div class="xs faint">${fmtDateTime(a.created_at)}</div></li>`).join('') : '<li class="muted">No events recorded.</li>'}</ul></div></div>
      ${role === 'admin' && !c.has_file ? `<div class="card pad soft stack"><b class="small">Demo: tamper test</b><p class="xs muted">Modify the stored content to show how integrity checking catches it.</p><div class="row"><button class="btn sm danger" data-tamper="0">Tamper</button><button class="btn sm" data-tamper="1">Restore</button></div></div>` : ''}
    </div>
  </div>`;
  el.querySelector('#recheck').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const r = await post(`/api/credentials/${c.id}/verify`);
    toast(`Integrity ${r.integrity ? 'passed' : 'FAILED'} · signature ${r.signature === null ? 'n/a' : r.signature ? 'valid' : 'INVALID'}`, r.integrity && r.signature !== false ? 'ok' : 'err');
    rerender();
  }));
  el.querySelector('#vc').addEventListener('click', async () => {
    const vc = await get(`/api/credentials/${c.id}/vc`);
    modal({ title: 'W3C Verifiable Credential (preview)', wide: true, sub: 'Shape follows the VC Data Model 2.0. The proof is simulated in this MVP.',
      body: `<pre class="doc-preview mono" style="font-size:12px">${esc(JSON.stringify(vc, null, 2))}</pre>` });
  });
  el.querySelector('#vreq')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
    await post(`/api/credentials/${c.id}/request-verification`, { org_id: el.querySelector('#vorg').value });
    toast('Sent to issuer — status is now Verification Pending'); rerender();
  }));
  on(el, '[data-rv]', async (e, b) => { if (await confirmDialog('Revoke access?', 'This organization will lose access to this document immediately.', { okLabel: 'Revoke', danger: true })) { await post(`/api/grants/${b.dataset.rv}/revoke`); toast('Access revoked'); rerender(); } });
  on(el, '[data-tamper]', async (e, b) => { await post(`/api/admin/credentials/${c.id}/tamper`, { restore: b.dataset.tamper === '1' }); toast(b.dataset.tamper === '1' ? 'Restored' : 'Content altered — integrity check will fail'); rerender(); });
  bindVerifyCopy(el);
}

// ---------------------------------------------------------------- public share view
export async function share({ el, params }) {
  let d;
  const top = `<div class="pub-top"><a class="brand" href="#/" style="padding:0"><span class="logo">${icon('check')}</span>Credo</a><span class="badge b-plain">${icon('lock')}Secure application package</span><div class="grow"></div>${simTag('Prototype')}</div>`;
  try { d = await get('/api/share/' + params.token); }
  catch (e) { el.innerHTML = `${top}<div class="pub"><div class="card pad"><div class="empty">${icon('ban')}<h2>Package unavailable</h2><p style="margin-top:8px">${esc(e.message)}</p></div></div></div>`; return; }
  const v = d.credentials.filter((c) => c.status === 'verified').length;
  el.innerHTML = `${top}<div class="pub">
    <div class="card pad"><div class="row wrap" style="gap:16px"><div class="avatar lg">${esc(initials(d.applicant.name))}</div><div class="grow">
      <div class="xs muted">Application package for <b>${esc(d.recipient?.name)}</b> · ${esc(d.application.title || '')}</div>
      <h1 style="margin-top:4px">${esc(d.applicant.name)}</h1><div class="muted">${esc(d.applicant.headline || '')}${d.applicant.location ? ' · ' + esc(d.applicant.location) : ''}</div>
      <div class="row wrap" style="margin-top:8px;gap:8px"><span class="badge ${['substantial', 'high'].includes(d.applicant.identity_level) ? 'b-verified' : 'b-self'}">${icon('fingerprint')}Applicant identity: ${esc(d.applicant.identity_level || 'not verified')}</span>${simTag()}</div></div>
      <div style="text-align:right"><div style="font-size:28px;font-weight:700">${v}/${d.credentials.length}</div><div class="xs muted">verified by issuer</div></div></div>
      ${d.package.message ? `<div class="callout small" style="margin-top:16px">${icon('mail')}<span>“${esc(d.package.message)}”</span></div>` : ''}
      <div class="xs muted" style="margin-top:12px">Shared ${fmtDate(d.package.created_at)} · link expires ${fmtDate(d.package.expires_at)} · every view is logged and visible to the applicant.</div></div>
    <div class="callout info small" style="margin:16px 0">${icon('info')}<span><b>How to read this:</b> “Verified by Issuer” means the document’s origin, signer and integrity were authenticated. It is not an admissions or hiring decision — that remains yours.</span></div>
    <div class="stack">${d.credentials.map((c) => `<div class="card"><div class="card-h"><div class="row grow">${docIcon(c.type, c.status)}<div class="grow"><b>${esc(c.title)}</b><div class="xs muted">${esc(c.type_label)} · ${esc(c.source === 'self' ? 'uploaded by applicant' : 'issued by ' + c.issuer_name)} · ${fmtDate(c.issued_at)}</div></div></div>${statusBadge(c.status)}</div>
      <details><summary class="small" style="padding:12px 20px;cursor:pointer;font-weight:600;color:var(--accent)">Verification evidence</summary>${evidence(c)}</details>
      <div class="card-b" style="border-top:1px solid var(--line)">${c.confidential ? `<div class="sealed" style="padding:18px">${icon('lock')}<p class="small" style="margin-top:6px"><b>Confidential letter.</b> Not available through share links. Authorized reviewers at ${esc(d.recipient?.name)} can read it in the Credo reviewer portal.</p><a class="btn sm" style="margin-top:10px" href="#/login">Reviewer sign-in</a></div>`
        : `${c.has_file ? '' : renderContent(c.content || '')}<div class="row wrap" style="margin-top:12px"><a class="btn sm" href="/api/share/${esc(params.token)}/credentials/${c.id}/download">${icon('download')}Download</a>
          <label class="btn sm ghost" style="cursor:pointer">${icon('hash')}Verify a downloaded copy<input type="file" class="sr-only" data-verify="${esc(c.integrity_hash)}"></label></div><div data-verify-out style="margin-top:8px"></div>`}</div></div>`).join('')}</div>
    <p class="xs muted" style="margin-top:24px;text-align:center">All credentials in this prototype are simulated. Credo does not submit applications on the applicant’s behalf unless the recipient has an integration.</p></div>`;
  el.querySelectorAll('[data-verify]').forEach((inp) => inp.addEventListener('change', async () => {
    const f = inp.files[0]; if (!f) return;
    const h = await sha256Hex(await f.arrayBuffer());
    const out = inp.closest('.card-b').querySelector('[data-verify-out]');
    out.innerHTML = h === inp.dataset.verify ? `<div class="callout ok small">${icon('check-circle')}<span><b>Match.</b> Identical to the issued document.</span></div>` : `<div class="callout bad small">${icon('x-circle')}<span><b>No match.</b> This file differs from the issued document.</span></div>`;
  }));
}
