"""Bounded loopback smoke for authenticated synthetic portal writes.

Requires the two approved temporary accounts. Leaves marked synthetic records,
revokes disposable sessions, and prints only bounded check counts and IDs.
"""

import argparse
import base64
import datetime as dt
import hashlib
import json
import secrets
import sqlite3
import time
import urllib.error
import urllib.request


def call(base, token, method, path, value=None, expected=200, binary=False):
    headers = {"Origin": "https://pytorch.ph", "Cookie": f"ph_session={token}"}
    body = None if value is None else json.dumps(value).encode()
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(base + path, data=body, headers=headers, method=method)
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            status, result = response.status, response.read(384 * 1024)
    except urllib.error.HTTPError as error:
        status, result = error.code, error.read(4096)
    elapsed = round((time.monotonic() - started) * 1000)
    if status != expected:
        raise AssertionError(f"{method} {path}: expected {expected}, got {status}: {result[:160]!r}")
    return (result if binary else json.loads(result)) if result else None, elapsed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="/var/lib/pytorch-ph-api/portal.db")
    parser.add_argument("--api", default="http://127.0.0.1:8787")
    args = parser.parse_args()
    if not args.api.startswith("http://127.0.0.1:"):
        parser.error("Smoke must target the API loopback listener")
    db = sqlite3.connect(args.db, timeout=5)
    actors = {email: (member_id, role) for email, member_id, role in db.execute(
        "SELECT email,id,role FROM members WHERE email IN (?,?)", ("member@admin.ph", "officer@admin.ph"))}
    if actors.get("member@admin.ph", (None, None))[1] != "member" or actors.get("officer@admin.ph", (None, None))[1] != "officer":
        raise RuntimeError("Approved temporary member and officer accounts are required")
    tokens = {}
    marker = secrets.token_hex(6)
    durations = []

    def check(role, method, path, value=None, expected=200, binary=False):
        result, elapsed = call(args.api, tokens[role], method, path, value, expected, binary)
        durations.append(elapsed)
        return result

    try:
        expires = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)).isoformat()
        for role, email in (("member", "member@admin.ph"), ("officer", "officer@admin.ph")):
            token = secrets.token_hex(32)
            tokens[role] = token
            db.execute("INSERT INTO sessions(token_hash,member_id,expires_at) VALUES (?,?,?)",
                       (hashlib.sha256(token.encode()).hexdigest(), actors[email][0], expires))
        db.commit()

        prefix = "/portal/api"
        assert check("member", "GET", "/auth/me")["role"] == "member"
        assert check("officer", "GET", "/auth/me")["role"] == "officer"
        privacy = {"hideGoogleIdentity": True, "hideRealName": False, "deviceCacheEnabled": True,
                   "anonymousRanking": False, "automaticErrorReports": True}
        check("member", "PUT", prefix + "/member/privacy", privacy)
        assert check("member", "GET", prefix + "/member/privacy") == privacy
        assert check("officer", "GET", prefix + "/member/privacy") != privacy
        check("member", "GET", prefix + "/officer/evidence", expected=403)
        assert check("member", "GET", prefix + "/backend/local-ai/status")["configured"] is False
        check("member", "POST", prefix + "/backend/local-ai/test", {})

        opportunity = {"company": f"Smoke {marker}", "title": "Synthetic role", "location": "Remote",
                       "workMode": "remote", "stage": "discovered", "fit": 70}
        saved = check("member", "POST", prefix + "/product/opportunities", opportunity, 201)
        opportunity_id = saved["opportunity"]["id"]
        opportunity["stage"] = "drafted"
        check("member", "PATCH", prefix + "/product/opportunities/" + opportunity_id, opportunity)
        view = check("member", "GET", prefix + "/product/opportunities")
        assert any(item["id"] == opportunity_id and item["stage"] == "drafted" for item in view["opportunities"])

        evidence = check("member", "POST", prefix + "/product/evidence", {
            "item": {"title": f"Synthetic evidence {marker}", "description": "Static test data"}, "approve": True}, 201)
        assert evidence["item"]["verificationState"] == "user_verified"
        tiny_jpeg = bytes([255, 216, 255]) + bytes(96) + bytes([255, 217])
        photo = check("member", "POST", prefix + "/product/evidence", {
            "title": f"Synthetic photo {marker}", "photoData": "data:image/jpeg;base64," + base64.b64encode(tiny_jpeg).decode()}, 201)
        media_path = "/portal/media/" + photo["item"]["mediaUrl"].rsplit("/", 1)[-1]
        assert check("member", "GET", media_path, binary=True) == tiny_jpeg
        check("officer", "GET", media_path, expected=404)

        report = check("member", "POST", prefix + "/feedback", {
            "category": "suggestion", "description": f"Synthetic feedback {marker}", "route": "/dashboard/",
            "uiState": {"title": "Dashboard", "viewport": "1280x720", "online": True, "componentMarkers": []}}, 201)
        report_id = report["id"]
        assert any(item["id"] == report_id for item in check("member", "GET", prefix + "/feedback"))
        check("member", "PATCH", prefix + "/feedback/" + report_id, {"status": "resolved", "severity": "low"}, 403)
        check("officer", "PATCH", prefix + "/feedback/" + report_id,
              {"status": "triaged", "severity": "low", "assignedTo": None, "resolution": None})

        # External events were removed; POST /events must no longer exist.
        check("officer", "POST", prefix + "/events", {}, 501)

        print(json.dumps({"status": "ok", "checks": len(durations), "marker": marker,
                          "maxMs": max(durations), "p50Ms": sorted(durations)[len(durations) // 2]}))
    finally:
        for token in tokens.values():
            db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
        db.commit()
        db.close()


if __name__ == "__main__":
    main()
