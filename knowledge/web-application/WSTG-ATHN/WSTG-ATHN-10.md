# WSTG-ATHN-10: Testing for Weaker Authentication in Alternative Channel

## Test ID
WSTG-ATHN-10

## Test Name
Testing for Weaker Authentication in Alternative Channel

## High-Level Description

Many applications provide multiple access channels (web, mobile, API, legacy interfaces) that may have inconsistent authentication controls. This test identifies scenarios where alternative channels have weaker security than the primary channel, potentially allowing attackers to bypass stronger controls by using a less secure path to the same functionality.

---

## What to Check

### Alternative Channels

- [ ] Mobile application API
- [ ] Legacy web interface
- [ ] Admin/internal interfaces
- [ ] Partner/B2B APIs
- [ ] Command-line tools
- [ ] WebSocket connections
- [ ] Different subdomains

### Security Differences

| Channel | Potential Weakness |
|---------|-------------------|
| Mobile API | No 2FA, weaker rate limiting |
| Legacy interface | Old auth mechanisms |
| Internal API | No auth assumed |
| Partner API | API key only |
| Dev/staging | Default credentials |

---

## How to Test

### Step 1: Enumerate Access Channels

```bash
# Find API endpoints
curl -s "https://target.com" | grep -oP 'https?://[a-zA-Z0-9./-]+api[a-zA-Z0-9./-]*'

# Common alternative endpoints
endpoints=(
    "https://api.target.com"
    "https://mobile-api.target.com"
    "https://m.target.com"
    "https://legacy.target.com"
    "https://old.target.com"
    "https://internal.target.com"
    "https://admin.target.com"
    "https://partner.target.com"
    "https://dev.target.com"
    "https://staging.target.com"
)

for endpoint in "${endpoints[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "$endpoint" 2>/dev/null)
    if [ "$status" != "000" ]; then
        echo "$endpoint: $status"
    fi
done
```

### Step 2: Compare Authentication Requirements

```bash
# Test main web login
echo "=== Main Web ==="
curl -s -X POST "https://target.com/api/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"test","password":"password"}' \
    -v 2>&1 | grep -iE "2fa|mfa|otp|verify"

# Test mobile API
echo "=== Mobile API ==="
curl -s -X POST "https://api.target.com/v1/auth/login" \
    -H "Content-Type: application/json" \
    -H "User-Agent: TargetApp/1.0 (iOS)" \
    -d '{"username":"test","password":"password"}' \
    -v 2>&1 | grep -iE "2fa|mfa|otp|verify"

# Test legacy endpoint
echo "=== Legacy ==="
curl -s -X POST "https://legacy.target.com/login" \
    -d "username=test&password=password" \
    -v 2>&1 | grep -iE "2fa|mfa|otp|verify"
```

### Step 3: Test 2FA Bypass via Alternative Channel

```bash
# If web requires 2FA but mobile might not

# Web login (with 2FA)
web_response=$(curl -s -X POST "https://target.com/api/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"test","password":"password"}')

echo "Web: $web_response"
# Check if 2FA is required

# Mobile API login (potentially without 2FA)
mobile_response=$(curl -s -X POST "https://api.target.com/v1/auth/login" \
    -H "Content-Type: application/json" \
    -H "X-App-Version: 1.0" \
    -d '{"username":"test","password":"password"}')

echo "Mobile: $mobile_response"
# Check if direct access token is returned
```

### Step 4: Test Rate Limiting Differences

```bash
#!/bin/bash
# Compare rate limiting across channels

channels=(
    "https://target.com/api/login"
    "https://api.target.com/v1/auth/login"
    "https://m.target.com/login"
    "https://legacy.target.com/login"
)

for channel in "${channels[@]}"; do
    echo "=== Testing: $channel ==="

    attempts=0
    for i in {1..50}; do
        status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$channel" \
            -H "Content-Type: application/json" \
            -d '{"username":"test","password":"wrong"}' 2>/dev/null)

        if [ "$status" == "429" ]; then
            echo "Rate limited after $i attempts"
            break
        fi
        attempts=$((attempts + 1))
    done

    if [ "$attempts" -eq 50 ]; then
        echo "[WEAK] No rate limiting after 50 attempts"
    fi

    echo ""
done
```

### Step 5: Test Account Lockout Differences

```bash
#!/bin/bash
# Compare lockout policies

# Test on main channel
echo "=== Main Channel ==="
for i in {1..15}; do
    response=$(curl -s -X POST "https://target.com/api/login" \
        -H "Content-Type: application/json" \
        -d '{"username":"testuser","password":"wrong"}')

    if echo "$response" | grep -qi "locked"; then
        echo "Locked after $i attempts on main channel"
        break
    fi
done

# Test on mobile API
echo "=== Mobile API ==="
for i in {1..15}; do
    response=$(curl -s -X POST "https://api.target.com/v1/auth/login" \
        -H "Content-Type: application/json" \
        -d '{"username":"testuser","password":"wrong"}')

    if echo "$response" | grep -qi "locked"; then
        echo "Locked after $i attempts on mobile API"
        break
    fi
done
```

### Step 6: Test Session Token Differences

