# Credo — Verified Universal Application Platform (MVP)

"Credo" is a placeholder product name.

## 1. MVP architecture

```
Browser (ES modules, no build step)          Python 3 stdlib server (server.py)
 ├─ Landing / onboarding                      ├─ REST JSON API (/api/*)
 ├─ Applicant app (dashboard, vault, apps)    ├─ RBAC + resource-level access checks
 ├─ Recommender invite flow (token link)  ──► ├─ Verification service (SHA-256 integrity,
 ├─ Institution / employer portal             │   simulated HMAC issuer signatures, revocation, expiry)
 ├─ Admin console                             ├─ Requirement matcher
 └─ Public package share view                 ├─ Audit log + notifications
                                              └─ SQLite (data/app.db) + file store (data/files)
```

Chosen because the environment has Python but no Node.js. The API boundary is the
same one a Next.js + Supabase build would use, so the frontend can be ported and the
server swapped for Postgres/Supabase without changing the data model.

**Simulated (clearly labelled in the UI):** email delivery (invites show in a "simulated inbox"),
one-time codes, institutional SSO / identity assurance, issuer digital signatures
(HMAC with server-held demo keys, not PKI), institution integrations. All seed data is fictional.

**Real:** SHA-256 integrity hashing and re-checking on every view, revocation/expiry
enforcement, confidential-letter redaction (server-side), consent-based access grants,
share tokens, audit logging, requirement matching.

## 2. Main user journeys

1. Applicant onboarding → profile → add application from program catalog → requirements auto-matched.
2. Applicant requests recommendation → recommender opens token link → verifies code + affiliation + identity assurance → accepts → writes/uploads → sets confidentiality and permitted recipients → submits → signed credential lands in vault.
3. Applicant requests transcript/diploma → registrar issues signed credential → appears in vault.
4. Applicant self-uploads → shown as Unverified → may request issuer verification → issuer confirms (signs) or rejects (Failed).
5. Applicant builds package for an application → selects matched docs → grants access → share link + recipient inbox.
6. Admissions/recruiter reviews package → inspects verification evidence → reads confidential letters (if permitted) → requests more documents / tracks review.
7. Issuer revokes a credential → status flips everywhere, grants show Revoked.
8. Admin verifies organizations, reviews audit log.

## 3. Database model

users, organizations, org_members, credentials, recommendation_requests,
document_requests, programs (requirement templates), applications,
application_requirements, packages, access_grants, audit_logs, notifications, sessions.
See `SCHEMA` in `server.py` for columns and indexes.

## 4. Authentication and authorization

- MVP: demo persona sign-in + self-serve applicant signup; HttpOnly SameSite=Lax session cookie.
- Roles: applicant, recommender, institution_rep, employer_rep, admin.
- Resource checks: subject owns credential; issuer org members manage issued credentials;
  recipient org members see only credentials with an active, unrevoked grant; confidential
  letter bodies are never returned to the subject or on public share links.
- Recommenders need no account: single-use invitation token + step-up verification.
- Production: OIDC/SSO with MFA for issuers, hashed tokens, KMS-backed signing keys
  (W3C VC Data Integrity / Open Badges 3.0), Postgres row-level security, encrypted object storage
  with signed URLs, retention policies and DSAR tooling. GDPR compliance needs legal + technical validation.

## 5. Implementation phases

1. Data model, seed data, verification primitives, API. (done)
2. Applicant experience: dashboard, profile, vault, verification details, requests, applications, packages, settings. (done)
3. Portals: recommender invite flow, institution/employer portal, admin. (done)
4. Next: real email, real IdP/SSO, PKI signatures + VC export conformance, ATS/SIS integrations, Postgres + RLS.
