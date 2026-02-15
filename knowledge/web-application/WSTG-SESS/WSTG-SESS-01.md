# WSTG-SESS-01: Testing for Session Management Schema

## Test ID
WSTG-SESS-01

## Test Name
Testing for Session Management Schema

## High-Level Description

Session management is the mechanism by which a web application maintains state with users across multiple requests. Weaknesses in session management can lead to session hijacking, fixation, or prediction attacks. This test evaluates the overall session management implementation including token generation, transmission, storage, and lifecycle management.

---

## What to Check

### Session Token Properties

- [ ] Token randomness/entropy
- [ ] Token length (minimum 128 bits)
- [ ] Token predictability
- [ ] Token format/structure
- [ ] Token transmission security
- [ ] Token storage location

### Session Lifecycle

| Phase | Security Concern |
|-------|-----------------|
| Generation | Randomness, entropy |
| Transmission | HTTPS, secure headers |
| Storage | HttpOnly, Secure flags |
| Validation | Server-side checks |
| Termination | Proper invalidation |

---

## How to Test

### Step 1: Identify Session Tokens

```bash
# Capture session tokens from response headers
curl -sI "https://target.com/login" | grep -iE "set-cookie|session|token"

# Common session token names:
# JSESSIONID (Java)
# PHPSESSID (PHP)
# ASP.NET_SessionId (.NET)
# session_id
# SESSIONID
# auth_token
# access_token

# Check multiple requests for all cookies
for i in {1..5}; do
    curl -s -c - "https://target.com/" | grep -v "^#"
done
```

### Step 2: Analyze Token Entropy

```python
#!/usr/bin/env python3
import requests
import math
from collections import Counter

class SessionEntropyAnalyzer:
    def __init__(self, url, session_cookie_name):
        self.url = url
        self.cookie_name = session_cookie_name
        self.tokens = []

    def collect_tokens(self, count=20):
        """Collect multiple session tokens"""
        print(f"[*] Collecting {count} session tokens...")

        for i in range(count):
            try:
                session = requests.Session()
                response = session.get(self.url)

                for cookie in session.cookies:
                    if cookie.name == self.cookie_name:
                        self.tokens.append(cookie.value)
                        break

            except Exception as e:
                print(f"[ERROR] {e}")

        print(f"[*] Collected {len(self.tokens)} tokens")
        return self.tokens

    def calculate_entropy(self, token):
        """Calculate Shannon entropy of token"""
        if not token:
            return 0

        freq = Counter(token)
        length = len(token)

        entropy = 0
        for count in freq.values():
            p = count / length
            entropy -= p * math.log2(p)

        return entropy * length  # Total entropy bits

    def analyze_randomness(self):
        """Analyze token randomness"""
        print("\n[*] Analyzing token randomness...")

        if not self.tokens:
            print("[!] No tokens collected")
            return

        # Token length analysis
        lengths = [len(t) for t in self.tokens]
        print(f"Token lengths: min={min(lengths)}, max={max(lengths)}, avg={sum(lengths)/len(lengths):.1f}")

        # Entropy analysis
        entropies = [self.calculate_entropy(t) for t in self.tokens]
        avg_entropy = sum(entropies) / len(entropies)
        print(f"Average entropy: {avg_entropy:.1f} bits")

        if avg_entropy < 64:
            print("[VULN] Low entropy - tokens may be predictable")
        elif avg_entropy < 128:
            print("[WARN] Moderate entropy - consider increasing")
        else:
            print("[OK] Good entropy (>= 128 bits)")

        # Check for common prefixes
        if len(self.tokens) > 1:
            common_prefix = self.find_common_prefix()
            if len(common_prefix) > 5:
                print(f"[WARN] Common prefix found: {common_prefix}")

        # Check character set
        all_chars = set(''.join(self.tokens))
        print(f"Character set size: {len(all_chars)}")

    def find_common_prefix(self):
        """Find common prefix in tokens"""
        if not self.tokens:
            return ""

        prefix = ""
        for chars in zip(*self.tokens):
            if len(set(chars)) == 1:
                prefix += chars[0]
            else:
                break
        return prefix

    def check_sequentiality(self):
        """Check if tokens appear sequential"""
        print("\n[*] Checking for sequential patterns...")

        # Extract numeric portions
        import re
        numeric_parts = []

        for token in self.tokens:
            numbers = re.findall(r'\d+', token)
            if numbers:
                numeric_parts.append(int(numbers[-1]))

        if len(numeric_parts) >= 2:
            # Check if sequential
            diffs = [numeric_parts[i+1] - numeric_parts[i]
                    for i in range(len(numeric_parts)-1)]

            if len(set(diffs)) == 1 and diffs[0] > 0:
                print(f"[VULN] Sequential pattern detected: increment = {diffs[0]}")
            else:
                print("[OK] No obvious sequential pattern")

# Usage
analyzer = SessionEntropyAnalyzer(
    "https://target.com/",
    "SESSIONID"
)
analyzer.collect_tokens(20)
analyzer.analyze_randomness()
analyzer.check_sequentiality()
```

