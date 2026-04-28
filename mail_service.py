import json
import os
import smtplib
from email.message import EmailMessage
from http.server import BaseHTTPRequestHandler, HTTPServer


HOST = "127.0.0.1"
PORT = 8025


def load_env_file(path: str = ".env") -> None:
    if not os.path.exists(path):
        return

    with open(path, "r", encoding="utf-8") as env_file:
        for raw_line in env_file:
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


load_env_file()


def build_message(payload):
    message = EmailMessage()
    message["Subject"] = payload["subject"]
    message["From"] = os.environ["SMTP_FROM"]
    message["To"] = payload["to"]
    message.set_content(payload["body"])
    return message


def send_mail(payload):
    host = os.environ["SMTP_HOST"]
    port = int(os.environ.get("SMTP_PORT", "587"))
    username = os.environ.get("SMTP_USERNAME", "")
    password = os.environ.get("SMTP_PASSWORD", "")
    use_tls = env_bool("SMTP_USE_TLS", True)
    use_ssl = env_bool("SMTP_USE_SSL", False)

    message = build_message(payload)

    if use_ssl:
        server_ctx = smtplib.SMTP_SSL(host, port, timeout=20)
    else:
        server_ctx = smtplib.SMTP(host, port, timeout=20)

    with server_ctx as server:
        if not use_ssl and use_tls:
            server.starttls()
        if username:
            server.login(username, password)
        server.send_message(message)


class MailHandler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.path != "/send-email":
            self.send_response(404)
            self._cors()
            self.end_headers()
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length)
            payload = json.loads(raw.decode("utf-8"))

            for key in ("to", "subject", "body"):
                if not payload.get(key):
                    raise ValueError(f"Missing field: {key}")

            send_mail(payload)

            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True}).encode("utf-8"))
        except Exception as error:
            self.send_response(500)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": False, "error": str(error)}).encode("utf-8"))


if __name__ == "__main__":
    print(f"Mail service listening on http://{HOST}:{PORT}")
    HTTPServer((HOST, PORT), MailHandler).serve_forever()
