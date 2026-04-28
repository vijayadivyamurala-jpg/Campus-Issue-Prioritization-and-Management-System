from __future__ import annotations

import json
import os
import shutil
import sqlite3
import tempfile
import uuid
import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from email.message import EmailMessage
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request, send_from_directory


ROOT = Path(__file__).resolve().parent
LEGACY_RUNTIME_DIR = Path(tempfile.gettempdir()) / "RTFP"
RUNTIME_DIR = ROOT / "data"
DB_PATH = RUNTIME_DIR / "campus_support.db"

app = Flask(__name__, static_folder=str(ROOT), static_url_path="")
APP_READY = False
DISPLAY_BASE_URL = os.environ.get("RESET_BASE_URL", "http://127.0.0.1:5000").rstrip("/")
print(f"\nOpen this link in your browser: {DISPLAY_BASE_URL}/index.html\n", flush=True)


def load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


load_env_file(ROOT / ".env")


def now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def future_iso(hours: int) -> str:
    return (datetime.utcnow() + timedelta(hours=hours)).replace(microsecond=0).isoformat() + "Z"


def future_iso_minutes(minutes: int) -> str:
    return (datetime.utcnow() + timedelta(minutes=minutes)).replace(microsecond=0).isoformat() + "Z"


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_reset_otp() -> str:
    return f"{secrets.randbelow(900000) + 100000:06d}"


def db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def migrate_legacy_db() -> None:
    legacy_db_path = LEGACY_RUNTIME_DIR / "campus_support.db"
    if DB_PATH.exists() or not legacy_db_path.exists():
        return

    RUNTIME_DIR.mkdir(exist_ok=True)
    shutil.copy2(legacy_db_path, DB_PATH)