### Step 3: Test Token Transmission Security

```bash
#!/bin/bash
# Test session token transmission security

TARGET="https://target.com"

# Get session token
response=$(curl -s -c - "$TARGET/login" -d "user=test&pass=test")

# Check for Secure flag
if echo "$response" | grep -i "Secure"; then
    echo "[OK] Secure flag present"
else
    echo "[VULN] Missing Secure flag - token sent over HTTP"
fi

# Check for HttpOnly flag
if echo "$response" | grep -i "HttpOnly"; then
    echo "[OK] HttpOnly flag present"
else
    echo "[VULN] Missing HttpOnly flag - XSS can steal token"
fi

# Check for SameSite attribute
if echo "$response" | grep -i "SameSite"; then
    samesite=$(echo "$response" | grep -oP "SameSite=\w+")
    echo "[OK] SameSite attribute: $samesite"
else
    echo "[WARN] Missing SameSite attribute"
fi

# Check if token appears in URL
curl -s -I "$TARGET/authenticated-page" | grep -i "location.*session"
if [ $? -eq 0 ]; then
    echo "[VULN] Session token in URL"
fi
```

### Step 4: Test Session Token Handling

```bash
#!/bin/bash
# Test how application handles session tokens

TARGET="https://target.com"
VALID_SESSION="valid_session_token"

# Test with no session
echo "=== No session token ==="
curl -s -I "$TARGET/protected"

# Test with invalid session
echo "=== Invalid session token ==="
curl -s -I "$TARGET/protected" -b "SESSIONID=invalid123"

# Test with expired session
echo "=== Expired session token ==="
curl -s -I "$TARGET/protected" -b "SESSIONID=expired_token"

# Test with empty session
echo "=== Empty session token ==="
curl -s -I "$TARGET/protected" -b "SESSIONID="

# Test with null session
echo "=== Null session token ==="
curl -s -I "$TARGET/protected" -b "SESSIONID=null"
```

### Step 5: Test Session Renewal

```bash
#!/bin/bash
# Test if session ID changes after authentication

TARGET="https://target.com"

# Get pre-auth session
pre_auth=$(curl -s -c - "$TARGET/" | grep -oP "SESSIONID=\K[^;]+")
echo "Pre-auth session: $pre_auth"

# Authenticate
post_auth=$(curl -s -c - -b "SESSIONID=$pre_auth" \
    "$TARGET/login" -d "user=test&pass=test" | grep -oP "SESSIONID=\K[^;]+")
echo "Post-auth session: $post_auth"

if [ "$pre_auth" == "$post_auth" ]; then
    echo "[VULN] Session fixation - ID not renewed after login"
else
    echo "[OK] Session ID renewed after login"
fi

# Test privilege change session renewal
# After privilege escalation, session should also renew
```

### Step 6: Test Session Storage

```javascript
// Browser console tests for session storage

// Check for session data in localStorage (not recommended)
console.log("localStorage session data:");
for (let key in localStorage) {
    if (key.toLowerCase().includes('session') ||
        key.toLowerCase().includes('token') ||
        key.toLowerCase().includes('auth')) {
        console.log(key + ": " + localStorage[key]);
    }
}

// Check sessionStorage
console.log("\nsessionStorage session data:");
for (let key in sessionStorage) {
    if (key.toLowerCase().includes('session') ||
        key.toLowerCase().includes('token')) {
        console.log(key + ": " + sessionStorage[key]);
    }
}

// If session data in storage is accessible, it's vulnerable to XSS
```

