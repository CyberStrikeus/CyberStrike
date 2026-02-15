# WSTG-ATHN-06: Testing for Browser Cache Weaknesses

## Test ID
WSTG-ATHN-06

## Test Name
Testing for Browser Cache Weaknesses

## High-Level Description

Browser cache weakness testing examines whether sensitive authentication and user data can be retrieved from browser cache, history, or back button functionality. Improper cache control headers may allow sensitive pages to be cached, enabling attackers to access private information from shared or public computers.

---

## What to Check

### Cache Control Issues

- [ ] Sensitive pages cached
- [ ] Missing cache-control headers
- [ ] Back button exposes data
- [ ] Browser history reveals sensitive URLs
- [ ] Autocomplete on sensitive forms
- [ ] Credential caching

### Sensitive Data Locations

| Location | Risk |
|----------|------|
| Browser cache | Offline access to pages |
| Browser history | URL disclosure |
| Form autocomplete | Credential exposure |
| Back button | Post-logout access |

---

## How to Test

### Step 1: Check Cache-Control Headers

```bash
# Check headers on sensitive pages

pages=(
    "/login"
    "/dashboard"
    "/account"
    "/profile"
    "/api/user"
    "/settings"
)

for page in "${pages[@]}"; do
    echo "=== $page ==="
    curl -sI "https://target.com$page" \
        -H "Authorization: Bearer $TOKEN" | \
        grep -iE "cache-control|pragma|expires|vary"
    echo ""
done

# Expected headers for sensitive pages:
# Cache-Control: no-store, no-cache, must-revalidate
# Pragma: no-cache
# Expires: 0
```

### Step 2: Test Back Button After Logout

```bash
# This requires browser testing, but we can check server behavior

# 1. Login and access sensitive page
session=$(curl -s -c - "https://target.com/login" \
    -X POST \
    -d "username=test&password=test" | grep session | awk '{print $7}')

# 2. Access dashboard
curl -s "https://target.com/dashboard" \
    -H "Cookie: session=$session" > dashboard_content.html

# 3. Logout
curl -s "https://target.com/logout" \
    -H "Cookie: session=$session"

# 4. Check if cached version returns with same session
# (This simulates back button)
curl -s "https://target.com/dashboard" \
    -H "Cookie: session=$session" \
    -H "Cache-Control: max-age=0" \
    -w "\nStatus: %{http_code}"

# Should return 401/302 to login, not cached content
```

### Step 3: Check Autocomplete Settings

```bash
# Check login form for autocomplete settings
curl -s "https://target.com/login" | \
    grep -iE "autocomplete|password|username" | \
    head -20

# Check for password fields without autocomplete="off"
curl -s "https://target.com/login" | \
    grep -i "type=.password" | \
    grep -v "autocomplete"

# Check registration form
curl -s "https://target.com/register" | \
    grep -iE "autocomplete|password"
```

### Step 4: Test Page Caching Behavior

```bash
#!/bin/bash
# Test if pages are being cached

TARGET="https://target.com"
TOKEN="your_token"

# Make request and check for caching headers
echo "Testing cache headers..."

# Sensitive endpoints
endpoints=("/dashboard" "/account" "/api/me" "/settings")

for endpoint in "${endpoints[@]}"; do
    echo "=== $endpoint ==="

    response=$(curl -sI "$TARGET$endpoint" \
        -H "Authorization: Bearer $TOKEN")

    # Check Cache-Control
    cache_control=$(echo "$response" | grep -i "cache-control")
    if [ -z "$cache_control" ]; then
        echo "  [VULN] No Cache-Control header"
    elif echo "$cache_control" | grep -qi "no-store\|no-cache"; then
        echo "  [OK] Proper caching disabled: $cache_control"
    else
        echo "  [WARN] Cache-Control may allow caching: $cache_control"
    fi

    # Check Pragma
    pragma=$(echo "$response" | grep -i "pragma")
    if [ -z "$pragma" ]; then
        echo "  [INFO] No Pragma header (optional for HTTP/1.1)"
    fi

    # Check Expires
    expires=$(echo "$response" | grep -i "expires")
    if echo "$expires" | grep -qi "0\|-1\|Thu, 01 Jan 1970"; then
        echo "  [OK] Expires set to past"
    fi

    echo ""
done
```

### Step 5: Check ETag and Last-Modified

```bash
# Check for conditional request headers that might reveal info

curl -sI "https://target.com/dashboard" \
    -H "Authorization: Bearer $TOKEN" | \
    grep -iE "etag|last-modified"

# If ETag contains user-specific info, it could be a privacy issue
# Make same request with different user and compare ETags
```

