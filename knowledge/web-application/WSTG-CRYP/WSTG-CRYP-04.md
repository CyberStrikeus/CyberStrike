# WSTG-CRYP-04: Testing for Weak Encryption

## Test ID
WSTG-CRYP-04

## Test Name
Testing for Weak Encryption

## High-Level Description

Weak encryption can occur through the use of outdated algorithms, insufficient key lengths, improper implementation, or predictable initialization vectors. This test identifies cryptographic weaknesses in data encryption at rest and in transit within the application.

---

## What to Check

- [ ] Encryption algorithm strength
- [ ] Key length adequacy
- [ ] IV/nonce randomness
- [ ] ECB mode usage
- [ ] Hardcoded keys
- [ ] Custom crypto implementations
- [ ] Hash algorithm strength

---

## How to Test

### Step 1: Identify Encrypted Data

```bash
# Look for encrypted/hashed data in:
# - Cookies
# - Database exports
# - API responses
# - Configuration files
# - URL parameters

# Check for common weak hash patterns
# MD5: 32 hex characters
# SHA1: 40 hex characters

# Check password storage
curl -s "https://target.com/api/user/export" | \
    grep -oP '[a-f0-9]{32}' | head -5  # Potential MD5
```

### Step 2: Analyze Encryption Patterns

```python
#!/usr/bin/env python3
import base64
import re

class EncryptionAnalyzer:
    def __init__(self):
        self.findings = []

    def analyze_ciphertext(self, data):
        """Analyze ciphertext for weaknesses"""
        print(f"[*] Analyzing: {data[:50]}...")

        # Check for Base64 encoding
        try:
            decoded = base64.b64decode(data)
            self._analyze_decoded(decoded)
        except:
            pass

        # Check for ECB mode (repeating blocks)
        self._check_ecb_patterns(data)

    def _analyze_decoded(self, data):
        """Analyze decoded ciphertext"""
        # Check block size
        if len(data) % 8 == 0:
            print(f"  Block size: 64-bit (may be DES/3DES)")
        if len(data) % 16 == 0:
            print(f"  Block size: 128-bit (may be AES)")

        # Check for repeating 16-byte blocks (ECB indicator)
        blocks = [data[i:i+16] for i in range(0, len(data), 16)]
        if len(blocks) != len(set(blocks)):
            print("  [VULN] Repeating blocks detected - possible ECB mode!")
            self.findings.append({
                "issue": "ECB mode encryption detected",
                "severity": "High"
            })

    def _check_ecb_patterns(self, data):
        """Check for ECB patterns in encoded data"""
        # Base64 encoded 16-byte blocks = 24 chars (with padding)
        chunks = [data[i:i+24] for i in range(0, len(data), 24)]

        if len(chunks) != len(set(chunks)) and len(chunks) > 2:
            print("  [VULN] Repeating patterns in ciphertext (ECB mode)")

    def analyze_hash(self, hash_value):
        """Analyze hash for weaknesses"""
        hash_len = len(hash_value)

        hash_types = {
            32: "MD5 (WEAK)",
            40: "SHA1 (WEAK)",
            64: "SHA256",
            128: "SHA512",
        }

        if hash_len in hash_types:
            hash_type = hash_types[hash_len]
            print(f"  Hash type: {hash_type}")

            if "WEAK" in hash_type:
                self.findings.append({
                    "issue": f"Weak hash algorithm: {hash_type}",
                    "severity": "Medium"
                })

    def check_hardcoded_keys(self, source_code):
        """Check for hardcoded encryption keys"""
        patterns = [
            r'(?:key|secret|password)\s*[=:]\s*["\'][^"\']{16,}["\']',
            r'AES\.new\(["\'][^"\']+["\']',
            r'secretKey\s*=\s*["\'][^"\']+["\']',
        ]

        for pattern in patterns:
            matches = re.findall(pattern, source_code, re.IGNORECASE)
            for match in matches:
                print(f"  [VULN] Potential hardcoded key: {match[:50]}")
                self.findings.append({
                    "issue": "Hardcoded encryption key",
                    "severity": "High"
                })

# Usage
analyzer = EncryptionAnalyzer()
analyzer.analyze_ciphertext("BASE64_ENCRYPTED_DATA")
analyzer.analyze_hash("5f4dcc3b5aa765d61d8327deb882cf99")
```

### Step 3: Test for Weak Password Hashing

```python
#!/usr/bin/env python3
import hashlib
import requests

def check_password_hash_strength(api_endpoint, test_password):
    """Check if password hashing is weak"""

    # Create account and get hash from response/database
    # Compare with known weak hashes

    known_weak_hashes = {
        hashlib.md5(test_password.encode()).hexdigest(): "MD5",
        hashlib.sha1(test_password.encode()).hexdigest(): "SHA1",
    }

    # If hash matches any weak algorithm, it's vulnerable
    # Real testing requires access to stored hashes

    print("[*] Test for weak password hashing requires:")
    print("    - Access to stored password hashes")
    print("    - Comparison with known hash outputs")
    print("    - Check for absence of salt")
```

---

## Tools

| Tool | Description |
|------|-------------|
| **hashcat** | Hash identification and cracking |
| **john** | Password hash analysis |
| **CyberChef** | Crypto analysis |

---

## Remediation Guide

### Use Strong Encryption

```python
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import os

# Use AES-256-GCM (authenticated encryption)
key = os.urandom(32)  # 256 bits
nonce = os.urandom(12)
aesgcm = AESGCM(key)

ciphertext = aesgcm.encrypt(nonce, plaintext, associated_data)
```

### Use Strong Password Hashing

```python
import bcrypt
# Or use Argon2 for better security

# Hash password
hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12))

# Verify
if bcrypt.checkpw(password.encode(), stored_hash):
    # Valid password
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| MD5/SHA1 for passwords | 7.5 | High |
| ECB mode encryption | 5.3 | Medium |
| Hardcoded keys | 7.5 | High |
| DES/3DES encryption | 5.3 | Medium |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-327** | Use of Broken or Risky Cryptographic Algorithm |
| **CWE-328** | Reversible One-Way Hash |
| **CWE-329** | Not Using a Random IV with CBC Mode |

---

## Checklist

```
[ ] Encryption algorithms identified
[ ] Key lengths checked
[ ] ECB mode usage tested
[ ] Hash algorithms analyzed
[ ] Hardcoded keys searched
[ ] IV randomness verified
[ ] Findings documented
```