### Step 7: Comprehensive Session Analysis

```python
#!/usr/bin/env python3
import requests
import time
from urllib.parse import urlparse

class SessionAnalyzer:
    def __init__(self, base_url):
        self.base_url = base_url
        self.session = requests.Session()
        self.findings = []

    def analyze_cookie_attributes(self):
        """Analyze session cookie security attributes"""
        print("\n[*] Analyzing cookie attributes...")

        response = self.session.get(self.base_url)

        for cookie in self.session.cookies:
            print(f"\nCookie: {cookie.name}")
            print(f"  Value length: {len(cookie.value)}")
            print(f"  Domain: {cookie.domain}")
            print(f"  Path: {cookie.path}")
            print(f"  Secure: {cookie.secure}")
            print(f"  HttpOnly: {cookie.has_nonstandard_attr('HttpOnly')}")

            # Check for issues
            if not cookie.secure:
                self.findings.append({
                    "issue": "Missing Secure flag",
                    "cookie": cookie.name,
                    "severity": "High"
                })

            if 'httponly' not in str(cookie).lower():
                self.findings.append({
                    "issue": "Missing HttpOnly flag",
                    "cookie": cookie.name,
                    "severity": "High"
                })

            if len(cookie.value) < 16:
                self.findings.append({
                    "issue": "Short token length",
                    "cookie": cookie.name,
                    "severity": "Medium"
                })

    def test_session_in_url(self):
        """Check if session appears in URLs"""
        print("\n[*] Testing for session in URL...")

        # Login and follow redirects
        response = self.session.get(
            f"{self.base_url}/login",
            allow_redirects=True
        )

        # Check URL history for session tokens
        for resp in response.history:
            if 'session' in resp.url.lower() or 'token' in resp.url.lower():
                self.findings.append({
                    "issue": "Session token in URL",
                    "url": resp.url,
                    "severity": "High"
                })
                print(f"[VULN] Session in URL: {resp.url}")

    def test_session_validity(self):
        """Test session validation"""
        print("\n[*] Testing session validation...")

        # Test with manipulated session
        manipulated_values = [
            "",
            "null",
            "undefined",
            "0",
            "admin",
            "../../../etc/passwd",
            "<script>alert(1)</script>",
            "A" * 1000,
        ]

        for value in manipulated_values:
            test_session = requests.Session()
            test_session.cookies.set('SESSIONID', value)

            try:
                response = test_session.get(f"{self.base_url}/protected")

                if response.status_code == 200:
                    print(f"[VULN] Accepted manipulated session: {value[:50]}")
                    self.findings.append({
                        "issue": "Weak session validation",
                        "value": value[:50],
                        "severity": "High"
                    })

            except:
                pass

    def generate_report(self):
        """Generate session analysis report"""
        print("\n" + "="*60)
        print("SESSION MANAGEMENT ANALYSIS REPORT")
        print("="*60)

        if not self.findings:
            print("\nNo issues found.")
            return

        print(f"\nTotal findings: {len(self.findings)}")

        # Group by severity
        by_severity = {}
        for finding in self.findings:
            sev = finding['severity']
            if sev not in by_severity:
                by_severity[sev] = []
            by_severity[sev].append(finding)

        for severity in ['Critical', 'High', 'Medium', 'Low']:
            if severity in by_severity:
                print(f"\n{severity} ({len(by_severity[severity])}):")
                for f in by_severity[severity]:
                    print(f"  - {f['issue']}")

# Usage
analyzer = SessionAnalyzer("https://target.com")
analyzer.analyze_cookie_attributes()
analyzer.test_session_in_url()
analyzer.test_session_validity()
analyzer.generate_report()
```

---

## Tools

### Session Analysis

| Tool | Description | Usage |
|------|-------------|-------|
| **Burp Suite** | Session analysis | Sequencer, token analysis |
| **OWASP ZAP** | Session testing | Automated scanning |
| **Cookie-Editor** | Browser extension | Cookie manipulation |

