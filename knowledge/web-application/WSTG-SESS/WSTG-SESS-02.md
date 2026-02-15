# WSTG-SESS-02: Testing for Cookies Attributes

## Test ID
WSTG-SESS-02

## Test Name
Testing for Cookies Attributes

## High-Level Description

Cookie attributes control how browsers handle cookies, including security restrictions. Improperly configured cookie attributes can expose session tokens to theft via XSS attacks, man-in-the-middle attacks, or cross-site request forgery. This test examines whether cookies are configured with appropriate security attributes including Secure, HttpOnly, SameSite, Domain, Path, and Expires/Max-Age.

---

## What to Check

### Cookie Security Attributes

- [ ] Secure flag (HTTPS only)
- [ ] HttpOnly flag (no JavaScript access)
- [ ] SameSite attribute (CSRF protection)
- [ ] Domain scope
- [ ] Path scope
- [ ] Expires/Max-Age settings
- [ ] Cookie prefix (__Host-, __Secure-)

### Attribute Impact

| Attribute | Missing Impact |
|-----------|---------------|
| Secure | Token sent over HTTP |
| HttpOnly | XSS can steal token |
| SameSite | CSRF attacks possible |
| Proper Domain | Subdomain attacks |
| Proper Path | Broader exposure |

---

## How to Test

### Step 1: Capture All Cookies

```bash
#!/bin/bash
# Capture and analyze all cookies

TARGET="https://target.com"

# Get all Set-Cookie headers
echo "=== All Set-Cookie Headers ==="
curl -sI "$TARGET" | grep -i "set-cookie"

# After authentication
echo -e "\n=== Post-Auth Cookies ==="
curl -s -c - -X POST "$TARGET/login" \
    -d "username=test&password=test" | grep -v "^#"

# Parse cookie attributes
curl -sI "$TARGET" | grep -i "set-cookie" | while read -r line; do
    echo "---"
    echo "Cookie: $(echo $line | cut -d= -f1 | sed 's/Set-Cookie: //')"
    echo "$line" | tr ';' '\n' | while read -r attr; do
        echo "  $attr"
    done
done
```

### Step 2: Check Security Flags

```bash
#!/bin/bash
# Comprehensive cookie attribute checker

TARGET="https://target.com"

cookies=$(curl -sI "$TARGET" | grep -i "set-cookie")

echo "=== Cookie Security Analysis ==="

while IFS= read -r cookie; do
    name=$(echo "$cookie" | sed 's/Set-Cookie: //' | cut -d= -f1)
    echo -e "\n[Cookie: $name]"

    # Check Secure flag
    if echo "$cookie" | grep -qi "secure"; then
        echo "  [OK] Secure flag present"
    else
        echo "  [VULN] Missing Secure flag"
    fi

    # Check HttpOnly flag
    if echo "$cookie" | grep -qi "httponly"; then
        echo "  [OK] HttpOnly flag present"
    else
        echo "  [VULN] Missing HttpOnly flag"
    fi

    # Check SameSite attribute
    if echo "$cookie" | grep -qi "samesite=strict"; then
        echo "  [OK] SameSite=Strict"
    elif echo "$cookie" | grep -qi "samesite=lax"; then
        echo "  [WARN] SameSite=Lax (consider Strict for sensitive cookies)"
    elif echo "$cookie" | grep -qi "samesite=none"; then
        echo "  [WARN] SameSite=None (requires Secure flag)"
    else
        echo "  [WARN] Missing SameSite attribute"
    fi

    # Check Domain
    if echo "$cookie" | grep -qi "domain="; then
        domain=$(echo "$cookie" | grep -oP "domain=[^;]+" | cut -d= -f2)
        echo "  [INFO] Domain: $domain"
        if echo "$domain" | grep -q "^\."; then
            echo "  [WARN] Leading dot allows subdomain access"
        fi
    else
        echo "  [OK] No Domain (origin only)"
    fi

    # Check Path
    if echo "$cookie" | grep -qi "path="; then
        path=$(echo "$cookie" | grep -oP "path=[^;]+" | cut -d= -f2)
        echo "  [INFO] Path: $path"
        if [ "$path" == "/" ]; then
            echo "  [WARN] Path=/ (entire site)"
        fi
    fi

    # Check Expires/Max-Age
    if echo "$cookie" | grep -qiE "expires=|max-age="; then
        echo "  [INFO] Persistent cookie (has expiration)"
    else
        echo "  [OK] Session cookie (expires on browser close)"
    fi

done <<< "$cookies"
```

### Step 3: Test Cookie Prefix Support

```bash
#!/bin/bash
# Test cookie prefixes (__Host-, __Secure-)

TARGET="https://target.com"

# __Host- prefix requirements:
# - Must have Secure flag
# - Must not have Domain attribute
# - Path must be /
# - Must be set from secure origin

# __Secure- prefix requirements:
# - Must have Secure flag
# - Must be set from secure origin

echo "=== Testing Cookie Prefixes ==="

# Check for __Host- cookies
curl -sI "$TARGET" | grep -i "set-cookie.*__Host-" && \
    echo "[OK] Using __Host- prefix" || \
    echo "[INFO] Not using __Host- prefix"

# Check for __Secure- cookies
curl -sI "$TARGET" | grep -i "set-cookie.*__Secure-" && \
    echo "[OK] Using __Secure- prefix" || \
    echo "[INFO] Not using __Secure- prefix"
```

