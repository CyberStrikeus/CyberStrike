# WSTG-INFO-06: Identify Application Entry Points

## Test ID
WSTG-INFO-06

## Test Name
Identify Application Entry Points

## High-Level Description

Entry points are the interfaces through which user-supplied data enters the application. Identifying all entry points is critical for mapping the application's attack surface before conducting targeted security tests. Entry points include URL parameters, POST body data, HTTP headers, cookies, file uploads, and any other mechanism that accepts user input. A comprehensive understanding of entry points allows penetration testers to systematically test each input vector for vulnerabilities such as injection, access control bypasses, and business logic flaws.

---

## What to Check

### Entry Point Categories

- [ ] URL query string parameters (GET)
- [ ] POST body parameters
- [ ] HTTP headers (custom and standard)
- [ ] Cookies and session tokens
- [ ] Hidden form fields
- [ ] File upload fields
- [ ] RESTful URL path parameters
- [ ] JSON/XML request bodies
- [ ] WebSocket messages
- [ ] GraphQL queries
- [ ] SOAP envelopes

### Information to Document

- [ ] Parameter names and locations
- [ ] Data types (string, integer, boolean, etc.)
- [ ] Accepted value ranges
- [ ] Required vs optional parameters
- [ ] Authentication requirements
- [ ] Multi-step process flows
- [ ] State-dependent parameters
- [ ] Encoding schemes used

---

## How to Test

### Step 1: Configure Proxy and Browse Application

#### Burp Suite Setup

1. Configure browser to use Burp proxy (127.0.0.1:8080)
2. Enable interception or passive logging
3. Add target to scope
4. Browse all application functionality
5. Review Site Map for discovered endpoints

#### OWASP ZAP Setup

1. Launch ZAP and configure browser proxy
2. Enable HUD or traditional interface
3. Add target URL to context
4. Spider the application
5. Review Sites tree for entry points

### Step 2: Analyze GET Requests

```http
GET /app/search?query=test&category=all&page=1&sort=desc HTTP/1.1
Host: target.com
Cookie: session=abc123; preference=dark
User-Agent: Mozilla/5.0
Referer: https://target.com/home
X-Requested-With: XMLHttpRequest
```

#### Entry Points in GET Request

| Location | Parameter | Value |
|----------|-----------|-------|
| Query String | query | test |
| Query String | category | all |
| Query String | page | 1 |
| Query String | sort | desc |
| Cookie | session | abc123 |
| Cookie | preference | dark |
| Header | User-Agent | Mozilla/5.0 |
| Header | Referer | https://... |
| Header | X-Requested-With | XMLHttpRequest |

### Step 3: Analyze POST Requests

```http
POST /app/checkout HTTP/1.1
Host: target.com
Content-Type: application/x-www-form-urlencoded
Cookie: session=abc123

product_id=100&quantity=2&price=50.00&discount_code=SAVE10&shipping=express
```

#### Entry Points in POST Request

| Location | Parameter | Value | Notes |
|----------|-----------|-------|-------|
| Body | product_id | 100 | Potential IDOR |
| Body | quantity | 2 | Integer manipulation |
| Body | price | 50.00 | Price tampering |
| Body | discount_code | SAVE10 | Brute-force target |
| Body | shipping | express | Business logic |

### Step 4: Analyze JSON/API Requests

```http
POST /api/v1/users HTTP/1.1
Host: target.com
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1...
X-API-Key: abcd1234

{
    "username": "newuser",
    "email": "user@example.com",
    "role": "user",
    "permissions": ["read", "write"],
    "metadata": {
        "source": "web",
        "version": "2.0"
    }
}
```

#### Entry Points in JSON Request

| Location | Parameter | Path | Type |
|----------|-----------|------|------|
| Header | Authorization | - | JWT Token |
| Header | X-API-Key | - | API Key |
| Body | username | $.username | String |
| Body | email | $.email | Email |
| Body | role | $.role | Enum |
| Body | permissions | $.permissions[] | Array |
| Body | source | $.metadata.source | Nested |

### Step 5: Analyze RESTful URL Patterns

```
GET /api/users/123/orders/456/items
```

#### URL Path Parameters

| Segment | Type | Description |
|---------|------|-------------|
| users | Resource | User collection |
| 123 | ID Parameter | User ID (IDOR test) |
| orders | Resource | Orders collection |
| 456 | ID Parameter | Order ID (IDOR test) |
| items | Resource | Items sub-resource |

### Step 6: Analyze Response Headers

```http
HTTP/1.1 200 OK
Server: nginx/1.18.0
Set-Cookie: session=newvalue; HttpOnly; Secure
Set-Cookie: tracking=xyz; Path=/
X-Request-ID: req-12345
X-Debug-Mode: enabled
Cache-Control: no-cache
Content-Type: application/json
```

#### Notable Response Elements

| Header | Value | Security Note |
|--------|-------|---------------|
| Server | nginx/1.18.0 | Version disclosure |
| Set-Cookie | session=... | Session management |
| X-Debug-Mode | enabled | Debug info leak |
| X-Request-ID | req-12345 | Tracking identifier |

