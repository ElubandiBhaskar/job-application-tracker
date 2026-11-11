#!/usr/bin/env python3
"""
End-to-end check against a *running* server (no Django test client, real HTTP).

    python scripts/smoke_test.py                      # http://localhost:8000
    python scripts/smoke_test.py http://host:8000

Creates two throw-away users, walks through the whole flow and exits non-zero
on the first thing that doesn't behave. Uses only the standard library.
"""
import json
import sys
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/")
PASSWORD = "Sm0ke-test-Pw!"
passed = 0


def call(method, path, body=None, token=None, expect=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as res:
            status, raw = res.status, res.read()
    except urllib.error.HTTPError as err:
        status, raw = err.code, err.read()
    payload = json.loads(raw) if raw else None
    if expect is not None and status != expect:
        fail(f"{method} {path} -> {status}, expected {expect}: {payload}")
    return status, payload


def fail(message):
    print(f"  FAIL  {message}")
    sys.exit(1)


def check(condition, label):
    global passed
    if not condition:
        fail(label)
    passed += 1
    print(f"  ok    {label}")


def main():
    tag = uuid.uuid4().hex[:8]
    alice_email, bob_email = f"alice-{tag}@example.com", f"bob-{tag}@example.com"

    print("auth")
    _, a = call("POST", "/api/auth/register/", {
        "email": alice_email, "first_name": "Alice", "password": PASSWORD, "password_confirm": PASSWORD,
    }, expect=201)
    check(a["user"]["email"] == alice_email, "register returns the user and tokens")
    call("POST", "/api/auth/register/", {
        "email": alice_email.upper(), "first_name": "Dup", "password": PASSWORD, "password_confirm": PASSWORD,
    }, expect=400)
    check(True, "duplicate email (different case) is rejected")
    _, b = call("POST", "/api/auth/register/", {
        "email": bob_email, "first_name": "Bob", "password": PASSWORD, "password_confirm": PASSWORD,
    }, expect=201)

    call("GET", "/api/applications/", expect=401)
    check(True, "anonymous request is refused")
    call("POST", "/api/auth/login/", {"email": alice_email, "password": "wrong-password"}, expect=401)
    check(True, "wrong password is refused")
    _, login = call("POST", "/api/auth/login/", {"email": alice_email, "password": PASSWORD}, expect=200)
    at, rt = login["access"], login["refresh"]
    check(True, "login works")

    print("applications")
    _, app = call("POST", "/api/applications/", {
        "job_title": "Python Developer", "company_name": "Acme Corp", "status": "applied",
        "work_mode": "remote", "salary_min": 800000, "salary_max": 1200000, "source": "LinkedIn",
    }, token=at, expect=201)
    app_id = app["id"]
    check(app["company_name"] == "Acme Corp" and app["applied_date"], "create (company auto-created, date defaulted)")
    call("POST", "/api/applications/", {"job_title": "Data Engineer", "company_name": "acme corp", "status": "wishlist"},
         token=at, expect=201)
    _, companies = call("GET", "/api/companies/", token=at, expect=200)
    check(companies["count"] == 1, "same company name (any case) reuses one company")
    call("POST", "/api/applications/", {"job_title": "x", "company_name": "y", "salary_min": 9, "salary_max": 1},
         token=at, expect=400)
    check(True, "salary min > max is rejected")

    _, found = call("GET", "/api/applications/?search=python", token=at, expect=200)
    check([r["job_title"] for r in found["results"]] == ["Python Developer"], "search")
    _, found = call("GET", "/api/applications/?status=wishlist", token=at, expect=200)
    check(found["count"] == 1 and found["results"][0]["job_title"] == "Data Engineer", "filter by status")
    _, found = call("GET", "/api/applications/?ordering=-applied_date", token=at, expect=200)
    check(found["results"][-1]["applied_date"] is None, "undated applications sort last")
    call("GET", "/api/applications/?status=bogus", token=at, expect=400)
    check(True, "invalid filter value is a 400, not a 500")

    print("status tracking")
    call("PATCH", f"/api/applications/{app_id}/", {"status": "interviewing"}, token=at, expect=200)
    call("PATCH", f"/api/applications/{app_id}/", {"notes": "just a note"}, token=at, expect=200)
    call("PATCH", f"/api/applications/{app_id}/", {"status": "offer"}, token=at, expect=200)
    _, history = call("GET", f"/api/applications/{app_id}/history/", token=at, expect=200)
    path = [(h["from_status"], h["to_status"]) for h in history]
    check(path == [("", "applied"), ("applied", "interviewing"), ("interviewing", "offer")],
          "timeline records every status change (and only those)")

    print("interviews")
    when = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    _, iv = call("POST", "/api/interviews/", {
        "application": app_id, "kind": "technical", "scheduled_at": when, "interviewer": "Priya",
    }, token=at, expect=201)
    _, stats = call("GET", "/api/stats/", token=at, expect=200)
    check(stats["total"] == 2 and stats["upcoming_interview_count"] == 1, "dashboard stats see the interview")
    check(stats["by_status"]["offer"] == 1 and stats["offers"] == 1, "stats count statuses correctly")
    call("PATCH", f"/api/interviews/{iv['id']}/", {"status": "completed"}, token=at, expect=200)
    _, stats = call("GET", "/api/stats/", token=at, expect=200)
    check(stats["upcoming_interview_count"] == 0, "completed interviews leave the upcoming list")

    print("isolation between users")
    bt = b["access"]
    _, bobs = call("GET", "/api/applications/", token=bt, expect=200)
    check(bobs["count"] == 0, "bob sees none of alice's applications")
    call("GET", f"/api/applications/{app_id}/", token=bt, expect=404)
    call("PATCH", f"/api/applications/{app_id}/", {"job_title": "hacked"}, token=bt, expect=404)
    call("DELETE", f"/api/applications/{app_id}/", token=bt, expect=404)
    call("GET", f"/api/applications/{app_id}/history/", token=bt, expect=404)
    call("PATCH", f"/api/interviews/{iv['id']}/", {"notes": "hacked"}, token=bt, expect=404)
    call("POST", "/api/interviews/", {"application": app_id, "scheduled_at": when}, token=bt, expect=400)
    call("POST", "/api/applications/", {"job_title": "x", "company": app["company"]}, token=bt, expect=400)
    check(True, "bob can't read, edit, delete or attach to alice's records")
    _, again = call("GET", f"/api/applications/{app_id}/", token=at, expect=200)
    check(again["job_title"] == "Python Developer", "alice's data is untouched")

    print("company rules")
    status, body = call("DELETE", f"/api/companies/{app['company']}/", token=at)
    check(status == 409 and "application" in body["detail"], "company with applications can't be deleted")

    print("tokens")
    _, refreshed = call("POST", "/api/auth/refresh/", {"refresh": rt}, expect=200)
    check(refreshed["refresh"] != rt, "refresh rotates the refresh token")
    call("POST", "/api/auth/refresh/", {"refresh": rt}, expect=401)
    check(True, "the old refresh token is dead after rotation")
    call("POST", "/api/auth/logout/", {"refresh": refreshed["refresh"]}, token=refreshed["access"], expect=204)
    call("POST", "/api/auth/refresh/", {"refresh": refreshed["refresh"]}, expect=401)
    check(True, "logout kills the refresh token")

    _, relog = call("POST", "/api/auth/login/", {"email": alice_email, "password": PASSWORD}, expect=200)
    new_pw = "An0ther-Pw-2026!"
    _, changed = call("POST", "/api/auth/change-password/", {
        "current_password": PASSWORD, "new_password": new_pw, "new_password_confirm": new_pw,
    }, token=relog["access"], expect=200)
    call("POST", "/api/auth/refresh/", {"refresh": relog["refresh"]}, expect=401)
    call("POST", "/api/auth/login/", {"email": alice_email, "password": PASSWORD}, expect=401)
    call("POST", "/api/auth/login/", {"email": alice_email, "password": new_pw}, expect=200)
    call("GET", "/api/auth/me/", token=changed["access"], expect=200)
    check(True, "password change: old password and old sessions are dead, new ones work")

    print("cleanup + cascade")
    call("DELETE", f"/api/applications/{app_id}/", token=changed["access"], expect=204)
    _, ivs = call("GET", "/api/interviews/", token=changed["access"], expect=200)
    check(ivs["count"] == 0, "deleting an application removes its interviews")

    print(f"\nAll {passed} checks passed against {BASE}")


if __name__ == "__main__":
    main()