### Step 6: Test Credential Caching in Browser

```html
<!-- This test is performed manually in browser -->
<!-- Check if browser offers to save password -->

<!-- 1. Open login page -->
<!-- 2. Enter credentials -->
<!-- 3. Check if browser prompts to save password -->
<!-- 4. Check if saved credentials appear in browser settings -->

<!-- Server should return: -->
<!-- - autocomplete="off" on login form -->
<!-- - autocomplete="new-password" on password reset forms -->
<!-- - Cache-Control: no-store -->
```

### Step 7: Test HTTPS Page Caching

```bash
# Check if HTTPS responses include caching headers
# Some browsers don't cache HTTPS by default, but explicit headers are safer

curl -sI "https://target.com/sensitive-page" \
    -H "Authorization: Bearer $TOKEN" \
    -o headers.txt

# Analyze headers
if grep -qi "cache-control.*public\|cache-control.*max-age=[1-9]" headers.txt; then
    echo "[VULN] Sensitive page may be cached"
fi

if ! grep -qi "cache-control" headers.txt; then
    echo "[VULN] No Cache-Control header on sensitive page"
fi
```

---

## Tools

### Header Analysis

| Tool | Description | Usage |
|------|-------------|-------|
| **curl** | HTTP client | Check headers |
| **Browser DevTools** | Network tab | Inspect cache behavior |
| **Burp Suite** | Proxy | Analyze responses |

### Cache Testing

| Tool | Description |
|------|-------------|
| **Browser cache viewer** | Inspect cached content |
| **Private/Incognito mode** | Test clean cache behavior |

---

## Example Commands/Payloads

### Cache Analysis Script

```python
#!/usr/bin/env python3
import requests

class CacheAnalyzer:
    def __init__(self, base_url, token=None):
        self.base_url = base_url
        self.headers = {}
        if token:
            self.headers["Authorization"] = f"Bearer {token}"
        self.results = []

    def analyze_endpoint(self, endpoint):
        """Analyze caching headers for an endpoint"""
        try:
            response = requests.get(
                f"{self.base_url}{endpoint}",
                headers=self.headers
            )

            result = {
                "endpoint": endpoint,
                "status": response.status_code,
                "issues": []
            }

            headers = response.headers

            # Check Cache-Control
            cache_control = headers.get("Cache-Control", "")
            if not cache_control:
                result["issues"].append("Missing Cache-Control header")
            else:
                if "no-store" not in cache_control.lower():
                    result["issues"].append(f"Cache-Control may allow caching: {cache_control}")
                if "private" not in cache_control.lower() and "no-store" not in cache_control.lower():
                    result["issues"].append("Cache-Control should include 'private' or 'no-store'")

            # Check Pragma
            pragma = headers.get("Pragma", "")
            if "no-cache" not in pragma.lower() and not cache_control:
                result["issues"].append("Missing Pragma: no-cache (useful for HTTP/1.0)")

            # Check Expires
            expires = headers.get("Expires", "")
            if expires and "0" not in expires and "1970" not in expires:
                result["issues"].append(f"Expires header may allow caching: {expires}")

            # Check for ETag with potentially sensitive data
            etag = headers.get("ETag", "")
            if etag and len(etag) > 50:
                result["issues"].append("Long ETag may contain sensitive information")

            result["cache_control"] = cache_control
            result["vulnerable"] = len(result["issues"]) > 0

            self.results.append(result)
            return result

        except Exception as e:
            return {"endpoint": endpoint, "error": str(e)}

    def analyze_form(self, endpoint):
        """Analyze form for autocomplete settings"""
        try:
            response = requests.get(
                f"{self.base_url}{endpoint}",
                headers=self.headers
            )

            issues = []

            # Check for password fields without autocomplete="off"
            if 'type="password"' in response.text or "type='password'" in response.text:
                if 'autocomplete="off"' not in response.text and 'autocomplete="new-password"' not in response.text:
                    issues.append("Password field without autocomplete='off'")

            # Check form-level autocomplete
            if '<form' in response.text:
                if 'autocomplete="off"' not in response.text:
                    issues.append("Form without autocomplete='off'")

            return {
                "endpoint": endpoint,
                "form_issues": issues,
                "vulnerable": len(issues) > 0
            }

        except Exception as e:
            return {"endpoint": endpoint, "error": str(e)}

    def generate_report(self):
        """Generate analysis report"""
        print("\n=== BROWSER CACHE SECURITY REPORT ===\n")

        vulnerable = [r for r in self.results if r.get("vulnerable")]

        print(f"Endpoints analyzed: {len(self.results)}")
        print(f"Vulnerable endpoints: {len(vulnerable)}\n")

        for result in self.results:
            status = "[VULN]" if result.get("vulnerable") else "[OK]"
            print(f"{status} {result['endpoint']}")

            if result.get("issues"):
                for issue in result["issues"]:
                    print(f"    - {issue}")

            print(f"    Cache-Control: {result.get('cache_control', 'Not set')}")
            print()

# Usage
analyzer = CacheAnalyzer("https://target.com", "your_token")
analyzer.analyze_endpoint("/dashboard")
analyzer.analyze_endpoint("/account")
analyzer.analyze_endpoint("/api/user")
analyzer.analyze_form("/login")
analyzer.generate_report()
```

