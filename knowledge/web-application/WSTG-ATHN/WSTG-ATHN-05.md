# WSTG-ATHN-05: Testing for Vulnerable Remember Password

## Test ID
WSTG-ATHN-05

## Test Name
Testing for Vulnerable Remember Password

## High-Level Description

"Remember me" or "remember password" functionality allows users to stay logged in across browser sessions. This test examines whether this functionality is implemented securely. Insecure implementations may store credentials in cleartext, use predictable tokens, or create persistent sessions that are vulnerable to theft or abuse.

---

## What to Check

### Remember Me Implementation

- [ ] Token generation security
- [ ] Token storage method
- [ ] Token expiration
- [ ] Token scope (device/browser specific)
- [ ] Credential storage
- [ ] Token revocation capability

### Common Vulnerabilities

| Vulnerability | Description |
|---------------|-------------|
| Cleartext credentials | Password stored in cookie |
| Predictable tokens | Sequential or guessable values |
| No expiration | Tokens never expire |
| Cross-device usage | Same token works everywhere |
| No revocation | Cannot invalidate tokens |

---

## How to Test

### Step 1: Analyze Remember Me Token

```bash
# Login with remember me enabled
response=$(curl -s -X POST "https://target.com/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"testuser","password":"password","remember_me":true}' \
    -c cookies.txt \
    -v 2>&1)

# Examine cookies
cat cookies.txt

# Look for remember me specific cookies
grep -i "remember\|persistent\|token" cookies.txt

# Check cookie attributes
curl -sI "https://target.com/login" -X POST \
    -d '{"username":"testuser","password":"password","remember_me":true}' | \
    grep -i "set-cookie"
```

### Step 2: Check for Cleartext Credentials

```bash
# Decode cookie values
# If base64 encoded
echo "cookie_value_here" | base64 -d

# Check for username/password in cookie
cookie_value="your_remember_me_cookie"

# Try base64 decode
echo "$cookie_value" | base64 -d 2>/dev/null

# Try URL decode
echo "$cookie_value" | python3 -c "import sys, urllib.parse; print(urllib.parse.unquote(sys.stdin.read()))"

# Check if value contains readable text
echo "$cookie_value" | xxd
```

### Step 3: Test Token Predictability

```bash
#!/bin/bash
# Collect multiple tokens to analyze patterns

tokens=()

for i in {1..10}; do
    # Create new account or use existing
    token=$(curl -s -X POST "https://target.com/login" \
        -H "Content-Type: application/json" \
        -d '{"username":"testuser","password":"password","remember_me":true}' \
        -c - | grep -i "remember" | awk '{print $7}')

    tokens+=("$token")
    echo "Token $i: $token"

    # Logout between requests
    curl -s "https://target.com/logout" > /dev/null

    sleep 1
done

# Analyze tokens for patterns
echo ""
echo "=== Token Analysis ==="
echo "Lengths: ${#tokens[@]} tokens collected"

# Check for sequential patterns
# Check for timestamp patterns
# Check for username inclusion
```

### Step 4: Test Token Expiration

```bash
# Login and get remember me token
curl -s -X POST "https://target.com/login" \
    -d '{"username":"testuser","password":"password","remember_me":true}' \
    -c cookies.txt

# Get the remember me cookie
remember_token=$(grep -i "remember" cookies.txt | awk '{print $7}')

# Test if token works
curl -s "https://target.com/dashboard" \
    -H "Cookie: remember_me=$remember_token" \
    -w "\nStatus: %{http_code}"

# Test after simulated time (if possible)
# Or wait and test periodically

# Check if old tokens still work
# Store tokens from previous tests and try them
```

### Step 5: Test Cross-Device Token Usage