### Step 4: Test HTTP Downgrade

```bash
#!/bin/bash
# Test if cookies are sent over HTTP

# This test requires both HTTP and HTTPS access
HTTP_TARGET="http://target.com"
HTTPS_TARGET="https://target.com"

# Get session from HTTPS
session=$(curl -s -c - "$HTTPS_TARGET/login" -d "user=test&pass=test" | \
    grep -oP "SESSIONID=\K[^;]+")

# Try to use session over HTTP
response=$(curl -s -b "SESSIONID=$session" "$HTTP_TARGET/protected")

if echo "$response" | grep -qi "authenticated\|welcome"; then
    echo "[VULN] Session cookie accepted over HTTP"
else
    echo "[OK] Session cookie not sent/accepted over HTTP"
fi
```

### Step 5: Test XSS Cookie Theft

```javascript
// Browser console test - check if session cookies are accessible
// If accessible, XSS can steal them

console.log("=== Cookies accessible via JavaScript ===");
console.log(document.cookie);

// Check for specific session cookies
const cookies = document.cookie.split(';');
cookies.forEach(cookie => {
    const [name, value] = cookie.trim().split('=');
    if (name.toLowerCase().includes('session') ||
        name.toLowerCase().includes('token') ||
        name.toLowerCase().includes('auth')) {
        console.log(`[VULN] Sensitive cookie accessible: ${name}`);
    }
});

// If session cookies appear, HttpOnly is missing
```

### Step 6: Comprehensive Cookie Analyzer

```python
#!/usr/bin/env python3
import requests
from http.cookies import SimpleCookie

class CookieAnalyzer:
    def __init__(self, url):
        self.url = url
        self.session = requests.Session()
        self.findings = []

    def analyze(self):
        """Analyze all cookie attributes"""
        print(f"[*] Analyzing cookies from {self.url}")

        response = self.session.get(self.url)

        for cookie in self.session.cookies:
            print(f"\n{'='*50}")
            print(f"Cookie: {cookie.name}")
            print(f"{'='*50}")

            self._analyze_cookie(cookie, response)

        return self.findings

    def _analyze_cookie(self, cookie, response):
        """Analyze individual cookie"""

        # Check Secure flag
        if cookie.secure:
            print(f"  [OK] Secure: True")
        else:
            print(f"  [VULN] Secure: False")
            self.findings.append({
                "cookie": cookie.name,
                "issue": "Missing Secure flag",
                "severity": "High",
                "recommendation": "Add Secure flag to cookie"
            })

        # Check HttpOnly (need to check raw header)
        set_cookie_headers = response.headers.get('Set-Cookie', '')
        if cookie.name in set_cookie_headers:
            if 'httponly' in set_cookie_headers.lower():
                print(f"  [OK] HttpOnly: True")
            else:
                print(f"  [VULN] HttpOnly: False")
                self.findings.append({
                    "cookie": cookie.name,
                    "issue": "Missing HttpOnly flag",
                    "severity": "High",
                    "recommendation": "Add HttpOnly flag to prevent XSS theft"
                })

        # Check SameSite
        if 'samesite=strict' in set_cookie_headers.lower():
            print(f"  [OK] SameSite: Strict")
        elif 'samesite=lax' in set_cookie_headers.lower():
            print(f"  [WARN] SameSite: Lax")
        elif 'samesite=none' in set_cookie_headers.lower():
            print(f"  [WARN] SameSite: None (cross-site allowed)")
            if not cookie.secure:
                self.findings.append({
                    "cookie": cookie.name,
                    "issue": "SameSite=None without Secure flag",
                    "severity": "High",
                    "recommendation": "SameSite=None requires Secure flag"
                })
        else:
            print(f"  [WARN] SameSite: Not set")
            self.findings.append({
                "cookie": cookie.name,
                "issue": "Missing SameSite attribute",
                "severity": "Medium",
                "recommendation": "Add SameSite=Strict or Lax"
            })

        # Check Domain
        print(f"  Domain: {cookie.domain or '(not set - origin only)'}")
        if cookie.domain and cookie.domain.startswith('.'):
            self.findings.append({
                "cookie": cookie.name,
                "issue": f"Domain with leading dot ({cookie.domain})",
                "severity": "Low",
                "recommendation": "Review if subdomain access is needed"
            })

        # Check Path
        print(f"  Path: {cookie.path}")
        if cookie.path == '/':
            print(f"  [INFO] Cookie available to entire site")

        # Check Expiration
        if cookie.expires:
            import datetime
            exp_date = datetime.datetime.fromtimestamp(cookie.expires)
            print(f"  Expires: {exp_date}")

            # Check for very long expiration
            days_until_expire = (exp_date - datetime.datetime.now()).days
            if days_until_expire > 365:
                self.findings.append({
                    "cookie": cookie.name,
                    "issue": f"Long expiration ({days_until_expire} days)",
                    "severity": "Low",
                    "recommendation": "Consider shorter cookie lifetime"
                })
        else:
            print(f"  Expires: Session (browser close)")

        # Check value characteristics
        print(f"  Value length: {len(cookie.value)}")
        if len(cookie.value) < 16:
            print(f"  [WARN] Short cookie value")

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*60)
        print("COOKIE SECURITY REPORT")
        print("="*60)

        if not self.findings:
            print("\nNo security issues found!")
            return

        print(f"\nTotal findings: {len(self.findings)}")

        # Group by severity
        for severity in ['High', 'Medium', 'Low']:
            issues = [f for f in self.findings if f['severity'] == severity]
            if issues:
                print(f"\n{severity.upper()} ({len(issues)}):")
                for issue in issues:
                    print(f"  [{issue['cookie']}] {issue['issue']}")
                    print(f"    → {issue['recommendation']}")

# Usage
analyzer = CookieAnalyzer("https://target.com")
analyzer.analyze()
analyzer.generate_report()
```

