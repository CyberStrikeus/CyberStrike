# WSTG-APIT-01: API Reconnaissance

## Test ID
WSTG-APIT-01

## Test Name
API Reconnaissance

## High-Level Description

API reconnaissance involves discovering and documenting all available API endpoints, understanding their functionality, and identifying potential attack surfaces. This includes finding undocumented endpoints, deprecated versions, and understanding the API structure.

---

## What to Check

- [ ] Public API documentation
- [ ] Hidden/undocumented endpoints
- [ ] API versions
- [ ] Authentication mechanisms
- [ ] Rate limiting
- [ ] Response formats
- [ ] Error messages

---

## How to Test

### Step 1: Documentation Discovery

```bash
#!/bin/bash
TARGET="target.com"

# Common API documentation paths
docs=(
    "/swagger.json"
    "/swagger/v1/swagger.json"
    "/api-docs"
    "/api/docs"
    "/openapi.json"
    "/openapi/v3/api-docs"
    "/.well-known/openapi.json"
    "/api/swagger"
    "/docs/api"
    "/redoc"
    "/graphql"
)

for doc in "${docs[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://$TARGET$doc")
    if [ "$status" != "404" ]; then
        echo "[FOUND] $doc: $status"
    fi
done
```

### Step 2: Endpoint Enumeration

```bash
#!/bin/bash
TARGET="https://target.com/api"

# Fuzz for endpoints
ffuf -u "$TARGET/FUZZ" \
    -w /usr/share/wordlists/seclists/Discovery/Web-Content/api/api-endpoints.txt \
    -mc 200,201,204,301,302,401,403 \
    -o api-endpoints.json

# Version enumeration
for v in v1 v2 v3 v4; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "$TARGET/$v/users")
    echo "/api/$v/users: $status"
done
```

### Step 3: Parameter Discovery

```bash
# Extract parameters from JS files
curl -s "https://target.com/main.js" | grep -oP '["'"'"'][a-zA-Z_]+["'"'"']\s*:' | sort -u

# Extract API endpoints from JS
curl -s "https://target.com/main.js" | grep -oP '/api/[a-zA-Z0-9/_-]+' | sort -u
```

### Step 4: API Recon Script

```python
#!/usr/bin/env python3
import requests
import re
import json

class APIRecon:
    def __init__(self, base_url):
        self.base_url = base_url.rstrip('/')
        self.session = requests.Session()
        self.endpoints = set()
        self.findings = []

    def find_documentation(self):
        """Find API documentation"""
        print("[*] Looking for API documentation...")

        doc_paths = [
            "/swagger.json", "/swagger/v1/swagger.json",
            "/openapi.json", "/api-docs", "/api/swagger.json",
            "/v2/api-docs", "/v3/api-docs"
        ]

        for path in doc_paths:
            try:
                response = self.session.get(f"{self.base_url}{path}", timeout=5)
                if response.status_code == 200:
                    print(f"[FOUND] {path}")
                    try:
                        doc = response.json()
                        self._extract_from_swagger(doc)
                    except:
                        pass
            except:
                pass

    def _extract_from_swagger(self, doc):
        """Extract endpoints from Swagger/OpenAPI doc"""
        paths = doc.get('paths', {})
        for path, methods in paths.items():
            for method in methods.keys():
                if method in ['get', 'post', 'put', 'delete', 'patch']:
                    self.endpoints.add((method.upper(), path))
                    print(f"  {method.upper()} {path}")

    def enumerate_versions(self):
        """Find API versions"""
        print("\n[*] Enumerating API versions...")

        versions = ['v1', 'v2', 'v3', 'v4', 'v1.0', 'v2.0', 'api/v1', 'api/v2']
        test_endpoints = ['/users', '/health', '/status', '/info']

        for version in versions:
            for endpoint in test_endpoints:
                url = f"{self.base_url}/{version}{endpoint}"
                try:
                    response = self.session.get(url, timeout=3)
                    if response.status_code not in [404]:
                        print(f"[FOUND] {url}: {response.status_code}")
                except:
                    pass

    def analyze_responses(self, endpoints):
        """Analyze API responses for information"""
        print("\n[*] Analyzing API responses...")

        for method, path in endpoints:
            url = f"{self.base_url}{path}"
            try:
                if method == 'GET':
                    response = self.session.get(url, timeout=5)
                else:
                    response = self.session.request(method, url, json={}, timeout=5)

                # Check response headers
                server = response.headers.get('Server', 'Unknown')
                content_type = response.headers.get('Content-Type', 'Unknown')

                print(f"\n{method} {path}")
                print(f"  Status: {response.status_code}")
                print(f"  Server: {server}")

                # Check for sensitive info in error messages
                if response.status_code >= 400:
                    self._check_error_disclosure(response.text)

            except Exception as e:
                pass

    def _check_error_disclosure(self, response_text):
        """Check for information disclosure in errors"""
        sensitive_patterns = [
            r'stack trace', r'exception', r'sql', r'database',
            r'internal server', r'debug'
        ]

        for pattern in sensitive_patterns:
            if re.search(pattern, response_text, re.I):
                print(f"  [WARN] Potential info disclosure: {pattern}")

    def generate_report(self):
        """Generate recon report"""
        print("\n" + "="*50)
        print("API RECONNAISSANCE REPORT")
        print("="*50)
        print(f"\nEndpoints discovered: {len(self.endpoints)}")

        for method, path in sorted(self.endpoints):
            print(f"  {method} {path}")

# Usage
recon = APIRecon("https://target.com")
recon.find_documentation()
recon.enumerate_versions()
recon.analyze_responses([('GET', '/api/users'), ('GET', '/api/status')])
recon.generate_report()
```

---

## Tools

| Tool | Description |
|------|-------------|
| **ffuf** | API endpoint fuzzing |
| **Arjun** | Parameter discovery |
| **Kiterunner** | API endpoint discovery |
| **Postman** | API documentation |

---

## Checklist

```
[ ] API documentation found
[ ] Endpoints enumerated
[ ] Versions discovered
[ ] Parameters identified
[ ] Authentication analyzed
[ ] Findings documented
```
