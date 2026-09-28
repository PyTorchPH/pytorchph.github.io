#!/usr/bin/env python3
"""Loopback auth smoke. Reads the temporary password from the private environment."""

import json
import os
import urllib.error
import urllib.request


BASE = "http://127.0.0.1:8787"


def request(method, path, body=None, cookie=None):
    headers = {"Origin": "https://pytorch.ph"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if cookie:
        headers["Cookie"] = cookie
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers=headers,
    )
    try:
        response = urllib.request.urlopen(req, timeout=5)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        data = response.read(4096)
        parsed = json.loads(data) if data else {}
        return response.status, parsed, response.headers.get("Set-Cookie", "").split(";", 1)[0]


password = os.environ["TEMP_TEST_PASSWORD"]
results = {}
for name, expected_role, expected_members in (
    ("member", "member", 403),
    ("officer", "officer", 200),
):
    status, viewer, cookie = request(
        "POST", "/auth/password", {"email": f"{name}@admin.ph", "password": password}
    )
    me_status, me, _ = request("GET", "/auth/me", cookie=cookie)
    members_status, _, _ = request("GET", "/members", cookie=cookie)
    results[name] = {
        "login": status,
        "role": viewer.get("role"),
        "me": me_status,
        "members": members_status,
    }
    assert (status, viewer.get("role"), me_status, me.get("role"), members_status) == (
        200, expected_role, 200, expected_role, expected_members
    )

wrong_status, _, _ = request(
    "POST", "/auth/password", {"email": "member@admin.ph", "password": "wrong"}
)
results["wrong_password"] = wrong_status
assert wrong_status == 401
print(json.dumps({"event": "api.auth_smoke", "outcome": "success", "results": results}))