def init_db() -> None:
    RUNTIME_DIR.mkdir(exist_ok=True)
    migrate_legacy_db()
    conn = db_connection()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            role TEXT NOT NULL,
            fname TEXT NOT NULL,
            lname TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            department TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS issues (
            id TEXT PRIMARY KEY,
            reporter_name TEXT NOT NULL,
            reporter_email TEXT NOT NULL,
            reporter_role TEXT NOT NULL,
            category TEXT NOT NULL,
            location TEXT NOT NULL,
            description TEXT NOT NULL,
            photo TEXT,
            photo_name TEXT,
            priority TEXT NOT NULL,
            priority_score REAL NOT NULL DEFAULT 0,
            priority_urgency INTEGER,
            priority_severity INTEGER,
            priority_impact INTEGER,
            priority_source TEXT NOT NULL,
            assigned_department TEXT,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            resolved_at TEXT
        );

        CREATE TABLE IF NOT EXISTS issue_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            issue_id TEXT NOT NULL,
            status TEXT NOT NULL,
            note TEXT NOT NULL,
            department TEXT,
            changed_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS resolved_issues (
            id TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            resolved_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS email_log (
            id TEXT PRIMARY KEY,
            issue_id TEXT NOT NULL,
            to_email TEXT NOT NULL,
            subject TEXT NOT NULL,
            body TEXT NOT NULL,
            type TEXT NOT NULL,
            delivery_status TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at TEXT NOT NULL,
            used_at TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS contact_messages (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            message TEXT NOT NULL,
            delivery_status TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS audit_log (
            id TEXT PRIMARY KEY,
            action TEXT NOT NULL,
            performed_by TEXT NOT NULL,
            timestamp TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS feedback (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            rating INTEGER NOT NULL,
            comments TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        """
    )
    conn.execute(
        "INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)",
        ("admin_password", "1234"),
    )
    conn.commit()
    conn.close()
    seed_demo_data()


def generate_issue_id() -> str:
    token = str(uuid.uuid4().int)[-8:]
    return f"ISSUE-{token}"


def priority_from_score(score: float) -> str:
    if score >= 3.5:
        return "High"
    if score >= 2.5:
        return "Medium"
    return "Low"


def weighted_priority(urgency: int, severity: int, impact: int) -> dict[str, Any]:
    score = round(0.4 * urgency + 0.35 * severity + 0.25 * impact, 2)
    return {"score": score, "priority": priority_from_score(score)}


def get_admin_password() -> str:
    conn = db_connection()
    row = conn.execute(
        "SELECT value FROM app_settings WHERE key = ?",
        ("admin_password",),
    ).fetchone()
    conn.close()
    return row["value"] if row else "1234"


def update_admin_password(new_password: str) -> None:
    conn = db_connection()
    conn.execute(
        """
        INSERT INTO app_settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """,
        ("admin_password", new_password),
    )
    conn.commit()
    conn.close()


@dataclass
class AuditLog:
    log_id: str
    action: str
    performed_by: str
    timestamp: str

    @staticmethod
    def logAction(action: str, performed_by: str) -> None:
        conn = db_connection()
        conn.execute(
            """
            INSERT INTO audit_log (id, action, performed_by, timestamp)
            VALUES (?, ?, ?, ?)
            """,
            (f"AUDIT-{uuid.uuid4().hex[:10]}", action, performed_by, now_iso()),
        )
        conn.commit()
        conn.close()


@dataclass
class Priority:
    urgency: int
    severity: int
    impact: int
    total_score: float

    @staticmethod
    def calculateScore(urgency: int, severity: int, impact: int) -> dict[str, Any]:
        return weighted_priority(urgency, severity, impact)


@dataclass
class IssueHistory:
    history_id: str
    issue_id: str
    old_status: str
    new_status: str
    updated_date: str

    @staticmethod
    def recordChange(issue_id: str, old_status: str, new_status: str, department: str | None = None) -> None:
        note = f"Status changed from {old_status} to {new_status}."
        add_history(issue_id, new_status, note, department)


@dataclass
class Notification:
    notification_id: str
    message: str
    sent_date: str

    @staticmethod
    def sendNotification(issue: dict[str, Any], email_type: str, subject: str, body: str) -> None:
        create_email_log(issue, email_type, subject, body)


@dataclass
class Feedback:
    user_id: str
    rating: int
    comments: str

    @staticmethod
    def submitFeedback(user_id: str, rating: int, comments: str) -> None:
        conn = db_connection()
        conn.execute(
            """
            INSERT INTO feedback (id, user_id, rating, comments, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (f"FDBK-{uuid.uuid4().hex[:10]}", user_id, rating, comments, now_iso()),
        )
        conn.commit()
        conn.close()


@dataclass
class Issue:
    issue_id: str
    category: str
    location: str
    description: str
    photo: str
    priority_level: str
    priority_score: float
    status: str
    created_date: str

    @staticmethod
    def calculatePriority(urgency: int, severity: int, impact: int) -> dict[str, Any]:
        return Priority.calculateScore(urgency, severity, impact)

    @staticmethod
    def updateStatus(issue_id: str, status: str, actor: str) -> dict[str, Any] | None:
        payload = {"status": status, "actor": actor}
        return process_issue_status_update(issue_id, payload)


@dataclass
class Department:
    department_id: str
    department_name: str
    contact_details: str

    @staticmethod
    def acceptIssue(issue_id: str, department_name: str) -> dict[str, Any] | None:
        return update_issue_department(issue_id, department_name)

    @staticmethod
    def updateStatus(issue_id: str, status: str) -> dict[str, Any] | None:
        return Issue.updateStatus(issue_id, status, "department")

    @staticmethod
    def provideFeedback(user_id: str, rating: int, comments: str) -> None:
        Feedback.submitFeedback(user_id, rating, comments)


@dataclass
class User:
    user_id: str
    name: str
    email: str
    role: str

    @staticmethod
    def login(role: str, email: str, password: str) -> dict[str, Any]:
        conn = db_connection()
        row = conn.execute(
            "SELECT role, fname, lname, email, department FROM users WHERE role = ? AND email = ? AND password = ?",
            (role, email, password),
        ).fetchone()
        conn.close()

        if not row:
            return {"ok": False, "message": "Incorrect credentials."}

        AuditLog.logAction("User login", row["email"])
        return {
            "ok": True,
            "session": {
                "role": row["role"],
                "name": f"{row['fname']} {row['lname']}".strip(),
                "email": row["email"],
                "department": row["department"] or "",
                "loginAt": now_iso(),
            },
        }

    @staticmethod
    def reportIssue(payload: dict[str, Any]) -> dict[str, Any]:
        return create_issue_record(payload)

    @staticmethod
    def viewIssueStatus(email: str) -> list[dict[str, Any]]:
        return issue_query("lower(reporter_email) = ?", (email.lower(),))

    @staticmethod
    def resetPassword(role: str, email: str, new_password: str) -> dict[str, Any]:
        conn = db_connection()
        row = conn.execute(
            "SELECT id FROM users WHERE role = ? AND lower(email) = ?",
            (role, email.lower()),
        ).fetchone()
        if not row:
            conn.close()
            return {"ok": False, "message": "No account found for that email."}

        conn.execute(
            "UPDATE users SET password = ? WHERE id = ?",
            (new_password, row["id"]),
        )
        conn.commit()
        conn.close()
        AuditLog.logAction("Password reset", email.lower())
        return {"ok": True, "message": "Password updated. Please log in with your new password."}


@dataclass
class Admin:
    admin_id: str
    name: str
    email: str

    @staticmethod
    def reviewIssue(issue_id: str) -> dict[str, Any] | None:
        AuditLog.logAction("Admin reviewed issue", "admin")
        return jsonify_issue(issue_id)

    @staticmethod
    def assignIssue(issue_id: str, department_name: str) -> dict[str, Any] | None:
        return Department.acceptIssue(issue_id, department_name)

    @staticmethod
    def updatePriority(issue_id: str, urgency: int, severity: int, impact: int) -> dict[str, Any] | None:
        return update_issue_priority(issue_id, urgency, severity, impact)

    @staticmethod
    def generateReport() -> dict[str, Any]:
        issues = issue_query()
        stats = {
            "totalIssues": len(issues),
            "newIssues": len([issue for issue in issues if issue["status"] == "New"]),
            "inProgressIssues": len([issue for issue in issues if issue["status"] == "In Progress"]),
            "resolvedIssues": len([issue for issue in issues if issue["status"] == "Resolved"]),
        }
        AuditLog.logAction("Admin generated report", "admin")
        return stats

    @staticmethod
    def resetPassword(admin_id: str, new_password: str) -> dict[str, Any]:
        if admin_id != "admin":
            return {"ok": False, "message": "Invalid Admin ID."}

        update_admin_password(new_password)
        AuditLog.logAction("Admin password reset", admin_id)
        return {"ok": True, "message": "Admin password updated. Please log in with the new password."}


def serialize_issue_row(row: sqlite3.Row) -> dict[str, Any]:
    conn = db_connection()
    history_rows = conn.execute(
        "SELECT status, note, department, changed_at FROM issue_history WHERE issue_id = ? ORDER BY changed_at ASC, id ASC",
        (row["id"],),
    ).fetchall()
    conn.close()

    history = [
        {
            "status": item["status"],
            "note": item["note"],
            "department": item["department"],
            "changedAt": item["changed_at"],
        }
        for item in history_rows
    ]

    return {
        "id": row["id"],
        "reporterName": row["reporter_name"],
        "reporterEmail": row["reporter_email"],
        "reporterRole": row["reporter_role"],
        "category": row["category"],
        "location": row["location"],
        "description": row["description"],
        "photo": row["photo"] or "",
        "photoName": row["photo_name"] or "",
        "priority": row["priority"],
        "priorityScore": row["priority_score"],
        "priorityFactors": {
            "urgency": row["priority_urgency"],
            "severity": row["priority_severity"],
            "impact": row["priority_impact"],
        }
        if row["priority_urgency"] is not None
        else None,
        "prioritySource": row["priority_source"],
        "assignedDepartment": row["assigned_department"] or "",
        "status": row["status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "resolvedAt": row["resolved_at"] or "",
        "history": history,
    }


def issue_to_archive_payload(issue_id: str) -> str:
    conn = db_connection()
    row = conn.execute("SELECT * FROM issues WHERE id = ?", (issue_id,)).fetchone()
    conn.close()
    return json.dumps(serialize_issue_row(row))


def upsert_resolved_archive(issue_id: str, resolved_at: str) -> None:
    conn = db_connection()
    conn.execute(
        """
        INSERT INTO resolved_issues (id, payload, resolved_at)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, resolved_at = excluded.resolved_at
        """,
        (issue_id, issue_to_archive_payload(issue_id), resolved_at),
    )
    conn.commit()
    conn.close()


def remove_from_resolved_archive(issue_id: str) -> None:
    conn = db_connection()
    conn.execute("DELETE FROM resolved_issues WHERE id = ?", (issue_id,))
    conn.commit()
    conn.close()


def add_history(issue_id: str, status: str, note: str, department: str | None = None) -> None:
    conn = db_connection()
    conn.execute(
        """
        INSERT INTO issue_history (issue_id, status, note, department, changed_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (issue_id, status, note, department, now_iso()),
    )
    conn.commit()
    conn.close()


def build_issue_reported_email(issue: dict[str, Any]) -> tuple[str, str]:
    subject = f"Issue Report Confirmation - {issue['id']}"
    body = (
        f"Hello {issue['reporterName']},\n\n"
        f"Your issue has been reported successfully.\n\n"
        f"Issue ID: {issue['id']}\n"
        f"Category: {issue['category']}\n"
        f"Location: {issue['location']}\n"
        f"Current Status: {issue['status']}\n"
        f"Priority: {issue['priority']}\n"
        f"Assigned Department: {issue['assignedDepartment'] or 'Pending admin assignment'}\n\n"
        f"Please keep this issue ID for future tracking.\n\n"
        f"Regards,\nCampus Issue Management Team"
    )
    return subject, body


def build_status_email(issue: dict[str, Any]) -> tuple[str, str]:
    subject = f"Issue Status Update - {issue['id']}"
    reporter_role = issue.get("reporterRole", "user").title()
    body = (
        f"Hello {issue['reporterName']},\n\n"
        f"Your issue status has been updated.\n\n"
        f"Issue ID: {issue['id']}\n"
        f"Reported By: {issue['reporterName']} ({reporter_role})\n"
        f"Current Status: {issue['status']}\n"
        f"Priority: {issue['priority']}\n"
        f"Assigned Department: {issue['assignedDepartment'] or 'Pending admin assignment'}\n\n"
        f"You can continue tracking this issue in the portal.\n\n"
        f"Regards,\nCampus Issue Management Team"
    )
    return subject, body


def build_department_staff_status_email(issue: dict[str, Any], staff_name: str) -> tuple[str, str]:
    subject = f"Assigned Issue Status Update - {issue['id']}"
    reporter_role = issue.get("reporterRole", "user").title()
    body = (
        f"Hello {staff_name},\n\n"
        f"An issue assigned to your department has a status update.\n\n"
        f"Issue ID: {issue['id']}\n"
        f"Reported By: {issue['reporterName']} ({reporter_role})\n"
        f"Reporter Email: {issue['reporterEmail']}\n"
        f"Category: {issue['category']}\n"
        f"Location: {issue['location']}\n"
        f"Current Status: {issue['status']}\n"
        f"Priority: {issue['priority']}\n"
        f"Assigned Department: {issue['assignedDepartment'] or 'Pending admin assignment'}\n\n"
        f"Please review the department dashboard for full details.\n\n"
        f"Regards,\nCampus Issue Management Team"
    )
    return subject, body


def build_password_reset_email(name: str, otp_code: str) -> tuple[str, str]:
    subject = "Password Reset OTP - Campus Issue Management System"
    body = (
        f"Hello {name},\n\n"
        f"We received a request to reset your Campus Issue Management System password.\n\n"
        f"Use this one-time password (OTP) to reset your password:\n{otp_code}\n\n"
        f"This OTP will expire in 10 minutes and can be used only once.\n\n"
        f"If you did not request a password reset, you can ignore this email.\n\n"
        f"Regards,\nCampus Issue Management Team"
    )
    return subject, body


def try_send_email(to_email: str, subject: str, body: str) -> str:
    smtp_host = os.environ.get("SMTP_HOST", "").strip()
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_username = os.environ.get("SMTP_USERNAME", "").strip()
    smtp_password = os.environ.get("SMTP_PASSWORD", "").strip()
    smtp_from = os.environ.get("SMTP_FROM", "").strip()
    smtp_use_tls = env_bool("SMTP_USE_TLS", True)
    smtp_use_ssl = env_bool("SMTP_USE_SSL", False)

    if not smtp_host or not smtp_from:
        return "Queued - Mail service unavailable"
    if bool(smtp_username) != bool(smtp_password):
        return "Queued - Mail service unavailable"

    import smtplib

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = smtp_from
    message["To"] = to_email
    message.set_content(body)

    try:
        if smtp_use_ssl:
            server_ctx = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=20)
        else:
            server_ctx = smtplib.SMTP(smtp_host, smtp_port, timeout=20)

        with server_ctx as server:
            if not smtp_use_ssl and smtp_use_tls:
                server.starttls()
            if smtp_username:
                server.login(smtp_username, smtp_password)
            server.send_message(message)
        return "Sent"
    except Exception:
        return "Queued - Mail service unavailable"


def create_email_log_for_recipient(
    issue: dict[str, Any],
    to_email: str,
    email_type: str,
    subject: str,
    body: str,
) -> None:
    delivery_status = try_send_email(to_email, subject, body)
    conn = db_connection()
    conn.execute(
        """
        INSERT INTO email_log (id, issue_id, to_email, subject, body, type, delivery_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            f"MAIL-{uuid.uuid4().hex[:10]}",
            issue["id"],
            to_email,
            subject,
            body,
            email_type,
            delivery_status,
            now_iso(),
        ),
    )
    conn.commit()
    conn.close()


def create_email_log(issue: dict[str, Any], email_type: str, subject: str, body: str) -> None:
    create_email_log_for_recipient(issue, issue["reporterEmail"], email_type, subject, body)


def create_system_email_log(to_email: str, email_type: str, subject: str, body: str) -> str:
    delivery_status = try_send_email(to_email, subject, body)
    conn = db_connection()
    conn.execute(
        """
        INSERT INTO email_log (id, issue_id, to_email, subject, body, type, delivery_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            f"MAIL-{uuid.uuid4().hex[:10]}",
            "PASSWORD-RESET",
            to_email,
            subject,
            body,
            email_type,
            delivery_status,
            now_iso(),
        ),
    )
    conn.commit()
    conn.close()
    return delivery_status


def department_staff_recipients(department: str) -> list[dict[str, str]]:
    if not department:
        return []

    conn = db_connection()
    rows = conn.execute(
        """
        SELECT fname, lname, email
        FROM users
        WHERE role = 'staff' AND lower(department) = lower(?)
        ORDER BY fname, lname
        """,
        (department,),
    ).fetchall()
    conn.close()

    return [
        {
            "name": f"{row['fname']} {row['lname']}".strip() or row["email"],
            "email": row["email"],
        }
        for row in rows
    ]


def send_issue_status_notifications(issue: dict[str, Any]) -> None:
    subject, body = build_status_email(issue)
    Notification.sendNotification(issue, "Status Updated", subject, body)

    notified = {issue["reporterEmail"].lower()}
    for staff in department_staff_recipients(issue.get("assignedDepartment", "")):
        staff_email = staff["email"].strip().lower()
        if not staff_email or staff_email in notified:
            continue

        staff_subject, staff_body = build_department_staff_status_email(issue, staff["name"])
        create_email_log_for_recipient(issue, staff_email, "Department Status Updated", staff_subject, staff_body)
        notified.add(staff_email)


def request_password_reset(account_type: str, email: str, base_url: str) -> dict[str, Any]:
    role = "staff" if account_type == "department" else account_type
    if role not in {"student", "staff"}:
        return {"ok": False, "message": "Unsupported account type."}

    safe_message = "If this account exists, a password reset OTP has been sent to the registered email."
    conn = db_connection()
    row = conn.execute(
        """
        SELECT id, fname, lname, email
        FROM users
        WHERE role = ? AND lower(email) = ?
        """,
        (role, email.lower()),
    ).fetchone()

    if not row:
        conn.close()
        return {"ok": True, "message": safe_message}

    otp_code = generate_reset_otp()
    token_hash = hash_token(otp_code)
    conn.execute("UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL", (now_iso(), row["id"]))
    conn.execute(
        """
        INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
        VALUES (?, ?, ?, ?, NULL, ?)
        """,
        (
            f"RESET-{uuid.uuid4().hex[:10]}",
            row["id"],
            token_hash,
            future_iso_minutes(10),
            now_iso(),
        ),
    )
    conn.commit()
    conn.close()

    name = f"{row['fname']} {row['lname']}".strip() or row["email"]
    subject, body = build_password_reset_email(name, otp_code)
    create_system_email_log(row["email"], "Password Reset", subject, body)
    AuditLog.logAction("Password reset OTP requested", row["email"])
    return {"ok": True, "message": safe_message}


def complete_password_reset(account_type: str, email: str, otp_code: str, new_password: str) -> dict[str, Any]:
    role = "staff" if account_type == "department" else account_type
    if role not in {"student", "staff"}:
        return {"ok": False, "message": "Unsupported account type."}

    token_hash = hash_token(otp_code)
    conn = db_connection()
    row = conn.execute(
        """
        SELECT password_reset_tokens.id, password_reset_tokens.expires_at, users.id AS user_id, users.email
        FROM password_reset_tokens
        JOIN users ON users.id = password_reset_tokens.user_id
        WHERE users.role = ?
          AND lower(users.email) = ?
          AND password_reset_tokens.token_hash = ?
          AND password_reset_tokens.used_at IS NULL
        ORDER BY datetime(password_reset_tokens.created_at) DESC
        LIMIT 1
        """,
        (role, email.lower(), token_hash),
    ).fetchone()

    if not row:
        conn.close()
        return {"ok": False, "message": "This OTP is invalid or has already been used."}

    if row["expires_at"] < now_iso():
        conn.close()
        return {"ok": False, "message": "This OTP has expired. Please request a new one."}

    timestamp = now_iso()
    conn.execute("UPDATE users SET password = ? WHERE id = ?", (new_password, row["user_id"]))
    conn.execute("UPDATE password_reset_tokens SET used_at = ? WHERE id = ?", (timestamp, row["id"]))
    conn.commit()
    conn.close()

    AuditLog.logAction("Password reset completed", row["email"])
    return {"ok": True, "message": "Password updated. Please log in with your new password."}


def retry_queued_emails(limit: int = 200) -> dict[str, int]:
    conn = db_connection()
    rows = conn.execute(
        """
        SELECT id, to_email, subject, body
        FROM email_log
        WHERE delivery_status LIKE 'Queued%'
        ORDER BY datetime(created_at) ASC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()

    conn.close()

    processed = 0
    sent = 0
    failed_updates = 0
    for row in rows:
        processed += 1
        status = try_send_email(row["to_email"], row["subject"], row["body"])
        if status == "Sent":
            sent += 1
        try:
            update_conn = db_connection()
            update_conn.execute(
                "UPDATE email_log SET delivery_status = ? WHERE id = ?",
                (status, row["id"]),
            )
            update_conn.commit()
            update_conn.close()
        except sqlite3.Error:
            failed_updates += 1

    return {"processed": processed, "sent": sent, "failed_updates": failed_updates}


def build_contact_support_email(name: str, email: str, message: str) -> tuple[str, str]:
    subject = f"Contact Form Message from {name}"
    body = (
        "New contact form message received.\n\n"
        f"Name: {name}\n"
        f"Email: {email}\n\n"
        "Message:\n"
        f"{message}\n"
    )
    return subject, body


def save_contact_message(name: str, email: str, message: str, delivery_status: str) -> None:
    conn = db_connection()
    conn.execute(
        """
        INSERT INTO contact_messages (id, name, email, message, delivery_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            f"CONTACT-{uuid.uuid4().hex[:10]}",
            name,
            email,
            message,
            delivery_status,
            now_iso(),
        ),
    )
    conn.commit()
    conn.close()


def seed_demo_data() -> None:
    conn = db_connection()
    existing = conn.execute("SELECT COUNT(*) FROM issues").fetchone()[0]
    if existing:
        conn.close()
        return

    now = now_iso()
    demo_issues = [
        {
            "id": generate_issue_id(),
            "reporter_name": "Asha Rao",
            "reporter_email": "24b81a6695@cvr.ac.in",
            "reporter_role": "student",
            "category": "Electric",
            "location": "Block A - Room 203",
            "description": "Projector power keeps cutting out during classes.",
            "photo": "",
            "photo_name": "",
            "priority": "Pending Admin Review",
            "priority_score": 0,
            "priority_urgency": None,
            "priority_severity": None,
            "priority_impact": None,
            "priority_source": "Awaiting admin review",
            "assigned_department": "",
            "status": "New",
            "created_at": now,
            "updated_at": now,
            "resolved_at": None,
        },
        {
            "id": generate_issue_id(),
            "reporter_name": "Ravi Kumar",
            "reporter_email": "ravi.kumar@cvr.ac.in",
            "reporter_role": "staff",
            "category": "Network",
            "location": "CSE Lab 2",
            "description": "Intermittent internet drops affect online lab submissions.",
            "photo": "",
            "photo_name": "",
            "priority": "Medium",
            "priority_score": 2.95,
            "priority_urgency": 3,
            "priority_severity": 3,
            "priority_impact": 3,
            "priority_source": "Admin assigned",
            "assigned_department": "IT Support",
            "status": "Resolved",
            "created_at": now,
            "updated_at": now,
            "resolved_at": now,
        },
    ]

    for issue in demo_issues:
        conn.execute(
            """
            INSERT INTO issues (
                id, reporter_name, reporter_email, reporter_role, category, location, description,
                photo, photo_name, priority, priority_score, priority_urgency, priority_severity,
                priority_impact, priority_source, assigned_department, status, created_at, updated_at, resolved_at
            ) VALUES (
                :id, :reporter_name, :reporter_email, :reporter_role, :category, :location, :description,
                :photo, :photo_name, :priority, :priority_score, :priority_urgency, :priority_severity,
                :priority_impact, :priority_source, :assigned_department, :status, :created_at, :updated_at, :resolved_at
            )
            """,
            issue,
        )

    conn.commit()
    conn.close()

    add_history(demo_issues[0]["id"], "New", "Issue created and receipt email queued.")
    add_history(demo_issues[1]["id"], "New", "Issue created and receipt email queued.")
    add_history(demo_issues[1]["id"], "In Progress", "Assigned to IT Support.", "IT Support")
    add_history(demo_issues[1]["id"], "Resolved", "Connection stabilized and verified.", "IT Support")
    upsert_resolved_archive(demo_issues[1]["id"], now)


def issue_query(where: str = "", params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    conn = db_connection()
    query = "SELECT * FROM issues"
    if where:
        query += f" WHERE {where}"
    query += " ORDER BY datetime(created_at) DESC"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [serialize_issue_row(row) for row in rows]


def jsonify_issue(issue_id: str):
    conn = db_connection()
    row = conn.execute("SELECT * FROM issues WHERE id = ?", (issue_id,)).fetchone()
    conn.close()
    if not row:
        return None
    return serialize_issue_row(row)


def has_open_high_priority_issue(department: str, exclude_issue_id: str) -> bool:
    if not department:
        return False

    conn = db_connection()
    row = conn.execute(
        """
        SELECT 1
        FROM issues
        WHERE assigned_department = ?
          AND priority = 'High'
          AND status != 'Resolved'
          AND id != ?
        LIMIT 1
        """,
        (department, exclude_issue_id),
    ).fetchone()
    conn.close()
    return row is not None


def issue_priority_rank(issue: dict[str, Any]) -> float:
    base = 0.0
    if issue["priority"] == "High":
        base = 300.0
    elif issue["priority"] == "Medium":
        base = 200.0
    elif issue["priority"] == "Low":
        base = 100.0
    return base + float(issue.get("priorityScore") or 0)


def has_higher_priority_new_issue(issue: dict[str, Any]) -> bool:
    department = issue.get("assignedDepartment") or ""
    if not department:
        return False

    current_rank = issue_priority_rank(issue)
    conn = db_connection()
    rows = conn.execute(
        """
        SELECT *
        FROM issues
        WHERE assigned_department = ?
          AND status = 'New'
          AND id != ?
        """,
        (department, issue["id"]),
    ).fetchall()
    conn.close()

    for row in rows:
        other_issue = serialize_issue_row(row)
        if issue_priority_rank(other_issue) > current_rank:
            return True
    return False


def create_issue_record(payload: dict[str, Any]) -> dict[str, Any]:
    issue_id = generate_issue_id()
    timestamp = now_iso()
    conn = db_connection()
    conn.execute(
        """
        INSERT INTO issues (
            id, reporter_name, reporter_email, reporter_role, category, location, description,
            photo, photo_name, priority, priority_score, priority_urgency, priority_severity, priority_impact,
            priority_source, assigned_department, status, created_at, updated_at, resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            issue_id,
            payload.get("reporterName", ""),
            payload.get("reporterEmail", "").lower(),
            payload.get("reporterRole", ""),
            payload.get("category", ""),
            payload.get("location", ""),
            payload.get("description", ""),
            payload.get("photo", ""),
            payload.get("photoName", ""),
            "Pending Admin Review",
            0,
            None,
            None,
            None,
            "Awaiting admin review",
            "",
            "New",
            timestamp,
            timestamp,
            None,
        ),
    )
    conn.commit()
    conn.close()

    add_history(issue_id, "New", "Issue created and receipt email queued. Waiting for admin priority and department assignment.")
    issue = jsonify_issue(issue_id)
    subject, body = build_issue_reported_email(issue)
    Notification.sendNotification(issue, "Issue Reported", subject, body)
    AuditLog.logAction("Issue reported", issue["reporterEmail"])
    return issue


def update_issue_department(issue_id: str, department: str) -> dict[str, Any] | None:
    conn = db_connection()
    conn.execute(
        "UPDATE issues SET assigned_department = ?, updated_at = ? WHERE id = ?",
        (department, now_iso(), issue_id),
    )
    conn.commit()
    conn.close()
    issue = jsonify_issue(issue_id)
    add_history(issue_id, issue["status"], f"Assigned to {department}.", department)
    AuditLog.logAction("Department assigned", "admin")
    return issue


def update_issue_priority(issue_id: str, urgency: int, severity: int, impact: int) -> dict[str, Any] | None:
    scored = Issue.calculatePriority(urgency, severity, impact)

    conn = db_connection()
    conn.execute(
        """
        UPDATE issues
        SET priority = ?, priority_score = ?, priority_urgency = ?, priority_severity = ?, priority_impact = ?,
            priority_source = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            scored["priority"],
            scored["score"],
            urgency,
            severity,
            impact,
            "Admin assigned",
            now_iso(),
            issue_id,
        ),
    )
    conn.commit()
    conn.close()
    issue = jsonify_issue(issue_id)
    add_history(issue_id, issue["status"], f"Priority assigned as {scored['priority']} with score {scored['score']}.", issue["assignedDepartment"] or None)
    AuditLog.logAction("Priority updated", "admin")
    return issue


def process_issue_status_update(issue_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    status = payload.get("status", "")
    actor = payload.get("actor", "").strip().lower()
    if actor != "department":
        raise PermissionError("Only the department can update issue status after admin review.")

    issue = jsonify_issue(issue_id)
    if not issue:
        return None

    if status not in {"In Progress", "Resolved"}:
        raise ValueError("Invalid department status update.")

    if status == "In Progress" and issue["status"] != "New":
        raise ValueError("Only new issues can be moved into progress.")

    if status == "In Progress" and has_higher_priority_new_issue(issue):
        raise ValueError("Start the higher-priority new issue in this department before starting lower-priority issues.")

    if status == "Resolved" and issue["status"] != "In Progress":
        raise ValueError("Only in-progress issues can be resolved.")

    if status == "Resolved" and issue["priority"] != "High" and has_open_high_priority_issue(issue["assignedDepartment"], issue_id):
        raise ValueError("Resolve all open high-priority issues in this department before closing lower-priority issues.")

    old_status = issue["status"]
    resolved_at = now_iso() if status == "Resolved" else None
    conn = db_connection()
    conn.execute(
        "UPDATE issues SET status = ?, updated_at = ?, resolved_at = ? WHERE id = ?",
        (status, now_iso(), resolved_at, issue_id),
    )
    conn.commit()
    conn.close()

    issue = jsonify_issue(issue_id)
    IssueHistory.recordChange(issue_id, old_status, status, issue["assignedDepartment"] or None)
    add_history(
        issue_id,
        status,
        "Issue marked as resolved by department." if status == "Resolved" else "Issue moved into active work by department.",
        issue["assignedDepartment"] or None,
    )

    if status == "Resolved":
        upsert_resolved_archive(issue_id, issue["resolvedAt"] or now_iso())
    else:
        remove_from_resolved_archive(issue_id)

    send_issue_status_notifications(issue)
    AuditLog.logAction(f"Issue moved to {status}", issue["assignedDepartment"] or "department")
    return issue


def chatbot_reply(message: str, context: dict[str, Any] | None = None) -> str:
    text = (message or "").strip().lower()
    context = context or {}
    portal = str(context.get("portal", "")).lower()
    role = str(context.get("role", "")).lower()
    page = str(context.get("page", "")).lower()
    is_admin = portal == "admin" or role == "admin" or page in {
        "admin_dashboard.html",
        "admin_issues.html",
        "issue_stage.html",
        "department_dashboard.html",
        "email_log.html",
    }
    is_tracking = portal == "tracking" or page == "tracking.html"
    is_member_dashboard = portal == "member" or (role in {"student", "staff"} and page in {"student_dashboard.html", "staff_dashboard.html"})

    if is_admin:
        rules = [
            (
                ["priority", "score", "urgency", "severity", "impact"],
                "Use the three admin factors Urgency, Severity, and Impact. Score each one from 1 to 5, then the system calculates 0.4U + 0.35S + 0.25I and maps the result to Low, Medium, or High priority.",
            ),
            (
                ["department", "assign", "team", "route"],
                "Open a New issue, choose the correct department from the dropdown, and save it there. In Progress and Resolved issues keep the assigned department fixed so the workflow stays consistent.",
            ),
            (
                ["resolved", "close", "mark resolved", "complete"],
                "Only issues that are already In Progress should be marked Resolved. Once resolved, the issue becomes read-only in the admin flow and appears in the resolved section and archive views.",
            ),
            (
                ["new", "in progress", "stage", "queue", "board"],
                "The admin board separates issues into New, In Progress, and Resolved. The first board shows the top items, and View more opens the full page for that stage.",
            ),
            (
                ["search", "issue id", "find"],
                "You can search issues by issue ID from the admin board, stage pages, and department view. Use the search bar to quickly narrow the visible complaints.",
            ),
            (
                ["email", "mail", "notification", "log"],
                "The admin board shows the latest email records, and View more opens the full email log. Report confirmations and status-update mails are logged there even if SMTP delivery is unavailable.",
            ),
            (
                ["department view", "department dashboard"],
                "Department View shows issues department-wise with live status progress, priority details, and history. It is useful for watching one department's workload in real time.",
            ),
            (
                ["hello", "hi", "hey"],
                "Hello. I can help with admin tasks like department assignment, priority scoring, stage management, issue search, and email logs.",
            ),
        ]
    elif is_tracking:
        rules = [
            (
                ["status", "current status", "what does my status mean"],
                "Your tracking page shows three stages: New means the complaint was received, In Progress means the assigned department is working on it, and Resolved means the issue has been completed and closed.",
            ),
            (
                ["in progress", "after in progress", "what happens next", "next update"],
                "After In Progress, the department completes the work and the issue moves to Resolved. Every status change is also added to the live updates section on your tracking page.",
            ),
            (
                ["department", "assigned department", "why assigned"],
                "The assigned department shows which campus team is responsible for solving your issue, such as IT Support, Electrical Maintenance, or Hostel Administration.",
            ),
            (
                ["priority", "score", "urgent"],
                "Priority is assigned by admin after review so urgent complaints can be handled sooner. The tracking page shows the current priority once it has been set.",
            ),
            (
                ["history", "live updates", "timeline"],
                "The live updates section shows the complaint timeline, including when it was reported, when work started, and when it was resolved.",
            ),
            (
                ["hello", "hi", "hey"],
                "Hello. I can help you understand the live tracking page, your complaint status, department assignment, and what each stage means.",
            ),
        ]
    elif is_member_dashboard:
        rules = [
            (
                ["report", "report issue", "new complaint", "raise"],
                "From your dashboard, use the Report issue button or the sidebar link to open the complaint form and submit a new campus issue.",
            ),
            (
                ["track", "status", "live tracking", "check complaint"],
                "Use the Open live tracking button or the Live tracking link in the sidebar to see the full complaint timeline and current status.",
            ),
            (
                ["issue summary", "summary", "table", "dashboard"],
                "The issue summary table gives you a quick overview of your complaints, including issue ID, category, location, priority, status, and the latest update.",
            ),
            (
                ["priority", "department"],
                "Your dashboard shows the current priority and assigned department after admin reviews your complaint. For full progress details, open the Live Tracking page.",
            ),
            (
                ["what next", "next", "after submit"],
                "After you submit a complaint, admin reviews it, assigns a department and priority, and then the issue moves through New, In Progress, and Resolved.",
            ),
            (
                ["hello", "hi", "hey"],
                "Hello. I can help you use your dashboard, report an issue, open live tracking, and understand your complaint summary.",
            ),
        ]
    else:
        rules = [
            (
                ["login", "log in", "signin", "sign in", "signup", "sign up", "account"],
                "Open the User Portal, choose Student or Staff, then sign in with your account. New users can create an account using their @cvr.ac.in email first.",
            ),
            (
                ["report", "complaint", "issue", "raise"],
                "Go to the User Portal after login, open the complaint form, fill in the problem details and location, and submit it. You can also attach an optional photo.",
            ),
            (
                ["status", "track", "tracking", "live", "progress"],
                "After login, open the Live Tracking page to see your complaint status, department assignment, and movement from New to In Progress to Resolved.",
            ),
            (
                ["photo", "image", "upload", "proof"],
                "Yes, the complaint form supports an optional photo upload. It is useful when you want to show visible damage or give clearer context.",
            ),
            (
                ["department", "assign", "team"],
                "After a complaint is submitted, the admin assigns it to the correct department such as IT Support, Electrical Maintenance, Hostel Administration, or other campus teams.",
            ),
            (
                ["what happens", "next", "after submit", "after submission"],
                "Once your complaint is submitted, admin reviews it, assigns the right department, sets its priority, and updates the status as work moves forward.",
            ),
            (
                ["contact", "support", "email", "phone"],
                "You can contact support through the Contact page. The current support details shown in the portal are support@cvr.ac.in and +91 98765 43210.",
            ),
            (
                ["portal", "home", "where do i go", "which page"],
                "Use the User Portal for student and staff actions, the Admin Portal for management and department view, and the Contact page if you need support details.",
            ),
            (
                ["priority", "urgent", "severity", "impact"],
                "Priority is handled by admin after submission so more serious complaints can be addressed sooner.",
            ),
            (
                ["hello", "hi", "hey"],
                "Hello. I can help with login, complaint flow, status updates, departments, and support information.",
            ),
        ]

    for keywords, reply in rules:
        if any(keyword in text for keyword in keywords):
            return reply

    if is_admin:
        return "I can help with admin actions like assigning departments, calculating priority, moving issues through stages, checking email logs, and using the department view."

    if is_tracking:
        return "I can help you understand your tracking page, complaint status, department assignment, live updates, and what happens after each stage."

    if is_member_dashboard:
        return "I can help you use your dashboard, report an issue, check complaint status, and understand the summary table and next steps."

    return "I can help with login, complaint submission, status checking, department routing, and support contact details. Try asking what to do next or where to track your complaint."


init_db()


@app.post("/api/register")
def api_register():
    payload = request.get_json(force=True)
    role = payload.get("role", "").strip().lower()
    email = payload.get("email", "").strip().lower()
    if role not in {"student", "staff"}:
        return jsonify({"ok": False, "message": "Invalid role."}), 400

    conn = db_connection()
    existing = conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone()
    if existing:
        conn.close()
        return jsonify({"ok": False, "message": "An account with this email already exists."}), 400

    conn.execute(
        """
        INSERT INTO users (role, fname, lname, email, password, department, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            role,
            payload.get("fname", "").strip(),
            payload.get("lname", "").strip(),
            email,
            payload.get("password", ""),
            payload.get("department", "").strip(),
            now_iso(),
        ),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.post("/api/login")
def api_login():
    payload = request.get_json(force=True)
    role = payload.get("role", "").strip().lower()
    email = payload.get("email", "").strip().lower()
    password = payload.get("password", "")
    result = User.login(role, email, password)
    if not result["ok"]:
        return jsonify(result), 400
    return jsonify(result)


@app.post("/api/admin/login")
def api_admin_login():
    payload = request.get_json(force=True)
    if payload.get("adminId") != "admin" or payload.get("password") != get_admin_password():
        return jsonify({"ok": False, "message": "Invalid Admin ID or password."}), 400
    AuditLog.logAction("Admin login", "admin")
    return jsonify(
        {
            "ok": True,
            "session": {
                "role": "admin",
                "name": "Campus Admin",
                "email": "admin@campus.local",
                "department": "",
                "loginAt": now_iso(),
            },
        }
    )


@app.post("/api/reset-password")
def api_reset_password():
    payload = request.get_json(force=True)
    account_type = payload.get("accountType", "").strip().lower()
    new_password = payload.get("newPassword", "")

    if len(new_password) < 4:
        return jsonify({"ok": False, "message": "Use a password with at least 4 characters."}), 400

    if account_type == "admin":
        result = Admin.resetPassword(payload.get("adminId", "").strip(), new_password)
    else:
        return jsonify({"ok": False, "message": "Please request a password reset OTP from the login page."}), 400

    if not result["ok"]:
        return jsonify(result), 400
    return jsonify(result)


@app.post("/api/password-reset/request")
def api_request_password_reset():
    payload = request.get_json(force=True)
    account_type = payload.get("accountType", "").strip().lower()
    email = payload.get("email", "").strip().lower()

    if not email or "@" not in email:
        return jsonify({"ok": False, "message": "Enter a valid registered email address."}), 400

    result = request_password_reset(account_type, email, request.host_url)
    if not result["ok"]:
        return jsonify(result), 400
    return jsonify(result)


@app.post("/api/password-reset/complete")
def api_complete_password_reset():
    payload = request.get_json(force=True)
    account_type = payload.get("accountType", "").strip().lower()
    email = payload.get("email", "").strip().lower()
    otp_code = payload.get("otp", "").strip()
    new_password = payload.get("newPassword", "")

    if not email or "@" not in email:
        return jsonify({"ok": False, "message": "Enter a valid registered email address."}), 400
    if not otp_code:
        return jsonify({"ok": False, "message": "OTP is required."}), 400
    if len(new_password) < 4:
        return jsonify({"ok": False, "message": "Use a password with at least 4 characters."}), 400

    result = complete_password_reset(account_type, email, otp_code, new_password)
    if not result["ok"]:
        return jsonify(result), 400
    return jsonify(result)


@app.get("/api/issues")
def api_get_issues():
    reporter_email = request.args.get("reporter_email")
    assigned_department = request.args.get("assigned_department")
    status = request.args.get("status")

    clauses = []
    params: list[Any] = []
    if reporter_email:
        clauses.append("lower(reporter_email) = ?")
        params.append(reporter_email.lower())
    if assigned_department:
        clauses.append("assigned_department = ?")
        params.append(assigned_department)
    if status:
        clauses.append("status = ?")
        params.append(status)

    where = " AND ".join(clauses)
    return jsonify({"ok": True, "issues": issue_query(where, tuple(params))})


@app.get("/api/issues/resolved")
def api_get_resolved_issues():
    conn = db_connection()
    rows = conn.execute("SELECT payload FROM resolved_issues ORDER BY datetime(resolved_at) DESC").fetchall()
    conn.close()
    return jsonify({"ok": True, "issues": [json.loads(row["payload"]) for row in rows]})


@app.post("/api/issues")
def api_create_issue():
    payload = request.get_json(force=True)
    issue = User.reportIssue(payload)
    return jsonify({"ok": True, "issue": issue})


@app.patch("/api/issues/<issue_id>/status")
def api_update_status(issue_id: str):
    payload = request.get_json(force=True)
    try:
        issue = process_issue_status_update(issue_id, payload)
    except PermissionError as error:
        return jsonify({"ok": False, "message": str(error)}), 403
    except ValueError as error:
        return jsonify({"ok": False, "message": str(error)}), 400

    if not issue:
        return jsonify({"ok": False, "message": "Issue not found."}), 404
    return jsonify({"ok": True, "issue": issue})


@app.patch("/api/issues/<issue_id>/department")
def api_update_department(issue_id: str):
    payload = request.get_json(force=True)
    department = payload.get("assignedDepartment", "")
    issue = Admin.assignIssue(issue_id, department)
    return jsonify({"ok": True, "issue": issue})


@app.patch("/api/issues/<issue_id>/priority")
def api_update_priority(issue_id: str):
    payload = request.get_json(force=True)
    urgency = int(payload.get("urgency", 1))
    severity = int(payload.get("severity", 1))
    impact = int(payload.get("impact", 1))
    issue = Admin.updatePriority(issue_id, urgency, severity, impact)
    return jsonify({"ok": True, "issue": issue})


@app.get("/api/email-log")
def api_email_log():
    conn = db_connection()
    rows = conn.execute("SELECT * FROM email_log ORDER BY datetime(created_at) DESC").fetchall()
    conn.close()
    email_log = [
        {
            "id": row["id"],
            "issueId": row["issue_id"],
            "to": row["to_email"],
            "subject": row["subject"],
            "body": row["body"],
            "type": row["type"],
            "deliveryStatus": row["delivery_status"],
            "sentAt": row["created_at"],
        }
        for row in rows
    ]
    return jsonify({"ok": True, "emails": email_log})


@app.post("/api/email-log/retry-queued")
def api_retry_queued_email():
    result = retry_queued_emails(limit=500)
    return jsonify(
        {
            "ok": True,
            "message": f"Retried {result['processed']} queued email(s), sent {result['sent']}.",
            "result": result,
        }
    )


@app.post("/api/contact")
def api_contact():
    payload = request.get_json(force=True)
    name = payload.get("name", "").strip()
    email = payload.get("email", "").strip().lower()
    message = payload.get("message", "").strip()

    if not name or not email or not message:
        return jsonify({"ok": False, "message": "Please fill all fields."}), 400

    if "@" not in email:
        return jsonify({"ok": False, "message": "Enter a valid email address."}), 400

    subject, body = build_contact_support_email(name, email, message)
    delivery_status = try_send_email(os.environ.get("SUPPORT_EMAIL", "support@cvr.ac.in"), subject, body)
    save_contact_message(name, email, message, delivery_status)

    if delivery_status == "Sent":
        return jsonify({"ok": True, "message": "Message sent successfully to support."})

    return jsonify({"ok": True, "message": "Message saved. Mail delivery is currently unavailable."})


@app.post("/api/chatbot")
def api_chatbot():
    payload = request.get_json(force=True)
    return jsonify({"ok": True, "reply": chatbot_reply(payload.get("message", ""), payload.get("context"))})


@app.get("/")
def root():
    return send_from_directory(ROOT, "index.html")


@app.get("/<path:path>")
def static_files(path: str):
    return send_from_directory(ROOT, path)


def startup_tasks() -> None:
    global APP_READY
    if APP_READY:
        return
    init_db()
    retry_queued_emails(limit=500)
    APP_READY = True


@app.before_request
def ensure_startup_tasks() -> None:
    startup_tasks()


if __name__ == "__main__":
    startup_tasks()
    app.run(debug=True, host="0.0.0.0", port=5000)
