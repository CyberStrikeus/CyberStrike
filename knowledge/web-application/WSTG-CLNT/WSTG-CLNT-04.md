# WSTG-CLNT-04: Testing for Client-Side URL Redirect

## Test ID
WSTG-CLNT-04

## Test Name
Testing for Client-Side URL Redirect

## High-Level Description

Client-side URL redirect vulnerabilities (open redirects) occur when JavaScript redirects users based on URL parameters without validation. Attackers can craft links that redirect victims to malicious sites, facilitating phishing attacks.

---

## What to Check

- [ ] location.href assignments
- [ ] location.replace() calls
- [ ] window.open() with user input
- [ ] meta refresh with parameters
- [ ] Form action manipulation

---

## How to Test

### Step 1: Identify Redirect Parameters

```bash
#!/bin/bash
TARGET="https://target.com"

# Common redirect parameters
params=("url" "redirect" "next" "return" "returnUrl" "goto" "destination" "redir" "redirect_uri" "continue")

for param in "${params[@]}"; do
    response=$(curl -sI "$TARGET/login?$param=https://evil.com" | grep -i "location")
    if echo "$response" | grep -qi "evil.com"; then
        echo "[VULN] Open redirect via: $param"
    fi
done
```

### Step 2: Test Bypass Techniques

```bash
#!/bin/bash
TARGET="https://target.com"
PARAM="redirect"

payloads=(
    "https://evil.com"
    "//evil.com"
    "https://target.com.evil.com"
    "https://evil.com/target.com"
    "https://target.com@evil.com"
    "javascript:alert(1)"
    "//evil.com/%2f%2e%2e"
    "https:evil.com"
    "/\\evil.com"
)

for payload in "${payloads[@]}"; do
    echo "Testing: $payload"
    curl -sI "$TARGET/auth?$PARAM=$payload" | grep -i "location"
done
```

### Step 3: JavaScript Redirect Analysis

```javascript
// Search for these patterns in JS files:
// location.href =
// location.replace(
// window.location =
// window.open(

// Check if URL parameter is used without validation
const urlParams = new URLSearchParams(window.location.search);
const redirectUrl = urlParams.get('redirect');

// Vulnerable pattern:
window.location.href = redirectUrl;  // No validation!

// Safe pattern:
const allowedHosts = ['target.com', 'sub.target.com'];
try {
    const url = new URL(redirectUrl);
    if (allowedHosts.includes(url.hostname)) {
        window.location.href = redirectUrl;
    }
} catch (e) {
    // Invalid URL
}
```

---

## Remediation

```javascript
function safeRedirect(url) {
    const allowedHosts = ['example.com', 'sub.example.com'];

    try {
        const parsed = new URL(url, window.location.origin);

        // Only allow same-origin or whitelisted hosts
        if (parsed.origin === window.location.origin ||
            allowedHosts.includes(parsed.hostname)) {
            window.location.href = parsed.href;
        } else {
            window.location.href = '/';  // Default safe redirect
        }
    } catch (e) {
        window.location.href = '/';
    }
}
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| Open redirect | 4.7 | Medium |
| javascript: URI redirect | 6.1 | Medium |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-601** | URL Redirection to Untrusted Site |

---

## Checklist

```
[ ] Redirect parameters identified
[ ] Bypass techniques tested
[ ] JavaScript redirect code analyzed
[ ] javascript: URI tested
[ ] Findings documented
```