```bash
# Login and get token
token=$(curl -s -X POST "https://target.com/login" \
    -d '{"username":"testuser","password":"password","remember_me":true}' \
    -c - | grep -i "remember" | awk '{print $7}')

# Try token from different User-Agent
curl -s "https://target.com/dashboard" \
    -H "Cookie: remember_me=$token" \
    -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
    -w "\nStatus: %{http_code}"

curl -s "https://target.com/dashboard" \
    -H "Cookie: remember_me=$token" \
    -H "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)" \
    -w "\nStatus: %{http_code}"

# Try from different simulated IP
curl -s "https://target.com/dashboard" \
    -H "Cookie: remember_me=$token" \
    -H "X-Forwarded-For: 1.2.3.4" \
    -w "\nStatus: %{http_code}"
```

### Step 6: Test Token Revocation

```bash
# Get remember me token
token=$(curl -s -X POST "https://target.com/login" \
    -d '{"username":"testuser","password":"password","remember_me":true}' \
    -c - | grep -i "remember" | awk '{print $7}')

# Verify token works
curl -s "https://target.com/dashboard" \
    -H "Cookie: remember_me=$token" \
    -w "\nStatus: %{http_code}" > /dev/null
echo "Before logout: Token works"

# Logout
curl -s "https://target.com/logout" \
    -H "Cookie: remember_me=$token"

# Try token again
response=$(curl -s "https://target.com/dashboard" \
    -H "Cookie: remember_me=$token" \
    -w "\nStatus: %{http_code}")

if echo "$response" | grep -q "200"; then
    echo "[VULN] Token still works after logout!"
else
    echo "[OK] Token properly invalidated after logout"
fi

# Test after password change
# Token should be invalidated after password change
```

### Step 7: Check Cookie Security Attributes

```bash
# Analyze cookie attributes
curl -sI "https://target.com/login" -X POST \
    -d '{"username":"testuser","password":"password","remember_me":true}' | \
    grep -i "set-cookie" | while read line; do
        echo "Cookie: $line"
        echo ""

        # Check for security attributes
        if echo "$line" | grep -qi "secure"; then
            echo "  [OK] Secure flag present"
        else
            echo "  [VULN] Secure flag missing"
        fi

        if echo "$line" | grep -qi "httponly"; then
            echo "  [OK] HttpOnly flag present"
        else
            echo "  [VULN] HttpOnly flag missing"
        fi

        if echo "$line" | grep -qi "samesite"; then
            echo "  [OK] SameSite attribute present"
        else
            echo "  [WARN] SameSite attribute missing"
        fi
    done
```

---

## Tools

### Cookie Analysis

| Tool | Description | Usage |
|------|-------------|-------|
| **Burp Suite** | Cookie inspection | Analyze token values |
| **Browser DevTools** | Cookie viewer | Inspect cookie attributes |
| **CyberChef** | Decoding | Decode token values |

### Token Analysis

| Tool | Description |
|------|-------------|
| **jwt.io** | JWT decoder |
| **Hashcat** | Hash analysis |
| **Custom scripts** | Pattern analysis |

---

## Example Commands/Payloads

### Remember Me Token Analyzer