### Step 7: Document Hidden Form Fields

```html
<form action="/checkout" method="POST">
    <input type="hidden" name="csrf_token" value="abc123">
    <input type="hidden" name="user_id" value="500">
    <input type="hidden" name="base_price" value="100.00">
    <input type="hidden" name="is_admin" value="false">
    <input type="text" name="quantity" value="1">
    <button type="submit">Purchase</button>
</form>
```

#### Hidden Field Analysis

| Field | Value | Risk |
|-------|-------|------|
| csrf_token | abc123 | Token strength |
| user_id | 500 | IDOR vulnerability |
| base_price | 100.00 | Price manipulation |
| is_admin | false | Privilege escalation |

### Step 8: Map Multi-Step Processes

Document workflows that require multiple requests:

```
1. GET /cart → View cart
2. POST /cart/apply-coupon → Apply discount
3. GET /checkout → Checkout page
4. POST /checkout/address → Submit address
5. POST /checkout/payment → Submit payment
6. POST /checkout/confirm → Confirm order
```

#### Process Flow Entry Points

| Step | Method | Key Parameters | State |
|------|--------|----------------|-------|
| 1 | GET | - | Unauthenticated |
| 2 | POST | coupon_code | Cart active |
| 3 | GET | - | Authenticated |
| 4 | POST | address_id, new_address | Cart active |
| 5 | POST | card_token, save_card | Address set |
| 6 | POST | confirm_token | Payment ready |

### Step 9: Identify WebSocket Endpoints

```javascript
// Browser DevTools > Network > WS
ws://target.com/socket
wss://target.com/secure-socket

// WebSocket message format
{"action": "subscribe", "channel": "orders", "user_id": 123}
```

### Step 10: Document GraphQL Entry Points

```graphql
# GraphQL query entry points
query {
    user(id: 123) {
        name
        email
        orders {
            id
            total
        }
    }
}

mutation {
    updateUser(id: 123, role: "admin") {
        success
    }
}
```

---

## Tools

### Proxy Tools

| Tool | Description | Key Feature |
|------|-------------|-------------|
| **Burp Suite** | Web proxy | Site map, parameter extraction |
| **OWASP ZAP** | Open-source proxy | Automated spider, HUD |
| **Fiddler** | Traffic inspector | .NET integration |
| **mitmproxy** | CLI proxy | Scriptable interception |
| **Charles Proxy** | macOS proxy | SSL proxying |

### Automated Discovery

| Tool | Description | Usage |
|------|-------------|-------|
| **Attack Surface Detector** | Source code analysis | `java -jar asd.jar <source>` |
| **Param Miner** | Burp extension | Hidden parameter discovery |
| **Arjun** | Parameter finder | `arjun -u https://target.com` |
| **x8** | Hidden parameter discovery | `x8 -u https://target.com` |
| **ParamSpider** | Parameter extraction | `paramspider -d target.com` |

### API Analysis

| Tool | Description |
|------|-------------|
| **Postman** | API testing |
| **Insomnia** | REST/GraphQL client |
| **GraphQL Voyager** | Schema visualization |
| **Swagger UI** | OpenAPI testing |

---

## Example Commands/Payloads

### Burp Suite Entry Point Extraction

1. Navigate to Target > Site map
2. Right-click target > Engagement tools > Analyze target
3. Review "Entry points" section
4. Export parameters: Target > Site map > Right-click > Copy URLs

### Arjun - Hidden Parameter Discovery

```bash
# Install
pip3 install arjun

# Basic scan
arjun -u https://target.com/page

# With wordlist
arjun -u https://target.com/page -w params.txt

# JSON body parameters
arjun -u https://target.com/api -m POST -c 'Content-Type: application/json'

# Multiple URLs
arjun -i urls.txt -o results.json
```

### ParamSpider - URL Parameter Extraction

```bash
# Install
git clone https://github.com/devanshbatham/paramspider
cd paramspider
pip3 install -r requirements.txt

# Basic usage
python3 paramspider.py -d target.com

# Exclude specific parameters
python3 paramspider.py -d target.com -e js,css,png

# Output to file
python3 paramspider.py -d target.com -o params.txt
```

### x8 - Hidden Parameter Discovery

```bash
# Install (Rust required)
cargo install x8

# Basic scan
x8 -u https://target.com/page -w params.txt

# With method and body
x8 -u https://target.com/api -X POST -b '{"test":"value"}'
```

### Custom Entry Point Documentation Script

```bash
#!/bin/bash
# Extract entry points from Burp Suite export

INPUT_FILE=$1
OUTPUT_FILE="entry_points.csv"

echo "URL,Method,Parameter,Location,Type" > $OUTPUT_FILE

# Parse URLs for GET parameters
grep -oP 'https?://[^\s]+' $INPUT_FILE | while read url; do
    # Extract query parameters
    echo "$url" | grep -oP '\?[^#]+' | tr '&' '\n' | while read param; do
        name=$(echo $param | cut -d= -f1 | tr -d '?')
        echo "$url,GET,$name,Query String,Unknown" >> $OUTPUT_FILE
    done
done

echo "Entry points saved to $OUTPUT_FILE"
```

