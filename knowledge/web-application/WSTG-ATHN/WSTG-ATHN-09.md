# WSTG-ATHN-09: Testing for Weak Password Change or Reset Functionalities

## Test ID
WSTG-ATHN-09

## Test Name
Testing for Weak Password Change or Reset Functionalities

## High-Level Description

Password change and reset functionalities are critical security controls that must be properly implemented. This test examines these mechanisms for vulnerabilities such as weak token generation, missing validation, token leakage, and account takeover possibilities. Weaknesses in these functions can allow attackers to take over user accounts.

---

## What to Check

### Password Reset Issues

- [ ] Token predictability
- [ ] Token expiration
- [ ] Token single-use enforcement
- [ ] Email enumeration
- [ ] Host header injection
- [ ] Token leakage in URLs

### Password Change Issues

- [ ] Current password required
- [ ] New password validation
- [ ] Session invalidation after change
- [ ] Notification to user

---

## How to Test

### Step 1: Test Password Reset Token Strength

```bash
#!/bin/bash
# Collect multiple reset tokens to analyze

tokens=()

for i in {1..5}; do
    # Request reset and capture token (from email/response)
    response=$(curl -s -X POST "https://target.com/api/forgot-password" \
        -H "Content-Type: application/json" \
        -d '{"email":"test@example.com"}')

    echo "Request $i: $response"

    # If token is in response (should not be!)
    token=$(echo "$response" | grep -oP '"token":"[^"]+' | cut -d'"' -f4)
    if [ -n "$token" ]; then
        tokens+=("$token")
        echo "Token $i: $token"
    fi

    sleep 2
done

# Analyze token patterns
# Check for:
# - Sequential patterns
# - Timestamp-based patterns
# - Predictable length
# - Character set limitations
```

### Step 2: Test Token Expiration

```bash
# Request password reset
curl -s -X POST "https://target.com/api/forgot-password" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com"}'

# Obtain token (from email)
RESET_TOKEN="token_from_email"

# Test immediately
curl -s "https://target.com/reset-password?token=$RESET_TOKEN" \
    -w "\nStatus: %{http_code}"

# Wait and test at intervals
for minutes in 15 30 60 120 1440; do
    echo "Waiting $minutes minutes..."
    sleep $((minutes * 60))

    response=$(curl -s "https://target.com/reset-password?token=$RESET_TOKEN" \
        -w "\nStatus: %{http_code}")

    echo "After $minutes minutes: $response"

    if echo "$response" | grep -qi "expired\|invalid"; then
        echo "Token expired after $minutes minutes"
        break
    fi
done
```

### Step 3: Test Token Reuse

```bash
RESET_TOKEN="valid_token"

# Use token first time
curl -s -X POST "https://target.com/api/reset-password" \
    -H "Content-Type: application/json" \
    -d "{
        \"token\": \"$RESET_TOKEN\",
        \"new_password\": \"NewPassword123!\"
    }"

echo "First use complete"

# Try to use token again
response=$(curl -s -X POST "https://target.com/api/reset-password" \
    -H "Content-Type: application/json" \
    -d "{
        \"token\": \"$RESET_TOKEN\",
        \"new_password\": \"AnotherPassword456!\"
    }")

if echo "$response" | grep -qi "success"; then
    echo "[VULN] Token can be reused!"
else
    echo "[OK] Token is single-use"
fi
```

### Step 4: Test Host Header Injection

```bash
# Test if reset email uses Host header for link
curl -s -X POST "https://target.com/api/forgot-password" \
    -H "Content-Type: application/json" \
    -H "Host: attacker.com" \
    -d '{"email":"test@example.com"}'

# Test with X-Forwarded-Host
curl -s -X POST "https://target.com/api/forgot-password" \
    -H "Content-Type: application/json" \
    -H "X-Forwarded-Host: attacker.com" \
    -d '{"email":"test@example.com"}'

# Test with absolute URL in Referer
curl -s -X POST "https://target.com/api/forgot-password" \
    -H "Content-Type: application/json" \
    -H "Referer: https://attacker.com" \
    -d '{"email":"test@example.com"}'

# Check if email contains attacker.com domain
```

