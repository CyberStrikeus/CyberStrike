# WSTG-SESS-03: Testing for Session Fixation

## Test ID
WSTG-SESS-03

## Test Name
Testing for Session Fixation

## High-Level Description

Session fixation is an attack where the attacker sets a user's session ID to a known value. When the victim authenticates, the attacker can hijack their session using the pre-set session ID. This occurs when the application doesn't regenerate the session ID after authentication, allowing the attacker to maintain access with the original session token.

---

## What to Check

- [ ] Session ID regeneration on login
- [ ] Session ID regeneration on privilege change
- [ ] Session ID acceptance from URL
- [ ] Session ID acceptance from POST data
- [ ] Cross-subdomain session fixation
- [ ] Session adoption after authentication

---

## How to Test

### Step 1: Pre-Authentication Session Test

```bash
#!/bin/bash
# Test if session ID changes after authentication

TARGET="https://target.com"

# Get pre-auth session
echo "=== Getting pre-auth session ==="
pre_session=$(curl -s -c - "$TARGET/" | grep -oP "SESSIONID=\K[^;]+")
echo "Pre-auth session: $pre_session"

# Authenticate with the same session
echo -e "\n=== Authenticating ==="
post_response=$(curl -s -c - -b "SESSIONID=$pre_session" \
    -X POST "$TARGET/login" \
    -d "username=testuser&password=testpass")

post_session=$(echo "$post_response" | grep -oP "SESSIONID=\K[^;]+")
echo "Post-auth session: $post_session"

# Compare
if [ -z "$post_session" ]; then
    # Session might be in cookie jar, check again
    post_session=$(curl -s -c - -b "SESSIONID=$pre_session" "$TARGET/dashboard" | \
        grep -oP "SESSIONID=\K[^;]+")
fi

if [ "$pre_session" == "$post_session" ]; then
    echo -e "\n[VULN] Session fixation - ID not regenerated after login!"
else
    echo -e "\n[OK] Session ID regenerated after login"
fi
```

### Step 2: Test Session ID in URL

```bash
#!/bin/bash
# Test if application accepts session ID from URL

TARGET="https://target.com"
ATTACKER_SESSION="attacker_controlled_session_id"

# Try to set session via URL
urls=(
    "$TARGET/?SESSIONID=$ATTACKER_SESSION"
    "$TARGET/?jsessionid=$ATTACKER_SESSION"
    "$TARGET/;jsessionid=$ATTACKER_SESSION"
    "$TARGET/login?session_id=$ATTACKER_SESSION"
)

for url in "${urls[@]}"; do
    response=$(curl -s -c - "$url")
    cookies=$(echo "$response" | grep -i "sessionid\|jsessionid")

    if echo "$cookies" | grep -q "$ATTACKER_SESSION"; then
        echo "[VULN] Session accepted from URL: $url"
    fi
done
```

### Step 3: Test Cross-Subdomain Fixation

```bash
#!/bin/bash
# Test cross-subdomain session fixation

MAIN_DOMAIN="target.com"
SUBDOMAIN="sub.target.com"

# Get session from subdomain
sub_session=$(curl -s -c - "https://$SUBDOMAIN/" | grep -oP "SESSIONID=\K[^;]+")
echo "Subdomain session: $sub_session"

# Check if session works on main domain
response=$(curl -s -b "SESSIONID=$sub_session" "https://$MAIN_DOMAIN/dashboard")

if echo "$response" | grep -qi "authenticated\|dashboard"; then
    echo "[VULN] Cross-subdomain session sharing detected"
fi
```

### Step 4: Session Fixation Attack Simulation

