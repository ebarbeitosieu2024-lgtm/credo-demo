#!/usr/bin/env python3
"""Credo MVP server — verified universal application platform.

Python standard library + optional Postgres. Run:  python3 server.py
Set DATABASE_URL to a Postgres connection string to keep data permanently (needed on Render);
without it, data is stored in data/app.db (SQLite).
Then open http://localhost:8787

Real in this MVP: SHA-256 integrity hashing re-checked on every view, revocation and
expiry enforcement, server-side confidential-letter redaction, consent-based access
grants, share tokens, audit logs, requirement matching.
Simulated (and labelled as such): email delivery, one-time codes, SSO / identity
assurance, issuer signatures (HMAC with demo keys, not PKI), institution integrations.
"""
import base64
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import sys
import threading
from datetime import date, datetime, timedelta, timezone
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
FILES_DIR = os.path.join(DATA_DIR, "files")
STATIC_DIR = os.path.join(ROOT, "static")
DB_PATH = os.path.join(DATA_DIR, "app.db")
PORT = int(os.environ.get("PORT", "8787"))
# Hosting services (e.g. Render) set PORT and need the server reachable from outside; locally stay on 127.0.0.1.
HOST = os.environ.get("HOST", "0.0.0.0" if "PORT" in os.environ else "127.0.0.1")
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
DB_LOCK = threading.Lock()

try:  # web files bundled by build_assets.py, used when static/ is not deployed
    from assets import ASSETS
except ImportError:
    ASSETS = {}

DOC_TYPES = {
    "transcript": "Academic transcript",
    "diploma": "Diploma",
    "recommendation": "Recommendation letter",
    "language_cert": "Language certificate",
    "employment_cert": "Employment certificate",
    "enrollment_cert": "Enrollment certificate",
    "personal_statement": "Personal statement",
    "cv": "CV / Resume",
    "certificate": "Certificate",
    "other": "Other document",
}
ISSUER_TYPES = {"transcript", "diploma", "enrollment_cert", "employment_cert", "language_cert", "certificate"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, role TEXT NOT NULL,
  headline TEXT, location TEXT, phone TEXT, summary TEXT, languages TEXT DEFAULT '[]',
  profile TEXT DEFAULT '{}', settings TEXT DEFAULT '{}', identity_level TEXT, identity_method TEXT,
  signing_key TEXT, is_demo INTEGER DEFAULT 0, created_at TEXT, password_hash TEXT);
