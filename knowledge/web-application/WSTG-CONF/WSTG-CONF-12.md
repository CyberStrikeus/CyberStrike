# WSTG-CONF-12: Test for Content Security Policy

## Test ID
WSTG-CONF-12

## Test Name
Test for Content Security Policy (CSP)

## High-Level Description

Content Security Policy (CSP) is a security mechanism that helps prevent cross-site scripting (XSS), clickjacking, and other code injection attacks. CSP defines which sources of content are allowed to be loaded and executed by the browser. This test evaluates whether CSP is implemented correctly and identifies misconfigurations that could allow attackers to bypass the policy.

---

## What to Check

### CSP Implementation

- [ ] CSP header present
- [ ] CSP meta tag usage
- [ ] Report-Only mode vs enforcement
- [ ] Policy completeness

### Dangerous Directives

| Directive | Risk | Description |
|-----------|------|-------------|
| `unsafe-inline` | High | Allows inline scripts/styles (XSS) |
| `unsafe-eval` | High | Allows eval() function |
| `unsafe-hashes` | Medium | Allows specific inline scripts |
| `*` wildcard | High | Allows any source |
| `data:` | Medium | Allows data URLs |
| `blob:` | Medium | Allows blob URLs |
| Missing `frame-ancestors` | Medium | Clickjacking possible |

### Key Directives

| Directive | Purpose |
|-----------|---------|
| `default-src` | Fallback for other directives |
| `script-src` | JavaScript sources |
| `style-src` | CSS sources |
| `img-src` | Image sources |
| `connect-src` | AJAX/WebSocket sources |
| `font-src` | Font sources |
| `object-src` | Plugin sources (Flash, etc.) |
| `frame-ancestors` | Embedding restrictions |
| `base-uri` | Base URL restrictions |
| `form-action` | Form submission targets |

---

## How to Test

### Step 1: Retrieve CSP Header

```bash
# Check HTTP header
curl -sI https://target.com | grep -i content-security-policy

# Full header output
curl -sI https://target.com | grep -iE 'content-security-policy|x-frame-options|x-content-type'

# Check meta tag
curl -s https://target.com | grep -i "content-security-policy"
```

### Step 2: Analyze CSP Policy

```bash
#!/bin/bash
TARGET=$1

echo "=== CSP ANALYSIS ==="
csp=$(curl -sI "https://$TARGET" | grep -i "content-security-policy:" | sed 's/content-security-policy://i')

if [ -z "$csp" ]; then
    echo "[FAIL] No CSP header found!"
    exit 1
fi

echo "Policy: $csp"
echo ""

# Check for dangerous patterns
echo "[+] Checking for dangerous patterns..."

if echo "$csp" | grep -qi "unsafe-inline"; then
    echo "  [HIGH] unsafe-inline detected - XSS possible"
fi

if echo "$csp" | grep -qi "unsafe-eval"; then
    echo "  [HIGH] unsafe-eval detected - eval() allowed"
fi

if echo "$csp" | grep -qE "script-src[^;]*\*"; then
    echo "  [HIGH] Wildcard in script-src"
fi

if echo "$csp" | grep -qE "default-src[^;]*\*"; then
    echo "  [HIGH] Wildcard in default-src"
fi

if ! echo "$csp" | grep -qi "frame-ancestors"; then
    echo "  [MEDIUM] Missing frame-ancestors - clickjacking possible"
fi

if ! echo "$csp" | grep -qi "object-src"; then
    echo "  [MEDIUM] Missing object-src"
fi

if echo "$csp" | grep -qi "data:"; then
    echo "  [MEDIUM] data: URI allowed"
fi

echo ""
echo "[+] Analysis complete"
```

### Step 3: Test CSP Bypass Vectors

#### 1. Check for JSONP Endpoints

```bash
# If whitelisted domain has JSONP
# Policy: script-src 'self' https://trusted.com

# Test JSONP callback
curl -s "https://trusted.com/api?callback=alert(1)"

# If callback is reflected, CSP can be bypassed
```

#### 2. Check for Angular/Template Injection

```html
<!-- If Angular is loaded and unsafe-eval not blocked -->
<div ng-app ng-csp>
    {{constructor.constructor('alert(1)')()}}
</div>
```

#### 3. Check for Base URI Injection

```html
<!-- If base-uri not set -->
<base href="https://attacker.com/">
<script src="/malicious.js"></script>
```

### Step 4: Browser DevTools Analysis

1. Open DevTools (F12)
2. Go to Console tab
3. Look for CSP violation reports
4. Network tab > filter by "report" for CSP reports

### Step 5: CSP Evaluator Tools

```bash
# Google CSP Evaluator (online)
# https://csp-evaluator.withgoogle.com/

# Local analysis with csp-evaluator
npm install -g csp-evaluator
csp-evaluator "script-src 'self' 'unsafe-inline'"
```

---

## Tools

### Online Tools

| Tool | URL | Purpose |
|------|-----|---------|
| Google CSP Evaluator | csp-evaluator.withgoogle.com | Policy analysis |
| CSP Validator | cspvalidator.org | Validation |
| Security Headers | securityheaders.com | Header check |
| Mozilla Observatory | observatory.mozilla.org | Security scan |

### Browser Extensions

| Extension | Browser | Purpose |
|-----------|---------|---------|
| CSP Evaluator | Chrome | Inline analysis |
| CSP Tester | Firefox | Policy testing |

### Burp Extensions

| Extension | Purpose |
|-----------|---------|
| CSP Auditor | CSP analysis |
| CSP Bypass | Bypass detection |

