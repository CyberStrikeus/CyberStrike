# WSTG-CLNT-12: Testing Browser Storage

## Test ID
WSTG-CLNT-12

## Test Name
Testing Browser Storage

## High-Level Description

Browser storage mechanisms (localStorage, sessionStorage, IndexedDB, cookies) can store sensitive data client-side. Vulnerabilities occur when sensitive information is stored insecurely, accessible to XSS attacks, or persists longer than necessary. Testing ensures proper data protection and lifecycle management.

---

## What to Check

- [ ] Sensitive data in localStorage
- [ ] Sensitive data in sessionStorage
- [ ] IndexedDB data exposure
- [ ] Cookie security attributes
- [ ] Data persistence and cleanup
- [ ] Access control to stored data

---

## How to Test

### Step 1: Enumerate Browser Storage

```javascript
// Browser console - Enumerate all storage

// Check localStorage
console.log("=== localStorage ===");
for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const value = localStorage.getItem(key);
    console.log(`${key}: ${value.substring(0, 100)}...`);
}

// Check sessionStorage
console.log("\n=== sessionStorage ===");
for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    const value = sessionStorage.getItem(key);
    console.log(`${key}: ${value.substring(0, 100)}...`);
}

// Check cookies
console.log("\n=== Cookies ===");
document.cookie.split(';').forEach(cookie => {
    console.log(cookie.trim());
});

// Check IndexedDB databases
console.log("\n=== IndexedDB ===");
indexedDB.databases().then(dbs => {
    dbs.forEach(db => console.log(`Database: ${db.name}`));
});
```

### Step 2: Storage Security Analyzer