---

## Tools

### Cookie Analysis

| Tool | Description | Usage |
|------|-------------|-------|
| **Browser DevTools** | Cookie inspection | Application > Cookies |
| **Cookie-Editor** | Browser extension | Edit/analyze cookies |
| **Burp Suite** | Traffic analysis | Cookie interception |

### Testing

| Tool | Description |
|------|-------------|
| **curl** | Command-line testing |
| **Custom scripts** | Automated analysis |

---

## Remediation Guide

### 1. Secure Cookie Configuration

```python
# Flask example
from flask import Flask, make_response

app = Flask(__name__)

# Global session cookie settings
app.config.update(
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Strict',
    SESSION_COOKIE_NAME='__Host-session',  # Use prefix
)

# For custom cookies
@app.route('/set-cookie')
def set_cookie():
    response = make_response("Cookie set")
    response.set_cookie(
        '__Host-session',
        value=generate_session_id(),
        secure=True,
        httponly=True,
        samesite='Strict',
        path='/',
        max_age=3600  # 1 hour
        # No domain - __Host- requires this
    )
    return response
```

### 2. Express.js Configuration

```javascript
const express = require('express');
const session = require('express-session');

const app = express();

app.use(session({
    name: '__Host-session',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: true,           // HTTPS only
        httpOnly: true,         // No JavaScript access
        sameSite: 'strict',     // CSRF protection
        maxAge: 3600000,        // 1 hour
        path: '/'
        // domain not set for __Host- prefix
    }
}));

// For individual cookies
app.get('/set-cookie', (req, res) => {
    res.cookie('preference', 'value', {
        secure: true,
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 86400000,
        path: '/settings'
    });
    res.send('Cookie set');
});
```

### 3. Java/Spring Configuration

```java
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.session.web.http.CookieSerializer;
import org.springframework.session.web.http.DefaultCookieSerializer;

@Configuration
public class SessionConfig {

    @Bean
    public CookieSerializer cookieSerializer() {
        DefaultCookieSerializer serializer = new DefaultCookieSerializer();
        serializer.setCookieName("__Host-SESSION");
        serializer.setUseSecureCookie(true);
        serializer.setUseHttpOnlyCookie(true);
        serializer.setSameSite("Strict");
        serializer.setCookiePath("/");
        serializer.setCookieMaxAge(3600); // 1 hour
        return serializer;
    }
}
```

### 4. Nginx Header Configuration

```nginx
# Add security headers for all cookies
add_header Set-Cookie "Path=/; Secure; HttpOnly; SameSite=Strict";

# Proxy cookie configuration
proxy_cookie_flags ~ secure httponly samesite=strict;

# Or in location block
location / {
    proxy_pass http://backend;
    proxy_cookie_path / "/; Secure; HttpOnly; SameSite=Strict";
}
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Missing Secure flag on session | 7.5 | High |
| Missing HttpOnly on session | 6.1 | Medium |
| SameSite=None without Secure | 6.5 | Medium |
| Missing SameSite | 4.3 | Medium |
| Overly broad Domain | 4.3 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-614** | HTTPS Cookie Without Secure | Missing Secure flag |
| **CWE-1004** | Cookie Without HttpOnly | XSS accessible |
| **CWE-1275** | Cookie With SameSite=None | CSRF risk |
| **CWE-565** | Reliance on Cookies Without Validation | Cookie trust |

---

## References

- [OWASP Cookie Security](https://owasp.org/www-community/controls/SecureCookieAttribute)
- [MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie)
- [RFC 6265 - HTTP State Management](https://tools.ietf.org/html/rfc6265)
- [Cookie Prefixes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#Cookie_prefixes)

---

## Checklist

```
[ ] All cookies identified
[ ] Secure flag checked
[ ] HttpOnly flag checked
[ ] SameSite attribute checked
[ ] Domain scope analyzed
[ ] Path scope analyzed
[ ] Expiration settings reviewed
[ ] Cookie prefixes considered
[ ] HTTP downgrade tested
[ ] JavaScript accessibility tested
[ ] Findings documented
[ ] Remediation recommendations provided
```
