# WSTG-AUTHZ-05.2: Testing OAuth Client Weaknesses

## Test ID
WSTG-AUTHZ-05.2

## Test Name
Testing OAuth Client Weaknesses

## High-Level Description

OAuth clients (also known as relying parties) are applications that use OAuth to access protected resources on behalf of users. Client-side vulnerabilities can lead to token theft, account takeover, and unauthorized access. This test focuses on identifying weaknesses in how the client application handles OAuth flows, stores tokens, validates responses, and protects against common attack vectors.

---

## What to Check

### Client-Side Components

- [ ] Token storage security
- [ ] Redirect URI handling
- [ ] State parameter validation
- [ ] PKCE implementation
- [ ] Token refresh handling
- [ ] Logout/revocation handling
- [ ] Cross-origin protections

### Common Client Vulnerabilities

| Vulnerability | Description |
|---------------|-------------|
| Insecure token storage | Tokens in localStorage |
| Missing state validation | CSRF vulnerability |
| Token in URL | Referrer leakage |
| Missing PKCE | Authorization code interception |
| Open redirect | redirect_uri manipulation |
| XSS token theft | JavaScript access to tokens |

---

## How to Test

### Step 1: Analyze Client OAuth Flow

```bash
# Monitor the complete OAuth flow
# 1. Authorization request
# 2. User consent
# 3. Authorization response (code/token)
# 4. Token exchange (if authorization code)
# 5. Resource access

# Use browser devtools to capture:
# - Network requests
# - localStorage/sessionStorage
# - Cookies
# - JavaScript console

# Look for OAuth parameters in URLs
grep -iE "code=|token=|access_token=|state=" browser_history.txt
```

### Step 2: Test Token Storage

```javascript
// Browser console tests for token storage

// Check localStorage
console.log("localStorage tokens:");
for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.toLowerCase().includes('token') ||
        key.toLowerCase().includes('auth') ||
        key.toLowerCase().includes('jwt')) {
        console.log(`${key}: ${localStorage.getItem(key)}`);
    }
}

// Check sessionStorage
console.log("\nsessionStorage tokens:");
for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key.toLowerCase().includes('token') ||
        key.toLowerCase().includes('auth')) {
        console.log(`${key}: ${sessionStorage.getItem(key)}`);
    }
}

// Check if tokens are accessible via XSS
// If XSS exists, can tokens be stolen?
```

### Step 3: Test State Parameter Handling

```bash
#!/bin/bash
# Test client-side state validation

# Capture legitimate OAuth flow
# 1. Start authorization
AUTH_URL="https://auth.example.com/oauth/authorize"
CLIENT_URL="https://client.example.com"
CLIENT_ID="client123"

# Get the state from client
initial_response=$(curl -s -c cookies.txt "$CLIENT_URL/login/oauth")
state=$(echo "$initial_response" | grep -oP 'state=\K[^&"]+')
echo "Original state: $state"

# Test callback with:
# 1. No state
curl -s "$CLIENT_URL/oauth/callback?code=AUTH_CODE"

# 2. Empty state
curl -s "$CLIENT_URL/oauth/callback?code=AUTH_CODE&state="

# 3. Modified state
curl -s "$CLIENT_URL/oauth/callback?code=AUTH_CODE&state=attacker_state"

# 4. State from different session
curl -s -b different_cookies.txt "$CLIENT_URL/oauth/callback?code=AUTH_CODE&state=$state"
```

### Step 4: Test PKCE Implementation

```bash
#!/bin/bash
# Verify client implements PKCE correctly

# Check if client sends code_challenge in authorization request
# Monitor authorization URL for code_challenge parameter

# Test if code_verifier is properly used in token request
# Intercept token request and check for code_verifier

# Test if PKCE is enforced:
# - Capture code_challenge from auth request
# - Intercept token request
# - Try token request without code_verifier
# - Try token request with wrong code_verifier

curl -s -X POST "https://auth.example.com/oauth/token" \
    -d "grant_type=authorization_code&code=AUTH_CODE&redirect_uri=REDIRECT&client_id=CLIENT"
# Should fail if PKCE was required
```