```python
#!/usr/bin/env python3
"""
Browser Storage Security Analyzer
Uses Selenium to analyze client-side storage
"""

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
import json
import time

class BrowserStorageTester:
    def __init__(self, url):
        self.url = url
        self.findings = []
        self.setup_browser()

    def setup_browser(self):
        """Setup headless Chrome"""
        options = Options()
        options.add_argument('--headless')
        options.add_argument('--no-sandbox')
        self.driver = webdriver.Chrome(options=options)

    def analyze_storage(self):
        """Analyze all browser storage"""
        print(f"[*] Analyzing storage for {self.url}")
        self.driver.get(self.url)
        time.sleep(3)  # Wait for page load

        # Get localStorage
        local_storage = self.driver.execute_script("""
            let items = {};
            for (let i = 0; i < localStorage.length; i++) {
                let key = localStorage.key(i);
                items[key] = localStorage.getItem(key);
            }
            return items;
        """)

        # Get sessionStorage
        session_storage = self.driver.execute_script("""
            let items = {};
            for (let i = 0; i < sessionStorage.length; i++) {
                let key = sessionStorage.key(i);
                items[key] = sessionStorage.getItem(key);
            }
            return items;
        """)

        # Get cookies
        cookies = self.driver.get_cookies()

        return {
            'localStorage': local_storage,
            'sessionStorage': session_storage,
            'cookies': cookies
        }

    def check_sensitive_data(self, storage_data):
        """Check for sensitive data patterns"""
        print("\n[*] Checking for sensitive data...")

        sensitive_patterns = [
            ('password', 'Password'),
            ('token', 'Authentication Token'),
            ('api_key', 'API Key'),
            ('apikey', 'API Key'),
            ('secret', 'Secret'),
            ('credit', 'Credit Card'),
            ('ssn', 'Social Security'),
            ('session', 'Session Data'),
            ('auth', 'Authentication Data'),
            ('bearer', 'Bearer Token'),
            ('jwt', 'JWT Token'),
            ('private', 'Private Data'),
        ]

        # Check localStorage
        for key, value in storage_data.get('localStorage', {}).items():
            for pattern, description in sensitive_patterns:
                if pattern.lower() in key.lower() or pattern.lower() in str(value).lower():
                    print(f"[VULN] Sensitive data in localStorage: {key}")
                    self.findings.append({
                        "location": "localStorage",
                        "key": key,
                        "issue": f"Potential {description} exposed",
                        "severity": "High"
                    })

        # Check sessionStorage
        for key, value in storage_data.get('sessionStorage', {}).items():
            for pattern, description in sensitive_patterns:
                if pattern.lower() in key.lower() or pattern.lower() in str(value).lower():
                    print(f"[WARN] Sensitive data in sessionStorage: {key}")
                    self.findings.append({
                        "location": "sessionStorage",
                        "key": key,
                        "issue": f"Potential {description} exposed",
                        "severity": "Medium"
                    })

        # Check cookies
        for cookie in storage_data.get('cookies', []):
            name = cookie.get('name', '')
            for pattern, description in sensitive_patterns:
                if pattern.lower() in name.lower():
                    if not cookie.get('httpOnly'):
                        print(f"[VULN] Sensitive cookie without HttpOnly: {name}")
                        self.findings.append({
                            "location": "cookie",
                            "key": name,
                            "issue": f"{description} cookie without HttpOnly",
                            "severity": "High"
                        })
                    if not cookie.get('secure'):
                        print(f"[VULN] Sensitive cookie without Secure: {name}")
                        self.findings.append({
                            "location": "cookie",
                            "key": name,
                            "issue": f"{description} cookie without Secure flag",
                            "severity": "Medium"
                        })

    def check_cookie_attributes(self, storage_data):
        """Check cookie security attributes"""
        print("\n[*] Checking cookie attributes...")

        for cookie in storage_data.get('cookies', []):
            name = cookie.get('name', '')
            issues = []

            if not cookie.get('httpOnly'):
                issues.append("Missing HttpOnly")
            if not cookie.get('secure'):
                issues.append("Missing Secure")
            if cookie.get('sameSite', '').lower() not in ['strict', 'lax']:
                issues.append("Missing/Weak SameSite")

            if issues:
                print(f"[WARN] Cookie '{name}': {', '.join(issues)}")
                for issue in issues:
                    self.findings.append({
                        "location": "cookie",
                        "key": name,
                        "issue": issue,
                        "severity": "Medium" if "HttpOnly" in issue else "Low"
                    })

    def test_xss_access(self):
        """Test if XSS could access storage"""
        print("\n[*] Testing XSS accessibility to storage...")

        # Execute XSS-like script to test access
        result = self.driver.execute_script("""
            let accessible = {
                localStorage: false,
                sessionStorage: false,
                cookies: false
            };

            try {
                localStorage.setItem('xss_test', 'test');
                localStorage.removeItem('xss_test');
                accessible.localStorage = true;
            } catch(e) {}

            try {
                sessionStorage.setItem('xss_test', 'test');
                sessionStorage.removeItem('xss_test');
                accessible.sessionStorage = true;
            } catch(e) {}

            try {
                accessible.cookies = document.cookie.length > 0 || true;
            } catch(e) {}

            return accessible;
        """)

        print(f"  localStorage accessible via JS: {result.get('localStorage')}")
        print(f"  sessionStorage accessible via JS: {result.get('sessionStorage')}")
        print(f"  Cookies accessible via JS: {result.get('cookies')}")

        return result

    def generate_report(self):
        """Generate security report"""
        print("\n" + "="*50)
        print("BROWSER STORAGE SECURITY REPORT")
        print("="*50)

        if not self.findings:
            print("\nNo significant issues found.")
        else:
            high = [f for f in self.findings if f['severity'] == 'High']
            medium = [f for f in self.findings if f['severity'] == 'Medium']
            low = [f for f in self.findings if f['severity'] == 'Low']

            if high:
                print(f"\n[HIGH SEVERITY] ({len(high)} issues)")
                for f in high:
                    print(f"  - {f['location']}/{f['key']}: {f['issue']}")

            if medium:
                print(f"\n[MEDIUM SEVERITY] ({len(medium)} issues)")
                for f in medium:
                    print(f"  - {f['location']}/{f['key']}: {f['issue']}")

            if low:
                print(f"\n[LOW SEVERITY] ({len(low)} issues)")
                for f in low:
                    print(f"  - {f['location']}/{f['key']}: {f['issue']}")

    def run_tests(self):
        """Run all tests"""
        try:
            storage_data = self.analyze_storage()

            print("\n[*] Storage Contents:")
            print(f"  localStorage entries: {len(storage_data.get('localStorage', {}))}")
            print(f"  sessionStorage entries: {len(storage_data.get('sessionStorage', {}))}")
            print(f"  Cookies: {len(storage_data.get('cookies', []))}")

            self.check_sensitive_data(storage_data)
            self.check_cookie_attributes(storage_data)
            self.test_xss_access()
            self.generate_report()
        finally:
            self.driver.quit()

# Usage
tester = BrowserStorageTester("https://target.com")
tester.run_tests()
```

### Step 3: IndexedDB Analysis

