# WSTG-AUTHZ-05.1: Testing OAuth Authorization Server Weaknesses

## Test ID
WSTG-AUTHZ-05.1

## Test Name
Testing OAuth Authorization Server Weaknesses

## High-Level Description

The OAuth Authorization Server is responsible for authenticating users, obtaining consent, and issuing access tokens. Vulnerabilities in the authorization server can compromise the entire OAuth ecosystem, leading to unauthorized access to protected resources across all client applications. This test focuses on identifying weaknesses specific to the authorization server implementation.

---

## What to Check

### Authorization Server Components

- [ ] Authorization endpoint security
- [ ] Token endpoint security
- [ ] Token introspection endpoint
- [ ] Token revocation endpoint
- [ ] UserInfo endpoint
- [ ] Discovery endpoints (.well-known)
- [ ] Client registration (if dynamic)

### Server-Side Vulnerabilities

| Vulnerability | Description |
|---------------|-------------|
| Weak token generation | Predictable tokens |
| Insufficient token validation | Missing signature verification |
| Client impersonation | Weak client authentication |
| Token leakage | Logging, error messages |
| Consent bypass | Auto-approval issues |

---

## How to Test

### Step 1: Analyze Discovery Endpoints

```bash
# OAuth Authorization Server Metadata
curl -s "https://auth.target.com/.well-known/oauth-authorization-server" | jq '.'

# OpenID Connect Discovery
curl -s "https://auth.target.com/.well-known/openid-configuration" | jq '.'

# Check for exposed information
# - Supported grant types
# - Token endpoint auth methods
# - Scopes supported
# - Response types supported
# - PKCE support

# Look for insecure configurations:
# - "response_types_supported": ["token"] (implicit flow)
# - "token_endpoint_auth_methods_supported": ["none"]
# - Missing "code_challenge_methods_supported"
```

### Step 2: Test Authorization Endpoint

```bash
#!/bin/bash
# Test authorization endpoint weaknesses

AUTH_URL="https://auth.target.com/oauth/authorize"
CLIENT_ID="test_client"

# Test response_type variations
response_types=("code" "token" "id_token" "code token" "code id_token" "token id_token" "code token id_token")

for rt in "${response_types[@]}"; do
    response=$(curl -s -I "$AUTH_URL?client_id=$CLIENT_ID&response_type=$rt&redirect_uri=https://client.com/callback&scope=openid" 2>/dev/null | head -20)
    echo "response_type=$rt"
    echo "$response" | grep -iE "location|error"
    echo "---"
done

# Test scope handling
scopes=("openid" "profile" "email" "admin" "write" "delete" "all" "*")

for scope in "${scopes[@]}"; do
    response=$(curl -s "$AUTH_URL?client_id=$CLIENT_ID&response_type=code&redirect_uri=https://client.com/callback&scope=$scope" 2>/dev/null)

    if echo "$response" | grep -qi "invalid_scope"; then
        echo "Scope '$scope': Rejected"
    else
        echo "Scope '$scope': Potentially accepted"
    fi
done
```

### Step 3: Test Token Endpoint Security

```bash
#!/bin/bash
# Test token endpoint weaknesses

TOKEN_URL="https://auth.target.com/oauth/token"

# Test without client authentication
curl -s -X POST "$TOKEN_URL" \
    -d "grant_type=authorization_code&code=AUTH_CODE&redirect_uri=https://client.com/callback"

# Test with various client auth methods
# client_secret_post
curl -s -X POST "$TOKEN_URL" \
    -d "grant_type=authorization_code&code=AUTH_CODE&redirect_uri=https://client.com/callback&client_id=CLIENT&client_secret=SECRET"

# client_secret_basic
curl -s -X POST "$TOKEN_URL" \
    -u "CLIENT:SECRET" \
    -d "grant_type=authorization_code&code=AUTH_CODE&redirect_uri=https://client.com/callback"

# Test grant types
grant_types=("authorization_code" "client_credentials" "password" "refresh_token" "urn:ietf:params:oauth:grant-type:jwt-bearer")

for gt in "${grant_types[@]}"; do
    response=$(curl -s -X POST "$TOKEN_URL" \
        -d "grant_type=$gt&client_id=CLIENT&client_secret=SECRET")
    echo "Grant type: $gt"
    echo "$response" | head -c 200
    echo -e "\n---"
done
```

### Step 4: Test Token Generation Strength

