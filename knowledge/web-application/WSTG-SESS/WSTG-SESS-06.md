# WSTG-SESS-06: Testing for Logout Functionality

## Test ID
WSTG-SESS-06

## Test Name
Testing for Logout Functionality

## High-Level Description

Logout functionality must properly terminate user sessions by invalidating session tokens on the server side. Improper logout implementation can allow continued access using old session tokens, session replay attacks, or leave users vulnerable if using shared computers.

---

## What to Check

- [ ] Server-side session invalidation
- [ ] Client-side token clearing
- [ ] "Remember me" token revocation
- [ ] All sessions logout (multi-device)
- [ ] Browser cache clearing
- [ ] Redirect after logout

---

## How to Test

### Step 1: Test Session Invalidation

```bash
#!/bin/bash
TARGET="https://target.com"

# Get authenticated session
session=$(curl -s -c - -X POST "$TARGET/login" \
    -d "username=test&password=test" | grep -oP "SESSIONID=\K[^;]+")
echo "Session: $session"

# Verify authenticated
curl -s -b "SESSIONID=$session" "$TARGET/dashboard" | grep -q "Welcome" && \
    echo "[OK] Session authenticated"

# Logout
curl -s -b "SESSIONID=$session" "$TARGET/logout"

# Try to use old session
response=$(curl -s -b "SESSIONID=$session" "$TARGET/dashboard")

if echo "$response" | grep -q "Welcome"; then
    echo "[VULN] Session still valid after logout!"
else
    echo "[OK] Session properly invalidated"
fi
```

### Step 2: Test Back Button After Logout

```bash
# After logout, cached pages should not be accessible
# Check Cache-Control headers on authenticated pages

curl -sI -b "session=valid" "https://target.com/dashboard" | \
    grep -iE "cache-control|pragma"

# Should include: no-store, no-cache, must-revalidate
```

### Step 3: Session Invalidation Tester

```python
#!/usr/bin/env python3
import requests
import time

class LogoutTester:
    def __init__(self, base_url):
        self.base_url = base_url
        self.findings = []

    def test_logout(self, login_creds, protected_page, logout_endpoint):
        """Test complete logout functionality"""
        print("[*] Testing logout functionality...")

        # Login
        session = requests.Session()
        session.post(f"{self.base_url}/login", data=login_creds)

        # Get session cookie
        original_cookies = dict(session.cookies)
        print(f"Session established: {list(original_cookies.keys())}")

        # Verify authenticated
        response = session.get(f"{self.base_url}{protected_page}")
        if response.status_code != 200:
            print("[!] Could not authenticate")
            return

        # Logout
        session.get(f"{self.base_url}{logout_endpoint}")
        print("Logout request sent")

        # Test 1: Same session access
        print("\n[1] Testing session after logout...")
        new_session = requests.Session()
        for name, value in original_cookies.items():
            new_session.cookies.set(name, value)

        response = new_session.get(f"{self.base_url}{protected_page}")

        if response.status_code == 200 and 'login' not in response.url.lower():
            print("[VULN] Session still valid after logout!")
            self.findings.append({
                "issue": "Session not invalidated",
                "severity": "High"
            })
        else:
            print("[OK] Session properly invalidated")

        # Test 2: Check cache headers
        print("\n[2] Checking cache headers...")
        self._check_cache_headers(protected_page)

        return self.findings

    def _check_cache_headers(self, protected_page):
        """Check if cache headers prevent storing"""
        session = requests.Session()
        response = session.get(f"{self.base_url}{protected_page}")

        cache_control = response.headers.get('Cache-Control', '')

        if 'no-store' in cache_control.lower():
            print("[OK] no-store header present")
        else:
            print("[WARN] Missing no-store - pages may be cached")
            self.findings.append({
                "issue": "Missing no-store cache header",
                "severity": "Medium"
            })

# Usage
tester = LogoutTester("https://target.com")
tester.test_logout(
    {"username": "test", "password": "test"},
    "/dashboard",
    "/logout"
)
```

---

## Remediation Guide

### Proper Logout Implementation

```python
from flask import session, redirect

@app.route('/logout')
def logout():
    # Clear server-side session
    session_id = session.get('id')
    if session_id:
        SessionStore.delete(session_id)

    # Clear all session data
    session.clear()

    # Create response with cache headers
    response = redirect('/login')
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, private'
    response.headers['Pragma'] = 'no-cache'

    # Clear session cookie
    response.delete_cookie('session')

    return response
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| Session valid after logout | 6.5 | Medium |
| Missing cache headers | 4.3 | Medium |
| No server-side invalidation | 7.5 | High |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-613** | Insufficient Session Expiration |

---

## Checklist

```
[ ] Server-side invalidation tested
[ ] Old session token tested post-logout
[ ] Cache headers checked
[ ] All sessions logout tested
[ ] Cookie clearing verified
[ ] Findings documented
```