### Step 5: Test User Enumeration via Reset

```bash
# Valid email
response1=$(curl -s -X POST "https://target.com/api/forgot-password" \
    -H "Content-Type: application/json" \
    -d '{"email":"valid@example.com"}')

# Invalid email
response2=$(curl -s -X POST "https://target.com/api/forgot-password" \
    -H "Content-Type: application/json" \
    -d '{"email":"definitely.not.valid.email@example.com"}')

echo "Valid email response: $response1"
echo "Invalid email response: $response2"

# Compare responses - should be identical
if [ "$response1" != "$response2" ]; then
    echo "[VULN] Different responses enable user enumeration"
fi
```

### Step 6: Test Password Change Without Current Password

```bash
# Try to change password without providing current password
curl -s -X POST "https://target.com/api/change-password" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "new_password": "NewPassword123!"
    }'

# Try with empty current password
curl -s -X POST "https://target.com/api/change-password" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "current_password": "",
        "new_password": "NewPassword123!"
    }'
```

### Step 7: Test Session Invalidation After Password Change

```bash
# Get current session
OLD_TOKEN="current_session_token"

# Change password
curl -s -X POST "https://target.com/api/change-password" \
    -H "Authorization: Bearer $OLD_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "current_password": "OldPassword123!",
        "new_password": "NewPassword456!"
    }'

# Try to use old session
response=$(curl -s "https://target.com/api/user/profile" \
    -H "Authorization: Bearer $OLD_TOKEN" \
    -w "\nStatus: %{http_code}")

if echo "$response" | grep -q "200"; then
    echo "[VULN] Old session still valid after password change"
else
    echo "[OK] Old session invalidated"
fi
```

---

## Tools

### Token Analysis

| Tool | Description | Usage |
|------|-------------|-------|
| **Burp Sequencer** | Token randomness | Analyze reset tokens |
| **Custom scripts** | Pattern detection | Token analysis |
| **hashcat** | Token cracking | Weak token exploitation |

### Testing

| Tool | Description |
|------|-------------|
| **Burp Suite** | Request manipulation |
| **OWASP ZAP** | Automated testing |

---

## Example Commands/Payloads

### Password Reset Tester