---

## Example Commands/Payloads

### Comprehensive CSP Analyzer

```bash
#!/bin/bash
TARGET=$1

echo "=== CSP SECURITY ANALYSIS ==="
echo "Target: $TARGET"
echo ""

# Get CSP header
csp_header=$(curl -sI "https://$TARGET" | grep -i "^content-security-policy:" | cut -d: -f2-)
csp_ro=$(curl -sI "https://$TARGET" | grep -i "^content-security-policy-report-only:" | cut -d: -f2-)

# Get CSP meta tag
csp_meta=$(curl -s "https://$TARGET" | grep -oP '(?<=<meta http-equiv="Content-Security-Policy" content=")[^"]+')

if [ -z "$csp_header" ] && [ -z "$csp_meta" ]; then
    echo "[CRITICAL] No CSP implemented!"
    exit 1
fi

csp="${csp_header:-$csp_meta}"
echo "Policy found: ${csp:0:100}..."
echo ""

# Analysis
echo "[+] Directive Analysis:"

# Script-src
script_src=$(echo "$csp" | grep -oP "script-src[^;]*")
if [ -z "$script_src" ]; then
    echo "  script-src: Not defined (falls back to default-src)"
else
    echo "  script-src: $script_src"

    if echo "$script_src" | grep -q "unsafe-inline"; then
        echo "    [!] RISK: unsafe-inline allows XSS"
    fi
    if echo "$script_src" | grep -q "unsafe-eval"; then
        echo "    [!] RISK: unsafe-eval allows code execution"
    fi
fi

# Default-src
default_src=$(echo "$csp" | grep -oP "default-src[^;]*")
echo "  default-src: ${default_src:-Not defined}"

# Frame-ancestors
frame_ancestors=$(echo "$csp" | grep -oP "frame-ancestors[^;]*")
if [ -z "$frame_ancestors" ]; then
    echo "  frame-ancestors: [!] MISSING - Clickjacking possible"
else
    echo "  frame-ancestors: $frame_ancestors"
fi

# Object-src
object_src=$(echo "$csp" | grep -oP "object-src[^;]*")
if [ -z "$object_src" ]; then
    echo "  object-src: [!] MISSING - Plugin attacks possible"
else
    echo "  object-src: $object_src"
fi

# Base-uri
base_uri=$(echo "$csp" | grep -oP "base-uri[^;]*")
if [ -z "$base_uri" ]; then
    echo "  base-uri: [!] MISSING - Base tag injection possible"
else
    echo "  base-uri: $base_uri"
fi

echo ""
echo "[+] Use Google CSP Evaluator for detailed analysis:"
echo "    https://csp-evaluator.withgoogle.com/"
```

### CSP Bypass Test Payloads

```html
<!-- Test for unsafe-inline bypass -->
<script>alert('XSS')</script>

<!-- Test for event handler bypass -->
<img src=x onerror="alert('XSS')">

<!-- Test for data: URI -->
<script src="data:text/javascript,alert('XSS')"></script>

<!-- Test for JSONP bypass -->
<script src="https://whitelisted.com/jsonp?callback=alert"></script>

<!-- Angular sandbox bypass (old versions) -->
{{constructor.constructor('alert(1)')()}}
```

---

## Remediation Guide

### 1. Implement Strict CSP

```http
# Recommended strict policy (nonce-based)
Content-Security-Policy:
    default-src 'self';
    script-src 'self' 'nonce-{random}' 'strict-dynamic';
    style-src 'self' 'nonce-{random}';
    img-src 'self' data: https:;
    font-src 'self';
    object-src 'none';
    base-uri 'self';
    frame-ancestors 'self';
    form-action 'self';
    upgrade-insecure-requests;
```

### 2. Web Server Configuration

#### Apache

```apache
Header always set Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'self';"
```

#### Nginx

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'self';" always;
```

### 3. Use Report-Only First

```http
# Test policy without breaking functionality
Content-Security-Policy-Report-Only: default-src 'self'; report-uri /csp-report
```

### 4. Implementation Steps

1. Start with Report-Only mode
2. Analyze violation reports
3. Whitelist necessary sources
4. Avoid unsafe-inline/unsafe-eval
5. Use nonces or hashes for inline scripts
6. Deploy enforcing policy

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| No CSP implemented | 6.1 | Medium |
| unsafe-inline in script-src | 6.1 | Medium |
| Wildcard in script-src | 6.1 | Medium |
| Missing frame-ancestors | 4.3 | Medium |
| Report-Only mode only | 3.7 | Low |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-16** | Configuration | Missing security header |
| **CWE-79** | Cross-site Scripting | CSP prevents XSS |
| **CWE-1021** | Improper Restriction of Rendered UI | Clickjacking |

---

## References

- [OWASP WSTG - Test for Content Security Policy](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/12-Test_for_Content_Security_Policy)
- [Google CSP Evaluator](https://csp-evaluator.withgoogle.com/)
- [MDN CSP Documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [OWASP CSP Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)

---

## Checklist

```
[ ] CSP header present
[ ] CSP meta tag checked
[ ] Policy completeness verified
[ ] unsafe-inline usage checked
[ ] unsafe-eval usage checked
[ ] Wildcard sources identified
[ ] frame-ancestors present
[ ] object-src restricted
[ ] base-uri restricted
[ ] JSONP bypass vectors tested
[ ] Report-Only vs enforcing verified
[ ] CSP Evaluator analysis done
[ ] Bypass possibilities documented
[ ] Remediation recommendations provided
```