```python
#!/usr/bin/env python3
import requests
import time
import hashlib
from collections import Counter

class TokenAnalyzer:
    def __init__(self, token_url, client_id, client_secret):
        self.token_url = token_url
        self.client_id = client_id
        self.client_secret = client_secret
        self.tokens = []

    def collect_tokens(self, count=10):
        """Collect multiple tokens for analysis"""
        print(f"[*] Collecting {count} tokens...")

        for i in range(count):
            try:
                response = requests.post(
                    self.token_url,
                    data={
                        "grant_type": "client_credentials",
                        "client_id": self.client_id,
                        "client_secret": self.client_secret,
                        "scope": "openid"
                    }
                )

                if response.status_code == 200:
                    token = response.json().get("access_token")
                    if token:
                        self.tokens.append({
                            "token": token,
                            "timestamp": time.time(),
                            "length": len(token)
                        })

                time.sleep(0.5)  # Avoid rate limiting

            except Exception as e:
                print(f"[ERROR] {e}")

        print(f"[*] Collected {len(self.tokens)} tokens")
        return self.tokens

    def analyze_entropy(self):
        """Analyze token entropy"""
        print("\n[*] Analyzing token entropy...")

        for token_data in self.tokens:
            token = token_data["token"]

            # Character frequency
            freq = Counter(token)
            unique_chars = len(freq)
            total_chars = len(token)

            # Simple entropy approximation
            entropy = sum((count/total_chars) * (-1 * (count/total_chars))
                         for count in freq.values()) * -1

            print(f"Token length: {total_chars}, Unique chars: {unique_chars}")

    def check_predictability(self):
        """Check for predictable patterns"""
        print("\n[*] Checking for predictable patterns...")

        if len(self.tokens) < 2:
            print("[!] Need more tokens for pattern analysis")
            return

        # Check if tokens are sequential
        token_hashes = [hashlib.md5(t["token"].encode()).hexdigest()
                        for t in self.tokens]

        # Check for common prefixes
        common_prefix = ""
        tokens_list = [t["token"] for t in self.tokens]

        for i, char in enumerate(tokens_list[0]):
            if all(t[i] == char for t in tokens_list if len(t) > i):
                common_prefix += char
            else:
                break

        if len(common_prefix) > 10:
            print(f"[WARN] Common prefix found: {common_prefix}")

        # Check for timestamp-based patterns
        for token_data in self.tokens:
            token = token_data["token"]
            ts = str(int(token_data["timestamp"]))

            if ts[:6] in token:
                print(f"[VULN] Timestamp may be embedded in token")

    def analyze_jwt_tokens(self):
        """Analyze if tokens are JWTs"""
        print("\n[*] Analyzing JWT tokens...")

        import base64
        import json

        for token_data in self.tokens:
            token = token_data["token"]
            parts = token.split(".")

            if len(parts) == 3:
                try:
                    header = json.loads(
                        base64.urlsafe_b64decode(parts[0] + "==")
                    )
                    payload = json.loads(
                        base64.urlsafe_b64decode(parts[1] + "==")
                    )

                    print(f"\nJWT detected:")
                    print(f"  Algorithm: {header.get('alg')}")
                    print(f"  Type: {header.get('typ')}")

                    # Check for weak algorithms
                    if header.get('alg') in ['none', 'HS256']:
                        print(f"  [WARN] Potentially weak algorithm: {header.get('alg')}")

                    # Check for sensitive data
                    sensitive_keys = ['password', 'secret', 'ssn', 'credit_card']
                    for key in payload:
                        if any(s in key.lower() for s in sensitive_keys):
                            print(f"  [VULN] Sensitive data in payload: {key}")

                except:
                    pass

# Usage
analyzer = TokenAnalyzer(
    "https://auth.target.com/oauth/token",
    "client_id",
    "client_secret"
)

analyzer.collect_tokens(10)
analyzer.analyze_entropy()
analyzer.check_predictability()
analyzer.analyze_jwt_tokens()
```

### Step 5: Test Client Authentication Weaknesses

```bash
#!/bin/bash
# Test client authentication security

TOKEN_URL="https://auth.target.com/oauth/token"
CLIENT_ID="known_client"

# Test common/default client secrets
secrets=("secret" "password" "123456" "client_secret" "$CLIENT_ID" "")

for secret in "${secrets[@]}"; do
    response=$(curl -s -X POST "$TOKEN_URL" \
        -d "grant_type=client_credentials&client_id=$CLIENT_ID&client_secret=$secret")

    if echo "$response" | grep -q "access_token"; then
        echo "[VULN] Weak client secret found: '$secret'"
    fi
done

# Test client_id enumeration
for i in {1..100}; do
    client="client_$i"
    response=$(curl -s -X POST "$TOKEN_URL" \
        -d "grant_type=client_credentials&client_id=$client&client_secret=test")

    error=$(echo "$response" | jq -r '.error_description // .error')

    if [ "$error" != "invalid_client" ]; then
        echo "Client '$client': $error"
    fi
done
```