### Entropy Analysis

| Tool | Description |
|------|-------------|
| **Burp Sequencer** | Token randomness analysis |
| **Custom scripts** | Entropy calculation |

---

## Remediation Guide

### 1. Secure Session Generation

```python
import secrets
import hashlib
import time

class SecureSessionManager:
    SESSION_LENGTH = 32  # 256 bits

    @staticmethod
    def generate_session_id():
        """Generate cryptographically secure session ID"""
        return secrets.token_urlsafe(SecureSessionManager.SESSION_LENGTH)

    @staticmethod
    def create_session(user_id, ip_address, user_agent):
        """Create new session with metadata"""
        session_id = SecureSessionManager.generate_session_id()

        session_data = {
            'session_id': session_id,
            'user_id': user_id,
            'created_at': time.time(),
            'last_activity': time.time(),
            'ip_address': hashlib.sha256(ip_address.encode()).hexdigest(),
            'user_agent_hash': hashlib.sha256(user_agent.encode()).hexdigest(),
        }

        # Store in session store
        SessionStore.save(session_id, session_data)

        return session_id
```

### 2. Secure Cookie Configuration

```python
from flask import Flask, make_response

app = Flask(__name__)

# Session configuration
app.config.update(
    SESSION_COOKIE_SECURE=True,        # HTTPS only
    SESSION_COOKIE_HTTPONLY=True,      # No JavaScript access
    SESSION_COOKIE_SAMESITE='Strict',  # CSRF protection
    PERMANENT_SESSION_LIFETIME=3600,   # 1 hour timeout
)

# Or set manually
@app.after_request
def set_secure_cookie(response):
    response.set_cookie(
        'session_id',
        value=session_id,
        secure=True,
        httponly=True,
        samesite='Strict',
        max_age=3600,
        path='/'
    )
    return response
```

### 3. Session Validation

```python
import hashlib
import time

class SessionValidator:
    MAX_INACTIVITY = 1800  # 30 minutes
    MAX_LIFETIME = 86400   # 24 hours

    def validate_session(self, session_id, request):
        """Validate session with multiple checks"""
        session = SessionStore.get(session_id)

        if not session:
            return False, "Session not found"

        # Check session age
        if time.time() - session['created_at'] > self.MAX_LIFETIME:
            SessionStore.delete(session_id)
            return False, "Session expired"

        # Check inactivity
        if time.time() - session['last_activity'] > self.MAX_INACTIVITY:
            SessionStore.delete(session_id)
            return False, "Session inactive"

        # Validate IP (optional - may cause issues with mobile)
        ip_hash = hashlib.sha256(request.remote_addr.encode()).hexdigest()
        if session['ip_address'] != ip_hash:
            # Log potential session hijacking
            log_security_event("IP mismatch", session_id)
            # Optionally invalidate session

        # Update last activity
        session['last_activity'] = time.time()
        SessionStore.save(session_id, session)

        return True, None
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Predictable session tokens | 9.1 | Critical |
| Missing Secure flag | 7.5 | High |
| Missing HttpOnly flag | 6.1 | Medium |
| Session in URL | 7.5 | High |
| Short session token | 5.3 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-330** | Insufficient Randomness | Weak token generation |
| **CWE-614** | HTTPS Session Cookie Without Secure | Missing Secure flag |
| **CWE-1004** | Sensitive Cookie Without HttpOnly | Missing HttpOnly |
| **CWE-598** | Session ID in URL | Exposure via Referer |

---

## References

- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP WSTG - Session Management Testing](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/06-Session_Management_Testing/)
- [RFC 6265 - HTTP State Management](https://tools.ietf.org/html/rfc6265)

---

## Checklist

```
[ ] Session tokens identified
[ ] Token entropy analyzed
[ ] Token randomness tested
[ ] Cookie flags checked (Secure, HttpOnly, SameSite)
[ ] Session in URL checked
[ ] Session renewal on auth tested
[ ] Session validation tested
[ ] Session storage analyzed
[ ] Token length verified
[ ] Findings documented
[ ] Remediation recommendations provided
```