### Step 5: Test Open Redirect in Client

```bash
#!/bin/bash
# Test for open redirects in client's redirect handling

CLIENT_URL="https://client.example.com"

# Test post-login redirect parameter
redirects=(
    "https://attacker.com"
    "//attacker.com"
    "/\\attacker.com"
    "https://client.example.com.attacker.com"
    "javascript:alert(1)"
    "data:text/html,<script>alert(1)</script>"
)

for redirect in "${redirects[@]}"; do
    # URL encode
    encoded=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$redirect'))")

    curl -s -I "$CLIENT_URL/oauth/callback?code=AUTH_CODE&state=VALID&next=$encoded"
    curl -s -I "$CLIENT_URL/oauth/callback?code=AUTH_CODE&state=VALID&redirect=$encoded"
    curl -s -I "$CLIENT_URL/oauth/callback?code=AUTH_CODE&state=VALID&return_to=$encoded"
done
```

### Step 6: Test Token Leakage via Referrer

```bash
# Check if tokens can leak via Referrer header

# After OAuth callback, check:
# 1. If access_token is in URL (implicit flow or error)
# 2. If any external resources are loaded
# 3. If Referrer-Policy is set

# Use browser devtools to check outgoing requests
# Look for access_token in Referer header

# Check for proper headers
curl -sI "https://client.example.com/oauth/callback" | grep -iE "referrer-policy|content-security-policy"
```

### Step 7: Comprehensive Client Tester