### Entry Point Documentation Template

```markdown
## Endpoint: /api/users/{id}

### Request
- **Method**: PUT
- **Authentication**: Required (Bearer token)
- **Content-Type**: application/json

### Parameters

| Name | Location | Type | Required | Description |
|------|----------|------|----------|-------------|
| id | URL Path | Integer | Yes | User ID |
| Authorization | Header | String | Yes | JWT Token |
| name | Body | String | No | Display name |
| email | Body | String | No | Email address |
| role | Body | Enum | No | user/admin |

### Example Request
```json
PUT /api/users/123
Authorization: Bearer eyJ...
Content-Type: application/json

{
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user"
}
```

### Test Cases
- [ ] IDOR: Try accessing other user IDs
- [ ] Privilege escalation: Change role to admin
- [ ] SQL injection in path parameter
- [ ] Mass assignment via role field
```

---

## Remediation Guide

### 1. Input Validation

```python
# Server-side validation example
def validate_user_input(data):
    schema = {
        'username': {'type': 'string', 'minlength': 3, 'maxlength': 50},
        'email': {'type': 'string', 'regex': r'^[^@]+@[^@]+\.[^@]+$'},
        'age': {'type': 'integer', 'min': 0, 'max': 150},
        'role': {'type': 'string', 'allowed': ['user', 'moderator']}
    }
    # Validate against schema
    return validate(data, schema)
```

### 2. Minimize Exposed Parameters

```html
<!-- BAD: Exposing sensitive data -->
<input type="hidden" name="price" value="100.00">
<input type="hidden" name="is_admin" value="false">

<!-- GOOD: Server-side price lookup -->
<input type="hidden" name="product_id" value="SKU123">
<!-- Price calculated server-side based on product_id -->
```

### 3. Implement Proper Access Controls

```python
# Check ownership before processing
def update_order(request, order_id):
    order = Order.objects.get(id=order_id)
    if order.user_id != request.user.id:
        return HttpResponseForbidden()
    # Process update
```

### 4. Use Security Headers

```
Set-Cookie: session=value; HttpOnly; Secure; SameSite=Strict
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Content-Security-Policy: default-src 'self'
```

### 5. Rate Limiting

```nginx
# nginx rate limiting
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

server {
    location /api/ {
        limit_req zone=api burst=20 nodelay;
    }
}
```

### 6. Monitor Reconnaissance Activity

- Log all 404 errors and unusual parameter patterns
- Alert on parameter fuzzing signatures
- Implement honeypot parameters

---

## Risk Assessment

### CVSS Score

This is a **reconnaissance/enumeration activity**, not a direct vulnerability. The CVSS score depends on what is discovered:

**Entry Point Mapping (Info)**
- Base Score: 0.0 (Informational)
- This is a testing methodology, not a finding

**Excessive Entry Points (Observation)**
- Wide attack surface may indicate architectural concerns
- Recommend minimizing unnecessary parameters

### Attack Surface Indicators

| Observation | Risk Level | Implication |
|-------------|------------|-------------|
| < 20 parameters | Low | Minimal attack surface |
| 20-50 parameters | Medium | Moderate attack surface |
| 50-100 parameters | High | Large attack surface |
| > 100 parameters | Critical | Extensive testing required |

---

## CWE Categories

| CWE ID | Title | Relevance |
|--------|-------|-----------|
| **CWE-20** | Improper Input Validation | Entry points require validation |
| **CWE-284** | Improper Access Control | Entry point authorization |
| **CWE-639** | Authorization Bypass Through User-Controlled Key | ID parameters in paths |
| **CWE-352** | Cross-Site Request Forgery | Form entry points |

---

## References

### OWASP References
- [OWASP WSTG - Identify Application Entry Points](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/06-Identify_Application_Entry_Points)
- [OWASP Attack Surface Analysis Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Attack_Surface_Analysis_Cheat_Sheet.html)

### Tools
- [Burp Suite](https://portswigger.net/burp)
- [OWASP ZAP](https://www.zaproxy.org/)
- [Arjun](https://github.com/s0md3v/Arjun)
- [ParamSpider](https://github.com/devanshbatham/paramspider)

### Additional Resources
- [Attack Surface Detector](https://github.com/secdec/attack-surface-detector-cli)
- [Param Miner (Burp Extension)](https://portswigger.net/bappstore/17d2949a985c4b7ca092728dba871943)

---

## Checklist

```
[ ] Proxy configured and traffic captured
[ ] All GET parameters documented
[ ] All POST parameters documented
[ ] Hidden form fields identified
[ ] Cookie parameters noted
[ ] Custom headers recorded
[ ] RESTful path parameters mapped
[ ] JSON/XML body parameters extracted
[ ] File upload fields identified
[ ] WebSocket endpoints documented
[ ] GraphQL queries analyzed
[ ] Multi-step processes mapped
[ ] Authentication requirements noted
[ ] Parameter data types identified
[ ] Required vs optional parameters distinguished
[ ] Response headers analyzed
[ ] Entry point spreadsheet/document created
[ ] Attack surface summary prepared
```
