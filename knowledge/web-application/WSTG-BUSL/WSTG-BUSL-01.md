# WSTG-BUSL-01: Test Business Logic Data Validation

## Test ID
WSTG-BUSL-01

## Test Name
Test Business Logic Data Validation

## High-Level Description

Business logic data validation testing examines whether the application correctly validates data according to business rules, not just technical constraints. While technical validation (data type, format, length) is often implemented, business-level validation (logical ranges, relationships, state transitions) may be missing. Attackers can exploit these gaps to submit data that is technically valid but violates business logic.

---

## What to Check

### Business Logic Validation Areas

- [ ] Numeric ranges (prices, quantities, percentages)
- [ ] Date/time logic (booking dates, age restrictions)
- [ ] Relationship validation (dependent fields)
- [ ] State transitions (order status, account state)
- [ ] Calculation integrity (totals, discounts)
- [ ] Cross-field validation

### Common Vulnerabilities

| Vulnerability | Example |
|---------------|---------|
| Negative values | Negative quantity causing refund |
| Out-of-range | 200% discount |
| Logic bypass | Skipping required steps |
| Race conditions | Double spending |
| Integer overflow | Extreme values wrapping |

---

## How to Test

### Step 1: Identify Business Rules

```bash
# Analyze application functionality to identify rules:
# - Price ranges
# - Quantity limits
# - Date constraints
# - Status transitions
# - User-specific limits

# Example: E-commerce cart
curl -s "https://target.com/api/products/1" | jq '{price, min_qty, max_qty}'
```

### Step 2: Test Numeric Boundary Violations

```bash
# Test negative values
curl -s -X POST "https://target.com/api/cart/add" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "product_id": 1,
        "quantity": -5
    }'

# Test zero values
curl -s -X POST "https://target.com/api/cart/add" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "product_id": 1,
        "quantity": 0
    }'

# Test extremely large values
curl -s -X POST "https://target.com/api/cart/add" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "product_id": 1,
        "quantity": 999999999
    }'

# Test decimal values for integer fields
curl -s -X POST "https://target.com/api/cart/add" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "product_id": 1,
        "quantity": 1.5
    }'
```

### Step 3: Test Price Manipulation

```bash
# Attempt to modify price directly
curl -s -X POST "https://target.com/api/checkout" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "items": [{
            "product_id": 1,
            "quantity": 1,
            "price": 0.01
        }],
        "total": 0.01
    }'

# Test discount percentage bounds
curl -s -X POST "https://target.com/api/apply-discount" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"discount_code": "TEST", "discount_percent": 150}'

# Test negative discount (adding money)
curl -s -X POST "https://target.com/api/apply-discount" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"discount_code": "TEST", "discount_percent": -50}'
```

### Step 4: Test Date/Time Logic

```bash
# Book in the past
curl -s -X POST "https://target.com/api/bookings" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "service_id": 1,
        "date": "2020-01-01",
        "time": "10:00"
    }'

# End date before start date
curl -s -X POST "https://target.com/api/reservations" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "check_in": "2025-12-31",
        "check_out": "2025-12-01"
    }'

# Age restriction bypass
curl -s -X POST "https://target.com/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "test",
        "birthdate": "2020-01-01"
    }'  # Too young
```

### Step 5: Test State Transition Violations

```bash
# Try to skip order states
# Normal: pending -> paid -> shipped -> delivered
curl -s -X PUT "https://target.com/api/orders/123/status" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"status": "delivered"}'  # Skip from pending to delivered

# Revert to previous state
curl -s -X PUT "https://target.com/api/orders/123/status" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"status": "pending"}'  # Try to revert

# Invalid state transition
curl -s -X PUT "https://target.com/api/orders/123/status" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"status": "invalid_state"}'
```

### Step 6: Test Cross-Field Validation

```bash
# Test dependent field logic
# If country = US, state should be valid US state
curl -s -X POST "https://target.com/api/address" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "country": "US",
        "state": "InvalidState",
        "zip": "12345"
    }'

# Payment type vs payment details mismatch
curl -s -X POST "https://target.com/api/payment" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "type": "credit_card",
        "bank_account": "123456789"
    }'
```

### Step 7: Test Calculation Integrity