### Step 6: Test Token Introspection/Revocation

```bash
# Token introspection endpoint
INTROSPECT_URL="https://auth.target.com/oauth/introspect"

# Test introspection without auth
curl -s -X POST "$INTROSPECT_URL" \
    -d "token=SOME_TOKEN"

# Test with client credentials
curl -s -X POST "$INTROSPECT_URL" \
    -u "CLIENT:SECRET" \
    -d "token=SOME_TOKEN"

# Test token revocation
REVOKE_URL="https://auth.target.com/oauth/revoke"

curl -s -X POST "$REVOKE_URL" \
    -u "CLIENT:SECRET" \
    -d "token=SOME_TOKEN&token_type_hint=access_token"

# Verify token is actually revoked
curl -s -X POST "$INTROSPECT_URL" \
    -u "CLIENT:SECRET" \
    -d "token=SOME_TOKEN"
```

### Step 7: Test Consent Bypass

```bash
#!/bin/bash
# Test if consent can be bypassed

AUTH_URL="https://auth.target.com/oauth/authorize"
CLIENT_ID="test_client"

# Test with prompt=none (should fail if no prior consent)
curl -s "$AUTH_URL?client_id=$CLIENT_ID&response_type=code&redirect_uri=https://client.com/callback&scope=openid&prompt=none"

# Test with approval_prompt=auto
curl -s "$AUTH_URL?client_id=$CLIENT_ID&response_type=code&redirect_uri=https://client.com/callback&scope=openid&approval_prompt=auto"

# Test with auto-approved client
# Some clients may be pre-approved (first-party apps)

# Check for scope creep
# If initially granted "read", can we silently add "write"?
curl -s "$AUTH_URL?client_id=$CLIENT_ID&response_type=code&redirect_uri=https://client.com/callback&scope=openid+profile+email+admin&prompt=none"
```

### Step 8: Test Resource Owner Password Grant

```bash
#!/bin/bash
# Test ROPC (Resource Owner Password Credentials) grant

TOKEN_URL="https://auth.target.com/oauth/token"

# Test if ROPC is enabled (should be disabled for most apps)
curl -s -X POST "$TOKEN_URL" \
    -d "grant_type=password&username=test&password=test&client_id=CLIENT&client_secret=SECRET"

# If enabled, test for brute force protection
for i in {1..20}; do
    response=$(curl -s -X POST "$TOKEN_URL" \
        -d "grant_type=password&username=admin&password=password$i&client_id=CLIENT&client_secret=SECRET")

    status=$(echo "$response" | jq -r '.error // "success"')
    echo "Attempt $i: $status"

    if [ "$status" == "too_many_requests" ]; then
        echo "Rate limited after $i attempts"
        break
    fi
done
```

---

## Tools

### OAuth Server Testing

| Tool | Description | Usage |
|------|-------------|-------|
| **Burp Suite** | Traffic analysis | Intercept OAuth flows |
| **Postman** | API testing | Test endpoints |
| **oauth2-test-server** | Test server | Development testing |

### Token Analysis

| Tool | Description |
|------|-------------|
| **jwt.io** | JWT decoder |
| **jwt_tool** | JWT security |
| **jwt-cracker** | Weak secret finder |

---

## Remediation Guide

### 1. Secure Token Generation

```python
import secrets
import hashlib
import time
import jwt

class SecureTokenGenerator:
    def __init__(self, secret_key, issuer):
        self.secret_key = secret_key
        self.issuer = issuer

    def generate_opaque_token(self, length=32):
        """Generate cryptographically secure opaque token"""
        return secrets.token_urlsafe(length)

    def generate_jwt_token(self, user_id, client_id, scopes, expiry=3600):
        """Generate secure JWT token"""
        now = int(time.time())

        payload = {
            "iss": self.issuer,
            "sub": str(user_id),
            "aud": client_id,
            "exp": now + expiry,
            "iat": now,
            "jti": secrets.token_hex(16),  # Unique token ID
            "scope": " ".join(scopes),
        }

        return jwt.encode(
            payload,
            self.secret_key,
            algorithm="RS256"  # Use asymmetric algorithm
        )

    def generate_authorization_code(self):
        """Generate secure authorization code"""
        return secrets.token_urlsafe(32)
```