```python
#!/usr/bin/env python3
import requests
import time
import hashlib
import statistics

class PasswordResetTester:
    def __init__(self, base_url):
        self.base_url = base_url
        self.session = requests.Session()

    def test_token_in_response(self, email):
        """Check if token is returned in response"""
        response = self.session.post(
            f"{self.base_url}/api/forgot-password",
            json={"email": email}
        )

        # Token should NEVER be in response
        text = response.text.lower()
        if "token" in text and len(response.text) > 100:
            return {"vulnerable": True, "reason": "Token may be in response"}

        return {"vulnerable": False}

    def test_host_header_injection(self, email):
        """Test for host header injection"""
        payloads = [
            {"Host": "attacker.com"},
            {"X-Forwarded-Host": "attacker.com"},
            {"X-Host": "attacker.com"},
            {"X-Forwarded-Server": "attacker.com"},
        ]

        for headers in payloads:
            try:
                response = self.session.post(
                    f"{self.base_url}/api/forgot-password",
                    json={"email": email},
                    headers=headers,
                    allow_redirects=False
                )

                # Check if response indicates email will be sent
                if response.status_code == 200:
                    return {
                        "tested_headers": headers,
                        "note": "Check email for poisoned link"
                    }

            except Exception as e:
                pass

        return {"tested": True}

    def test_user_enumeration(self, valid_email, invalid_email):
        """Test for user enumeration via different responses"""

        valid_response = self.session.post(
            f"{self.base_url}/api/forgot-password",
            json={"email": valid_email}
        )

        invalid_response = self.session.post(
            f"{self.base_url}/api/forgot-password",
            json={"email": invalid_email}
        )

        # Compare responses
        differences = []

        if valid_response.status_code != invalid_response.status_code:
            differences.append(f"Status code: {valid_response.status_code} vs {invalid_response.status_code}")

        if len(valid_response.text) != len(invalid_response.text):
            differences.append(f"Response length: {len(valid_response.text)} vs {len(invalid_response.text)}")

        if valid_response.text != invalid_response.text:
            differences.append("Response content differs")

        # Check timing
        times_valid = []
        times_invalid = []

        for _ in range(5):
            start = time.time()
            self.session.post(f"{self.base_url}/api/forgot-password", json={"email": valid_email})
            times_valid.append(time.time() - start)

            start = time.time()
            self.session.post(f"{self.base_url}/api/forgot-password", json={"email": invalid_email})
            times_invalid.append(time.time() - start)

        avg_valid = statistics.mean(times_valid)
        avg_invalid = statistics.mean(times_invalid)

        if abs(avg_valid - avg_invalid) > 0.1:
            differences.append(f"Timing difference: {avg_valid:.3f}s vs {avg_invalid:.3f}s")

        return {
            "vulnerable": len(differences) > 0,
            "differences": differences
        }

    def test_token_reuse(self, token, new_password_1, new_password_2):
        """Test if token can be reused"""

        # First use
        response1 = self.session.post(
            f"{self.base_url}/api/reset-password",
            json={"token": token, "new_password": new_password_1}
        )

        # Second use
        response2 = self.session.post(
            f"{self.base_url}/api/reset-password",
            json={"token": token, "new_password": new_password_2}
        )

        return {
            "first_use": response1.status_code,
            "second_use": response2.status_code,
            "vulnerable": response2.status_code == 200
        }

    def test_password_change_requires_current(self, token):
        """Test if password change requires current password"""

        # Without current password
        response = self.session.post(
            f"{self.base_url}/api/change-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"new_password": "NewPassword123!"}
        )

        return {
            "current_password_required": response.status_code != 200,
            "status": response.status_code
        }

    def generate_report(self, results):
        """Generate test report"""
        print("\n=== PASSWORD RESET SECURITY REPORT ===\n")

        for test_name, result in results.items():
            vulnerable = result.get("vulnerable", False)
            status = "[VULN]" if vulnerable else "[OK]"
            print(f"{status} {test_name}")

            for key, value in result.items():
                if key != "vulnerable":
                    print(f"    {key}: {value}")
            print()

# Usage
tester = PasswordResetTester("https://target.com")
results = {
    "Token in Response": tester.test_token_in_response("test@example.com"),
    "Host Header Injection": tester.test_host_header_injection("test@example.com"),
    "User Enumeration": tester.test_user_enumeration("valid@example.com", "invalid@example.com"),
}
tester.generate_report(results)
```

---

## Remediation Guide

### 1. Secure Password Reset Token Generation

```python
import secrets
import hashlib
from datetime import datetime, timedelta

class SecurePasswordReset:
    TOKEN_EXPIRY = timedelta(hours=1)

    def __init__(self, redis_client):
        self.redis = redis_client

    def create_reset_token(self, user_id):
        """Create secure reset token"""
        # Generate cryptographically secure token
        token = secrets.token_urlsafe(32)

        # Store hash of token (not the token itself)
        token_hash = hashlib.sha256(token.encode()).hexdigest()

        token_data = {
            "user_id": user_id,
            "created_at": datetime.utcnow().isoformat(),
            "used": False
        }

        # Store with expiration
        key = f"password_reset:{token_hash}"
        self.redis.setex(
            key,
            int(self.TOKEN_EXPIRY.total_seconds()),
            json.dumps(token_data)
        )

        return token  # Return unhashed token to user

    def verify_and_consume_token(self, token):
        """Verify token and mark as used (single-use)"""
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        key = f"password_reset:{token_hash}"

        # Get token data
        data = self.redis.get(key)
        if not data:
            return None, "Invalid or expired token"

        token_data = json.loads(data)

        # Check if already used
        if token_data["used"]:
            return None, "Token already used"

        # Mark as used (or delete)
        self.redis.delete(key)

        return token_data["user_id"], None

    def send_reset_email(self, user, token):
        """Send reset email with secure link"""
        # Use configured domain, not Host header
        domain = current_app.config['DOMAIN']

        reset_url = f"https://{domain}/reset-password?token={token}"

        send_email(
            to=user.email,
            subject="Password Reset Request",
            body=f"Click here to reset your password: {reset_url}\n\nThis link expires in 1 hour."
        )
```

