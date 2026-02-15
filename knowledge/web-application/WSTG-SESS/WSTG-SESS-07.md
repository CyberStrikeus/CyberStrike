# WSTG-SESS-07: Testing for Session Timeout

## Test ID
WSTG-SESS-07

## Test Name
Testing for Session Timeout

## High-Level Description

Session timeout controls how long a session remains valid after periods of inactivity or absolute time limits. Improper timeout configuration can leave sessions vulnerable to hijacking if users don't explicitly logout, especially on shared computers or public networks.

---

## What to Check

- [ ] Idle timeout implementation
- [ ] Absolute timeout (max session age)
- [ ] Timeout consistency across endpoints
- [ ] Timeout bypass via activity
- [ ] Warning before timeout
- [ ] Timeout on sensitive actions

---

## How to Test

### Step 1: Test Idle Timeout

```bash
#!/bin/bash
TARGET="https://target.com"

# Get session
session=$(curl -s -c - -X POST "$TARGET/login" \
    -d "username=test&password=test" | grep -oP "SESSIONID=\K[^;]+")
echo "Session: $session"

# Wait for timeout (adjust based on expected timeout)
echo "Waiting for idle timeout..."
for i in {1..60}; do
    sleep 60  # Wait 1 minute
    response=$(curl -s -b "SESSIONID=$session" "$TARGET/dashboard")

    if echo "$response" | grep -qi "login\|expired\|timeout"; then
        echo "Session expired after $i minutes"
        exit 0
    fi
    echo "Minute $i: Session still valid"
done

echo "[VULN] Session still valid after 60 minutes idle"
```

### Step 2: Test Absolute Timeout

```python
#!/usr/bin/env python3
import requests
import time

def test_absolute_timeout(base_url, credentials, max_hours=24):
    """Test absolute session timeout"""
    session = requests.Session()
    session.post(f"{base_url}/login", data=credentials)

    start_time = time.time()

    while True:
        # Keep session active
        time.sleep(300)  # 5 minutes
        response = session.get(f"{base_url}/dashboard")

        elapsed_hours = (time.time() - start_time) / 3600

        if 'login' in response.url.lower():
            print(f"Session expired after {elapsed_hours:.2f} hours (absolute)")
            return elapsed_hours

        if elapsed_hours >= max_hours:
            print(f"[VULN] Session still valid after {max_hours} hours")
            return None

        print(f"Hour {elapsed_hours:.2f}: Session still active")

# Usage
test_absolute_timeout("https://target.com", {"username": "test", "password": "test"})
```

### Step 3: Session Timeout Tester

```python
#!/usr/bin/env python3
import requests
import time

class SessionTimeoutTester:
    def __init__(self, base_url):
        self.base_url = base_url
        self.findings = []

    def test_idle_timeout(self, login_creds, protected_page, expected_timeout_mins):
        """Test idle timeout"""
        print(f"[*] Testing idle timeout (expected: {expected_timeout_mins} mins)...")

        session = requests.Session()
        session.post(f"{self.base_url}/login", data=login_creds)

        # Verify authenticated
        if session.get(f"{self.base_url}{protected_page}").status_code != 200:
            print("[!] Authentication failed")
            return

        # Wait and check
        intervals = [5, 10, 15, 30, 60, 120]  # minutes

        for mins in intervals:
            if mins > expected_timeout_mins * 2:
                break

            print(f"  Waiting {mins} minutes...")
            time.sleep(mins * 60)

            response = session.get(f"{self.base_url}{protected_page}")

            if 'login' in response.url.lower() or response.status_code == 401:
                print(f"  [OK] Session expired after ~{mins} minutes")
                if mins > expected_timeout_mins:
                    self.findings.append({
                        "issue": f"Timeout longer than expected ({mins} vs {expected_timeout_mins} mins)",
                        "severity": "Low"
                    })
                return

        print(f"  [VULN] Session still valid after extended period")
        self.findings.append({
            "issue": "No effective idle timeout",
            "severity": "High"
        })

    def test_timeout_bypass(self, login_creds, protected_page):
        """Test if minimal activity prevents timeout"""
        print("[*] Testing timeout bypass with minimal activity...")

        # Test if simple GET requests reset timeout indefinitely
        # This should be acceptable for idle timeout but not absolute

# Usage
tester = SessionTimeoutTester("https://target.com")
tester.test_idle_timeout(
    {"username": "test", "password": "test"},
    "/dashboard",
    expected_timeout_mins=30
)
```

---

## Remediation Guide

### Timeout Implementation

```python
import time
from flask import session, redirect, request

# Configuration
IDLE_TIMEOUT = 1800  # 30 minutes
ABSOLUTE_TIMEOUT = 28800  # 8 hours

@app.before_request
def check_session_timeout():
    if 'user_id' not in session:
        return

    now = time.time()

    # Check absolute timeout
    if now - session.get('created_at', now) > ABSOLUTE_TIMEOUT:
        session.clear()
        return redirect('/login?reason=absolute_timeout')

    # Check idle timeout
    if now - session.get('last_activity', now) > IDLE_TIMEOUT:
        session.clear()
        return redirect('/login?reason=idle_timeout')

    # Update last activity
    session['last_activity'] = now

@app.route('/login', methods=['POST'])
def login():
    if authenticate(request.form):
        session['user_id'] = user.id
        session['created_at'] = time.time()
        session['last_activity'] = time.time()
        return redirect('/dashboard')
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| No idle timeout | 5.3 | Medium |
| Excessive timeout (>4 hours) | 4.3 | Medium |
| No absolute timeout | 5.3 | Medium |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-613** | Insufficient Session Expiration |

---

## Checklist

```
[ ] Idle timeout tested
[ ] Absolute timeout tested
[ ] Timeout values documented
[ ] Activity bypass tested
[ ] Findings documented
[ ] Remediation provided
```
