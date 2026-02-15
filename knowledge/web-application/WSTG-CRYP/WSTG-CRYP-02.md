# WSTG-CRYP-02: Testing for Padding Oracle

## Test ID
WSTG-CRYP-02

## Test Name
Testing for Padding Oracle

## High-Level Description

A padding oracle attack exploits the information leaked when a system reveals whether decrypted data has valid padding. This occurs with block ciphers in CBC mode when the application returns different error messages or behaviors for valid versus invalid padding. Attackers can use this to decrypt ciphertext without knowing the key.

---

## What to Check

- [ ] CBC mode encryption usage
- [ ] Different responses for padding errors
- [ ] Timing differences in responses
- [ ] Error message differences
- [ ] Encrypted cookies/tokens
- [ ] ASP.NET ScriptResource/WebResource

---

## How to Test

### Step 1: Identify Encrypted Data

```bash
# Look for encrypted parameters
# - Cookies with Base64-like values
# - URL parameters with encrypted data
# - Hidden form fields
# - ViewState (ASP.NET)

# Check cookie values
curl -sI "https://target.com" | grep -i "set-cookie"

# ASP.NET WebResource/ScriptResource (common padding oracle target)
curl -s "https://target.com/WebResource.axd?d=ENCRYPTED_DATA"
curl -s "https://target.com/ScriptResource.axd?d=ENCRYPTED_DATA"
```

### Step 2: Test Response Differences

```bash
#!/bin/bash
TARGET="https://target.com"
PARAM="encrypted_value"

# Original valid value
original="VALID_ENCRYPTED_BASE64"

# Modify last byte to test padding
modified=$(echo "$original" | base64 -d | head -c -1 | cat - <(printf '\x00') | base64)

# Compare responses
echo "=== Original ==="
curl -s "$TARGET/decrypt?data=$original" | head -5

echo -e "\n=== Modified ==="
curl -s "$TARGET/decrypt?data=$modified" | head -5

# Check for different error messages, status codes, or timing
```

### Step 3: Padding Oracle Tester

```python
#!/usr/bin/env python3
import requests
import base64
import time

class PaddingOracleTester:
    def __init__(self, base_url, param_name):
        self.base_url = base_url
        self.param_name = param_name
        self.findings = []

    def test_padding_oracle(self, encrypted_value):
        """Test for padding oracle vulnerability"""
        print(f"[*] Testing for padding oracle...")

        try:
            # Decode the encrypted value
            ciphertext = base64.b64decode(encrypted_value)

            if len(ciphertext) % 16 != 0:
                print("[INFO] Ciphertext length not multiple of 16 (not AES)")

            # Test original value
            original_response = self._make_request(encrypted_value)
            original_time = original_response['time']
            original_status = original_response['status']

            print(f"Original: Status={original_status}, Time={original_time:.3f}s")

            # Modify last byte of each block
            results = []
            for i in range(256):
                modified = bytearray(ciphertext)
                modified[-1] = i
                modified_b64 = base64.b64encode(bytes(modified)).decode()

                response = self._make_request(modified_b64)
                results.append({
                    'byte': i,
                    'status': response['status'],
                    'time': response['time'],
                    'length': response['length']
                })

            # Analyze results for oracle
            self._analyze_results(results)

        except Exception as e:
            print(f"[ERROR] {e}")

    def _make_request(self, value):
        """Make request and measure response"""
        start = time.time()
        try:
            response = requests.get(
                self.base_url,
                params={self.param_name: value},
                timeout=10
            )
            elapsed = time.time() - start
            return {
                'status': response.status_code,
                'time': elapsed,
                'length': len(response.content),
                'text': response.text[:100]
            }
        except:
            return {'status': 0, 'time': time.time() - start, 'length': 0, 'text': ''}

    def _analyze_results(self, results):
        """Analyze results for padding oracle indicators"""
        # Check for status code differences
        status_codes = set(r['status'] for r in results)
        if len(status_codes) > 1:
            print(f"[POTENTIAL] Different status codes: {status_codes}")
            self.findings.append({
                "issue": "Different status codes for padding bytes",
                "severity": "High"
            })

        # Check for timing differences
        times = [r['time'] for r in results]
        avg_time = sum(times) / len(times)
        max_diff = max(times) - min(times)

        if max_diff > 0.5:
            print(f"[POTENTIAL] Timing difference: {max_diff:.3f}s")
            self.findings.append({
                "issue": "Timing differences detected",
                "severity": "Medium"
            })

        # Check for response length differences
        lengths = set(r['length'] for r in results)
        if len(lengths) > 2:
            print(f"[POTENTIAL] Different response lengths: {len(lengths)} unique")

# Usage
tester = PaddingOracleTester(
    "https://target.com/resource",
    "data"
)
tester.test_padding_oracle("BASE64_ENCRYPTED_VALUE")
```

### Step 4: Using Automated Tools

```bash
# PadBuster
padbuster https://target.com/decrypt?data= ENCRYPTED_VALUE 16 \
    -encoding 0 \
    -cookies "session=xxx"

# Test mode (non-destructive)
padbuster https://target.com/decrypt?data= ENCRYPTED_VALUE 16 \
    -encoding 0 \
    -noiv
```

---

## Tools

| Tool | Description |
|------|-------------|
| **PadBuster** | Automated padding oracle exploitation |
| **Burp Suite** | Manual testing |
| **Custom scripts** | Timing analysis |

---

## Remediation Guide

### Use Authenticated Encryption

```python
from cryptography.fernet import Fernet
# Fernet uses AES-128-CBC with HMAC (authenticated encryption)

key = Fernet.generate_key()
cipher = Fernet(key)

# Encrypt
encrypted = cipher.encrypt(b"secret data")

# Decrypt (will fail on tampering)
decrypted = cipher.decrypt(encrypted)
```

### Use GCM Mode Instead of CBC

```python
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import os

key = AESGCM.generate_key(bit_length=256)
aesgcm = AESGCM(key)
nonce = os.urandom(12)

# Encrypt with authentication
ciphertext = aesgcm.encrypt(nonce, b"secret data", None)

# Decrypt (authenticated)
plaintext = aesgcm.decrypt(nonce, ciphertext, None)
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| Padding oracle (decryption possible) | 7.5 | High |
| Different error messages for padding | 5.3 | Medium |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-209** | Information Exposure Through Error Message |
| **CWE-649** | Reliance on Obfuscation or Encryption without Integrity Checking |

---

## Checklist

```
[ ] Encrypted parameters identified
[ ] Response differences tested
[ ] Timing analysis performed
[ ] Error messages analyzed
[ ] ASP.NET resources checked
[ ] Findings documented
```