CREATE TABLE IF NOT EXISTS organizations(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, domain TEXT, country TEXT,
  verification_status TEXT NOT NULL, verified_at TEXT, signing_key TEXT, description TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS org_members(
  user_id TEXT REFERENCES users(id), org_id TEXT REFERENCES organizations(id), role TEXT,
  authorization_status TEXT, PRIMARY KEY(user_id, org_id));
CREATE TABLE IF NOT EXISTS credentials(
  id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL,
  subject_user_id TEXT NOT NULL REFERENCES users(id), issuer_org_id TEXT REFERENCES organizations(id),
  issuer_user_id TEXT REFERENCES users(id), issuer_name TEXT, source TEXT NOT NULL,
  content TEXT, file_path TEXT, file_data TEXT, file_name TEXT, mime TEXT,
  issued_at TEXT, expires_at TEXT, status TEXT NOT NULL, revoked_at TEXT, revocation_reason TEXT,
  integrity_hash TEXT, signature TEXT, sig_key_ref TEXT, signature_method TEXT, verification_method TEXT,
  confidential INTEGER DEFAULT 0, reuse_policy TEXT DEFAULT 'any', permitted_recipients TEXT DEFAULT '[]',
  metadata TEXT DEFAULT '{}', simulated INTEGER DEFAULT 1, created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_cred_subject ON credentials(subject_user_id);
CREATE INDEX IF NOT EXISTS idx_cred_issuer ON credentials(issuer_org_id);
CREATE TABLE IF NOT EXISTS recommendation_requests(
  id TEXT PRIMARY KEY, applicant_id TEXT REFERENCES users(id), recommender_name TEXT, recommender_email TEXT,
  recommender_user_id TEXT, org_id TEXT REFERENCES organizations(id), purpose TEXT, application_id TEXT,
  deadline TEXT, status TEXT, confidential INTEGER DEFAULT 1, token TEXT UNIQUE, verification TEXT DEFAULT '{}',
  decline_reason TEXT, credential_id TEXT, created_at TEXT, updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_rec_applicant ON recommendation_requests(applicant_id);
CREATE INDEX IF NOT EXISTS idx_rec_email ON recommendation_requests(recommender_email);
CREATE TABLE IF NOT EXISTS document_requests(
  id TEXT PRIMARY KEY, applicant_id TEXT REFERENCES users(id), org_id TEXT REFERENCES organizations(id),
  type TEXT, details TEXT, application_id TEXT, credential_id TEXT, status TEXT, response_note TEXT,
  created_at TEXT, updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_docreq_org ON document_requests(org_id);
CREATE TABLE IF NOT EXISTS programs(
  id TEXT PRIMARY KEY, org_id TEXT REFERENCES organizations(id), title TEXT, type TEXT, deadline TEXT,
  description TEXT, requirements TEXT);
CREATE TABLE IF NOT EXISTS applications(
  id TEXT PRIMARY KEY, applicant_id TEXT REFERENCES users(id), org_id TEXT REFERENCES organizations(id),
  program_id TEXT, title TEXT, type TEXT, deadline TEXT, status TEXT, created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_app_applicant ON applications(applicant_id);
CREATE TABLE IF NOT EXISTS application_requirements(
  id TEXT PRIMARY KEY, application_id TEXT REFERENCES applications(id), doc_type TEXT, label TEXT,
  min_status TEXT, position INTEGER, matched_credential_id TEXT);
CREATE INDEX IF NOT EXISTS idx_req_app ON application_requirements(application_id);
CREATE TABLE IF NOT EXISTS packages(
  id TEXT PRIMARY KEY, applicant_id TEXT REFERENCES users(id), application_id TEXT,
  recipient_org_id TEXT REFERENCES organizations(id), credential_ids TEXT, token TEXT UNIQUE, status TEXT,
  review_status TEXT, message TEXT, expires_at TEXT, views INTEGER DEFAULT 0, created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_pkg_recipient ON packages(recipient_org_id);
CREATE TABLE IF NOT EXISTS access_grants(
  id TEXT PRIMARY KEY, credential_id TEXT REFERENCES credentials(id), recipient_org_id TEXT,
  package_id TEXT, scope TEXT, expires_at TEXT, revoked INTEGER DEFAULT 0, created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_grant_cred ON access_grants(credential_id);
CREATE TABLE IF NOT EXISTS audit_logs(
  id TEXT PRIMARY KEY, actor_id TEXT, actor_label TEXT, action TEXT, resource_type TEXT, resource_id TEXT,
  detail TEXT, subject_user_id TEXT, created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_audit_subject ON audit_logs(subject_user_id);
CREATE TABLE IF NOT EXISTS notifications(
  id TEXT PRIMARY KEY, user_id TEXT, title TEXT, body TEXT, link TEXT, read INTEGER DEFAULT 0, created_at TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT, created_at TEXT);
"""


# ---------------------------------------------------------------- helpers

class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def today():
    return date.today().isoformat()


def uid(prefix):
    return prefix + "_" + secrets.token_hex(6)


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
TABLES = ["sessions", "notifications", "audit_logs", "access_grants", "packages", "application_requirements",
          "applications", "programs", "document_requests", "recommendation_requests", "credentials", "org_members",
          "organizations", "users"]


class PgConn:
    """Makes a psycopg connection accept the SQLite-style SQL used in this file (? placeholders)."""

    def __init__(self, raw):
        self.raw = raw

    def execute(self, sql, args=()):
        ignore = "INSERT OR IGNORE" in sql
        sql = sql.replace("INSERT OR IGNORE", "INSERT").replace("?", "%s")
        if ignore:
            sql += " ON CONFLICT DO NOTHING"
        cur = self.raw.cursor()
        cur.execute(sql, tuple(args))
        return cur

    def executescript(self, script):
        for stmt in script.split(";"):
            if stmt.strip():
                self.raw.execute(stmt)

    def commit(self):
        self.raw.commit()

    def rollback(self):
        self.raw.rollback()

    def close(self):
        pass  # one shared connection, reused across requests (requests are serialized by DB_LOCK)


_pg = None


def db():
    global _pg
    if DATABASE_URL:
        import psycopg
        from psycopg.rows import dict_row
        if _pg is None or _pg.raw.closed or _pg.raw.broken:
            _pg = PgConn(psycopg.connect(DATABASE_URL, row_factory=dict_row))
        return _pg
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def hash_password(pw):
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 200000)
    return "pbkdf2_sha256$200000$%s$%s" % (salt.hex(), dk.hex())


def check_password(pw, stored):
    try:
        _, rounds, salt, digest = (stored or "").split("$")
        dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), int(rounds))
        return hmac.compare_digest(dk.hex(), digest)
    except ValueError:
        return False


def one(conn, sql, *args):
    r = conn.execute(sql, args).fetchone()
    return dict(r) if r else None


def many(conn, sql, *args):
    return [dict(r) for r in conn.execute(sql, args).fetchall()]


def jl(s, default=None):
    if s is None or s == "":
        return default
    try:
        return json.loads(s)
    except ValueError:
        return default


def audit(conn, actor, action, rtype, rid, detail="", subject=None):
    conn.execute(
        "INSERT INTO audit_logs VALUES(?,?,?,?,?,?,?,?,?)",
        (uid("evt"), actor["id"] if actor else None,
         (actor or {}).get("name", "System"), action, rtype, rid, detail, subject, now()))


def notify(conn, user_id, title, body, link=""):
    if not user_id:
        return
    conn.execute("INSERT INTO notifications VALUES(?,?,?,?,?,0,?)",
                 (uid("ntf"), user_id, title, body, link, now()))


# ---------------------------------------------------------------- verification primitives

def credential_bytes(row):
    if row.get("file_data"):
        return base64.b64decode(row["file_data"])
    if row.get("file_path"):
        p = os.path.join(FILES_DIR, row["file_path"])
        if not os.path.exists(p):
            return None
        with open(p, "rb") as f:
            return f.read()
    return (row.get("content") or "").encode("utf-8")


def signing_payload(row):
    return "|".join([row["integrity_hash"] or "", row["id"], row["subject_user_id"], row["issued_at"] or ""])


def key_for(conn, ref):
    if not ref:
        return None
    kind, _, rid = ref.partition(":")
    table = "organizations" if kind == "org" else "users"
    r = one(conn, "SELECT signing_key FROM %s WHERE id=?" % table, rid)
    return r["signing_key"] if r else None


def sign_row(conn, row):
    key = key_for(conn, row["sig_key_ref"])
    return hmac.new(key.encode(), signing_payload(row).encode(), hashlib.sha256).hexdigest()


def check_credential(conn, row):
    data = credential_bytes(row)
    integrity = data is not None and sha256_bytes(data) == row["integrity_hash"]
    sig = None
    if row.get("signature"):
        key = key_for(conn, row["sig_key_ref"])
        sig = bool(key) and hmac.compare_digest(
            hmac.new(key.encode(), signing_payload(row).encode(), hashlib.sha256).hexdigest(), row["signature"])
    return integrity, sig


def effective_status(row, integrity, sig):
    if row.get("revoked_at"):
        return "revoked"
    if row["status"] == "failed" or not integrity or sig is False:
        return "failed"
    if row.get("expires_at") and row["expires_at"] < today():
        return "expired"
    return row["status"]


def active_grant(conn, cred_id, org_id):
    return one(conn, """SELECT g.* FROM access_grants g JOIN packages p ON p.id=g.package_id
        WHERE g.credential_id=? AND g.recipient_org_id=? AND g.revoked=0 AND p.status='active'
        AND (g.expires_at IS NULL OR g.expires_at>=?)""", cred_id, org_id, today())


def org_ids_of(conn, user):
    return [r["org_id"] for r in many(conn, "SELECT org_id FROM org_members WHERE user_id=? AND authorization_status='authorized'", user["id"])]


def access_level(conn, row, viewer):
    """Returns (can_see_metadata, can_see_content, reason)."""
    if viewer is None:
        return False, False, "none"
    if viewer["role"] == "admin":
        return True, False, "admin"
    if row["subject_user_id"] == viewer["id"]:
        return True, not row["confidential"], "subject"
    if row.get("issuer_user_id") == viewer["id"]:
        return True, True, "issuer"
    orgs = org_ids_of(conn, viewer)
    if row.get("issuer_org_id") in orgs and row["source"] == "issuer":
        return True, True, "issuer_org"
    for oid in orgs:
        if active_grant(conn, row["id"], oid):
            permitted = jl(row["permitted_recipients"], [])
            ok = not row["confidential"] or row["reuse_policy"] == "any" or oid in permitted
            return True, ok, "recipient"
    return False, False, "none"


def serialize_credential(conn, row, viewer=None, force_content=None, with_checks=True):
    integrity, sig = check_credential(conn, row) if with_checks else (True, None)
    status = effective_status(row, integrity, sig)
    if force_content is None:
        _, can_content, reason = access_level(conn, row, viewer)
    else:
        can_content, reason = force_content, "share"
    org = one(conn, "SELECT id,name,type,verification_status,domain,country FROM organizations WHERE id=?",
              row["issuer_org_id"]) if row.get("issuer_org_id") else None
    issuer_user = one(conn, "SELECT id,name,email,identity_level,identity_method FROM users WHERE id=?",
                      row["issuer_user_id"]) if row.get("issuer_user_id") else None
    out = {k: row[k] for k in ("id", "type", "title", "subject_user_id", "issuer_name", "source", "file_name", "mime",
                               "issued_at", "expires_at", "revoked_at", "revocation_reason", "integrity_hash",
                               "signature", "signature_method", "verification_method", "reuse_policy",
                               "simulated", "created_at")}
    out.update({
        "type_label": DOC_TYPES.get(row["type"], row["type"]),
        "stored_status": row["status"], "status": status,
        "confidential": bool(row["confidential"]),
        "permitted_recipients": jl(row["permitted_recipients"], []),
        "metadata": jl(row["metadata"], {}),
        "issuer_org": org, "issuer_user": issuer_user,
        "checks": {"integrity": integrity, "signature": sig},
        "can_view_content": bool(can_content), "access_reason": reason,
        "has_file": is_file(row),
        "content": row["content"] if (can_content and not is_file(row)) else None,
    })
    return out


def is_file(row):
    return bool(row.get("file_path") or row.get("file_data"))


def store_file(data, file_name):
    os.makedirs(FILES_DIR, exist_ok=True)
    ext = os.path.splitext(file_name or "")[1][:10]
    name = secrets.token_hex(12) + re.sub(r"[^A-Za-z0-9.]", "", ext)
    with open(os.path.join(FILES_DIR, name), "wb") as f:
        f.write(data)
    return name


def create_credential(conn, *, type, title, subject_id, source, status, content=None, file_bytes=None,
                      file_name=None, mime=None, issuer_org_id=None, issuer_user_id=None, issuer_name=None,
                      issued_at=None, expires_at=None, sig_key_ref=None, signature_method=None,
                      verification_method=None, confidential=0, reuse_policy="any", permitted=None,
                      metadata=None, simulated=1):
    cid = uid("cred")
    file_data = base64.b64encode(file_bytes).decode() if file_bytes is not None else None
    data = file_bytes if file_bytes is not None else (content or "").encode("utf-8")
    row = {
        "id": cid, "type": type, "title": title, "subject_user_id": subject_id,
        "issuer_org_id": issuer_org_id, "issuer_user_id": issuer_user_id, "issuer_name": issuer_name,
        "source": source, "content": content if file_bytes is None else None, "file_path": None, "file_data": file_data,
        "file_name": file_name, "mime": mime, "issued_at": issued_at or now(), "expires_at": expires_at,
        "status": status, "revoked_at": None, "revocation_reason": None,
        "integrity_hash": sha256_bytes(data), "signature": None, "sig_key_ref": sig_key_ref,
        "signature_method": signature_method, "verification_method": verification_method,
        "confidential": 1 if confidential else 0, "reuse_policy": reuse_policy,
        "permitted_recipients": json.dumps(permitted or []), "metadata": json.dumps(metadata or {}),
        "simulated": simulated, "created_at": now(),
    }
    if sig_key_ref:
        row["signature"] = sign_row(conn, row)
    cols = list(row.keys())
    conn.execute("INSERT INTO credentials(%s) VALUES(%s)" % (",".join(cols), ",".join("?" * len(cols))),
                 [row[c] for c in cols])
    return row


# ---------------------------------------------------------------- requirement matching

RANK = {"verified": 0, "pending": 1, "self_uploaded": 2}
NEXT_ACTIONS = {
    "recommendation": ("Request recommendation", "#/request?type=recommendation"),
    "transcript": ("Request from your school", "#/request?type=transcript"),
    "diploma": ("Request from your school", "#/request?type=diploma"),
    "enrollment_cert": ("Request enrollment verification", "#/request?type=enrollment_cert"),
    "employment_cert": ("Request employment verification", "#/request?type=employment_cert"),
}


def match_requirements(conn, app):
    reqs = many(conn, "SELECT * FROM application_requirements WHERE application_id=? ORDER BY position", app["id"])
    creds = []
    for r in many(conn, "SELECT * FROM credentials WHERE subject_user_id=?", app["applicant_id"]):
        integ, sig = check_credential(conn, r)
        st = effective_status(r, integ, sig)
        if st in RANK:
            creds.append((r, st))
    recs = many(conn, """SELECT * FROM recommendation_requests WHERE applicant_id=? AND
        status IN ('sent','opened','accepted') AND (application_id=? OR application_id IS NULL)
        ORDER BY created_at""", app["applicant_id"], app["id"])
    docreqs = many(conn, "SELECT * FROM document_requests WHERE applicant_id=? AND status='requested'",
                   app["applicant_id"])
    used, used_req = set(), set()
    out = []
    for q in reqs:
        match, mstatus, pending = None, None, None
        cands = [(r, st) for r, st in creds if r["type"] == q["doc_type"] and r["id"] not in used]
        if q["matched_credential_id"]:
            cands = [c for c in cands if c[0]["id"] == q["matched_credential_id"]] or cands

        def score(c):
            r, st = c
            pr = jl(r["permitted_recipients"], [])
            allowed = r["reuse_policy"] == "any" or app["org_id"] in pr
            return (0 if allowed else 1, RANK[st], -int(re.sub(r"\D", "", r["issued_at"] or "")[:8] or 0))
        cands.sort(key=score)
        if cands:
            match, mstatus = cands[0]
            pr = jl(match["permitted_recipients"], [])
            if match["reuse_policy"] != "any" and app["org_id"] not in pr:
                match, mstatus = None, None
        if match:
            used.add(match["id"])
        else:
            pool = [r for r in recs if r["id"] not in used_req] if q["doc_type"] == "recommendation" else \
                   [d for d in docreqs if d["type"] == q["doc_type"] and d["id"] not in used_req]
            if pool:
                pending = pool[0]
                used_req.add(pending["id"])
        if match and (mstatus == "verified" or q["min_status"] == "any"):
            state = "complete"
        elif match and mstatus == "pending":
            state = "pending"
        elif match:
            state = "needs_verification"
        elif pending:
            state = "pending"
        else:
            state = "missing"
        action = None
        if state == "missing":
            label, link = NEXT_ACTIONS.get(q["doc_type"], ("Upload document", "#/vault?upload=" + q["doc_type"]))
            action = {"label": label, "link": link + ("&app=" + app["id"] if "?" in link else "")}
        elif state == "needs_verification":
            action = {"label": "Request issuer verification", "link": "#/credential/" + match["id"]}
        elif state == "pending" and pending and q["doc_type"] == "recommendation":
            action = {"label": "Send reminder", "rec_id": pending["id"]}
        out.append({
            "id": q["id"], "doc_type": q["doc_type"], "label": q["label"], "min_status": q["min_status"],
            "state": state, "next_action": action,
            "credential": {"id": match["id"], "title": match["title"], "status": mstatus,
                           "issuer_name": match["issuer_name"], "confidential": bool(match["confidential"])} if match else None,
            "pending_request": {"id": pending["id"], "kind": "recommendation" if q["doc_type"] == "recommendation" else "document",
                                "who": pending.get("recommender_name") or org_name(conn, pending.get("org_id")),
                                "status": pending["status"], "deadline": pending.get("deadline")} if pending else None,
        })
    return out


def org_name(conn, oid):
    r = one(conn, "SELECT name FROM organizations WHERE id=?", oid) if oid else None
    return r["name"] if r else None


def app_summary(conn, app, detail=False):
    reqs = match_requirements(conn, app)
    done = sum(1 for r in reqs if r["state"] == "complete")
    org = one(conn, "SELECT id,name,type,verification_status FROM organizations WHERE id=?", app["org_id"])
    pkg = one(conn, "SELECT id,status,created_at,review_status FROM packages WHERE application_id=? AND status='active' ORDER BY created_at DESC", app["id"])
    nxt = next((r for r in reqs if r["state"] in ("missing", "needs_verification")), None) or \
        next((r for r in reqs if r["state"] == "pending"), None)
    s = dict(app)
    s.update({"org": org, "progress": round(100 * done / len(reqs)) if reqs else 0, "done": done,
              "total": len(reqs), "missing": sum(1 for r in reqs if r["state"] == "missing"),
              "pending": sum(1 for r in reqs if r["state"] == "pending"),
              "needs_verification": sum(1 for r in reqs if r["state"] == "needs_verification"),
              "package": pkg, "ready": done == len(reqs) and len(reqs) > 0,
              "next_step": ({"label": nxt["label"], "state": nxt["state"], "action": nxt["next_action"]} if nxt else None)})
    if detail:
        s["requirements"] = reqs
    return s


# ---------------------------------------------------------------- seed data

def seed(conn):
    if one(conn, "SELECT id FROM users LIMIT 1"):
        return
    k = lambda: secrets.token_hex(32)
    orgs = [
        ("org_eis", "Example International School", "school", "example-intl.school", "Spain", "verified",
         "Upper-secondary school (fictional demo issuer)."),
        ("org_ie", "IE University", "university", "ie.edu", "Spain", "verified",
         "Demo admissions account. Not a live integration."),
        ("org_bocconi", "Bocconi University", "university", "unibocconi.it", "Italy", "verified",
         "Demo admissions account. Not a live integration."),
        ("org_northbridge", "Northbridge Consulting", "employer", "northbridge.example", "United Kingdom", "verified",
         "Strategy consultancy (fictional)."),
        ("org_helix", "Helix Technologies", "employer", "helix.example", "Germany", "verified",
         "Technology company (fictional)."),
        ("org_lumen", "Lumen Analytics", "employer", "lumen.example", "Spain", "verified",
         "Data analytics firm (fictional)."),
        ("org_gea", "Global English Assessment", "test_provider", "gea.example", "United Kingdom", "verified",
         "Language test provider (fictional)."),
        ("org_westbrook", "Westbrook Academy", "school", "westbrook.example", "Ireland", "pending",
         "Applied to become a verified issuer."),
    ]
    for o in orgs:
        conn.execute("INSERT INTO organizations VALUES(?,?,?,?,?,?,?,?,?,?)",
                     (o[0], o[1], o[2], o[3], o[4], o[5], "2026-01-10" if o[5] == "verified" else None, k(), o[6], "2026-01-01"))

    alex_profile = {
        "education": [
            {"institution": "Example International School", "org_id": "org_eis", "degree": "Upper Secondary Diploma",
             "field": "Sciences & Economics track", "start": "2022-09", "end": "2026-06", "result": "GPA 3.9 / 4.0",
             "achievements": ["National Mathematics Olympiad — Silver (2025)", "Head of Economics Society"],
             "credential_type": "transcript"},
        ],
        "experience": [
            {"organization": "Lumen Analytics", "org_id": "org_lumen", "title": "Data Analyst Intern", "type": "Internship",
             "start": "2026-07", "end": "2026-08",
             "description": "Built dashboards for retail clients; automated weekly KPI reporting in Python.",
             "credential_type": "employment_cert"},
            {"organization": "Code Club Madrid", "org_id": None, "title": "Volunteer Mentor", "type": "Volunteering",
             "start": "2024-10", "end": "", "description": "Teaches introductory programming to 10–14 year olds."},
        ],
        "projects": [
            {"name": "Rent Map Madrid", "description": "Open-data visualisation of rental prices by district."},
        ],
        "skills": ["Python", "Data analysis", "Excel modelling", "Public speaking", "SQL", "Figma"],
        "certifications": ["English C1 (Global English Assessment)"],
    }
    users = [
        ("usr_alex", "Alex Morgan", "alex.morgan@example.com", "applicant",
         "Prospective business & data student", "Madrid, Spain", "+34 600 000 000",
         "Analytical, curious student interested in the intersection of business, data and technology.",
         [{"language": "English", "level": "C1"}, {"language": "Spanish", "level": "Native"}, {"language": "French", "level": "B1"}],
         alex_profile, "substantial", "Government ID check (simulated)"),
        ("usr_ruiz", "Dr. Elena Ruiz", "e.ruiz@example-intl.school", "recommender",
         "Head of Mathematics, Example International School", "Madrid, Spain", None, None, [], {},
         "substantial", "Institutional SSO (simulated)"),
        ("usr_okafor", "James Okafor", "j.okafor@example-intl.school", "recommender",
         "Economics Teacher, Example International School", "Madrid, Spain", None, None, [], {}, None, None),
        ("usr_lind", "Sofia Lind", "registrar@example-intl.school", "institution_rep",
         "Registrar, Example International School", "Madrid, Spain", None, None, [], {},
         "high", "Institutional SSO + hardware key (simulated)"),
        ("usr_gil", "Marta Gil", "admissions.reviewer@ie.edu", "institution_rep",
         "Admissions Reviewer, IE University (demo account)", "Madrid, Spain", None, None, [], {},
         "substantial", "Institutional SSO (simulated)"),
        ("usr_chen", "Daniel Chen", "d.chen@northbridge.example", "employer_rep",
         "Campus Recruiting Lead, Northbridge Consulting", "London, UK", None, None, [], {},
         "substantial", "Corporate SSO (simulated)"),
        ("usr_weiss", "Hannah Weiss", "h.weiss@lumen.example", "employer_rep",
         "HR Manager, Lumen Analytics", "Madrid, Spain", None, None, [], {},
         "substantial", "Corporate SSO (simulated)"),
        ("usr_shah", "Priya Shah", "priya@credo.example", "admin", "Trust & Safety, Credo", "Remote", None, None, [], {},
         "high", "Staff SSO + hardware key (simulated)"),
        ("usr_rivera", "Sam Rivera", "sam.rivera@example.com", "applicant", "Economics graduate", "Lisbon, Portugal",
         None, "Economics graduate focused on strategy and operations.", [{"language": "English", "level": "C2"}],
         {"education": [], "experience": [], "skills": ["Strategy", "Excel"]}, "substantial", "Government ID check (simulated)"),
        ("usr_lee", "Jordan Lee", "jordan.lee@example.com", "applicant", "IB student", "Dublin, Ireland",
         None, "Student interested in entrepreneurship.", [{"language": "English", "level": "Native"}],
         {"education": [], "experience": [], "skills": ["Entrepreneurship"]}, "basic", "Email + phone (simulated)"),
    ]
    settings = json.dumps({"profile_visibility": "private", "default_share_days": 30, "notify_email": True,
                           "notify_deadlines": True, "allow_reuse_prompts": True, "two_factor": True})
    for u in users:
        conn.execute("""INSERT INTO users(id,name,email,role,headline,location,phone,summary,languages,profile,settings,
            identity_level,identity_method,signing_key,is_demo,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)""",
                     (u[0], u[1], u[2], u[3], u[4], u[5], u[6], u[7], json.dumps(u[8]), json.dumps(u[9]), settings,
                      u[10], u[11], k(), "2026-09-01"))
    for user_id, org_id, role in [("usr_ruiz", "org_eis", "faculty"), ("usr_okafor", "org_eis", "faculty"),
                                  ("usr_lind", "org_eis", "registrar"), ("usr_gil", "org_ie", "admissions_reviewer"),
                                  ("usr_chen", "org_northbridge", "recruiter"), ("usr_weiss", "org_lumen", "hr")]:
        conn.execute("INSERT INTO org_members VALUES(?,?,?, 'authorized')", (user_id, org_id, role))

    transcript = {
        "kind": "transcript", "student": "Alex Morgan", "program": "Upper Secondary Diploma — Sciences & Economics",
        "period": "2022–2026", "gpa": "3.9 / 4.0", "class_rank": "Top 5%",
        "courses": [["Mathematics: Analysis (Higher)", "A+"], ["Economics (Higher)", "A"], ["Physics", "A"],
                    ["English Language & Literature", "A"], ["Spanish A: Literature", "A-"], ["Computer Science", "A+"],
                    ["Theory of Knowledge", "A"], ["Extended Essay (Economics)", "A"]],
        "issued_by": "Office of the Registrar", "notice": "SIMULATED DEMO CREDENTIAL — fictional data.",
    }
    eis = dict(issuer_org_id="org_eis", issuer_name="Example International School", sig_key_ref="org:org_eis",
               signature_method="Institutional digital signature (simulated HMAC-SHA256)")
    c_tr = create_credential(conn, type="transcript", title="High School Transcript", subject_id="usr_alex",
                             source="issuer", status="verified", content=json.dumps(transcript, indent=2),
                             issuer_user_id="usr_lind", issued_at="2026-09-12T10:04:00+00:00",
                             verification_method="Issued directly by verified institution", **eis)
    create_credential(conn, type="language_cert", title="English Language Certificate — C1",
                      subject_id="usr_alex", source="issuer", status="verified",
                      content=json.dumps({"kind": "language_cert", "candidate": "Alex Morgan", "level": "C1 (CEFR)",
                                          "overall": 7.5, "listening": 8.0, "reading": 7.5, "writing": 7.0, "speaking": 7.5,
                                          "test_date": "2026-06-14", "notice": "SIMULATED DEMO CREDENTIAL"}, indent=2),
                      issuer_org_id="org_gea", issuer_name="Global English Assessment", sig_key_ref="org:org_gea",
                      signature_method="Issuer digital signature (simulated HMAC-SHA256)",
                      verification_method="Issued directly by verified test provider",
                      issued_at="2026-06-20T09:00:00+00:00", expires_at="2028-06-20")
    create_credential(conn, type="language_cert", title="English Language Certificate — B2 (2023)",
                      subject_id="usr_alex", source="issuer", status="verified",
                      content=json.dumps({"kind": "language_cert", "candidate": "Alex Morgan", "level": "B2 (CEFR)",
                                          "overall": 6.0, "notice": "SIMULATED DEMO CREDENTIAL"}, indent=2),
                      issuer_org_id="org_gea", issuer_name="Global English Assessment", sig_key_ref="org:org_gea",
                      signature_method="Issuer digital signature (simulated HMAC-SHA256)",
                      verification_method="Issued directly by verified test provider",
                      issued_at="2023-05-10T09:00:00+00:00", expires_at="2025-05-10")
    letter = ("To the Admissions Committee,\n\nI have taught Alex Morgan Higher-level Mathematics for three years. "
              "Alex is among the strongest students I have worked with in fifteen years of teaching: precise, persistent "
              "and unusually generous in helping classmates. Alex's national Olympiad silver medal reflects real depth, "
              "not drilling — the extended investigation on optimisation in public transport routing was graduate-level "
              "in its rigour.\n\nI recommend Alex without reservation.\n\nDr. Elena Ruiz\nHead of Mathematics\n\n"
              "[SIMULATED DEMO LETTER — fictional content]")
    create_credential(conn, type="recommendation", title="Mathematics Recommendation — Dr. Elena Ruiz",
                      subject_id="usr_alex", source="recommender", status="verified", content=letter,
                      issuer_org_id="org_eis", issuer_user_id="usr_ruiz", issuer_name="Dr. Elena Ruiz",
                      sig_key_ref="user:usr_ruiz", signature_method="Recommender signature (simulated HMAC-SHA256)",
                      verification_method="Institutional email code + affiliation check + institutional SSO (simulated)",
                      issued_at="2026-10-02T16:30:00+00:00", expires_at="2027-10-02", confidential=1,
                      reuse_policy="recipient_specific", permitted=["org_ie", "org_bocconi"],
                      metadata={"relationship": "Mathematics teacher, 3 years", "affiliation": "Example International School"})
    create_credential(conn, type="employment_cert", title="Internship Certificate — Lumen Analytics",
                      subject_id="usr_alex", source="issuer", status="verified",
                      content=json.dumps({"kind": "employment_cert", "employee": "Alex Morgan", "role": "Data Analyst Intern",
                                          "start": "2026-07-01", "end": "2026-08-29", "hours_per_week": 35,
                                          "summary": "Built client dashboards; automated KPI reporting.",
                                          "notice": "SIMULATED DEMO CREDENTIAL"}, indent=2),
                      issuer_org_id="org_lumen", issuer_user_id="usr_weiss", issuer_name="Lumen Analytics",
                      sig_key_ref="org:org_lumen", signature_method="Employer digital signature (simulated HMAC-SHA256)",
                      verification_method="Issued by verified employer HR representative",
                      issued_at="2026-08-30T12:00:00+00:00")
    create_credential(conn, type="personal_statement", title="Personal Statement — Business & Data",
                      subject_id="usr_alex", source="self", status="self_uploaded",
                      content="Why I want to study business and data... [demo personal statement written by applicant]",
                      file_name="personal-statement.txt", issued_at="2026-10-10T18:00:00+00:00",
                      verification_method="Self-uploaded by applicant — not independently verified")
    create_credential(conn, type="cv", title="CV — Alex Morgan (Oct 2026)", subject_id="usr_alex", source="self",
                      status="self_uploaded", content="Alex Morgan — CV\nEducation...\nExperience...\n[demo CV]",
                      file_name="alex-morgan-cv.txt", issued_at="2026-10-12T09:00:00+00:00",
                      verification_method="Self-uploaded by applicant — not independently verified")

    # programs (requirement templates defined by organizations)
    V, A = "verified", "any"
    programs = [
        ("prg_ie_bba", "org_ie", "Bachelor's Program — Business Administration", "university", "2026-12-15",
         "Four-year bachelor's programme in Madrid & Segovia (demo listing).",
         [("transcript", "Academic transcript", V), ("diploma", "Secondary school diploma", V),
          ("language_cert", "English proficiency certificate", V), ("recommendation", "Recommendation letter 1", V),
          ("recommendation", "Recommendation letter 2", V), ("personal_statement", "Personal statement", A), ("cv", "CV", A)]),
        ("prg_bocconi_msc", "org_bocconi", "Master's Program — Data Science & Business", "graduate", "2027-01-20",
         "Two-year MSc (demo listing).",
         [("transcript", "Academic transcript", V), ("language_cert", "English proficiency certificate", V),
          ("recommendation", "Academic recommendation", V), ("personal_statement", "Statement of purpose", A), ("cv", "CV", A)]),
        ("prg_nb_intern", "org_northbridge", "Consulting Summer Internship 2027", "internship", "2026-11-30",
         "10-week summer internship (fictional).",
         [("cv", "CV", A), ("transcript", "Academic transcript", V), ("employment_cert", "Proof of prior work experience", V),
          ("recommendation", "Professional or academic reference", V)]),
        ("prg_helix_grad", "org_helix", "Technology Graduate Program", "job", "2027-02-01",
         "Rotational graduate scheme (fictional).",
         [("cv", "CV", A), ("transcript", "Academic transcript", V), ("diploma", "Diploma", V),
          ("language_cert", "English proficiency", V)]),
        ("prg_ie_cs", "org_ie", "Bachelor's Program — Computer Science & AI", "university", "2027-01-15",
         "Demo listing.", [("transcript", "Academic transcript", V), ("diploma", "Secondary school diploma", V),
                           ("language_cert", "English proficiency certificate", V), ("recommendation", "Recommendation letter", V),
                           ("personal_statement", "Personal statement", A)]),
        ("prg_lumen_ft", "org_lumen", "Junior Data Analyst", "job", "2026-12-31", "Full-time role (fictional).",
         [("cv", "CV", A), ("employment_cert", "Prior experience", V)]),
    ]
    for p in programs:
        conn.execute("INSERT INTO programs VALUES(?,?,?,?,?,?,?)",
                     (p[0], p[1], p[2], p[3], p[4], p[5], json.dumps([{"doc_type": a, "label": b, "min_status": c} for a, b, c in p[6]])))

    app_ids = {}
    for pid, created in [("prg_ie_bba", "2026-10-01"), ("prg_bocconi_msc", "2026-10-03"),
                         ("prg_nb_intern", "2026-10-05"), ("prg_helix_grad", "2026-10-08")]:
        app_ids[pid] = add_application(conn, "usr_alex", pid, created)

    conn.execute("""INSERT INTO recommendation_requests VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                 ("rec_econ", "usr_alex", "James Okafor", "j.okafor@example-intl.school", "usr_okafor", "org_eis",
                  "Recommendation for undergraduate business programmes, focusing on economics coursework and the Economics Society.",
                  app_ids["prg_ie_bba"], "2026-11-25", "sent", 1, "inv_" + secrets.token_urlsafe(18), "{}", None, None,
                  "2026-10-14T09:00:00+00:00", "2026-10-14T09:00:00+00:00"))
    conn.execute("INSERT INTO document_requests VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                 ("dreq_diploma", "usr_alex", "org_eis", "diploma", "Upper Secondary Diploma, graduated June 2026.",
                  app_ids["prg_ie_bba"], None, "requested", None, "2026-10-15T11:00:00+00:00", "2026-10-15T11:00:00+00:00"))
    conn.execute("INSERT INTO document_requests VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                 ("dreq_rivera", "usr_rivera", "org_northbridge", "employment_cert",
                  "Business Analyst Intern, June–August 2025, London office.", None, None, "requested", None,
                  "2026-10-16T08:00:00+00:00", "2026-10-16T08:00:00+00:00"))

    # other applicants with packages so the review portals have an inbox
    for subj, prog, title in [("usr_rivera", "prg_nb_intern", "Bachelor in Economics — Transcript"),
                              ("usr_lee", "prg_ie_bba", "Secondary School Transcript")]:
        c = create_credential(conn, type="transcript", title=title, subject_id=subj, source="issuer", status="verified",
                              content=json.dumps({"kind": "transcript", "student": one(conn, "SELECT name FROM users WHERE id=?", subj)["name"], "gpa": "3.6 / 4.0",
                                                  "notice": "SIMULATED DEMO CREDENTIAL"}),
                              issued_at="2026-07-01T10:00:00+00:00",
                              verification_method="Issued directly by verified institution", **eis)
        cv = create_credential(conn, type="cv", title="CV", subject_id=subj, source="self", status="self_uploaded",
                               content="[demo CV]", verification_method="Self-uploaded by applicant — not independently verified")
        a = add_application(conn, subj, prog, "2026-10-10")
        appr = one(conn, "SELECT * FROM applications WHERE id=?", a)
        make_package(conn, one(conn, "SELECT * FROM users WHERE id=?", subj), appr, [c["id"], cv["id"]], 30, "Looking forward to hearing from you.")

    for t, b, l, d in [
        ("Transcript issued", "Example International School issued your High School Transcript.", "#/vault", "2026-09-12T10:05:00+00:00"),
        ("Recommendation submitted", "Dr. Elena Ruiz submitted a confidential recommendation.", "#/vault", "2026-10-02T16:31:00+00:00"),
        ("Deadline approaching", "Consulting Summer Internship closes on 30 Nov 2026.", "#/applications", "2026-10-18T08:00:00+00:00"),
    ]:
        conn.execute("INSERT INTO notifications VALUES(?,?,?,?,?,0,?)", (uid("ntf"), "usr_alex", t, b, l, d))
    for actor, label, action, rtype, rid, detail, ts in [
        ("usr_lind", "Sofia Lind", "credential.issued", "credential", c_tr["id"], "High School Transcript", "2026-09-12T10:04:00+00:00"),
        ("usr_ruiz", "Dr. Elena Ruiz", "recommendation.submitted", "credential", None, "Confidential, IE University + Bocconi", "2026-10-02T16:30:00+00:00"),
        ("usr_alex", "Alex Morgan", "recommendation.requested", "recommendation", "rec_econ", "To James Okafor", "2026-10-14T09:00:00+00:00"),
        ("usr_alex", "Alex Morgan", "document.requested", "document_request", "dreq_diploma", "Diploma from Example International School", "2026-10-15T11:00:00+00:00"),
    ]:
        conn.execute("INSERT INTO audit_logs VALUES(?,?,?,?,?,?,?,?,?)", (uid("evt"), actor, label, action, rtype, rid, detail, "usr_alex", ts))
    conn.commit()


def add_application(conn, user_id, program_id, created=None):
    p = one(conn, "SELECT * FROM programs WHERE id=?", program_id)
    if not p:
        raise ApiError(404, "Program not found")
    aid = uid("app")
    conn.execute("INSERT INTO applications VALUES(?,?,?,?,?,?,?,?,?)",
                 (aid, user_id, p["org_id"], program_id, p["title"], p["type"], p["deadline"], "in_progress", created or now()))
    for i, r in enumerate(jl(p["requirements"], [])):
        conn.execute("INSERT INTO application_requirements VALUES(?,?,?,?,?,?,NULL)",
                     (uid("req"), aid, r["doc_type"], r["label"], r.get("min_status", "verified"), i))
    return aid


def make_package(conn, user, app, cred_ids, days, message=""):
    pid = uid("pkg")
    token = "shr_" + secrets.token_urlsafe(20)
    exp = (date.today() + timedelta(days=int(days or 30))).isoformat()
    conn.execute("INSERT INTO packages VALUES(?,?,?,?,?,?,?,?,?,?,0,?)",
                 (pid, app["applicant_id"], app["id"], app["org_id"], json.dumps(cred_ids), token, "active",
                  "received", message, exp, now()))
    for cid in cred_ids:
        conn.execute("INSERT INTO access_grants VALUES(?,?,?,?,?,?,0,?)",
                     (uid("grt"), cid, app["org_id"], pid, "view_download", exp, now()))
    conn.execute("UPDATE applications SET status='shared' WHERE id=?", (app["id"],))
    audit(conn, user, "package.shared", "package", pid, "%d documents to %s" % (len(cred_ids), org_name(conn, app["org_id"])),
          app["applicant_id"])
    for m in many(conn, "SELECT user_id FROM org_members WHERE org_id=?", app["org_id"]):
        notify(conn, m["user_id"], "New application package", "%s shared %d documents for %s." % (
            (one(conn, "SELECT name FROM users WHERE id=?", app["applicant_id"]) or {}).get("name"), len(cred_ids), app["title"]),
               "#/org/package/" + pid)
    return pid, token


# ---------------------------------------------------------------- API handlers

def public_user(u):
    if not u:
        return None
    return {k: u.get(k) for k in ("id", "name", "email", "role", "headline", "location", "identity_level", "identity_method", "is_demo")}


def session_payload(conn, user):
    if not user:
        return {"user": None}
    orgs = many(conn, """SELECT o.id,o.name,o.type,o.verification_status,m.role FROM org_members m
        JOIN organizations o ON o.id=m.org_id WHERE m.user_id=?""", user["id"])
    unread = one(conn, "SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0", user["id"])["n"]
    return {"user": public_user(user), "orgs": orgs, "unread": unread}


def h_session(conn, user, body, params):
    return session_payload(conn, user)


def h_personas(conn, user, body, params):
    rows = many(conn, """SELECT u.id,u.name,u.role,u.headline FROM users u WHERE is_demo=1
        AND u.id NOT IN ('usr_rivera','usr_lee') ORDER BY CASE role WHEN 'applicant' THEN 0 WHEN 'recommender' THEN 1
        WHEN 'institution_rep' THEN 2 WHEN 'employer_rep' THEN 3 ELSE 4 END, name""")
    return {"personas": rows}


def start_session(conn, u, how):
    token = secrets.token_urlsafe(32)
    conn.execute("INSERT INTO sessions VALUES(?,?,?)", (token, u["id"], now()))
    audit(conn, u, "session.signin", "user", u["id"], how, u["id"] if u["role"] == "applicant" else None)
    return {"_set_session": token, **session_payload(conn, u)}


def h_login(conn, user, body, params):
    if body.get("user_id"):  # demo persona (fictional seed accounts only)
        u = one(conn, "SELECT * FROM users WHERE id=? AND is_demo=1", body["user_id"])
        if not u:
            raise ApiError(404, "Unknown demo user")
        return start_session(conn, u, "Demo persona sign-in")
    email = (body.get("email") or "").strip().lower()
    u = one(conn, "SELECT * FROM users WHERE email=?", email)
    if not u or not check_password(body.get("password") or "", u.get("password_hash")):
        raise ApiError(401, "Incorrect email or password.")
    return start_session(conn, u, "Email + password sign-in")


def h_logout(conn, user, body, params):
    return {"_clear_session": True, "ok": True}


def h_signup(conn, user, body, params):
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    if len(name) < 2 or not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise ApiError(400, "Enter your full name and a valid email address.")
    if len(password) < 8:
        raise ApiError(400, "Choose a password with at least 8 characters.")
    if one(conn, "SELECT id FROM users WHERE email=?", email):
        raise ApiError(409, "An account with this email already exists.")
    uid_ = uid("usr")
    profile = {"education": [], "experience": [], "projects": [], "skills": [], "certifications": []}
    edu = body.get("education") or {}
    if edu.get("institution"):
        profile["education"].append({"institution": edu["institution"], "org_id": edu.get("org_id"),
                                     "degree": edu.get("degree", ""), "field": edu.get("field", ""),
                                     "start": edu.get("start", ""), "end": edu.get("end", ""), "result": "", "achievements": []})
    conn.execute("""INSERT INTO users(id,name,email,role,headline,location,summary,languages,profile,settings,
        identity_level,identity_method,signing_key,is_demo,created_at,password_hash) VALUES(?,?,?,'applicant',?,?,?,?,?,?,?,?,?,0,?,?)""",
                 (uid_, name, email, body.get("headline", ""), body.get("location", ""), "", "[]", json.dumps(profile),
                  json.dumps({"profile_visibility": "private", "default_share_days": 30, "notify_email": True,
                              "notify_deadlines": True, "allow_reuse_prompts": True, "two_factor": False}),
                  "basic", "Email + password (email not yet confirmed)", secrets.token_hex(32), now(), hash_password(password)))
    u = one(conn, "SELECT * FROM users WHERE id=?", uid_)
    for pid in body.get("program_ids") or []:
        add_application(conn, uid_, pid)
    audit(conn, u, "account.created", "user", uid_, "Applicant signup", uid_)
    notify(conn, uid_, "Welcome to Credo", "Add your CV to your vault, then request your transcript and a reference.", "/app")
    return start_session(conn, u, "New account")


def h_orgs(conn, user, body, params):
    return {"orgs": many(conn, "SELECT id,name,type,domain,country,verification_status,description FROM organizations ORDER BY name")}


def h_programs(conn, user, body, params):
    rows = many(conn, """SELECT p.*, o.name org_name, o.type org_type FROM programs p JOIN organizations o ON o.id=p.org_id
        ORDER BY p.deadline""")
    for r in rows:
        r["requirements"] = jl(r["requirements"], [])
    return {"programs": rows}


def my_creds(conn, user):
    return [serialize_credential(conn, r, user) for r in
            many(conn, "SELECT * FROM credentials WHERE subject_user_id=? ORDER BY issued_at DESC", user["id"])]


def pending_items(conn, user):
    recs = many(conn, """SELECT r.*, o.name org_name, a.title app_title FROM recommendation_requests r
        LEFT JOIN organizations o ON o.id=r.org_id LEFT JOIN applications a ON a.id=r.application_id
        WHERE r.applicant_id=? ORDER BY r.created_at DESC""", user["id"])
    for r in recs:
        r["verification"] = jl(r["verification"], {})
        r["invite_link"] = "#/invite/" + r["token"]
        r.pop("token", None)
    docs = many(conn, """SELECT d.*, o.name org_name FROM document_requests d LEFT JOIN organizations o ON o.id=d.org_id
        WHERE d.applicant_id=? ORDER BY d.created_at DESC""", user["id"])
    for d in docs:
        d["type_label"] = DOC_TYPES.get(d["type"], d["type"])
    return recs, docs


def h_dashboard(conn, user, body, params):
    creds = my_creds(conn, user)
    recs, docs = pending_items(conn, user)
    apps = [app_summary(conn, a) for a in many(conn, "SELECT * FROM applications WHERE applicant_id=? ORDER BY deadline", user["id"])]
    profile = jl(user["profile"], {})
    checks = [bool(user.get("headline")), bool(user.get("summary")), bool(user.get("location")),
              bool(jl(user["languages"], [])), bool(profile.get("education")), bool(profile.get("experience")),
              bool(profile.get("skills")), any(c["type"] == "transcript" and c["status"] == "verified" for c in creds),
              any(c["type"] == "recommendation" for c in creds), user.get("identity_level") in ("substantial", "high")]
    deadlines = sorted(
        [{"date": a["deadline"], "label": a["title"], "org": a["org"]["name"], "link": "#/applications/" + a["id"], "kind": "application"} for a in apps] +
        [{"date": r["deadline"], "label": "Recommendation — " + r["recommender_name"], "org": r["org_name"],
          "link": "#/vault", "kind": "recommendation"} for r in recs if r["status"] in ("sent", "opened", "accepted") and r["deadline"]],
        key=lambda d: d["date"] or "9999")
    activity = many(conn, "SELECT * FROM audit_logs WHERE subject_user_id=? ORDER BY created_at DESC LIMIT 8", user["id"])
    return {
        "profile_completion": round(100 * sum(checks) / len(checks)),
        "verified_count": sum(1 for c in creds if c["status"] == "verified"),
        "credential_count": len(creds),
        "pending_recommendations": sum(1 for r in recs if r["status"] in ("sent", "opened", "accepted")),
        "pending_documents": sum(1 for d in docs if d["status"] == "requested"),
        "applications": apps, "deadlines": [d for d in deadlines if (d["date"] or "") >= today()][:6],
        "activity": activity, "today": today(),
    }


def h_profile(conn, user, body, params):
    creds = my_creds(conn, user)
    u = dict(user)
    out = public_user(u)
    out.update({"phone": u["phone"], "summary": u["summary"], "languages": jl(u["languages"], []),
                "profile": jl(u["profile"], {}), "credentials": [{k: c[k] for k in ("id", "type", "title", "status", "issuer_name", "issuer_org")} for c in creds]})
    return out


def h_profile_update(conn, user, body, params):
    fields = {}
    for k in ("name", "headline", "location", "phone", "summary"):
        if k in body:
            fields[k] = str(body[k])[:2000]
    if "languages" in body:
        fields["languages"] = json.dumps(body["languages"])
    if "profile" in body:
        fields["profile"] = json.dumps(body["profile"])
    if fields:
        conn.execute("UPDATE users SET %s WHERE id=?" % ",".join(k + "=?" for k in fields), list(fields.values()) + [user["id"]])
        audit(conn, user, "profile.updated", "user", user["id"], ", ".join(fields.keys()), user["id"])
    return {"ok": True}


def h_credentials(conn, user, body, params):
    recs, docs = pending_items(conn, user)
    return {"credentials": my_creds(conn, user), "recommendations": recs, "document_requests": docs, "doc_types": DOC_TYPES}


def get_cred_for(conn, user, cid):
    row = one(conn, "SELECT * FROM credentials WHERE id=?", cid)
    if not row:
        raise ApiError(404, "Credential not found")
    can_meta, _, _ = access_level(conn, row, user)
    if not can_meta:
        raise ApiError(403, "You do not have access to this credential")
    return row


def h_credential(conn, user, body, params):
    row = get_cred_for(conn, user, params["id"])
    c = serialize_credential(conn, row, user)
    c["subject"] = public_user(one(conn, "SELECT * FROM users WHERE id=?", row["subject_user_id"]))
    show_grants = c["access_reason"] in ("subject", "admin")
    c["grants"] = many(conn, """SELECT g.*, o.name org_name, p.status package_status, a.title app_title FROM access_grants g
        LEFT JOIN organizations o ON o.id=g.recipient_org_id LEFT JOIN packages p ON p.id=g.package_id
        LEFT JOIN applications a ON a.id=p.application_id WHERE g.credential_id=? ORDER BY g.created_at DESC""", row["id"]) if show_grants else []
    c["audit"] = many(conn, "SELECT * FROM audit_logs WHERE resource_id=? ORDER BY created_at DESC LIMIT 20", row["id"])
    c["permitted_orgs"] = [org_name(conn, o) for o in c["permitted_recipients"]]
    c["verification_request"] = one(conn, "SELECT d.*, o.name org_name FROM document_requests d LEFT JOIN organizations o ON o.id=d.org_id WHERE d.credential_id=? AND d.type='verify_upload' ORDER BY d.created_at DESC", row["id"])
    return c


def h_credential_vc(conn, user, body, params):
    row = get_cred_for(conn, user, params["id"])
    c = serialize_credential(conn, row, user)
    return {
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        "type": ["VerifiableCredential", "Credo" + "".join(w.capitalize() for w in row["type"].split("_"))],
        "id": "urn:credo:credential:" + row["id"],
        "issuer": {"id": "urn:credo:" + (row["sig_key_ref"] or "self").replace(":", ":"), "name": row["issuer_name"]},
        "validFrom": row["issued_at"], "validUntil": row["expires_at"],
        "credentialSubject": {"id": "urn:credo:user:" + row["subject_user_id"], "documentType": row["type"],
                              "title": row["title"], "digestSRI": "sha256-" + base64.b64encode(bytes.fromhex(row["integrity_hash"])).decode()},
        "credentialStatus": {"type": "CredoRevocationStatus", "status": c["status"]},
        "proof": ({"type": "SimulatedHmacSha256Signature2026", "created": row["issued_at"],
                   "verificationMethod": "urn:credo:key:" + row["sig_key_ref"], "proofValue": row["signature"],
                   "note": "Simulated proof for the MVP. Production would use VC Data Integrity (e.g. eddsa-rdfc-2022)."}
                  if row["signature"] else None),
    }


def h_verify(conn, user, body, params):
    row = get_cred_for(conn, user, params["id"])
    integ, sig = check_credential(conn, row)
    audit(conn, user, "credential.verification_checked", "credential", row["id"],
          "integrity=%s signature=%s" % (integ, sig), row["subject_user_id"])
    return {"integrity": integ, "signature": sig, "status": effective_status(row, integ, sig), "checked_at": now()}


def h_upload(conn, user, body, params):
    title = (body.get("title") or "").strip()
    ctype = body.get("type") or "other"
    if not title or ctype not in DOC_TYPES:
        raise ApiError(400, "Title and document type are required.")
    file_bytes, content = None, None
    if body.get("data_b64"):
        try:
            file_bytes = base64.b64decode(body["data_b64"])
        except ValueError:
            raise ApiError(400, "Invalid file data")
        if len(file_bytes) > MAX_UPLOAD_BYTES:
            raise ApiError(413, "Files must be 8 MB or smaller.")
    else:
        content = body.get("content") or ""
        if not content.strip():
            raise ApiError(400, "Attach a file or paste the document text.")
    row = create_credential(conn, type=ctype, title=title, subject_id=user["id"], source="self", status="self_uploaded",
                            content=content, file_bytes=file_bytes, file_name=body.get("file_name"),
                            mime=body.get("mime"), issuer_name=user["name"], simulated=0,
                            verification_method="Self-uploaded by applicant — not independently verified")
    audit(conn, user, "credential.uploaded", "credential", row["id"], title, user["id"])
    return {"id": row["id"]}


def h_request_verification(conn, user, body, params):
    row = get_cred_for(conn, user, params["id"])
    if row["subject_user_id"] != user["id"] or row["source"] != "self":
        raise ApiError(400, "Only your own self-uploaded documents can be sent for issuer verification.")
    org = one(conn, "SELECT * FROM organizations WHERE id=?", body.get("org_id"))
    if not org:
        raise ApiError(400, "Choose the issuing organization.")
    if org["verification_status"] != "verified":
        raise ApiError(400, "That organization is not yet a verified issuer on Credo.")
    did = uid("dreq")
    conn.execute("INSERT INTO document_requests VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                 (did, user["id"], org["id"], "verify_upload", body.get("details") or row["title"], None, row["id"],
                  "requested", None, now(), now()))
    conn.execute("UPDATE credentials SET status='pending', issuer_org_id=? WHERE id=?", (org["id"], row["id"]))
    audit(conn, user, "verification.requested", "credential", row["id"], "Sent to " + org["name"], user["id"])
    for m in many(conn, "SELECT user_id FROM org_members WHERE org_id=?", org["id"]):
        notify(conn, m["user_id"], "Verification requested", "%s asked you to verify “%s”." % (user["name"], row["title"]), "#/org?tab=requests")
    return {"ok": True}


def h_download(conn, user, body, params):
    row = get_cred_for(conn, user, params["id"])
    _, can_content, _ = access_level(conn, row, user)
    if not can_content:
        raise ApiError(403, "This document is confidential and cannot be downloaded by you.")
    audit(conn, user, "credential.downloaded", "credential", row["id"], row["title"], row["subject_user_id"])
    return file_response(row)


def file_response(row):
    data = credential_bytes(row) or b""
    if is_file(row):
        name = row.get("file_name") or "document"
        mime = row.get("mime") or mimetypes.guess_type(name)[0] or "application/octet-stream"
    else:
        is_json = (row.get("content") or "").lstrip().startswith("{")
        name = re.sub(r"[^A-Za-z0-9]+", "-", row["title"]).strip("-").lower() + (".json" if is_json else ".txt")
        mime = "application/json" if is_json else "text/plain; charset=utf-8"
    return {"_raw": data, "_mime": mime, "_filename": name}


def h_rec_create(conn, user, body, params):
    name = (body.get("recommender_name") or "").strip()
    email = (body.get("recommender_email") or "").strip().lower()
    if not name or not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise ApiError(400, "Enter the recommender's name and institutional email.")
    org = one(conn, "SELECT * FROM organizations WHERE id=?", body.get("org_id"))
    if not org:
        raise ApiError(400, "Select the recommender's institution.")
    if body.get("application_id") and not one(conn, "SELECT id FROM applications WHERE id=? AND applicant_id=?", body["application_id"], user["id"]):
        raise ApiError(400, "Unknown application")
    rid = uid("rec")
    token = "inv_" + secrets.token_urlsafe(18)
    rec_user = one(conn, "SELECT id FROM users WHERE email=?", email)
    conn.execute("INSERT INTO recommendation_requests VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                 (rid, user["id"], name, email, rec_user["id"] if rec_user else None, org["id"],
                  (body.get("purpose") or "")[:2000], body.get("application_id") or None, body.get("deadline") or None,
                  "sent", 1 if body.get("confidential", True) else 0, token, "{}", None, None, now(), now()))
    audit(conn, user, "recommendation.requested", "recommendation", rid, "To %s (%s)" % (name, org["name"]), user["id"])
    if rec_user:
        notify(conn, rec_user["id"], "New recommendation request", "%s asked you for a recommendation." % user["name"], "#/invite/" + token)
    return {"id": rid, "invite_link": "#/invite/" + token, "simulated_email": {
        "to": email, "subject": "%s has requested a recommendation via Credo" % user["name"],
        "body": "Open your secure link to respond. No account needed."}}


def h_rec_action(conn, user, body, params):
    r = one(conn, "SELECT * FROM recommendation_requests WHERE id=? AND applicant_id=?", params["id"], user["id"])
    if not r:
        raise ApiError(404, "Request not found")
    act = params["action"]
    if act == "remind":
        audit(conn, user, "recommendation.reminded", "recommendation", r["id"], "Reminder to " + r["recommender_name"], user["id"])
        if r["recommender_user_id"]:
            notify(conn, r["recommender_user_id"], "Reminder", "%s sent a reminder about their recommendation." % user["name"], "#/invite/" + r["token"])
        return {"ok": True, "simulated_email": {"to": r["recommender_email"], "subject": "Reminder: recommendation for " + user["name"]}}
    if act == "cancel":
        if r["status"] == "submitted":
            raise ApiError(400, "Already submitted — ask the recommender to revoke it instead.")
        conn.execute("UPDATE recommendation_requests SET status='cancelled', updated_at=? WHERE id=?", (now(), r["id"]))
        audit(conn, user, "recommendation.cancelled", "recommendation", r["id"], "", user["id"])
        return {"ok": True}
    raise ApiError(404, "Unknown action")


def h_docreq_create(conn, user, body, params):
    t = body.get("type")
    if t not in ("transcript", "diploma", "enrollment_cert", "employment_cert", "certificate", "language_cert"):
        raise ApiError(400, "Choose a document type.")
    org = one(conn, "SELECT * FROM organizations WHERE id=?", body.get("org_id"))
    if not org:
        raise ApiError(400, "Choose the issuing organization.")
    did = uid("dreq")
    conn.execute("INSERT INTO document_requests VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                 (did, user["id"], org["id"], t, (body.get("details") or "")[:2000], body.get("application_id") or None,
                  None, "requested", None, now(), now()))
    audit(conn, user, "document.requested", "document_request", did, "%s from %s" % (DOC_TYPES[t], org["name"]), user["id"])
    for m in many(conn, "SELECT user_id FROM org_members WHERE org_id=?", org["id"]):
        notify(conn, m["user_id"], "New document request", "%s requested: %s." % (user["name"], DOC_TYPES[t]), "#/org?tab=requests")
    note = None if org["verification_status"] == "verified" else "This organization is not verified yet — the request will wait until it is."
    return {"id": did, "note": note}


def h_apps(conn, user, body, params):
    return {"applications": [app_summary(conn, a) for a in many(conn, "SELECT * FROM applications WHERE applicant_id=? ORDER BY deadline", user["id"])]}


def h_app_create(conn, user, body, params):
    if one(conn, "SELECT id FROM applications WHERE applicant_id=? AND program_id=?", user["id"], body.get("program_id")):
        raise ApiError(409, "You are already tracking this application.")
    aid = add_application(conn, user["id"], body.get("program_id"))
    audit(conn, user, "application.created", "application", aid, org_name(conn, one(conn, "SELECT org_id FROM applications WHERE id=?", aid)["org_id"]), user["id"])
    return {"id": aid}


def h_app(conn, user, body, params):
    a = one(conn, "SELECT * FROM applications WHERE id=? AND applicant_id=?", params["id"], user["id"])
    if not a:
        raise ApiError(404, "Application not found")
    s = app_summary(conn, a, detail=True)
    s["packages"] = many(conn, "SELECT id,status,review_status,expires_at,views,created_at,credential_ids FROM packages WHERE application_id=? ORDER BY created_at DESC", a["id"])
    s["program"] = one(conn, "SELECT description FROM programs WHERE id=?", a["program_id"])
    return s


def h_app_delete(conn, user, body, params):
    a = one(conn, "SELECT * FROM applications WHERE id=? AND applicant_id=?", params["id"], user["id"])
    if not a:
        raise ApiError(404, "Application not found")
    conn.execute("UPDATE packages SET status='revoked' WHERE application_id=?", (a["id"],))
    conn.execute("UPDATE access_grants SET revoked=1 WHERE package_id IN (SELECT id FROM packages WHERE application_id=?)", (a["id"],))
    conn.execute("DELETE FROM application_requirements WHERE application_id=?", (a["id"],))
    conn.execute("DELETE FROM applications WHERE id=?", (a["id"],))
    audit(conn, user, "application.removed", "application", a["id"], a["title"], user["id"])
    return {"ok": True}


def h_pkg_create(conn, user, body, params):
    a = one(conn, "SELECT * FROM applications WHERE id=? AND applicant_id=?", body.get("application_id"), user["id"])
    if not a:
        raise ApiError(404, "Application not found")
    ids = list(dict.fromkeys(body.get("credential_ids") or []))
    if not ids:
        raise ApiError(400, "Select at least one document.")
    if not body.get("consent"):
        raise ApiError(400, "Confirm that you authorize sharing these documents.")
    for cid in ids:
        r = one(conn, "SELECT * FROM credentials WHERE id=? AND subject_user_id=?", cid, user["id"])
        if not r:
            raise ApiError(400, "Unknown document in package")
        integ, sig = check_credential(conn, r)
        st = effective_status(r, integ, sig)
        if st in ("revoked", "expired", "failed"):
            raise ApiError(400, "“%s” is %s and cannot be shared." % (r["title"], st))
        if r["reuse_policy"] != "any" and a["org_id"] not in jl(r["permitted_recipients"], []):
            raise ApiError(400, "The recommender has not permitted “%s” to be shared with this organization." % r["title"])
    conn.execute("UPDATE packages SET status='superseded' WHERE application_id=? AND status='active'", (a["id"],))
    pid, token = make_package(conn, user, a, ids, body.get("expires_days") or 30, (body.get("message") or "")[:1000])
    return {"id": pid, "share_link": "#/share/" + token, "token": token}


def h_pkgs(conn, user, body, params):
    rows = many(conn, """SELECT p.*, o.name org_name, a.title app_title FROM packages p LEFT JOIN organizations o ON o.id=p.recipient_org_id
        LEFT JOIN applications a ON a.id=p.application_id WHERE p.applicant_id=? ORDER BY p.created_at DESC""", user["id"])
    for r in rows:
        r["credential_ids"] = jl(r["credential_ids"], [])
        r["share_link"] = "#/share/" + r["token"]
    return {"packages": rows}


def h_pkg_revoke(conn, user, body, params):
    p = one(conn, "SELECT * FROM packages WHERE id=? AND applicant_id=?", params["id"], user["id"])
    if not p:
        raise ApiError(404, "Package not found")
    conn.execute("UPDATE packages SET status='revoked' WHERE id=?", (p["id"],))
    conn.execute("UPDATE access_grants SET revoked=1 WHERE package_id=?", (p["id"],))
    audit(conn, user, "package.revoked", "package", p["id"], "Access withdrawn from " + org_name(conn, p["recipient_org_id"]), user["id"])
    return {"ok": True}


def h_grants(conn, user, body, params):
    rows = many(conn, """SELECT g.*, c.title cred_title, o.name org_name, p.status package_status FROM access_grants g
        JOIN credentials c ON c.id=g.credential_id LEFT JOIN organizations o ON o.id=g.recipient_org_id
        LEFT JOIN packages p ON p.id=g.package_id WHERE c.subject_user_id=? ORDER BY g.created_at DESC""", user["id"])
    for r in rows:
        r["active"] = not r["revoked"] and r["package_status"] == "active" and (not r["expires_at"] or r["expires_at"] >= today())
    return {"grants": rows}


def h_grant_revoke(conn, user, body, params):
    g = one(conn, """SELECT g.* FROM access_grants g JOIN credentials c ON c.id=g.credential_id
        WHERE g.id=? AND c.subject_user_id=?""", params["id"], user["id"])
    if not g:
        raise ApiError(404, "Grant not found")
    conn.execute("UPDATE access_grants SET revoked=1 WHERE id=?", (g["id"],))
    audit(conn, user, "access.revoked", "credential", g["credential_id"], "From " + (org_name(conn, g["recipient_org_id"]) or ""), user["id"])
    return {"ok": True}


def h_audit(conn, user, body, params):
    return {"events": many(conn, "SELECT * FROM audit_logs WHERE subject_user_id=? OR actor_id=? ORDER BY created_at DESC LIMIT 100", user["id"], user["id"])}


def h_notifications(conn, user, body, params):
    return {"notifications": many(conn, "SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 30", user["id"])}


def h_notifications_read(conn, user, body, params):
    conn.execute("UPDATE notifications SET read=1 WHERE user_id=?", (user["id"],))
    return {"ok": True}


def h_settings_get(conn, user, body, params):
    return {"settings": jl(user["settings"], {}), "identity_level": user["identity_level"], "identity_method": user["identity_method"],
            "email": user["email"]}


def h_settings_put(conn, user, body, params):
    s = jl(user["settings"], {})
    for k in ("profile_visibility", "default_share_days", "notify_email", "notify_deadlines", "allow_reuse_prompts", "two_factor"):
        if k in body:
            s[k] = body[k]
    conn.execute("UPDATE users SET settings=? WHERE id=?", (json.dumps(s), user["id"]))
    audit(conn, user, "settings.updated", "user", user["id"], ", ".join(k for k in body), user["id"])
    return {"settings": s}


def h_export(conn, user, body, params):
    data = {"exported_at": now(), "user": public_user(user), "profile": jl(user["profile"], {}),
            "credentials": [{k: c[k] for k in ("id", "type", "title", "status", "issuer_name", "issued_at", "expires_at", "integrity_hash", "confidential")} for c in my_creds(conn, user)],
            "applications": many(conn, "SELECT id,title,deadline,status FROM applications WHERE applicant_id=?", user["id"]),
            "access_grants": h_grants(conn, user, {}, {})["grants"],
            "audit_log": h_audit(conn, user, {}, {})["events"],
            "note": "Data export (GDPR Art. 15/20 style). Confidential letter bodies are excluded at the recommender's request."}
    audit(conn, user, "data.exported", "user", user["id"], "", user["id"])
    return {"_raw": json.dumps(data, indent=2).encode(), "_mime": "application/json", "_filename": "credo-data-export.json"}


def h_delete_request(conn, user, body, params):
    audit(conn, user, "account.deletion_requested", "user", user["id"], "Simulated — would start a 30-day erasure workflow", user["id"])
    return {"ok": True, "message": "Deletion request recorded (simulated). In production this starts a verified erasure workflow; issuer records may be retained where law requires."}


# ---- public share link

def h_share(conn, user, body, params):
    p = one(conn, "SELECT * FROM packages WHERE token=?", params["token"])
    if not p:
        raise ApiError(404, "This share link is invalid.")
    if p["status"] != "active" or (p["expires_at"] and p["expires_at"] < today()):
        raise ApiError(410, "This package is no longer available — the applicant revoked or replaced it, or it expired.")
    conn.execute("UPDATE packages SET views=views+1 WHERE id=?", (p["id"],))
    a = one(conn, "SELECT * FROM applications WHERE id=?", p["application_id"])
    applicant = one(conn, "SELECT * FROM users WHERE id=?", p["applicant_id"])
    creds = []
    for cid in jl(p["credential_ids"], []):
        row = one(conn, "SELECT * FROM credentials WHERE id=?", cid)
        g = one(conn, "SELECT * FROM access_grants WHERE package_id=? AND credential_id=?", p["id"], cid)
        if not row or not g or g["revoked"]:
            continue
        c = serialize_credential(conn, row, None, force_content=not row["confidential"])
        creds.append(c)
    audit(conn, None, "package.viewed", "package", p["id"], "Share link opened", p["applicant_id"])
    return {"package": {k: p[k] for k in ("id", "status", "expires_at", "created_at", "message")},
            "application": {"title": a["title"] if a else None, "deadline": a["deadline"] if a else None},
            "recipient": one(conn, "SELECT id,name,type,verification_status FROM organizations WHERE id=?", p["recipient_org_id"]),
            "applicant": {"name": applicant["name"], "headline": applicant["headline"], "location": applicant["location"],
                          "identity_level": applicant["identity_level"], "identity_method": applicant["identity_method"]},
            "credentials": creds}


def h_share_download(conn, user, body, params):
    p = one(conn, "SELECT * FROM packages WHERE token=? AND status='active'", params["token"])
    if not p or params["cid"] not in jl(p["credential_ids"], []):
        raise ApiError(404, "Not found")
    row = one(conn, "SELECT * FROM credentials WHERE id=?", params["cid"])
    g = one(conn, "SELECT * FROM access_grants WHERE package_id=? AND credential_id=? AND revoked=0", p["id"], row["id"])
    if not g or row["confidential"]:
        raise ApiError(403, "Not available through a share link.")
    audit(conn, None, "credential.downloaded", "credential", row["id"], "Via share link", p["applicant_id"])
    return file_response(row)


# ---- recommender invite flow (token = capability, no account needed)

def load_invite(conn, token):
    r = one(conn, "SELECT * FROM recommendation_requests WHERE token=?", token)
    if not r:
        raise ApiError(404, "This invitation link is invalid.")
    if r["status"] == "cancelled":
        raise ApiError(410, "The applicant cancelled this request.")
    r["verification"] = jl(r["verification"], {})
    return r


def invite_view(conn, r, user=None):
    applicant = one(conn, "SELECT * FROM users WHERE id=?", r["applicant_id"])
    org = one(conn, "SELECT * FROM organizations WHERE id=?", r["org_id"])
    app = one(conn, "SELECT a.title, o.name org_name, a.org_id FROM applications a JOIN organizations o ON o.id=a.org_id WHERE a.id=?", r["application_id"]) if r["application_id"] else None
    domain_ok = bool(org and org["domain"] and r["recommender_email"].endswith("@" + org["domain"]))
    v = r["verification"]
    prev = []
    if user and user["email"] == r["recommender_email"]:  # only the signed-in recommender sees their past letters
        prev = [{"title": c["title"], "issued_at": c["issued_at"], "content": c["content"]} for c in
                many(conn, "SELECT title, issued_at, content FROM credentials WHERE issuer_user_id=? AND type='recommendation' ORDER BY issued_at DESC LIMIT 3", r["recommender_user_id"])]
    other_orgs = many(conn, "SELECT id,name FROM organizations WHERE type IN ('university','employer') AND verification_status='verified' ORDER BY name")
    return {
        "id": r["id"], "status": r["status"], "recommender_name": r["recommender_name"], "recommender_email": r["recommender_email"],
        "purpose": r["purpose"], "deadline": r["deadline"], "confidential": bool(r["confidential"]),
        "applicant": {"name": applicant["name"], "headline": applicant["headline"], "location": applicant["location"]},
        "institution": {"id": org["id"], "name": org["name"], "domain": org["domain"], "verification_status": org["verification_status"]} if org else None,
        "application": app, "verification": v, "domain_match": domain_ok, "previous_letters": prev,
        "recipient_options": other_orgs, "credential_id": r["credential_id"],
        "steps": {"email_code": bool(v.get("email_code_verified")), "affiliation": bool(v.get("affiliation_verified")),
                  "identity": bool(v.get("identity_method"))},
    }


def save_v(conn, r):
    conn.execute("UPDATE recommendation_requests SET verification=?, updated_at=? WHERE id=?", (json.dumps(r["verification"]), now(), r["id"]))


def h_invite(conn, user, body, params):
    r = load_invite(conn, params["token"])
    if r["status"] == "sent":
        conn.execute("UPDATE recommendation_requests SET status='opened', updated_at=? WHERE id=?", (now(), r["id"]))
        r["status"] = "opened"
        audit(conn, None, "recommendation.opened", "recommendation", r["id"], r["recommender_name"] + " opened the invitation", r["applicant_id"])
    return invite_view(conn, r, user)


def h_invite_send_code(conn, user, body, params):
    r = load_invite(conn, params["token"])
    code = "%06d" % secrets.randbelow(1000000)
    r["verification"]["code_hash"] = sha256_bytes(code.encode())
    r["verification"]["code_sent_at"] = now()
    save_v(conn, r)
    return {"sent_to": r["recommender_email"], "simulated_code": code,
            "note": "Email delivery is simulated in this MVP — the code is shown here instead of being emailed."}


def h_invite_verify_code(conn, user, body, params):
    r = load_invite(conn, params["token"])
    v = r["verification"]
    if not v.get("code_hash") or sha256_bytes((body.get("code") or "").strip().encode()) != v["code_hash"]:
        raise ApiError(400, "That code does not match. Request a new one and try again.")
    v.update({"email_code_verified": True, "email_verified_at": now()})
    org = one(conn, "SELECT * FROM organizations WHERE id=?", r["org_id"])
    if org and org["verification_status"] == "verified" and r["recommender_email"].endswith("@" + (org["domain"] or "~")):
        v.update({"affiliation_verified": True, "affiliation_method": "Email domain matches verified institution %s (%s)" % (org["name"], org["domain"])})
    save_v(conn, r)
    audit(conn, None, "recommender.email_verified", "recommendation", r["id"], r["recommender_email"], r["applicant_id"])
    return invite_view(conn, r, user)


def h_invite_assurance(conn, user, body, params):
    r = load_invite(conn, params["token"])
    v = r["verification"]
    if not v.get("email_code_verified"):
        raise ApiError(400, "Verify your email first.")
    method = body.get("method")
    methods = {"sso": "Institutional single sign-on (simulated)", "id_document": "Government ID + selfie check (simulated)",
               "registrar": "Confirmation by institution registrar (simulated)"}
    if method not in methods:
        raise ApiError(400, "Choose a verification method.")
    v.update({"identity_method": methods[method], "identity_level": "substantial", "identity_verified_at": now()})
    if not v.get("affiliation_verified") and method in ("sso", "registrar"):
        v.update({"affiliation_verified": True, "affiliation_method": methods[method]})
    save_v(conn, r)
    audit(conn, None, "recommender.identity_verified", "recommendation", r["id"], methods[method], r["applicant_id"])
    return invite_view(conn, r, user)


def h_invite_respond(conn, user, body, params):
    r = load_invite(conn, params["token"])
    if r["status"] in ("submitted", "declined"):
        raise ApiError(400, "This request is already %s." % r["status"])
    applicant = one(conn, "SELECT * FROM users WHERE id=?", r["applicant_id"])
    if body.get("accept"):
        conn.execute("UPDATE recommendation_requests SET status='accepted', updated_at=? WHERE id=?", (now(), r["id"]))
        audit(conn, None, "recommendation.accepted", "recommendation", r["id"], r["recommender_name"] + " accepted", applicant["id"])
        notify(conn, applicant["id"], "Recommendation accepted", "%s accepted your request." % r["recommender_name"], "#/vault")
    else:
        conn.execute("UPDATE recommendation_requests SET status='declined', decline_reason=?, updated_at=? WHERE id=?",
                     ((body.get("reason") or "")[:500], now(), r["id"]))
        audit(conn, None, "recommendation.declined", "recommendation", r["id"], r["recommender_name"] + " declined", applicant["id"])
        notify(conn, applicant["id"], "Recommendation declined", "%s declined your request." % r["recommender_name"], "#/vault")
    return invite_view(conn, load_invite(conn, params["token"]), user)


def h_invite_submit(conn, user, body, params):
    r = load_invite(conn, params["token"])
    v = r["verification"]
    if r["status"] != "accepted":
        raise ApiError(400, "Accept the request before submitting a letter.")
    if not (v.get("email_code_verified") and v.get("affiliation_verified") and v.get("identity_method")):
        raise ApiError(400, "Complete identity and affiliation verification before submitting.")
    content, file_bytes = body.get("content"), None
    if body.get("data_b64"):
        file_bytes = base64.b64decode(body["data_b64"])
        if len(file_bytes) > MAX_UPLOAD_BYTES:
            raise ApiError(413, "Files must be 8 MB or smaller.")
        content = None
    elif not (content or "").strip() or len(content.strip()) < 80:
        raise ApiError(400, "Write the letter (at least a few sentences) or upload a file.")
    rec_user = one(conn, "SELECT * FROM users WHERE email=?", r["recommender_email"])
    if not rec_user:
        rec_id = uid("usr")
        conn.execute("""INSERT INTO users(id,name,email,role,headline,languages,profile,settings,identity_level,identity_method,
            signing_key,is_demo,created_at) VALUES(?,?,?,'recommender',?,'[]','{}','{}',?,?,?,0,?)""",
                     (rec_id, r["recommender_name"], r["recommender_email"], body.get("position") or "", v.get("identity_level"),
                      v.get("identity_method"), secrets.token_hex(32), now()))
        conn.execute("INSERT OR IGNORE INTO org_members VALUES(?,?,'faculty','authorized')", (rec_id, r["org_id"]))
        rec_user = one(conn, "SELECT * FROM users WHERE id=?", rec_id)
    permitted = [o for o in (body.get("permitted_recipients") or []) if isinstance(o, str)]
    reuse = body.get("reuse_policy") if body.get("reuse_policy") in ("any", "recipient_specific") else "recipient_specific"
    if reuse == "recipient_specific" and not permitted:
        raise ApiError(400, "Choose at least one permitted recipient, or allow reuse for any application.")
    org = one(conn, "SELECT * FROM organizations WHERE id=?", r["org_id"])
    row = create_credential(
        conn, type="recommendation", title=body.get("title") or "Recommendation — " + r["recommender_name"],
        subject_id=r["applicant_id"], source="recommender", status="verified", content=content, file_bytes=file_bytes,
        file_name=body.get("file_name"), mime=body.get("mime"), issuer_org_id=r["org_id"], issuer_user_id=rec_user["id"],
        issuer_name=r["recommender_name"], sig_key_ref="user:" + rec_user["id"],
        signature_method="Recommender signature (simulated HMAC-SHA256)",
        verification_method="; ".join(filter(None, ["Email one-time code (simulated delivery)", v.get("affiliation_method"), v.get("identity_method")])),
        expires_at=body.get("expires_at") or None, confidential=1 if body.get("confidential", True) else 0,
        reuse_policy=reuse, permitted=permitted,
        metadata={"relationship": body.get("relationship") or "", "position": body.get("position") or "",
                  "affiliation": org["name"] if org else "", "request_id": r["id"]})
    conn.execute("UPDATE recommendation_requests SET status='submitted', credential_id=?, recommender_user_id=?, updated_at=? WHERE id=?",
                 (row["id"], rec_user["id"], now(), r["id"]))
    audit(conn, rec_user, "recommendation.submitted", "credential", row["id"],
          ("Confidential" if row["confidential"] else "Visible to applicant") + ", sha256 " + row["integrity_hash"][:12], r["applicant_id"])
    notify(conn, r["applicant_id"], "Recommendation received",
           "%s submitted a %srecommendation." % (r["recommender_name"], "confidential " if row["confidential"] else ""), "#/credential/" + row["id"])
    return {"ok": True, "credential_id": row["id"], "integrity_hash": row["integrity_hash"]}


def h_recommender_requests(conn, user, body, params):
    rows = many(conn, """SELECT r.*, u.name applicant_name, a.title app_title FROM recommendation_requests r
        JOIN users u ON u.id=r.applicant_id LEFT JOIN applications a ON a.id=r.application_id
        WHERE r.recommender_email=? ORDER BY r.created_at DESC""", user["email"])
    for r in rows:
        r["invite_link"] = "#/invite/" + r.pop("token")
        r["verification"] = None
    issued = many(conn, "SELECT id,title,issued_at,confidential,revoked_at,subject_user_id FROM credentials WHERE issuer_user_id=? ORDER BY issued_at DESC", user["id"])
    return {"requests": rows, "issued": issued}


def h_recommender_revoke(conn, user, body, params):
    row = one(conn, "SELECT * FROM credentials WHERE id=? AND issuer_user_id=?", params["id"], user["id"])
    if not row:
        raise ApiError(404, "Not found")
    conn.execute("UPDATE credentials SET revoked_at=?, revocation_reason=? WHERE id=?", (now(), body.get("reason") or "Withdrawn by recommender", row["id"]))
    audit(conn, user, "credential.revoked", "credential", row["id"], body.get("reason") or "Withdrawn by recommender", row["subject_user_id"])
    notify(conn, row["subject_user_id"], "Recommendation withdrawn", "%s withdrew a recommendation." % user["name"], "#/credential/" + row["id"])
    return {"ok": True}


# ---- organization portal (institutions + employers)

def my_org(conn, user):
    m = one(conn, """SELECT o.*, m.role member_role FROM org_members m JOIN organizations o ON o.id=m.org_id
        WHERE m.user_id=? AND m.authorization_status='authorized'""", user["id"])
    if not m:
        raise ApiError(403, "You are not an authorized representative of any organization.")
    m.pop("signing_key", None)
    return m


def h_org_overview(conn, user, body, params):
    org = my_org(conn, user)
    reqs = many(conn, """SELECT d.*, u.name applicant_name, u.email applicant_email FROM document_requests d JOIN users u ON u.id=d.applicant_id
        WHERE d.org_id=? ORDER BY d.status='requested' DESC, d.created_at DESC""", org["id"])
    for d in reqs:
        d["type_label"] = "Verify uploaded document" if d["type"] == "verify_upload" else DOC_TYPES.get(d["type"], d["type"])
        if d["type"] == "verify_upload" and d["credential_id"]:
            c = one(conn, "SELECT * FROM credentials WHERE id=?", d["credential_id"])
            d["upload"] = {"title": c["title"], "file_name": c["file_name"], "integrity_hash": c["integrity_hash"],
                           "content": c["content"] if not is_file(c) else None, "id": c["id"]} if c else None
    issued = [serialize_credential(conn, r, user) for r in many(conn,
              "SELECT * FROM credentials WHERE issuer_org_id=? AND source='issuer' ORDER BY issued_at DESC", org["id"])]
    for c in issued:
        s = one(conn, "SELECT name, email FROM users WHERE id=?", c["subject_user_id"]) or {}
        c["subject_name"], c["subject_email"] = s.get("name"), s.get("email")
    pkgs = many(conn, """SELECT p.id,p.status,p.review_status,p.created_at,p.expires_at,p.credential_ids,u.name applicant_name,u.headline,
        a.title app_title, a.deadline FROM packages p JOIN users u ON u.id=p.applicant_id LEFT JOIN applications a ON a.id=p.application_id
        WHERE p.recipient_org_id=? AND p.status='active' ORDER BY p.created_at DESC""", org["id"])
    for p in pkgs:
        ids = jl(p.pop("credential_ids"), [])
        rows = [one(conn, "SELECT * FROM credentials WHERE id=?", i) for i in ids]
        sts = [effective_status(r, *check_credential(conn, r)) for r in rows if r]
        p["doc_count"] = len(sts)
        p["verified_count"] = sum(1 for s in sts if s == "verified")
    programs = many(conn, "SELECT * FROM programs WHERE org_id=? ORDER BY deadline", org["id"])
    for p in programs:
        p["requirements"] = jl(p["requirements"], [])
        p["applicants"] = one(conn, "SELECT COUNT(*) n FROM applications WHERE program_id=?", p["id"])["n"]
    members = many(conn, """SELECT u.id,u.name,u.email,u.identity_level,u.identity_method,m.role,m.authorization_status FROM org_members m
        JOIN users u ON u.id=m.user_id WHERE m.org_id=?""", org["id"])
    return {"org": org, "requests": reqs, "issued": issued, "packages": pkgs, "programs": programs, "members": members,
            "doc_types": DOC_TYPES}


def org_doc_request(conn, user, rid):
    org = my_org(conn, user)
    d = one(conn, "SELECT * FROM document_requests WHERE id=? AND org_id=?", rid, org["id"])
    if not d:
        raise ApiError(404, "Request not found")
    return org, d


def h_org_issue(conn, user, body, params):
    org = my_org(conn, user)
    if org["verification_status"] != "verified":
        raise ApiError(403, "Your organization must be verified before it can issue credentials.")
    d = None
    if params.get("id"):
        org, d = org_doc_request(conn, user, params["id"])
        if d["status"] != "requested":
            raise ApiError(400, "This request is already closed.")
        subject_id = d["applicant_id"]
    else:
        s = one(conn, "SELECT * FROM users WHERE email=? AND role='applicant'", (body.get("subject_email") or "").strip().lower())
        if not s:
            raise ApiError(404, "No applicant with that email on Credo.")
        subject_id = s["id"]
    if d and d["type"] == "verify_upload":
        c = one(conn, "SELECT * FROM credentials WHERE id=?", d["credential_id"])
        c.update({"status": "verified", "issuer_org_id": org["id"], "issuer_user_id": user["id"], "issuer_name": org["name"],
                  "sig_key_ref": "org:" + org["id"], "signature_method": "Issuer attestation of uploaded file (simulated HMAC-SHA256)",
                  "verification_method": "Applicant upload confirmed authentic by issuer"})
        c["signature"] = sign_row(conn, c)
        conn.execute("""UPDATE credentials SET status='verified', issuer_org_id=?, issuer_user_id=?, issuer_name=?, sig_key_ref=?,
            signature_method=?, verification_method=?, signature=?, source='issuer' WHERE id=?""",
                     (org["id"], user["id"], org["name"], c["sig_key_ref"], c["signature_method"], c["verification_method"], c["signature"], c["id"]))
        conn.execute("UPDATE document_requests SET status='issued', updated_at=? WHERE id=?", (now(), d["id"]))
        audit(conn, user, "credential.verified_upload", "credential", c["id"], "Confirmed by " + org["name"], subject_id)
        notify(conn, subject_id, "Document verified", "%s confirmed “%s”." % (org["name"], c["title"]), "#/credential/" + c["id"])
        return {"id": c["id"]}
    ctype = (d["type"] if d else body.get("type")) or "certificate"
    fields = body.get("fields") or {}
    subj = one(conn, "SELECT name FROM users WHERE id=?", subject_id)
    content = json.dumps(dict({"kind": ctype, "subject": subj["name"], "issuer": org["name"],
                               "issued_by": user["name"], "notice": "SIMULATED DEMO CREDENTIAL"}, **fields), indent=2)
    row = create_credential(conn, type=ctype, title=body.get("title") or DOC_TYPES.get(ctype), subject_id=subject_id,
                            source="issuer", status="verified", content=content, issuer_org_id=org["id"], issuer_user_id=user["id"],
                            issuer_name=org["name"], sig_key_ref="org:" + org["id"],
                            signature_method="Institutional digital signature (simulated HMAC-SHA256)",
                            verification_method="Issued directly by verified %s representative" % org["type"].replace("_", " "),
                            expires_at=body.get("expires_at") or None)
    if d:
        conn.execute("UPDATE document_requests SET status='issued', credential_id=?, updated_at=? WHERE id=?", (row["id"], now(), d["id"]))
    audit(conn, user, "credential.issued", "credential", row["id"], row["title"], subject_id)
    notify(conn, subject_id, "New verified credential", "%s issued “%s”." % (org["name"], row["title"]), "#/credential/" + row["id"])
    return {"id": row["id"]}


def h_org_reject(conn, user, body, params):
    org, d = org_doc_request(conn, user, params["id"])
    conn.execute("UPDATE document_requests SET status='rejected', response_note=?, updated_at=? WHERE id=?",
                 ((body.get("reason") or "")[:500], now(), d["id"]))
    if d["type"] == "verify_upload" and d["credential_id"]:
        conn.execute("UPDATE credentials SET status='failed', verification_method=? WHERE id=?",
                     ("Issuer could not confirm this document: " + (body.get("reason") or "no reason given"), d["credential_id"]))
    audit(conn, user, "document_request.rejected", "document_request", d["id"], body.get("reason") or "", d["applicant_id"])
    notify(conn, d["applicant_id"], "Request declined", "%s could not fulfil your request. %s" % (org["name"], body.get("reason") or ""), "#/vault")
    return {"ok": True}


def h_org_revoke(conn, user, body, params):
    org = my_org(conn, user)
    row = one(conn, "SELECT * FROM credentials WHERE id=? AND issuer_org_id=?", params["id"], org["id"])
    if not row:
        raise ApiError(404, "Credential not found")
    reason = (body.get("reason") or "").strip() or "Revoked by issuer"
    conn.execute("UPDATE credentials SET revoked_at=?, revocation_reason=? WHERE id=?", (now(), reason, row["id"]))
    audit(conn, user, "credential.revoked", "credential", row["id"], reason, row["subject_user_id"])
    notify(conn, row["subject_user_id"], "Credential revoked", "%s revoked “%s”: %s" % (org["name"], row["title"], reason), "#/credential/" + row["id"])
    return {"ok": True}


def h_org_package(conn, user, body, params):
    org = my_org(conn, user)
    p = one(conn, "SELECT * FROM packages WHERE id=? AND recipient_org_id=?", params["id"], org["id"])
    if not p:
        raise ApiError(404, "Package not found")
    a = one(conn, "SELECT * FROM applications WHERE id=?", p["application_id"])
    applicant = one(conn, "SELECT * FROM users WHERE id=?", p["applicant_id"])
    creds = []
    for cid in jl(p["credential_ids"], []):
        row = one(conn, "SELECT * FROM credentials WHERE id=?", cid)
        if row:
            c = serialize_credential(conn, row, user)
            c["grant_active"] = bool(active_grant(conn, cid, org["id"]))
            creds.append(c)
    reqs = match_requirements(conn, a) if a else []
    included = set(jl(p["credential_ids"], []))
    for q in reqs:
        q["in_package"] = bool(q["credential"] and q["credential"]["id"] in included)
        q.pop("next_action", None)
        q.pop("pending_request", None)
    audit(conn, user, "package.reviewed", "package", p["id"], org["name"], p["applicant_id"])
    return {"package": {k: p[k] for k in ("id", "status", "review_status", "created_at", "expires_at", "message", "views")},
            "application": {"title": a["title"], "deadline": a["deadline"], "type": a["type"]} if a else None,
            "applicant": {"name": applicant["name"], "headline": applicant["headline"], "location": applicant["location"],
                          "email": applicant["email"], "identity_level": applicant["identity_level"],
                          "identity_method": applicant["identity_method"], "summary": applicant["summary"]},
            "credentials": creds, "requirements": reqs,
            "history": many(conn, "SELECT * FROM audit_logs WHERE resource_id=? ORDER BY created_at DESC", p["id"])}


def h_org_package_status(conn, user, body, params):
    org = my_org(conn, user)
    p = one(conn, "SELECT * FROM packages WHERE id=? AND recipient_org_id=?", params["id"], org["id"])
    if not p:
        raise ApiError(404, "Package not found")
    st = body.get("review_status")
    if st not in ("received", "in_review", "info_requested", "review_complete"):
        raise ApiError(400, "Invalid status")
    conn.execute("UPDATE packages SET review_status=? WHERE id=?", (st, p["id"]))
    audit(conn, user, "package.status_changed", "package", p["id"], st.replace("_", " "), p["applicant_id"])
    if st == "info_requested" or body.get("message"):
        msg = (body.get("message") or "").strip()
        notify(conn, p["applicant_id"], "%s requested more information" % org["name"], msg or "Please check your application.",
               "#/applications/" + (p["application_id"] or ""))
        audit(conn, user, "package.info_requested", "package", p["id"], msg, p["applicant_id"])
    return {"ok": True}


def h_org_program(conn, user, body, params):
    org = my_org(conn, user)
    p = one(conn, "SELECT * FROM programs WHERE id=? AND org_id=?", params["id"], org["id"])
    if not p:
        raise ApiError(404, "Program not found")
    reqs = [{"doc_type": r["doc_type"], "label": (r.get("label") or DOC_TYPES.get(r["doc_type"], ""))[:120],
             "min_status": "any" if r.get("min_status") == "any" else "verified"}
            for r in body.get("requirements") or [] if r.get("doc_type") in DOC_TYPES]
    conn.execute("UPDATE programs SET requirements=?, deadline=COALESCE(?, deadline) WHERE id=?",
                 (json.dumps(reqs), body.get("deadline"), p["id"]))
    audit(conn, user, "program.requirements_updated", "program", p["id"], "%d requirements" % len(reqs))
    return {"ok": True, "note": "Applies to new applications. Existing applications keep their requirements."}


# ---- admin

def h_admin(conn, user, body, params):
    counts = {k: one(conn, sql)["n"] for k, sql in {
        "users": "SELECT COUNT(*) n FROM users", "applicants": "SELECT COUNT(*) n FROM users WHERE role='applicant'",
        "organizations": "SELECT COUNT(*) n FROM organizations", "credentials": "SELECT COUNT(*) n FROM credentials",
        "verified_credentials": "SELECT COUNT(*) n FROM credentials WHERE status='verified' AND revoked_at IS NULL",
        "packages": "SELECT COUNT(*) n FROM packages WHERE status='active'",
        "recommendations": "SELECT COUNT(*) n FROM recommendation_requests"}.items()}
    integrity_failures = []
    for r in many(conn, "SELECT * FROM credentials"):
        i, s = check_credential(conn, r)
        if not i or s is False:
            integrity_failures.append({"id": r["id"], "title": r["title"], "integrity": i, "signature": s})
    return {"counts": counts,
            "orgs": many(conn, "SELECT id,name,type,domain,country,verification_status,verified_at,description FROM organizations ORDER BY verification_status!='pending', name"),
            "audit": many(conn, "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 60"),
            "integrity_failures": integrity_failures}


def h_admin_org(conn, user, body, params):
    o = one(conn, "SELECT * FROM organizations WHERE id=?", params["id"])
    if not o:
        raise ApiError(404, "Organization not found")
    dec = body.get("decision")
    if dec not in ("verified", "rejected", "pending"):
        raise ApiError(400, "Invalid decision")
    conn.execute("UPDATE organizations SET verification_status=?, verified_at=? WHERE id=?", (dec, now() if dec == "verified" else None, o["id"]))
    audit(conn, user, "organization." + dec, "organization", o["id"], o["name"])
    return {"ok": True}


def h_admin_tamper(conn, user, body, params):
    """Demo only: corrupts a stored credential so the integrity check visibly fails."""
    row = one(conn, "SELECT * FROM credentials WHERE id=?", params["id"])
    if not row or is_file(row):
        raise ApiError(400, "Pick a text credential")
    if body.get("restore") and row["content"].endswith("\n[tampered]"):
        conn.execute("UPDATE credentials SET content=? WHERE id=?", (row["content"][:-len("\n[tampered]")], row["id"]))
        audit(conn, user, "demo.tamper_restored", "credential", row["id"], "", row["subject_user_id"])
    elif not body.get("restore"):
        conn.execute("UPDATE credentials SET content=? WHERE id=?", (row["content"] + "\n[tampered]", row["id"]))
        audit(conn, user, "demo.tampered", "credential", row["id"], "Simulated tampering for demo", row["subject_user_id"])
    return {"ok": True}


# ---------------------------------------------------------------- routing

ANY = ("applicant", "recommender", "institution_rep", "employer_rep", "admin")
ORG = ("institution_rep", "employer_rep")
ROUTES = [
    ("GET", r"/api/session", h_session, None),
    ("GET", r"/api/personas", h_personas, None),
    ("POST", r"/api/login", h_login, None),
    ("POST", r"/api/logout", h_logout, None),
    ("POST", r"/api/signup", h_signup, None),
    ("GET", r"/api/orgs", h_orgs, None),
    ("GET", r"/api/programs", h_programs, None),
    ("GET", r"/api/me/dashboard", h_dashboard, ("applicant",)),
    ("GET", r"/api/me/profile", h_profile, ("applicant",)),
    ("PUT", r"/api/me/profile", h_profile_update, ("applicant",)),
    ("GET", r"/api/me/settings", h_settings_get, ANY),
    ("PUT", r"/api/me/settings", h_settings_put, ANY),
    ("GET", r"/api/me/export", h_export, ("applicant",)),
    ("POST", r"/api/me/delete-request", h_delete_request, ("applicant",)),
    ("GET", r"/api/credentials", h_credentials, ("applicant",)),
    ("POST", r"/api/credentials/upload", h_upload, ("applicant",)),
    ("GET", r"/api/credentials/(?P<id>[\w-]+)", h_credential, ANY),
    ("GET", r"/api/credentials/(?P<id>[\w-]+)/vc", h_credential_vc, ANY),
    ("POST", r"/api/credentials/(?P<id>[\w-]+)/verify", h_verify, ANY),
    ("GET", r"/api/credentials/(?P<id>[\w-]+)/download", h_download, ANY),
    ("POST", r"/api/credentials/(?P<id>[\w-]+)/request-verification", h_request_verification, ("applicant",)),
    ("POST", r"/api/recommendations", h_rec_create, ("applicant",)),
    ("POST", r"/api/recommendations/(?P<id>[\w-]+)/(?P<action>remind|cancel)", h_rec_action, ("applicant",)),
    ("POST", r"/api/doc-requests", h_docreq_create, ("applicant",)),
    ("GET", r"/api/applications", h_apps, ("applicant",)),
    ("POST", r"/api/applications", h_app_create, ("applicant",)),
    ("GET", r"/api/applications/(?P<id>[\w-]+)", h_app, ("applicant",)),
    ("DELETE", r"/api/applications/(?P<id>[\w-]+)", h_app_delete, ("applicant",)),
    ("GET", r"/api/packages", h_pkgs, ("applicant",)),
    ("POST", r"/api/packages", h_pkg_create, ("applicant",)),
    ("POST", r"/api/packages/(?P<id>[\w-]+)/revoke", h_pkg_revoke, ("applicant",)),
    ("GET", r"/api/grants", h_grants, ("applicant",)),
    ("POST", r"/api/grants/(?P<id>[\w-]+)/revoke", h_grant_revoke, ("applicant",)),
    ("GET", r"/api/audit", h_audit, ANY),
    ("GET", r"/api/notifications", h_notifications, ANY),
    ("POST", r"/api/notifications/read", h_notifications_read, ANY),
    ("GET", r"/api/share/(?P<token>[\w-]+)", h_share, None),
    ("GET", r"/api/share/(?P<token>[\w-]+)/credentials/(?P<cid>[\w-]+)/download", h_share_download, None),
    ("GET", r"/api/invite/(?P<token>[\w-]+)", h_invite, None),
    ("POST", r"/api/invite/(?P<token>[\w-]+)/send-code", h_invite_send_code, None),
    ("POST", r"/api/invite/(?P<token>[\w-]+)/verify-code", h_invite_verify_code, None),
    ("POST", r"/api/invite/(?P<token>[\w-]+)/assurance", h_invite_assurance, None),
    ("POST", r"/api/invite/(?P<token>[\w-]+)/respond", h_invite_respond, None),
    ("POST", r"/api/invite/(?P<token>[\w-]+)/submit", h_invite_submit, None),
    ("GET", r"/api/recommender/requests", h_recommender_requests, ("recommender",)),
    ("POST", r"/api/recommender/credentials/(?P<id>[\w-]+)/revoke", h_recommender_revoke, ("recommender",)),
    ("GET", r"/api/org/overview", h_org_overview, ORG),
    ("POST", r"/api/org/requests/(?P<id>[\w-]+)/issue", h_org_issue, ORG),
    ("POST", r"/api/org/requests/(?P<id>[\w-]+)/reject", h_org_reject, ORG),
    ("POST", r"/api/org/credentials/issue", h_org_issue, ORG),
    ("POST", r"/api/org/credentials/(?P<id>[\w-]+)/revoke", h_org_revoke, ORG),
    ("GET", r"/api/org/packages/(?P<id>[\w-]+)", h_org_package, ORG),
    ("POST", r"/api/org/packages/(?P<id>[\w-]+)/status", h_org_package_status, ORG),
    ("PUT", r"/api/org/programs/(?P<id>[\w-]+)", h_org_program, ORG),
    ("GET", r"/api/admin/overview", h_admin, ("admin",)),
    ("POST", r"/api/admin/orgs/(?P<id>[\w-]+)/verify", h_admin_org, ("admin",)),
    ("POST", r"/api/admin/credentials/(?P<id>[\w-]+)/tamper", h_admin_tamper, ("admin",)),
]
COMPILED = [(m, re.compile("^" + p + "$"), f, a) for m, p, f, a in ROUTES]


class Handler(BaseHTTPRequestHandler):
    server_version = "Credo/0.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.command, self.path))

    def _security_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")

    def _send(self, status, data, mime="application/json", extra=None):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self._security_headers()
        for k, v in (extra or []):
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _session_token(self):
        c = cookies.SimpleCookie(self.headers.get("Cookie", ""))
        return c["credo_session"].value if "credo_session" in c else None

    def _dispatch(self, method):
        path = urlparse(self.path).path
        if not path.startswith("/api/"):
            return self._static(path)
        if method == "POST" and path == "/api/demo/reset":
            if DATABASE_URL:  # hosted: real accounts live here, so never allow a wipe from the web
                return self._send(403, json.dumps({"error": "Reset is disabled on the hosted site."}).encode())
            return self._reset()
        for m, rx, fn, roles in COMPILED:
            mt = rx.match(path)
            if not mt or m != method:
                continue
            try:
                length = int(self.headers.get("Content-Length") or 0)
                if length > MAX_UPLOAD_BYTES * 2:
                    raise ApiError(413, "Request too large")
                body = json.loads(self.rfile.read(length) or b"{}") if length else {}
                with DB_LOCK:
                    conn = db()
                    try:
                        tok = self._session_token()
                        user = one(conn, "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?", tok) if tok else None
                        if roles is not None:
                            if not user:
                                raise ApiError(401, "Please sign in.")
                            if user["role"] not in roles:
                                raise ApiError(403, "Your role cannot perform this action.")
                        result = fn(conn, user, body, mt.groupdict())
                        if isinstance(result, dict) and result.get("_clear_session") and tok:
                            conn.execute("DELETE FROM sessions WHERE token=?", (tok,))
                        conn.commit()
                    except Exception:
                        conn.rollback()
                        raise
                    finally:
                        conn.close()
                if isinstance(result, dict) and "_raw" in result:
                    return self._send(200, result["_raw"], result["_mime"],
                                      [("Content-Disposition", 'attachment; filename="%s"' % result["_filename"])])
                extra = []
                if isinstance(result, dict) and result.get("_set_session"):
                    secure = "; Secure" if self.headers.get("X-Forwarded-Proto") == "https" else ""
                    extra.append(("Set-Cookie", "credo_session=%s; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000%s" % (result.pop("_set_session"), secure)))
                if isinstance(result, dict) and result.pop("_clear_session", None):
                    extra.append(("Set-Cookie", "credo_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"))
                return self._send(200, json.dumps(result, default=str).encode(), extra=extra)
            except ApiError as e:
                return self._send(e.status, json.dumps({"error": e.message}).encode())
            except (ValueError, KeyError, TypeError) as e:
                return self._send(400, json.dumps({"error": "Bad request: %s" % e}).encode())
            except Exception as e:  # pragma: no cover
                import traceback
                traceback.print_exc()
                return self._send(500, json.dumps({"error": "Server error"}).encode())
        self._send(404, json.dumps({"error": "Not found"}).encode())

    def _reset(self):
        with DB_LOCK:
            if DATABASE_URL:
                conn = db()
                for t in TABLES:
                    conn.execute("DROP TABLE IF EXISTS %s CASCADE" % t)
                conn.commit()
            elif os.path.exists(DB_PATH):
                os.remove(DB_PATH)
            init_db()
        self._send(200, b'{"ok":true}', extra=[("Set-Cookie", "credo_session=; Path=/; Max-Age=0")])

    def _static(self, path):
        rel = path.lstrip("/") or "index.html"
        full = os.path.normpath(os.path.join(STATIC_DIR, rel))
        if full.startswith(STATIC_DIR + os.sep) and os.path.isfile(full):
            with open(full, "rb") as f:
                data = f.read()
        elif rel in ASSETS:  # deployed without the static/ folder: use the bundled copy
            data = ASSETS[rel].encode("utf-8")
        else:
            rel = "index.html"
            index = os.path.join(STATIC_DIR, rel)
            if os.path.isfile(index):
                with open(index, "rb") as f:
                    data = f.read()
            else:
                data = ASSETS[rel].encode("utf-8")
        mime = mimetypes.guess_type(rel)[0] or "application/octet-stream"
        if mime.startswith("text/") or mime.endswith("javascript"):
            mime += "; charset=utf-8"
        self._send(200, data, mime)

    def do_GET(self):
        self._dispatch("GET")

    def do_HEAD(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PUT(self):
        self._dispatch("PUT")

    def do_DELETE(self):
        self._dispatch("DELETE")


def init_db():
    os.makedirs(FILES_DIR, exist_ok=True)
    conn = db()
    conn.executescript(SCHEMA)
    conn.commit()
    for table, col in [("users", "password_hash"), ("credentials", "file_data")]:  # upgrade older databases
        try:
            conn.execute("ALTER TABLE %s ADD COLUMN %s TEXT" % (table, col))
            conn.commit()
        except Exception:
            conn.rollback()
    seed(conn)
    conn.commit()
    conn.close()


if __name__ == "__main__":
    mimetypes.add_type("text/javascript", ".js")
    mimetypes.add_type("text/css", ".css")
    init_db()
    print("Credo MVP running on http://%s:%d" % ("localhost" if HOST == "127.0.0.1" else HOST, PORT), flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