```javascript
// Analyze IndexedDB contents
async function analyzeIndexedDB() {
    const databases = await indexedDB.databases();

    for (const dbInfo of databases) {
        console.log(`\n=== Database: ${dbInfo.name} ===`);

        const request = indexedDB.open(dbInfo.name);

        request.onsuccess = function(event) {
            const db = event.target.result;
            const storeNames = db.objectStoreNames;

            console.log('Object Stores:', Array.from(storeNames));

            for (const storeName of storeNames) {
                const transaction = db.transaction(storeName, 'readonly');
                const store = transaction.objectStore(storeName);
                const getAllRequest = store.getAll();

                getAllRequest.onsuccess = function() {
                    console.log(`\nStore: ${storeName}`);
                    console.log('Records:', getAllRequest.result.length);

                    // Check for sensitive data
                    getAllRequest.result.forEach((record, i) => {
                        const str = JSON.stringify(record);
                        if (str.match(/password|token|secret|key|auth/i)) {
                            console.log(`[!] Potential sensitive data in record ${i}`);
                        }
                    });
                };
            }
        };
    }
}

analyzeIndexedDB();
```

### Step 4: Cookie Analysis Script

```bash
#!/bin/bash
TARGET="https://target.com"

# Fetch and analyze cookies
echo "[*] Analyzing cookies for $TARGET"

curl -sI "$TARGET" | grep -i "set-cookie" | while read -r line; do
    echo ""
    echo "Cookie: $line"

    # Check security attributes
    if ! echo "$line" | grep -qi "httponly"; then
        echo "  [!] Missing HttpOnly"
    fi

    if ! echo "$line" | grep -qi "secure"; then
        echo "  [!] Missing Secure"
    fi

    if ! echo "$line" | grep -qi "samesite"; then
        echo "  [!] Missing SameSite"
    fi
done
```

---

## Tools

| Tool | Purpose |
|------|---------|
| Browser DevTools (Application tab) | View all storage |
| EditThisCookie | Cookie editor extension |
| Selenium/Puppeteer | Automated storage analysis |
| Burp Suite | Cookie analysis |

---

## Remediation

```javascript
// SECURE: Don't store sensitive data in localStorage
// Use server-side sessions instead

// If client storage is needed, encrypt sensitive data
class SecureStorage {
    constructor(encryptionKey) {
        this.key = encryptionKey;
    }

    async encrypt(data) {
        const encoder = new TextEncoder();
        const encodedData = encoder.encode(JSON.stringify(data));

        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            encoder.encode(this.key),
            { name: 'AES-GCM' },
            false,
            ['encrypt']
        );

        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            cryptoKey,
            encodedData
        );

        return {
            iv: Array.from(iv),
            data: Array.from(new Uint8Array(encrypted))
        };
    }

    async setItem(key, value) {
        const encrypted = await this.encrypt(value);
        sessionStorage.setItem(key, JSON.stringify(encrypted));
    }
}

// SECURE: Set proper cookie attributes
// Server-side (Python/Flask)
from flask import make_response

@app.route('/login', methods=['POST'])
def login():
    response = make_response(redirect('/dashboard'))
    response.set_cookie(
        'session_id',
        value=generate_session_id(),
        secure=True,        # HTTPS only
        httponly=True,      # No JavaScript access
        samesite='Strict',  # No cross-site requests
        max_age=3600,       # 1 hour expiry
        path='/',
        domain='.example.com'
    )
    return response

// SECURE: Clear storage on logout
function secureLogout() {
    // Clear all storage
    localStorage.clear();
    sessionStorage.clear();

    // Clear IndexedDB
    indexedDB.databases().then(dbs => {
        dbs.forEach(db => indexedDB.deleteDatabase(db.name));
    });

    // Clear cookies (server should also invalidate)
    document.cookie.split(';').forEach(cookie => {
        const name = cookie.split('=')[0].trim();
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    });

    // Redirect to login
    window.location.href = '/login';
}
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| Credentials in localStorage | 7.5 | High |
| Session token in localStorage | 7.5 | High |
| Sensitive cookie without HttpOnly | 6.1 | Medium |
| Missing Secure flag on sensitive cookie | 5.3 | Medium |
| PII in browser storage | 5.3 | Medium |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-922** | Insecure Storage of Sensitive Information |
| **CWE-312** | Cleartext Storage of Sensitive Information |
| **CWE-1004** | Sensitive Cookie Without 'HttpOnly' Flag |
| **CWE-614** | Sensitive Cookie in HTTPS Session Without 'Secure' Attribute |

---

## References

- [OWASP Testing Guide - Browser Storage](https://owasp.org/www-project-web-security-testing-guide/)
- [MDN - Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)
- [MDN - IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)

---

## Checklist

```
[ ] localStorage analyzed
[ ] sessionStorage analyzed
[ ] IndexedDB databases enumerated
[ ] Cookie attributes checked
[ ] Sensitive data patterns searched
[ ] XSS accessibility tested
[ ] Data persistence after logout tested
[ ] Findings documented
```