### 2. Proper Client Authentication

```python
import bcrypt
import secrets
from enum import Enum

class ClientAuthMethod(Enum):
    NONE = "none"
    SECRET_POST = "client_secret_post"
    SECRET_BASIC = "client_secret_basic"
    PRIVATE_KEY_JWT = "private_key_jwt"
    TLS_CLIENT_AUTH = "tls_client_auth"

class ClientAuthenticator:
    def authenticate(self, client_id, request):
        """Authenticate OAuth client"""
        client = Client.query.get(client_id)

        if not client:
            return None, "invalid_client"

        auth_method = client.token_endpoint_auth_method

        if auth_method == ClientAuthMethod.SECRET_BASIC:
            return self._auth_basic(client, request)
        elif auth_method == ClientAuthMethod.SECRET_POST:
            return self._auth_post(client, request)
        elif auth_method == ClientAuthMethod.PRIVATE_KEY_JWT:
            return self._auth_jwt(client, request)
        else:
            return None, "unsupported_auth_method"

    def _auth_basic(self, client, request):
        """HTTP Basic authentication"""
        auth = request.authorization

        if not auth:
            return None, "missing_credentials"

        if not secrets.compare_digest(auth.username, client.client_id):
            return None, "invalid_client"

        if not bcrypt.checkpw(auth.password.encode(), client.secret_hash):
            return None, "invalid_client"

        return client, None

    def _auth_jwt(self, client, request):
        """JWT client assertion authentication"""
        assertion = request.form.get("client_assertion")
        assertion_type = request.form.get("client_assertion_type")

        if assertion_type != "urn:ietf:params:oauth:client-assertion-type:jwt-bearer":
            return None, "invalid_assertion_type"

        try:
            # Verify JWT with client's public key
            payload = jwt.decode(
                assertion,
                client.public_key,
                algorithms=["RS256"],
                audience=self.token_endpoint_url
            )

            if payload.get("sub") != client.client_id:
                return None, "invalid_client"

            return client, None

        except jwt.InvalidTokenError:
            return None, "invalid_assertion"
```

### 3. Consent Management

```python
class ConsentManager:
    def check_consent(self, user_id, client_id, requested_scopes):
        """Check if user has consented to requested scopes"""
        existing_consent = Consent.query.filter_by(
            user_id=user_id,
            client_id=client_id
        ).first()

        if not existing_consent:
            return False, set(requested_scopes)

        # Check if all requested scopes are already consented
        consented_scopes = set(existing_consent.scopes.split())
        requested_set = set(requested_scopes)

        missing_scopes = requested_set - consented_scopes

        if missing_scopes:
            return False, missing_scopes

        return True, set()

    def record_consent(self, user_id, client_id, scopes):
        """Record user consent"""
        consent = Consent.query.filter_by(
            user_id=user_id,
            client_id=client_id
        ).first()

        if consent:
            # Add new scopes to existing consent
            existing = set(consent.scopes.split())
            existing.update(scopes)
            consent.scopes = " ".join(existing)
        else:
            consent = Consent(
                user_id=user_id,
                client_id=client_id,
                scopes=" ".join(scopes)
            )
            db.session.add(consent)

        db.session.commit()
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Weak token generation | 9.1 | Critical |
| Missing client authentication | 8.8 | High |
| Consent bypass | 7.5 | High |
| Token leakage in logs | 6.5 | Medium |
| ROPC enabled | 6.5 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-330** | Insufficient Randomness | Weak tokens |
| **CWE-287** | Improper Authentication | Client auth issues |
| **CWE-862** | Missing Authorization | Consent bypass |
| **CWE-532** | Information in Log Files | Token leakage |

---

## References

- [OAuth 2.0 Authorization Server Metadata](https://tools.ietf.org/html/rfc8414)
- [OAuth 2.0 Security Best Practices](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics)
- [OAuth 2.0 for Native Apps](https://tools.ietf.org/html/rfc8252)

---

## Checklist

```
[ ] Discovery endpoints analyzed
[ ] Authorization endpoint tested
[ ] Token endpoint authenticated
[ ] Token generation strength analyzed
[ ] Client authentication tested
[ ] Token introspection tested
[ ] Token revocation tested
[ ] Consent handling verified
[ ] ROPC grant checked
[ ] JWT tokens analyzed
[ ] Findings documented
[ ] Remediation recommendations provided
```