---

## Remediation Guide

### 1. Set Proper Cache-Control Headers

```python
from flask import Flask, make_response

@app.after_request
def add_cache_headers(response):
    """Add security headers to prevent caching of sensitive pages"""

    # For all authenticated pages
    if is_authenticated_request():
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'

    return response

# Or for specific routes
@app.route('/dashboard')
@login_required
def dashboard():
    response = make_response(render_template('dashboard.html'))
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response
```

### 2. Web Server Configuration

```nginx
# Nginx - Disable caching for sensitive locations
location /dashboard {
    add_header Cache-Control "no-store, no-cache, must-revalidate, max-age=0" always;
    add_header Pragma "no-cache" always;
    add_header Expires "0" always;

    # Your location config
}

# For all authenticated areas
location /api/ {
    add_header Cache-Control "private, no-store, no-cache, must-revalidate" always;
    add_header Pragma "no-cache" always;
}
```

```apache
# Apache - Disable caching for sensitive pages
<Location /dashboard>
    Header always set Cache-Control "no-store, no-cache, must-revalidate, max-age=0"
    Header always set Pragma "no-cache"
    Header always set Expires "0"
</Location>
```

### 3. Disable Form Autocomplete

```html
<!-- Login form -->
<form method="POST" action="/login" autocomplete="off">
    <input type="text" name="username" autocomplete="off">
    <input type="password" name="password" autocomplete="off">
    <button type="submit">Login</button>
</form>

<!-- Password change form -->
<form method="POST" action="/change-password" autocomplete="off">
    <input type="password" name="current_password" autocomplete="current-password">
    <input type="password" name="new_password" autocomplete="new-password">
    <input type="password" name="confirm_password" autocomplete="new-password">
    <button type="submit">Change Password</button>
</form>
```

### 4. Clear Sensitive Data on Logout

```javascript
// Client-side: Clear sensitive data on logout
function logout() {
    // Clear any cached data
    if (window.sessionStorage) {
        sessionStorage.clear();
    }

    if (window.localStorage) {
        // Clear sensitive items
        localStorage.removeItem('user_data');
        localStorage.removeItem('auth_token');
    }

    // Redirect to login with cache bypass
    window.location.replace('/login?logout=1');

    // Prevent back button
    history.pushState(null, null, '/login');
    window.addEventListener('popstate', function() {
        history.pushState(null, null, '/login');
    });
}
```

```python
# Server-side: Clear session and send no-cache headers
@app.route('/logout')
def logout():
    # Clear session
    session.clear()

    response = make_response(redirect('/login'))

    # Clear session cookie
    response.delete_cookie('session')

    # Prevent caching of logout redirect
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
    response.headers['Clear-Site-Data'] = '"cache", "storage"'

    return response
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Cached credentials accessible | 6.5 | Medium |
| Back button shows sensitive data | 5.3 | Medium |
| Missing Cache-Control on sensitive pages | 4.3 | Medium |
| Autocomplete enabled on password fields | 3.7 | Low |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-525** | Use of Web Browser Cache Containing Sensitive Information | Cached sensitive data |
| **CWE-524** | Use of Cache Containing Sensitive Information | General cache issue |
| **CWE-200** | Exposure of Sensitive Information | Data disclosure |

---

## References

- [OWASP WSTG - Testing for Browser Cache Weaknesses](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/04-Authentication_Testing/06-Testing_for_Browser_Cache_Weaknesses)
- [MDN Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control)
- [OWASP Secure Headers](https://owasp.org/www-project-secure-headers/)

---

## Checklist

```
[ ] Cache-Control headers checked on sensitive pages
[ ] Pragma header checked
[ ] Expires header checked
[ ] Back button behavior tested
[ ] Logout cache behavior tested
[ ] Form autocomplete settings checked
[ ] Password field autocomplete disabled
[ ] Browser history exposure tested
[ ] ETag information disclosure checked
[ ] Clear-Site-Data header considered
[ ] Findings documented
[ ] Remediation recommendations provided
```