```bash
# Submit mismatched totals
curl -s -X POST "https://target.com/api/checkout" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "items": [
            {"product_id": 1, "quantity": 2, "price": 100},
            {"product_id": 2, "quantity": 1, "price": 50}
        ],
        "subtotal": 250,
        "tax": 0,
        "total": 1
    }'

# Test floating point precision issues
curl -s -X POST "https://target.com/api/transfer" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"amount": 0.1, "to_account": "12345"}'

# Repeat multiple times - check for rounding errors
```

---

## Tools

### Manual Testing

| Tool | Description | Usage |
|------|-------------|-------|
| **Burp Suite** | Request manipulation | Modify values in requests |
| **Postman** | API testing | Create test collections |
| **Browser DevTools** | Form manipulation | Modify hidden fields |

### Automated Testing

| Tool | Description |
|------|-------------|
| **Burp Intruder** | Boundary value testing |
| **Custom scripts** | Automated logic tests |

---

## Example Commands/Payloads

### Business Logic Test Payloads

```json
// Numeric boundary tests
{"quantity": -1}
{"quantity": 0}
{"quantity": 0.5}
{"quantity": 99999999}
{"quantity": 2147483648}  // Integer overflow
{"price": -100}
{"discount": 999}

// Date/time tests
{"date": "1900-01-01"}
{"date": "2099-12-31"}
{"start_date": "2025-12-31", "end_date": "2025-01-01"}

// State manipulation
{"status": "admin_approved"}
{"status": "paid"}
{"status": "completed"}

// Calculation manipulation
{"subtotal": 100, "tax": -50, "total": 50}
{"quantity": 10, "unit_price": 10, "total": 1}
```

### Business Logic Testing Script

```python
#!/usr/bin/env python3
import requests
import json

class BusinessLogicTester:
    def __init__(self, base_url, token):
        self.base_url = base_url
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }

    def test_quantity_bounds(self, product_id):
        """Test quantity boundary values"""
        test_values = [-1, 0, 0.5, 1, 100, 999999, 2147483648]
        results = []

        for qty in test_values:
            response = requests.post(
                f"{self.base_url}/api/cart/add",
                headers=self.headers,
                json={"product_id": product_id, "quantity": qty}
            )

            results.append({
                "quantity": qty,
                "status": response.status_code,
                "accepted": response.status_code == 200,
                "response": response.text[:200]
            })

        return results

    def test_price_manipulation(self, product_id):
        """Test if price can be manipulated"""
        test_cases = [
            {"price": 0},
            {"price": 0.01},
            {"price": -100},
            {"unit_price": 0.01, "total": 0.01}
        ]

        results = []
        for case in test_cases:
            data = {"product_id": product_id, "quantity": 1, **case}
            response = requests.post(
                f"{self.base_url}/api/cart/add",
                headers=self.headers,
                json=data
            )

            results.append({
                "test": case,
                "status": response.status_code,
                "response": response.text[:200]
            })

        return results

    def test_discount_bounds(self):
        """Test discount percentage bounds"""
        test_values = [-50, 0, 50, 100, 150, 999]
        results = []

        for discount in test_values:
            response = requests.post(
                f"{self.base_url}/api/apply-discount",
                headers=self.headers,
                json={"discount_percent": discount}
            )

            results.append({
                "discount": discount,
                "status": response.status_code,
                "accepted": response.status_code == 200
            })

        return results

# Usage
tester = BusinessLogicTester("https://target.com", "your_token")
print("Quantity tests:", tester.test_quantity_bounds(1))
print("Price tests:", tester.test_price_manipulation(1))
print("Discount tests:", tester.test_discount_bounds())
```

---

## Remediation Guide

### 1. Server-Side Business Rule Validation

```python
from decimal import Decimal

class OrderValidator:
    def validate_quantity(self, quantity, product):
        """Validate quantity against business rules"""
        if not isinstance(quantity, int):
            raise ValueError("Quantity must be an integer")

        if quantity <= 0:
            raise ValueError("Quantity must be positive")

        if quantity > product.max_order_quantity:
            raise ValueError(f"Maximum quantity is {product.max_order_quantity}")

        if quantity > product.stock:
            raise ValueError("Insufficient stock")

        return True

    def validate_order(self, order):
        """Validate entire order"""
        # Validate each item
        for item in order.items:
            self.validate_quantity(item.quantity, item.product)

        # Validate calculations server-side
        calculated_subtotal = sum(
            item.product.price * item.quantity
            for item in order.items
        )

        if order.subtotal != calculated_subtotal:
            raise ValueError("Invalid subtotal")

        # Validate discount
        if order.discount:
            if order.discount.percent > 100 or order.discount.percent < 0:
                raise ValueError("Invalid discount")

        # Calculate total server-side
        order.total = self.calculate_total(order)

        return True
```