```python
#!/usr/bin/env python3
import requests
import base64
import json
import hashlib
from datetime import datetime

class RememberMeAnalyzer:
    def __init__(self, base_url):
        self.base_url = base_url
        self.tokens = []

    def login_and_get_token(self, username, password):
        """Login and capture remember me token"""
        response = requests.post(
            f"{self.base_url}/login",
            json={
                "username": username,
                "password": password,
                "remember_me": True
            }
        )

        # Look for remember me cookie
        for cookie in response.cookies:
            if "remember" in cookie.name.lower() or "persistent" in cookie.name.lower():
                return {
                    "name": cookie.name,
                    "value": cookie.value,
                    "secure": cookie.secure,
                    "httponly": "httponly" in str(cookie).lower(),
                    "expires": cookie.expires,
                    "timestamp": datetime.now().isoformat()
                }

        return None

    def analyze_token(self, token_value):
        """Analyze token structure"""
        analysis = {
            "length": len(token_value),
            "appears_encoded": False,
            "decoded_content": None,
            "appears_sequential": False,
            "contains_username": False,
            "appears_hashed": False
        }

        # Try base64 decode
        try:
            decoded = base64.b64decode(token_value).decode('utf-8')
            analysis["appears_encoded"] = True
            analysis["decoded_content"] = decoded

            # Check if it's JSON
            try:
                json_data = json.loads(decoded)
                analysis["is_json"] = True
                analysis["json_keys"] = list(json_data.keys())
            except:
                pass

        except:
            pass

        # Check if it looks like a hash
        if len(token_value) in [32, 40, 64, 128]:  # MD5, SHA1, SHA256, SHA512
            if all(c in '0123456789abcdef' for c in token_value.lower()):
                analysis["appears_hashed"] = True

        return analysis

    def check_predictability(self, num_samples=5):
        """Check if tokens are predictable"""
        print(f"Collecting {num_samples} tokens...")

        for i in range(num_samples):
            token = self.login_and_get_token("testuser", "password")
            if token:
                self.tokens.append(token)
                print(f"  Token {i+1}: {token['value'][:50]}...")

        if len(self.tokens) < 2:
            return {"error": "Not enough tokens collected"}

        # Analyze patterns
        values = [t["value"] for t in self.tokens]

        # Check for sequential patterns
        sequential = False
        try:
            nums = [int(v, 16) if all(c in '0123456789abcdef' for c in v.lower()) else None for v in values]
            if all(n is not None for n in nums):
                diffs = [nums[i+1] - nums[i] for i in range(len(nums)-1)]
                if len(set(diffs)) == 1:
                    sequential = True
        except:
            pass

        # Check for timestamp patterns
        timestamp_pattern = any("time" in str(self.analyze_token(v).get("decoded_content", "")).lower() for v in values)

        return {
            "total_collected": len(self.tokens),
            "unique_values": len(set(values)),
            "sequential_pattern": sequential,
            "timestamp_pattern": timestamp_pattern,
            "predictable": sequential or len(set(values)) < len(values)
        }

    def check_token_after_logout(self, token):
        """Check if token still works after logout"""
        # First verify token works
        response = requests.get(
            f"{self.base_url}/dashboard",
            cookies={"remember_me": token}
        )
        works_before = response.status_code == 200

        # Logout
        requests.get(
            f"{self.base_url}/logout",
            cookies={"remember_me": token}
        )

        # Try again
        response = requests.get(
            f"{self.base_url}/dashboard",
            cookies={"remember_me": token}
        )
        works_after = response.status_code == 200

        return {
            "works_before_logout": works_before,
            "works_after_logout": works_after,
            "properly_invalidated": works_before and not works_after
        }

    def generate_report(self):
        """Generate analysis report"""
        print("\n=== REMEMBER ME SECURITY REPORT ===\n")

        if self.tokens:
            token = self.tokens[0]
            analysis = self.analyze_token(token["value"])

            print("Token Attributes:")
            print(f"  Secure flag: {token.get('secure', 'Unknown')}")
            print(f"  HttpOnly: {token.get('httponly', 'Unknown')}")
            print(f"  Expires: {token.get('expires', 'Unknown')}")

            print("\nToken Analysis:")
            print(f"  Length: {analysis['length']}")
            print(f"  Appears encoded: {analysis['appears_encoded']}")
            print(f"  Appears hashed: {analysis['appears_hashed']}")

            if analysis.get("decoded_content"):
                print(f"  Decoded content: {analysis['decoded_content'][:100]}")

# Usage
analyzer = RememberMeAnalyzer("https://target.com")
predictability = analyzer.check_predictability(5)
print(f"Predictability analysis: {predictability}")
analyzer.generate_report()
```

---

## Remediation Guide

### 1. Secure Token Generation