```python
#!/usr/bin/env python3
import requests
import re
from urllib.parse import urlparse, parse_qs

class OAuthClientTester:
    def __init__(self, client_url):
        self.client_url = client_url
        self.session = requests.Session()
        self.vulnerabilities = []

    def analyze_oauth_initiation(self, login_endpoint="/login/oauth"):
        """Analyze how client initiates OAuth flow"""
        print("\n[*] Analyzing OAuth initiation...")

        try:
            response = self.session.get(
                f"{self.client_url}{login_endpoint}",
                allow_redirects=False
            )

            if response.status_code in [302, 303]:
                location = response.headers.get('Location', '')
                parsed = urlparse(location)
                params = parse_qs(parsed.query)

                print(f"Authorization URL: {parsed.scheme}://{parsed.netloc}{parsed.path}")

                # Check for state parameter
                if 'state' not in params:
                    print("[VULN] Missing state parameter")
                    self.vulnerabilities.append({
                        "type": "missing_state",
                        "location": "authorization_request"
                    })
                else:
                    print(f"State: {params['state'][0][:20]}...")

                # Check for PKCE
                if 'code_challenge' not in params:
                    print("[WARN] No PKCE code_challenge (may be OK for confidential client)")
                else:
                    print(f"PKCE: code_challenge present")
                    if params.get('code_challenge_method', [''])[0] != 'S256':
                        print("[WARN] PKCE should use S256 method")

                # Check response_type
                response_type = params.get('response_type', [''])[0]
                if response_type == 'token':
                    print("[VULN] Using implicit flow (token in URL)")
                    self.vulnerabilities.append({
                        "type": "implicit_flow",
                        "description": "Tokens exposed in URL"
                    })

                # Check redirect_uri
                redirect_uri = params.get('redirect_uri', [''])[0]
                if 'http://' in redirect_uri and 'localhost' not in redirect_uri:
                    print("[VULN] Non-HTTPS redirect_uri")
                    self.vulnerabilities.append({
                        "type": "http_redirect",
                        "uri": redirect_uri
                    })

        except Exception as e:
            print(f"[ERROR] {e}")

        return self.vulnerabilities

    def test_state_validation(self, callback_endpoint="/oauth/callback"):
        """Test if client properly validates state"""
        print("\n[*] Testing state validation...")

        # First get a valid state
        init_response = self.session.get(
            f"{self.client_url}/login/oauth",
            allow_redirects=False
        )

        location = init_response.headers.get('Location', '')
        params = parse_qs(urlparse(location).query)
        valid_state = params.get('state', [''])[0]

        # Test with no state
        response = self.session.get(
            f"{self.client_url}{callback_endpoint}",
            params={"code": "test_code"},
            allow_redirects=False
        )

        if response.status_code not in [400, 403]:
            print("[VULN] Callback accepted without state")
            self.vulnerabilities.append({
                "type": "missing_state_validation",
                "description": "Callback doesn't require state"
            })

        # Test with wrong state
        response = self.session.get(
            f"{self.client_url}{callback_endpoint}",
            params={"code": "test_code", "state": "attacker_state"},
            allow_redirects=False
        )

        if response.status_code not in [400, 403]:
            print("[VULN] Callback accepted with invalid state")
            self.vulnerabilities.append({
                "type": "invalid_state_accepted",
                "description": "State not properly validated"
            })

        return self.vulnerabilities

    def test_token_storage(self):
        """Document token storage locations (requires browser testing)"""
        print("\n[*] Token storage analysis (manual verification needed)")

        storage_checks = """
        // Run in browser console after OAuth login:

        // Check localStorage
        Object.keys(localStorage).filter(k =>
            /token|auth|jwt|session/i.test(k)
        ).forEach(k => console.log('localStorage:', k, localStorage[k]));

        // Check sessionStorage
        Object.keys(sessionStorage).filter(k =>
            /token|auth|jwt|session/i.test(k)
        ).forEach(k => console.log('sessionStorage:', k, sessionStorage[k]));

        // Check cookies
        document.cookie.split(';').filter(c =>
            /token|auth|jwt|session/i.test(c)
        ).forEach(c => console.log('cookie:', c));

        // Check if tokens are HttpOnly
        // Tokens should NOT be accessible via JavaScript
        """

        print(storage_checks)

    def test_callback_error_handling(self, callback_endpoint="/oauth/callback"):
        """Test how client handles OAuth errors"""
        print("\n[*] Testing callback error handling...")

        errors = [
            {"error": "access_denied", "error_description": "User denied access"},
            {"error": "invalid_request", "error_description": "Invalid request"},
            {"error": "server_error", "error_description": "Auth server error"},
        ]

        for error in errors:
            try:
                response = self.session.get(
                    f"{self.client_url}{callback_endpoint}",
                    params=error
                )

                # Check if error details are reflected (XSS potential)
                if error["error_description"] in response.text:
                    print(f"[WARN] Error description reflected in response")

                    # Test XSS in error_description
                    xss_payload = "<script>alert(1)</script>"
                    xss_response = self.session.get(
                        f"{self.client_url}{callback_endpoint}",
                        params={"error": "invalid_request",
                               "error_description": xss_payload}
                    )

                    if xss_payload in xss_response.text:
                        print("[VULN] XSS in error handling")
                        self.vulnerabilities.append({
                            "type": "xss_error_handling",
                            "payload": xss_payload
                        })

            except Exception as e:
                pass

        return self.vulnerabilities

    def test_logout_handling(self, logout_endpoint="/logout"):
        """Test logout and token revocation"""
        print("\n[*] Testing logout handling...")

        try:
            # Get a session
            self.session.get(f"{self.client_url}/login")

            # Logout
            logout_response = self.session.get(
                f"{self.client_url}{logout_endpoint}",
                allow_redirects=False
            )

            # Check if session is actually cleared
            # Try accessing protected resource
            protected_response = self.session.get(
                f"{self.client_url}/dashboard",
                allow_redirects=False
            )

            if protected_response.status_code == 200:
                print("[VULN] Session not properly cleared on logout")
                self.vulnerabilities.append({
                    "type": "session_not_cleared",
                    "description": "Logout doesn't invalidate session"
                })

        except Exception as e:
            pass

        return self.vulnerabilities

    def generate_report(self):
        """Generate client security report"""
        print("\n" + "="*60)
        print("OAUTH CLIENT SECURITY REPORT")
        print("="*60)

        if not self.vulnerabilities:
            print("\nNo vulnerabilities found.")
            return

        print(f"\nTotal findings: {len(self.vulnerabilities)}\n")

        # Group by type
        by_type = {}
        for vuln in self.vulnerabilities:
            t = vuln['type']
            if t not in by_type:
                by_type[t] = []
            by_type[t].append(vuln)

        for vuln_type, vulns in by_type.items():
            print(f"\n[{vuln_type.upper()}] ({len(vulns)} finding(s))")
            for v in vulns:
                for k, val in v.items():
                    if k != 'type':
                        print(f"  {k}: {val}")

# Usage
tester = OAuthClientTester("https://client.example.com")
tester.analyze_oauth_initiation()
tester.test_state_validation()
tester.test_callback_error_handling()
tester.test_logout_handling()
tester.generate_report()
```