```python
#!/usr/bin/env python3
import requests
import time

class SessionFixationTester:
    def __init__(self, base_url):
        self.base_url = base_url
        self.attacker_session = None
        self.findings = []

    def test_basic_fixation(self, login_endpoint, credentials):
        """Test basic session fixation vulnerability"""
        print("[*] Testing basic session fixation...")

        # Step 1: Attacker gets a session
        attacker = requests.Session()
        attacker.get(self.base_url)

        # Get attacker's session ID
        for cookie in attacker.cookies:
            if 'session' in cookie.name.lower():
                self.attacker_session = cookie.value
                print(f"[*] Attacker session: {self.attacker_session[:20]}...")
                break

        if not self.attacker_session:
            print("[!] No session cookie found")
            return

        # Step 2: Simulate victim using attacker's session
        victim = requests.Session()
        victim.cookies.set('SESSIONID', self.attacker_session)

        # Step 3: Victim authenticates
        login_response = victim.post(
            f"{self.base_url}{login_endpoint}",
            data=credentials
        )

        # Step 4: Get victim's post-auth session
        victim_post_session = None
        for cookie in victim.cookies:
            if 'session' in cookie.name.lower():
                victim_post_session = cookie.value
                break

        # Step 5: Check if session changed
        if victim_post_session == self.attacker_session:
            print("[VULN] Session fixation vulnerability!")
            print("       Session ID not regenerated after login")
            self.findings.append({
                "type": "session_fixation",
                "severity": "High",
                "description": "Session ID unchanged after authentication"
            })

            # Step 6: Verify attacker can access victim's session
            self._verify_session_hijack()

        else:
            print("[OK] Session regenerated after login")
            print(f"     New session: {victim_post_session[:20]}...")

        return self.findings

    def _verify_session_hijack(self):
        """Verify attacker can hijack the fixed session"""
        print("[*] Verifying session hijacking...")

        attacker_test = requests.Session()
        attacker_test.cookies.set('SESSIONID', self.attacker_session)

        response = attacker_test.get(f"{self.base_url}/dashboard")

        if response.status_code == 200 and 'login' not in response.url.lower():
            print("[VULN] Attacker can access authenticated session!")
            self.findings.append({
                "type": "session_hijack_verified",
                "severity": "Critical",
                "description": "Attacker successfully hijacked authenticated session"
            })
        else:
            print("[INFO] Session hijack not verified")

    def test_url_session(self):
        """Test session ID in URL"""
        print("\n[*] Testing session ID in URL...")

        test_session = "attacker_session_12345"

        url_patterns = [
            f"{self.base_url}/?SESSIONID={test_session}",
            f"{self.base_url}/?jsessionid={test_session}",
            f"{self.base_url}/;jsessionid={test_session}",
            f"{self.base_url}/?PHPSESSID={test_session}",
        ]

        for url in url_patterns:
            try:
                session = requests.Session()
                response = session.get(url)

                for cookie in session.cookies:
                    if test_session in cookie.value:
                        print(f"[VULN] Session accepted from URL: {url}")
                        self.findings.append({
                            "type": "url_session",
                            "severity": "High",
                            "url": url
                        })
                        break

            except Exception as e:
                pass

        return self.findings

    def test_privilege_escalation_fixation(self, escalation_endpoint):
        """Test session regeneration on privilege change"""
        print("\n[*] Testing session on privilege change...")

        session = requests.Session()
        session.get(self.base_url)

        pre_session = None
        for cookie in session.cookies:
            if 'session' in cookie.name.lower():
                pre_session = cookie.value
                break

        # Trigger privilege change
        session.post(f"{self.base_url}{escalation_endpoint}")

        post_session = None
        for cookie in session.cookies:
            if 'session' in cookie.name.lower():
                post_session = cookie.value
                break

        if pre_session == post_session:
            print("[VULN] Session not regenerated on privilege change")
            self.findings.append({
                "type": "privilege_fixation",
                "severity": "Medium",
                "description": "Session unchanged after privilege change"
            })

        return self.findings

# Usage
tester = SessionFixationTester("https://target.com")
tester.test_basic_fixation("/login", {"username": "test", "password": "test"})
tester.test_url_session()
```

---

## Tools

| Tool | Description | Usage |
|------|-------------|-------|
| **Burp Suite** | Session analysis | Compare pre/post auth sessions |
| **OWASP ZAP** | Automated testing | Session fixation scanner |
| **Browser DevTools** | Cookie monitoring | Observe session changes |

---

## Remediation Guide

### 1. Session Regeneration on Login

```python
from flask import session
import secrets

@app.route('/login', methods=['POST'])
def login():
    username = request.form['username']
    password = request.form['password']

    if authenticate(username, password):
        # CRITICAL: Regenerate session ID after authentication
        session.clear()
        session.regenerate()  # Or create new session

        # Set authenticated user
        session['user_id'] = user.id
        session['authenticated'] = True

        return redirect('/dashboard')

    return render_template('login.html', error='Invalid credentials')

# Flask-Login example
from flask_login import login_user

@app.route('/login', methods=['POST'])
def login():
    if authenticate(username, password):
        # flask-login regenerates session by default
        login_user(user)
        return redirect('/dashboard')
```

### 2. Express.js Session Regeneration

```javascript
app.post('/login', (req, res) => {
    authenticate(req.body.username, req.body.password, (err, user) => {
        if (user) {
            // Regenerate session ID
            req.session.regenerate((err) => {
                if (err) {
                    return res.status(500).send('Session error');
                }

                req.session.userId = user.id;
                req.session.authenticated = true;

                res.redirect('/dashboard');
            });
        } else {
            res.render('login', { error: 'Invalid credentials' });
        }
    });
});
```

### 3. Java/Spring Session Regeneration

```java
@PostMapping("/login")
public String login(HttpServletRequest request, @RequestParam String username,
                    @RequestParam String password) {

    if (authenticate(username, password)) {
        // Invalidate old session
        HttpSession oldSession = request.getSession(false);
        if (oldSession != null) {
            oldSession.invalidate();
        }

        // Create new session
        HttpSession newSession = request.getSession(true);
        newSession.setAttribute("userId", user.getId());
        newSession.setAttribute("authenticated", true);

        return "redirect:/dashboard";
    }

    return "login";
}
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Session fixation (no regeneration) | 8.8 | High |
| Session ID accepted from URL | 7.5 | High |
| Cross-subdomain fixation | 6.5 | Medium |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-384** | Session Fixation |
| **CWE-472** | External Control of Web Service Cookie |

---

## References

- [OWASP Session Fixation](https://owasp.org/www-community/attacks/Session_fixation)
- [OWASP WSTG - Session Fixation](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/06-Session_Management_Testing/03-Testing_for_Session_Fixation)

---

## Checklist

```
[ ] Pre-auth session ID captured
[ ] Post-auth session ID compared
[ ] Session regeneration on login verified
[ ] URL-based session tested
[ ] Cross-subdomain fixation tested
[ ] Privilege change regeneration tested
[ ] Findings documented
[ ] Remediation recommendations provided
```