```bash
# Compare session security across channels

# Web session
web_session=$(curl -s -X POST "https://target.com/api/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"test","password":"password"}' \
    -c - | grep -i "session\|token")

echo "Web session: $web_session"

# Mobile session
mobile_session=$(curl -s -X POST "https://api.target.com/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"test","password":"password"}')

echo "Mobile session: $mobile_session"

# Compare token formats, expiration, etc.
```

### Step 7: Test OAuth/SSO Implementation Differences

```bash
# Check if OAuth is enforced on all channels

# Web (should use SSO)
curl -sI "https://target.com/login" | grep -i "location\|oauth\|sso"

# Mobile API (might allow direct login)
curl -s -X POST "https://api.target.com/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"test","password":"password"}' | head -50

# Legacy (might have different auth)
curl -sI "https://legacy.target.com/login" | grep -i "location\|oauth\|sso"
```

---

## Tools

### Channel Discovery

| Tool | Description | Usage |
|------|-------------|-------|
| **Subfinder** | Subdomain enumeration | Find alternative endpoints |
| **Amass** | Asset discovery | Discover channels |
| **Burp Suite** | Traffic analysis | Identify API patterns |

### Comparison Testing

| Tool | Description |
|------|-------------|
| **Custom scripts** | Automated comparison |
| **Postman** | Multi-channel testing |

---

## Example Commands/Payloads

### Multi-Channel Authentication Tester

```python
#!/usr/bin/env python3
import requests
import time

class MultiChannelTester:
    def __init__(self, channels):
        """
        channels: dict of channel_name -> base_url
        """
        self.channels = channels
        self.results = {}

    def test_basic_auth(self, username, password):
        """Test if basic auth works on each channel"""
        print("[*] Testing basic authentication...")

        for name, base_url in self.channels.items():
            endpoints = [
                f"{base_url}/api/login",
                f"{base_url}/api/v1/auth/login",
                f"{base_url}/auth/login",
                f"{base_url}/login",
            ]

            for endpoint in endpoints:
                try:
                    response = requests.post(
                        endpoint,
                        json={"username": username, "password": password},
                        timeout=10
                    )

                    if response.status_code == 200:
                        self.results[f"{name}_basic_auth"] = {
                            "endpoint": endpoint,
                            "success": True,
                            "requires_2fa": "2fa" in response.text.lower() or "mfa" in response.text.lower()
                        }
                        break

                except:
                    pass

    def test_2fa_requirement(self, username, password):
        """Check if 2FA is required on each channel"""
        print("[*] Testing 2FA requirements...")

        for name, base_url in self.channels.items():
            try:
                response = requests.post(
                    f"{base_url}/api/login",
                    json={"username": username, "password": password},
                    timeout=10
                )

                requires_2fa = any(x in response.text.lower()
                                   for x in ["2fa", "mfa", "verification", "otp", "code"])

                has_token = any(x in response.text.lower()
                               for x in ["token", "access_token", "session"])

                self.results[f"{name}_2fa"] = {
                    "requires_2fa": requires_2fa,
                    "direct_token": has_token and not requires_2fa
                }

            except Exception as e:
                self.results[f"{name}_2fa"] = {"error": str(e)}

    def test_rate_limiting(self, max_attempts=50):
        """Test rate limiting on each channel"""
        print("[*] Testing rate limiting...")

        for name, base_url in self.channels.items():
            blocked_at = None

            for i in range(max_attempts):
                try:
                    response = requests.post(
                        f"{base_url}/api/login",
                        json={"username": "test", "password": f"wrong{i}"},
                        timeout=5
                    )

                    if response.status_code == 429:
                        blocked_at = i + 1
                        break

                except:
                    break

            self.results[f"{name}_rate_limit"] = {
                "blocked_after": blocked_at,
                "no_limit": blocked_at is None
            }

    def test_lockout_policy(self, username, max_attempts=15):
        """Test account lockout on each channel"""
        print("[*] Testing lockout policy...")

        for name, base_url in self.channels.items():
            locked_at = None

            for i in range(max_attempts):
                try:
                    response = requests.post(
                        f"{base_url}/api/login",
                        json={"username": username, "password": f"wrong{i}"},
                        timeout=5
                    )

                    if "locked" in response.text.lower():
                        locked_at = i + 1
                        break

                except:
                    break

            self.results[f"{name}_lockout"] = {
                "locked_after": locked_at,
                "no_lockout": locked_at is None
            }

    def compare_security(self):
        """Compare security levels across channels"""
        print("\n=== SECURITY COMPARISON ===\n")

        # Find weakest channel
        weaknesses = []

        for name, base_url in self.channels.items():
            # Check 2FA
            tfa = self.results.get(f"{name}_2fa", {})
            if tfa.get("direct_token"):
                weaknesses.append(f"{name}: No 2FA required")

            # Check rate limiting
            rl = self.results.get(f"{name}_rate_limit", {})
            if rl.get("no_limit"):
                weaknesses.append(f"{name}: No rate limiting")

            # Check lockout
            lo = self.results.get(f"{name}_lockout", {})
            if lo.get("no_lockout"):
                weaknesses.append(f"{name}: No account lockout")

        if weaknesses:
            print("WEAKNESSES FOUND:")
            for w in weaknesses:
                print(f"  [!] {w}")
        else:
            print("No significant weaknesses found across channels")

    def generate_report(self):
        """Generate full report"""
        print("\n" + "=" * 60)
        print("MULTI-CHANNEL AUTHENTICATION TEST REPORT")
        print("=" * 60 + "\n")

        for test_name, result in self.results.items():
            print(f"{test_name}:")
            for key, value in result.items():
                print(f"    {key}: {value}")
            print()

        self.compare_security()

# Usage
channels = {
    "web": "https://target.com",
    "mobile_api": "https://api.target.com",
    "legacy": "https://legacy.target.com",
}

tester = MultiChannelTester(channels)
tester.test_basic_auth("testuser", "password")
tester.test_2fa_requirement("testuser", "password")
tester.test_rate_limiting()
tester.test_lockout_policy("testuser")
tester.generate_report()
```