### Step 8: Test Mobile OAuth Client

```bash
# For mobile apps, additional checks:

# 1. Check if using custom URL schemes (vulnerable to hijacking)
# Look for: myapp://callback instead of https://

# 2. Check for PKCE (required for mobile/public clients)
# Intercept authorization request and verify code_challenge

# 3. Check token storage
# - iOS: Should use Keychain
# - Android: Should use EncryptedSharedPreferences or Keystore

# 4. Check for deep link hijacking
# - Verify app uses App Links (Android) or Universal Links (iOS)
# - Custom schemes are vulnerable to hijacking

# 5. Check for intent interception (Android)
# Malicious apps can intercept OAuth callbacks
```

---

## Tools

### Client Analysis

| Tool | Description | Usage |
|------|-------------|-------|
| **Browser DevTools** | Traffic analysis | Monitor OAuth flow |
| **Burp Suite** | Proxy | Intercept requests |
| **OWASP ZAP** | Security scanner | Automated testing |

### Mobile Testing

| Tool | Description |
|------|-------------|
| **Frida** | Dynamic instrumentation |
| **objection** | Mobile exploration |
| **MobSF** | Static analysis |

---

## Remediation Guide

### 1. Secure Token Storage

```javascript
// Use HttpOnly cookies for token storage (preferred)
// Server sets cookie:
// Set-Cookie: access_token=xxx; HttpOnly; Secure; SameSite=Strict; Path=/

// If client-side storage is needed, use sessionStorage (not localStorage)
// and encrypt sensitive data

class SecureTokenStorage {
    constructor(encryptionKey) {
        this.key = encryptionKey;
    }

    async store(token) {
        // Encrypt before storing
        const encrypted = await this.encrypt(token);
        sessionStorage.setItem('auth_token', encrypted);
    }

    async retrieve() {
        const encrypted = sessionStorage.getItem('auth_token');
        if (!encrypted) return null;
        return await this.decrypt(encrypted);
    }

    clear() {
        sessionStorage.removeItem('auth_token');
    }

    async encrypt(data) {
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(data);

        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(this.key),
            'AES-GCM',
            false,
            ['encrypt']
        );

        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            dataBuffer
        );

        return btoa(String.fromCharCode(...iv) + String.fromCharCode(...new Uint8Array(encrypted)));
    }
}
```

### 2. Proper State Handling

```python
import secrets
import hashlib
from flask import session, redirect, abort

class OAuthStateManager:
    @staticmethod
    def generate_state(nonce=None):
        """Generate secure state parameter"""
        state = secrets.token_urlsafe(32)

        # Store in session with optional nonce
        session['oauth_state'] = {
            'value': hashlib.sha256(state.encode()).hexdigest(),
            'nonce': nonce,
            'created': time.time()
        }

        return state

    @staticmethod
    def validate_state(received_state):
        """Validate state from callback"""
        stored = session.pop('oauth_state', None)

        if not stored:
            return False

        # Check expiration (5 minute max)
        if time.time() - stored['created'] > 300:
            return False

        received_hash = hashlib.sha256(received_state.encode()).hexdigest()
        return secrets.compare_digest(stored['value'], received_hash)

# Usage in callback
@app.route('/oauth/callback')
def oauth_callback():
    state = request.args.get('state')

    if not state or not OAuthStateManager.validate_state(state):
        abort(400, "Invalid state parameter")

    code = request.args.get('code')
    # Exchange code for token
```