```python
import secrets
import hashlib
from datetime import datetime, timedelta

class SecureRememberMe:
    def __init__(self, redis_client):
        self.redis = redis_client
        self.token_expiry = timedelta(days=30)

    def create_token(self, user_id, user_agent, ip_address):
        """Create secure remember me token"""
        # Generate cryptographically secure random token
        selector = secrets.token_urlsafe(12)
        validator = secrets.token_urlsafe(32)

        # Hash the validator for storage
        validator_hash = hashlib.sha256(validator.encode()).hexdigest()

        # Store token data
        token_data = {
            "user_id": user_id,
            "validator_hash": validator_hash,
            "user_agent": user_agent,
            "ip_address": ip_address,
            "created_at": datetime.utcnow().isoformat()
        }

        # Store in Redis with expiration
        key = f"remember_me:{selector}"
        self.redis.setex(
            key,
            int(self.token_expiry.total_seconds()),
            json.dumps(token_data)
        )

        # Return token as selector:validator
        return f"{selector}:{validator}"

    def verify_token(self, token, user_agent, ip_address):
        """Verify remember me token"""
        try:
            selector, validator = token.split(':')
        except ValueError:
            return None

        # Get stored data
        key = f"remember_me:{selector}"
        stored_data = self.redis.get(key)

        if not stored_data:
            return None

        data = json.loads(stored_data)

        # Verify validator hash
        validator_hash = hashlib.sha256(validator.encode()).hexdigest()
        if not secrets.compare_digest(data["validator_hash"], validator_hash):
            return None

        # Optional: Verify device fingerprint
        # if data["user_agent"] != user_agent:
        #     return None

        return data["user_id"]

    def revoke_token(self, token):
        """Revoke a specific token"""
        try:
            selector, _ = token.split(':')
            self.redis.delete(f"remember_me:{selector}")
        except:
            pass

    def revoke_all_tokens(self, user_id):
        """Revoke all tokens for a user"""
        # Scan and delete all tokens for this user
        for key in self.redis.scan_iter(match="remember_me:*"):
            data = self.redis.get(key)
            if data:
                token_data = json.loads(data)
                if token_data.get("user_id") == user_id:
                    self.redis.delete(key)
```

### 2. Secure Cookie Settings

```python
from flask import Flask, make_response

@app.route('/login', methods=['POST'])
def login():
    user = authenticate(request.json)

    if user and request.json.get('remember_me'):
        remember_token = remember_me.create_token(
            user.id,
            request.headers.get('User-Agent'),
            request.remote_addr
        )

        response = make_response(jsonify({"status": "success"}))

        # Set secure cookie
        response.set_cookie(
            'remember_me',
            value=remember_token,
            max_age=30 * 24 * 60 * 60,  # 30 days
            secure=True,  # HTTPS only
            httponly=True,  # No JavaScript access
            samesite='Lax',  # CSRF protection
            path='/'
        )

        return response
```

### 3. Token Rotation

```python
def verify_and_rotate_token(token, user_agent, ip_address):
    """Verify token and issue new one (rotate)"""
    user_id = remember_me.verify_token(token, user_agent, ip_address)

    if user_id:
        # Revoke old token
        remember_me.revoke_token(token)

        # Issue new token
        new_token = remember_me.create_token(user_id, user_agent, ip_address)

        return user_id, new_token

    return None, None
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Cleartext password in cookie | 9.8 | Critical |
| Predictable token generation | 8.8 | High |
| Token works after logout | 7.5 | High |
| Missing Secure flag | 5.3 | Medium |
| Token never expires | 6.5 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-312** | Cleartext Storage of Sensitive Information | Password in cookie |
| **CWE-330** | Use of Insufficiently Random Values | Weak tokens |
| **CWE-613** | Insufficient Session Expiration | No expiration |
| **CWE-614** | Sensitive Cookie Without Secure Flag | Missing security |

---

## References

- [OWASP WSTG - Testing for Vulnerable Remember Password](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/04-Authentication_Testing/05-Testing_for_Vulnerable_Remember_Password)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)

---

## Checklist

```
[ ] Remember me token analyzed
[ ] Token encoding checked
[ ] Cleartext credentials checked
[ ] Token predictability tested
[ ] Token expiration tested
[ ] Cross-device usage tested
[ ] Token revocation on logout tested
[ ] Token revocation on password change tested
[ ] Cookie Secure flag checked
[ ] Cookie HttpOnly flag checked
[ ] Cookie SameSite attribute checked
[ ] Findings documented
[ ] Remediation recommendations provided
```
