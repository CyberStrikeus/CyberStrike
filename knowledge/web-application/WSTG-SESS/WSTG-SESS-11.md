# WSTG-SESS-11: Testing for Concurrent Sessions

## Test ID
WSTG-SESS-11

## Test Name
Testing for Concurrent Sessions

## High-Level Description

Concurrent session handling determines how an application manages multiple simultaneous sessions for the same user account. Improper handling can allow attackers to maintain access even after legitimate users change passwords or attempt to terminate sessions, and may enable account sharing in violation of terms of service.

---

## What to Check

- [ ] Multiple simultaneous sessions allowed
- [ ] Session invalidation on password change
- [ ] Session termination capabilities
- [ ] New login behavior (invalidate previous?)
- [ ] Device/session management features
- [ ] Session limit enforcement

---

## How to Test

### Step 1: Test Concurrent Session Behavior

```bash
#!/bin/bash
TARGET="https://target.com"
USERNAME="testuser"
PASSWORD="testpass"

# Create first session
session1=$(curl -s -c - -X POST "$TARGET/login" \
    -d "username=$USERNAME&password=$PASSWORD" | grep -oP "SESSIONID=\K[^;]+")
echo "Session 1: $session1"

# Create second session (simulate different device)
session2=$(curl -s -c - -X POST "$TARGET/login" \
    -d "username=$USERNAME&password=$PASSWORD" \
    -H "User-Agent: DifferentDevice/1.0" | grep -oP "SESSIONID=\K[^;]+")
echo "Session 2: $session2"

# Check if both sessions work
echo -e "\nTesting Session 1:"
curl -s -b "SESSIONID=$session1" "$TARGET/dashboard" | grep -q "Welcome" && \
    echo "Session 1: VALID" || echo "Session 1: INVALID"

echo "Testing Session 2:"
curl -s -b "SESSIONID=$session2" "$TARGET/dashboard" | grep -q "Welcome" && \
    echo "Session 2: VALID" || echo "Session 2: INVALID"
```

### Step 2: Test Session Invalidation on Password Change

```bash
#!/bin/bash
TARGET="https://target.com"

# Create session
session=$(curl -s -c - -X POST "$TARGET/login" \
    -d "username=test&password=oldpass" | grep -oP "SESSIONID=\K[^;]+")

# Change password (from another session or same)
curl -s -X POST "$TARGET/api/change-password" \
    -b "SESSIONID=$session" \
    -d "old_password=oldpass&new_password=newpass"

# Check if old session still works
response=$(curl -s -b "SESSIONID=$session" "$TARGET/dashboard")

if echo "$response" | grep -q "Welcome"; then
    echo "[VULN] Session still valid after password change!"
else
    echo "[OK] Session invalidated after password change"
fi
```

### Step 3: Concurrent Session Tester