### 3. PKCE for Public Clients

```javascript
class PKCEManager {
    static async generateCodeVerifier() {
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        return this.base64URLEncode(array);
    }

    static async generateCodeChallenge(verifier) {
        const encoder = new TextEncoder();
        const data = encoder.encode(verifier);
        const hash = await crypto.subtle.digest('SHA-256', data);
        return this.base64URLEncode(new Uint8Array(hash));
    }

    static base64URLEncode(buffer) {
        return btoa(String.fromCharCode(...buffer))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
    }

    static async initializeAuth() {
        const codeVerifier = await this.generateCodeVerifier();
        const codeChallenge = await this.generateCodeChallenge(codeVerifier);

        // Store verifier in session
        sessionStorage.setItem('code_verifier', codeVerifier);

        return {
            code_challenge: codeChallenge,
            code_challenge_method: 'S256'
        };
    }

    static getCodeVerifier() {
        const verifier = sessionStorage.getItem('code_verifier');
        sessionStorage.removeItem('code_verifier');
        return verifier;
    }
}

// Usage
async function startOAuth() {
    const pkce = await PKCEManager.initializeAuth();

    const authUrl = new URL('https://auth.example.com/authorize');
    authUrl.searchParams.set('client_id', CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('code_challenge', pkce.code_challenge);
    authUrl.searchParams.set('code_challenge_method', pkce.code_challenge_method);

    window.location = authUrl.toString();
}
```

### 4. Secure Redirect Handling

```python
from urllib.parse import urlparse

ALLOWED_REDIRECT_HOSTS = ['example.com', 'www.example.com']

def validate_redirect(redirect_uri):
    """Validate post-login redirect URL"""
    if not redirect_uri:
        return '/'

    # Parse URL
    parsed = urlparse(redirect_uri)

    # Only allow relative URLs or specific hosts
    if parsed.netloc:
        if parsed.netloc not in ALLOWED_REDIRECT_HOSTS:
            return '/'

    # Block javascript: and data: URLs
    if parsed.scheme in ['javascript', 'data', 'vbscript']:
        return '/'

    # Ensure path doesn't start with // (protocol-relative)
    if redirect_uri.startswith('//'):
        return '/'

    return redirect_uri

@app.route('/oauth/callback')
def oauth_callback():
    # ... validate state and exchange code ...

    # Safely handle redirect
    next_url = request.args.get('next', '/')
    safe_redirect = validate_redirect(next_url)

    return redirect(safe_redirect)
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Token in localStorage (XSS accessible) | 6.5 | Medium |
| Missing state validation (CSRF) | 8.8 | High |
| Missing PKCE (public client) | 7.5 | High |
| Open redirect post-auth | 6.1 | Medium |
| Token in URL (referrer leak) | 6.5 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-352** | CSRF | Missing state |
| **CWE-601** | Open Redirect | Unsafe redirects |
| **CWE-922** | Insecure Storage | Token storage |
| **CWE-200** | Information Exposure | Token leakage |

---

## References

- [OAuth 2.0 for Browser-Based Apps](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps)
- [OAuth 2.0 for Native Apps](https://tools.ietf.org/html/rfc8252)
- [PKCE RFC 7636](https://tools.ietf.org/html/rfc7636)
- [OAuth Security Best Practices](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics)

---

## Checklist

```
[ ] OAuth initiation analyzed
[ ] State parameter validated
[ ] PKCE implementation checked
[ ] Token storage analyzed
[ ] Redirect handling tested
[ ] Error handling tested
[ ] Referrer leakage checked
[ ] Logout handling verified
[ ] Mobile-specific issues checked
[ ] XSS impact on tokens assessed
[ ] Findings documented
[ ] Remediation recommendations provided
```