### 2. Prevent User Enumeration

```python
@app.route('/api/forgot-password', methods=['POST'])
def forgot_password():
    email = request.json.get('email')

    # Always return the same response
    generic_response = {
        "message": "If an account exists with this email, a reset link has been sent"
    }

    user = User.query.filter_by(email=email).first()

    if user:
        token = password_reset.create_reset_token(user.id)
        password_reset.send_reset_email(user, token)
        log_event("password_reset_requested", user_id=user.id)
    else:
        # Log for monitoring but don't reveal to user
        log_event("password_reset_invalid_email", email=email)

    # Add consistent delay to prevent timing attacks
    time.sleep(random.uniform(0.5, 1.0))

    return jsonify(generic_response)
```

### 3. Secure Password Change

```python
@app.route('/api/change-password', methods=['POST'])
@login_required
def change_password():
    current_password = request.json.get('current_password')
    new_password = request.json.get('new_password')

    # Require current password
    if not current_password:
        return jsonify({"error": "Current password required"}), 400

    if not current_user.check_password(current_password):
        log_security_event("password_change_failed", user_id=current_user.id)
        return jsonify({"error": "Current password incorrect"}), 401

    # Validate new password
    errors = validate_password(new_password, current_user)
    if errors:
        return jsonify({"errors": errors}), 400

    # Check password history
    if not check_password_history(current_user, new_password):
        return jsonify({"error": "Cannot reuse recent passwords"}), 400

    # Change password
    current_user.set_password(new_password)

    # Invalidate all other sessions
    invalidate_all_sessions(current_user.id, except_current=True)

    # Notify user
    send_password_changed_notification(current_user)

    # Log event
    log_security_event("password_changed", user_id=current_user.id)

    return jsonify({"message": "Password changed successfully"})
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Predictable reset tokens | 9.8 | Critical |
| Host header injection | 8.8 | High |
| Token reuse allowed | 8.8 | High |
| No current password required for change | 7.5 | High |
| User enumeration via reset | 5.3 | Medium |
| No session invalidation | 6.5 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-640** | Weak Password Recovery Mechanism | Token issues |
| **CWE-620** | Unverified Password Change | No current password |
| **CWE-204** | Observable Response Discrepancy | User enumeration |
| **CWE-613** | Insufficient Session Expiration | No invalidation |

---

## References

- [OWASP WSTG - Testing for Weak Password Change/Reset](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/04-Authentication_Testing/09-Testing_for_Weak_Password_Change_or_Reset_Functionalities)
- [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
- [Password Reset Poisoning](https://portswigger.net/web-security/host-header/exploiting/password-reset-poisoning)

---

## Checklist

```
[ ] Reset token randomness tested
[ ] Reset token expiration tested
[ ] Reset token single-use tested
[ ] Host header injection tested
[ ] User enumeration via reset tested
[ ] Token leakage checked
[ ] Current password required for change
[ ] New password validation tested
[ ] Session invalidation after change tested
[ ] Password change notification sent
[ ] Reset URL HTTPS only
[ ] Findings documented
[ ] Remediation recommendations provided
```