```python
#!/usr/bin/env python3
import requests
import time

class ConcurrentSessionTester:
    def __init__(self, base_url):
        self.base_url = base_url
        self.findings = []

    def test_multiple_sessions(self, credentials):
        """Test if multiple sessions are allowed"""
        print("[*] Testing multiple concurrent sessions...")

        sessions = []

        # Create multiple sessions
        for i in range(3):
            session = requests.Session()
            session.headers['User-Agent'] = f'Device-{i}/1.0'
            session.post(f"{self.base_url}/login", data=credentials)
            sessions.append(session)

        # Check if all sessions work
        valid_count = 0
        for i, session in enumerate(sessions):
            response = session.get(f"{self.base_url}/dashboard")
            if response.status_code == 200 and 'login' not in response.url.lower():
                valid_count += 1
                print(f"  Session {i+1}: Valid")
            else:
                print(f"  Session {i+1}: Invalid")

        if valid_count == len(sessions):
            print(f"[INFO] All {valid_count} concurrent sessions allowed")
        elif valid_count == 1:
            print("[OK] Only one session allowed at a time")

        return valid_count

    def test_password_change_invalidation(self, credentials, new_password):
        """Test session invalidation on password change"""
        print("\n[*] Testing session invalidation on password change...")

        # Create multiple sessions
        session1 = requests.Session()
        session2 = requests.Session()

        session1.post(f"{self.base_url}/login", data=credentials)
        session2.post(f"{self.base_url}/login", data=credentials)

        # Change password from session1
        session1.post(f"{self.base_url}/api/change-password", data={
            "old_password": credentials['password'],
            "new_password": new_password
        })

        # Check if session2 still works
        response = session2.get(f"{self.base_url}/dashboard")

        if response.status_code == 200 and 'login' not in response.url.lower():
            print("[VULN] Other sessions not invalidated after password change!")
            self.findings.append({
                "issue": "Sessions persist after password change",
                "severity": "High"
            })
        else:
            print("[OK] Other sessions invalidated after password change")

    def test_session_termination(self, credentials):
        """Test if user can terminate other sessions"""
        print("\n[*] Testing session termination capability...")

        # Check for session management endpoint
        session = requests.Session()
        session.post(f"{self.base_url}/login", data=credentials)

        # Look for session management
        response = session.get(f"{self.base_url}/settings/sessions")

        if response.status_code == 200:
            print("[OK] Session management available")
            # Try to terminate sessions
            session.post(f"{self.base_url}/settings/sessions/terminate-all")
        else:
            print("[INFO] No session management interface found")

    def test_session_limit(self, credentials, max_sessions=10):
        """Test if there's a limit on concurrent sessions"""
        print(f"\n[*] Testing session limit (trying {max_sessions} sessions)...")

        sessions = []

        for i in range(max_sessions):
            session = requests.Session()
            session.headers['User-Agent'] = f'Device-{i}/1.0'
            response = session.post(f"{self.base_url}/login", data=credentials)

            if response.status_code != 200 or 'login' in response.url.lower():
                print(f"[INFO] Session limit reached at {i} sessions")
                return i

            sessions.append(session)

        print(f"[WARN] No limit found - {max_sessions} concurrent sessions created")
        return max_sessions

# Usage
tester = ConcurrentSessionTester("https://target.com")
credentials = {"username": "test", "password": "test"}

tester.test_multiple_sessions(credentials)
tester.test_password_change_invalidation(credentials, "newpassword123")
tester.test_session_termination(credentials)
tester.test_session_limit(credentials)
```

---

## Remediation Guide

### Session Management Implementation

```python
from flask import session, g
import time

class SessionManager:
    MAX_CONCURRENT_SESSIONS = 5

    def create_session(self, user_id):
        """Create new session with limits"""
        # Get existing sessions
        existing = Session.query.filter_by(user_id=user_id).all()

        # Enforce limit
        if len(existing) >= self.MAX_CONCURRENT_SESSIONS:
            # Terminate oldest session
            oldest = min(existing, key=lambda s: s.created_at)
            Session.delete(oldest.id)

        # Create new session
        session_id = secrets.token_urlsafe(32)
        Session.create(
            id=session_id,
            user_id=user_id,
            created_at=time.time(),
            device_info=request.headers.get('User-Agent')
        )

        return session_id

    def invalidate_user_sessions(self, user_id, except_current=None):
        """Invalidate all sessions for user"""
        sessions = Session.query.filter_by(user_id=user_id)

        for s in sessions:
            if s.id != except_current:
                Session.delete(s.id)

# On password change
@app.route('/change-password', methods=['POST'])
@require_auth
def change_password():
    if update_password(g.user, request.form):
        # Invalidate all other sessions
        session_manager.invalidate_user_sessions(
            g.user.id,
            except_current=session.get('id')
        )
        return jsonify({"success": True})
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| Sessions persist after password change | 7.5 | High |
| No concurrent session limit | 4.3 | Medium |
| No session termination capability | 4.3 | Medium |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-613** | Insufficient Session Expiration |
| **CWE-384** | Session Fixation |

---

## Checklist

```
[ ] Concurrent sessions tested
[ ] Password change invalidation tested
[ ] Session termination tested
[ ] Session limit tested
[ ] Session management UI checked
[ ] Findings documented
```