### 2. State Machine for Status Transitions

```python
class OrderStateMachine:
    VALID_TRANSITIONS = {
        'pending': ['paid', 'cancelled'],
        'paid': ['processing', 'refunded'],
        'processing': ['shipped', 'cancelled'],
        'shipped': ['delivered', 'returned'],
        'delivered': ['completed', 'returned'],
        'completed': [],
        'cancelled': [],
        'refunded': [],
        'returned': ['refunded']
    }

    def can_transition(self, current_state, new_state):
        """Check if transition is valid"""
        allowed = self.VALID_TRANSITIONS.get(current_state, [])
        return new_state in allowed

    def transition(self, order, new_state):
        """Perform state transition with validation"""
        if not self.can_transition(order.status, new_state):
            raise ValueError(
                f"Cannot transition from {order.status} to {new_state}"
            )

        order.status = new_state
        order.status_history.append({
            'from': order.status,
            'to': new_state,
            'timestamp': datetime.utcnow(),
            'user': current_user.id
        })

        return order
```

### 3. Date/Time Validation

```python
from datetime import datetime, timedelta

def validate_booking_dates(check_in, check_out):
    """Validate booking date logic"""
    today = datetime.now().date()

    # Must be in the future
    if check_in < today:
        raise ValueError("Check-in date must be in the future")

    # Check-out must be after check-in
    if check_out <= check_in:
        raise ValueError("Check-out must be after check-in")

    # Maximum booking length
    if (check_out - check_in).days > 30:
        raise ValueError("Maximum booking length is 30 days")

    # Must be within bookable range (e.g., 1 year ahead)
    max_date = today + timedelta(days=365)
    if check_in > max_date:
        raise ValueError("Cannot book more than 1 year in advance")

    return True
```

### 4. Never Trust Client-Side Calculations

```python
@app.route('/api/checkout', methods=['POST'])
def checkout():
    cart = get_user_cart(current_user)

    # Recalculate everything server-side
    subtotal = Decimal('0')
    for item in cart.items:
        # Get current price from database
        product = Product.query.get(item.product_id)
        item_total = product.current_price * item.quantity
        subtotal += item_total

    # Apply discount server-side
    discount = calculate_discount(cart.discount_code, subtotal)

    # Calculate tax server-side
    tax = calculate_tax(subtotal - discount, current_user.address)

    # Final total
    total = subtotal - discount + tax

    # Ignore any totals sent by client
    order = create_order(
        items=cart.items,
        subtotal=subtotal,
        discount=discount,
        tax=tax,
        total=total
    )

    return jsonify(order.to_dict())
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Price manipulation accepted | 9.8 | Critical |
| Negative quantity causing refund | 9.8 | Critical |
| State transition bypass | 8.8 | High |
| Missing calculation validation | 7.5 | High |
| Date logic bypass | 6.5 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-20** | Improper Input Validation | Missing business validation |
| **CWE-129** | Improper Validation of Array Index | Numeric bounds issues |
| **CWE-840** | Business Logic Errors | Logic flaw exploitation |

---

## References

- [OWASP WSTG - Test Business Logic Data Validation](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/10-Business_Logic_Testing/01-Test_Business_Logic_Data_Validation)
- [OWASP Testing for Business Logic](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/10-Business_Logic_Testing/)

---

## Checklist

```
[ ] Business rules identified and documented
[ ] Numeric boundary values tested
[ ] Negative values tested
[ ] Zero values tested
[ ] Decimal/float precision tested
[ ] Price manipulation tested
[ ] Discount bounds tested
[ ] Date/time logic tested
[ ] State transitions validated
[ ] Cross-field validation tested
[ ] Calculation integrity verified
[ ] Client-side vs server-side validation compared
[ ] Findings documented
[ ] Remediation recommendations provided
```
