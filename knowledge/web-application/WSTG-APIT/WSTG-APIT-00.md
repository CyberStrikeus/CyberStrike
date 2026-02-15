# WSTG-APIT-00: API Testing Overview

## Test ID
WSTG-APIT-00

## Test Name
API Testing Overview

## High-Level Description

APIs (Application Programming Interfaces) are the backbone of modern applications, enabling communication between different services, mobile apps, and frontend interfaces. API security testing focuses on identifying vulnerabilities specific to API implementations including authentication, authorization, input validation, and business logic flaws.

---

## API Types

### REST APIs
- HTTP-based, stateless
- Uses standard methods (GET, POST, PUT, DELETE)
- JSON/XML responses
- Resource-based URLs

### GraphQL APIs
- Single endpoint
- Query language for APIs
- Client-specified data retrieval
- Introspection capabilities

### SOAP APIs
- XML-based protocol
- WSDL service descriptions
- Enterprise/legacy systems
- Strict contracts

---

## What to Check

### Authentication & Authorization
- [ ] API key security
- [ ] OAuth implementation
- [ ] JWT validation
- [ ] BOLA (IDOR) vulnerabilities
- [ ] BFLA (Function-level auth)
- [ ] Rate limiting

### Input Validation
- [ ] Injection attacks
- [ ] Mass assignment
- [ ] Parameter tampering
- [ ] Content-type validation

### Data Protection
- [ ] Sensitive data exposure
- [ ] Excessive data exposure
- [ ] Encryption in transit

---

## How to Test

### Step 1: API Discovery

```bash
#!/bin/bash
TARGET="target.com"

# Find API endpoints
# Check common paths
endpoints=(
    "/api"
    "/api/v1"
    "/api/v2"
    "/v1"
    "/graphql"
    "/rest"
    "/swagger.json"
    "/openapi.json"
    "/api-docs"
)

for endpoint in "${endpoints[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://$TARGET$endpoint")
    echo "$endpoint: $status"
done

# Check for API documentation
curl -s "https://$TARGET/swagger.json" | jq '.' 2>/dev/null
curl -s "https://$TARGET/.well-known/openapi.json" | jq '.' 2>/dev/null
```

### Step 2: API Enumeration

```bash
# Use API documentation or fuzzing
# Extract endpoints from:
# - Swagger/OpenAPI specs
# - Mobile app analysis
# - JavaScript source code
# - Proxy traffic

# Fuzz API endpoints
ffuf -u "https://target.com/api/FUZZ" -w api-wordlist.txt -mc 200,201,401,403
```

### Step 3: Authentication Testing

```bash
#!/bin/bash
API="https://target.com/api"

# Test without authentication
curl -s "$API/users" -H "Content-Type: application/json"

# Test with invalid token
curl -s "$API/users" -H "Authorization: Bearer invalid_token"

# Test with expired token
curl -s "$API/users" -H "Authorization: Bearer expired_token"

# Test API key in different locations
curl -s "$API/users?api_key=test"
curl -s "$API/users" -H "X-API-Key: test"
curl -s "$API/users" -H "Authorization: ApiKey test"
```

### Step 4: Basic API Security Checker

```python
#!/usr/bin/env python3
import requests
import json

class APISecurityChecker:
    def __init__(self, base_url, auth_header=None):
        self.base_url = base_url
        self.session = requests.Session()
        if auth_header:
            self.session.headers.update(auth_header)
        self.findings = []

    def check_authentication(self, endpoints):
        """Check authentication requirements"""
        print("[*] Checking authentication...")

        no_auth = requests.Session()

        for endpoint in endpoints:
            url = f"{self.base_url}{endpoint}"

            # Test without auth
            response = no_auth.get(url)
            if response.status_code == 200:
                print(f"[VULN] No auth required: {endpoint}")
                self.findings.append({
                    "issue": f"Missing authentication on {endpoint}",
                    "severity": "High"
                })

    def check_rate_limiting(self, endpoint, requests_count=100):
        """Check for rate limiting"""
        print(f"\n[*] Checking rate limiting on {endpoint}...")

        for i in range(requests_count):
            response = self.session.get(f"{self.base_url}{endpoint}")
            if response.status_code == 429:
                print(f"[OK] Rate limited after {i+1} requests")
                return

        print(f"[WARN] No rate limiting after {requests_count} requests")
        self.findings.append({
            "issue": f"No rate limiting on {endpoint}",
            "severity": "Medium"
        })

    def check_http_methods(self, endpoint):
        """Check allowed HTTP methods"""
        print(f"\n[*] Checking HTTP methods on {endpoint}...")

        methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']
        url = f"{self.base_url}{endpoint}"

        for method in methods:
            response = self.session.request(method, url)
            if response.status_code not in [404, 405]:
                print(f"  {method}: {response.status_code}")

    def check_cors(self, endpoint):
        """Check CORS configuration"""
        print(f"\n[*] Checking CORS on {endpoint}...")

        headers = {"Origin": "https://evil.com"}
        response = self.session.options(
            f"{self.base_url}{endpoint}",
            headers=headers
        )

        acao = response.headers.get('Access-Control-Allow-Origin', '')
        if acao == '*' or acao == 'https://evil.com':
            print(f"[VULN] Permissive CORS: {acao}")
            self.findings.append({
                "issue": "Permissive CORS configuration",
                "severity": "Medium"
            })

    def generate_report(self):
        """Generate API security report"""
        print("\n" + "="*50)
        print("API SECURITY REPORT")
        print("="*50)

        if not self.findings:
            print("\nNo issues found.")
            return

        print(f"\nFindings: {len(self.findings)}")
        for f in self.findings:
            print(f"\n  [{f['severity']}] {f['issue']}")

# Usage
checker = APISecurityChecker(
    "https://target.com/api",
    {"Authorization": "Bearer token"}
)
checker.check_authentication(["/users", "/orders", "/admin"])
checker.check_rate_limiting("/users")
checker.check_http_methods("/users")
checker.check_cors("/users")
checker.generate_report()
```

---

## Tools

| Tool | Description |
|------|-------------|
| **Postman** | API testing and documentation |
| **Burp Suite** | API traffic interception |
| **OWASP ZAP** | Automated API scanning |
| **Insomnia** | API client |
| **GraphQL Voyager** | GraphQL visualization |

---

## OWASP API Security Top 10 (2023)

| ID | Vulnerability |
|----|--------------|
| API1 | Broken Object Level Authorization (BOLA) |
| API2 | Broken Authentication |
| API3 | Broken Object Property Level Authorization |
| API4 | Unrestricted Resource Consumption |
| API5 | Broken Function Level Authorization (BFLA) |
| API6 | Unrestricted Access to Sensitive Business Flows |
| API7 | Server Side Request Forgery (SSRF) |
| API8 | Security Misconfiguration |
| API9 | Improper Inventory Management |
| API10 | Unsafe Consumption of APIs |

---

## References

- [OWASP API Security Project](https://owasp.org/www-project-api-security/)
- [OWASP API Security Top 10](https://owasp.org/API-Security/)

---

## Checklist

```
[ ] API endpoints discovered
[ ] Authentication tested
[ ] Authorization tested
[ ] Input validation tested
[ ] Rate limiting checked
[ ] CORS configuration reviewed
[ ] Error handling analyzed
[ ] Findings documented
```
