"""Bounded production API smoke with synthetic records and disposable sessions.

Run on the API host after an SQLite online backup. This intentionally leaves the
marked event and evidence records for review, but revokes the test sessions.
"""

import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import secrets
import sqlite3
import urllib.error
import urllib.request


def request(base, origin, token, method, path, payload=None, expected=200):
    headers = {"Origin": origin, "Cookie": f"ph_session={token}"}
    data = None if payload is None else json.dumps(payload).encode()
    if data is not None:
        headers["Content-Type"] = "application/json"
    call = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(call, timeout=10) as response:
            status, body = response.status, response.read(65536)
    except urllib.error.HTTPError as error:
        status, body = error.code, error.read(65536)
    if status != expected:
        raise AssertionError(f"{method} {path}: expected {expected}, got {status}: {body[:180]!r}")
    if not body:
        return None
    return json.loads(body)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="/var/lib/pytorch-ph-api/portal.db")
    parser.add_argument("--api", default="http://127.0.0.1:8787")
    parser.add_argument("--origin", default="https://pytorch.ph")
    parser.add_argument("--preflight", action="store_true")
    args = parser.parse_args()
    if not args.api.startswith("http://127.0.0.1:"):
        parser.error("Smoke must target the API loopback listener")
    connection = sqlite3.connect(args.db, timeout=5)
    rows = connection.execute(
        "SELECT email,id,role FROM members WHERE email IN (?,?)",
        ("member@admin.ph", "officer@admin.ph"),
    ).fetchall()
    actors = {email: (member_id, role) for email, member_id, role in rows}
    if actors.get("member@admin.ph", (None, None))[1] != "member" or actors.get("officer@admin.ph", (None, None))[1] != "officer":
        raise RuntimeError("Approved temporary member and officer accounts are required")
    if args.preflight:
        print(json.dumps({"preflight": "ok", "actors": ["member", "officer"]}))
        connection.close()
        return

    backup = Path(args.db).parent / "backups" / f"portal.before-officer-smoke.{dt.datetime.now(dt.timezone.utc):%Y%m%dT%H%M%SZ}.db"
    with sqlite3.connect(backup) as target:
        connection.backup(target)
        if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("SQLite backup integrity check failed")
    print(json.dumps({"backup": str(backup), "status": "verified"}), flush=True)

    tokens = {}
    expires = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)).isoformat()
    marker = secrets.token_hex(8)
    try:
        for email in ("member@admin.ph", "officer@admin.ph"):
            token = secrets.token_hex(32)
            tokens[email] = token
            connection.execute(
                "INSERT INTO sessions(token_hash,member_id,expires_at) VALUES (?,?,?)",
                (hashlib.sha256(token.encode()).hexdigest(), actors[email][0], expires),
            )
        connection.commit()
        member, officer = tokens["member@admin.ph"], tokens["officer@admin.ph"]
        base, origin = args.api, args.origin
        request(base, origin, member, "GET", "/auth/me")
        request(base, origin, member, "POST", "/events", {
            "title": f"Postman smoke {marker}", "category": "competitive",
            "startsAt": "2020-01-01T00:00:00Z", "entrantKind": "individual", "placePoints": [10],
        }, 403)
        claim = request(base, origin, member, "POST", "/evidence", {
            "kind": "personal_project", "title": f"Postman smoke {marker}",
            "sourceUrl": "https://github.com/pytorch-ph/postman-test",
            "contentHash": hashlib.sha256(marker.encode()).hexdigest(),
        }, 201)
        assert any(item["id"] == claim["id"] for item in request(base, origin, member, "GET", "/evidence/me"))
        extension = request(base, origin, member, "POST", "/evidence/extension", {
            "schemaVersion": 1, "source": "github", "origin": "extension_scrape",
            "pageUrl": f"https://github.com/pytorch-ph/postman-test/{marker}",
            "contentHash": "sha256:" + hashlib.sha256(marker.encode()).hexdigest(),
            "items": [{"title": f"Postman extension {marker}", "text": "Static test data",
                       "sourceUrl": f"https://github.com/pytorch-ph/postman-test/{marker}",
                       "evidenceKind": "project"}],
        }, 201)
        assert extension["submitted"] == 1
        request(base, origin, officer, "GET", "/members")
        request(base, origin, officer, "POST", "/mail/routes/postman_test", {
            "requiredRoles": ["secretariat"], "senderRole": "secretariat",
        }, 403)
        event = request(base, origin, officer, "POST", "/events", {
            "title": f"Postman smoke {marker}", "category": "competitive",
            "startsAt": "2020-01-01T00:00:00Z", "entrantKind": "individual", "placePoints": [10],
        }, 201)
        assert any(item["id"] == event["id"] for item in request(base, origin, officer, "GET", "/events"))
        entrant = request(base, origin, officer, "POST", f"/events/{event['id']}/entrants", {
            "name": "Synthetic member", "memberIds": [actors["member@admin.ph"][0]],
        }, 201)
        assert any(item["id"] == entrant["id"] for item in request(base, origin, officer, "GET", f"/events/{event['id']}/entrants"))
        result = request(base, origin, officer, "POST", f"/events/{event['id']}/results", {
            "expectedRevision": 0, "placements": [{"place": 1, "entrantId": entrant["id"]}],
            "reason": "Production API smoke result",
        })
        assert result["revision"] == 1
        assert request(base, origin, officer, "GET", f"/events/{event['id']}/results")["revision"] == 1
        request(base, origin, officer, "GET", f"/events/{event['id']}/attendance")
        request(base, origin, member, "GET", "/public/events")
        request(base, origin, member, "GET", "/leaderboard")
        assert any(item["id"] == claim["id"] for item in request(base, origin, officer, "GET", "/evidence/pending"))
        request(base, origin, officer, "POST", f"/evidence/{claim['id']}/review", {
            "decision": "reject", "reason": "Synthetic production smoke claim",
        }, 204)
        assert any(item["id"] == claim["id"] and item["status"] == "rejected" for item in request(base, origin, member, "GET", "/evidence/me"))
        request(base, origin, member, "POST", "/auth/signout")
        request(base, origin, member, "GET", "/auth/me", expected=401)
        print(json.dumps({"smoke": "passed", "marker": marker, "checks": 20}))
    finally:
        for token in tokens.values():
            connection.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
        connection.commit()
        connection.close()


if __name__ == "__main__":
    main()