---

## Remediation Guide

### 1. Centralized Authentication Service

```python
# All channels should use the same auth service
from auth_service import AuthService

class CentralizedAuth:
    """Single authentication service for all channels"""

    def __init__(self):
        self.auth = AuthService()

    def authenticate(self, username, password, channel, device_info=None):
        """Authenticate with consistent security across channels"""

        # Validate credentials
        user = self.auth.verify_credentials(username, password)
        if not user:
            return None, "Invalid credentials"

        # Apply same rate limiting
        if not self.auth.check_rate_limit(username, channel):
            return None, "Too many attempts"

        # Apply same lockout policy
        if self.auth.is_locked(username):
            return None, "Account locked"

        # Require 2FA for ALL channels if enabled
        if user.mfa_enabled:
            return {"requires_2fa": True, "temp_token": self.auth.create_temp_token(user)}

        # Generate session with same security settings
        session = self.auth.create_session(
            user,
            channel=channel,
            device_info=device_info,
            expiry=self.get_session_expiry(channel)  # Same expiry regardless of channel
        )

        return session, None
```

### 2. Consistent Security Policies

```python
# Configuration that applies to all channels
AUTH_CONFIG = {
    "max_login_attempts": 5,
    "lockout_duration": 900,  # 15 minutes
    "rate_limit": "10/minute",
    "session_expiry": 3600,  # 1 hour
    "require_2fa": True,  # For all channels
}

class AuthMiddleware:
    """Apply consistent auth checks across all channels"""

    def __init__(self, config=AUTH_CONFIG):
        self.config = config

    def check_rate_limit(self, request):
        """Same rate limiting for all channels"""
        identifier = self.get_client_identifier(request)
        return rate_limiter.check(identifier, self.config["rate_limit"])

    def check_lockout(self, username):
        """Same lockout policy for all channels"""
        return lockout_manager.is_locked(username)

    def require_2fa(self, user, request):
        """2FA required regardless of channel"""
        if self.config["require_2fa"] and user.mfa_enabled:
            return True
        return False

    def get_client_identifier(self, request):
        """Consistent client identification"""
        # Use combination of IP and user for fair rate limiting
        return f"{request.remote_addr}:{request.json.get('username', 'unknown')}"
```

### 3. API Gateway Enforcement

```yaml
# API Gateway configuration ensuring consistent security
policies:
  authentication:
    required: true
    methods:
      - jwt
      - session

  rate_limiting:
    enabled: true
    requests_per_minute: 60
    burst: 10

  mfa:
    required: true
    channels:
      - web
      - mobile
      - api
      - legacy

routes:
  - path: /api/**
    policies: [authentication, rate_limiting, mfa]

  - path: /v1/auth/**
    policies: [authentication, rate_limiting, mfa]

  - path: /legacy/**
    policies: [authentication, rate_limiting, mfa]  # Same policies!

  - path: /mobile/**
    policies: [authentication, rate_limiting, mfa]  # Same policies!
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| 2FA bypass via alternative channel | 8.8 | High |
| No rate limiting on API channel | 7.5 | High |
| Weaker lockout on mobile API | 6.5 | Medium |
| Different session security | 5.3 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-306** | Missing Authentication for Critical Function | Weak channel auth |
| **CWE-287** | Improper Authentication | Inconsistent controls |
| **CWE-307** | Improper Restriction of Excessive Authentication Attempts | Rate limiting gaps |

---

## References

- [OWASP WSTG - Testing for Weaker Authentication in Alternative Channel](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/04-Authentication_Testing/10-Testing_for_Weaker_Authentication_in_Alternative_Channel)
- [OWASP API Security Top 10](https://owasp.org/API-Security/)

---

## Checklist

```
[ ] All access channels enumerated
[ ] 2FA requirement compared across channels
[ ] Rate limiting compared across channels
[ ] Account lockout compared across channels
[ ] Session token security compared
[ ] OAuth/SSO enforcement checked
[ ] Legacy interfaces tested
[ ] Mobile API tested
[ ] Partner/B2B APIs tested
[ ] Internal endpoints tested
[ ] Findings documented
[ ] Remediation recommendations provided
```
