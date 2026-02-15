# WSTG-CONF-06: Test HTTP Methods

## Test ID
WSTG-CONF-06

## Test Name
Test HTTP Methods

## High-Level Description

HTTP methods define the type of action to be performed on a resource. While GET and POST are commonly used, other methods like PUT, DELETE, TRACE, and OPTIONS may be enabled and exploitable. This test identifies which HTTP methods are supported by the web server and checks for potential security issues such as arbitrary file upload (PUT), file deletion (DELETE), cross-site tracing (TRACE), and access control bypasses.

---

## What to Check

### HTTP Methods to Test

| Method | Purpose | Security Risk |
|--------|---------|---------------|
| GET | Retrieve resource | Authorization bypass |
| POST | Submit data | Authorization bypass |
| HEAD | Get headers only | Auth bypass, info disclosure |
| PUT | Upload/create resource | Arbitrary file upload |
| DELETE | Remove resource | Arbitrary file deletion |
| OPTIONS | List supported methods | Information disclosure |
| TRACE | Echo request (debug) | Cross-Site Tracing (XST) |
| CONNECT | TCP tunnel | Proxy abuse |
| PATCH | Partial modification | Data manipulation |

### Additional Checks

- [ ] Method override headers
- [ ] Access control per method
- [ ] Arbitrary method handling
- [ ] WebDAV methods (PROPFIND, COPY, MOVE, etc.)

---

## How to Test

### Step 1: Discover Supported Methods (OPTIONS)

```bash
# Send OPTIONS request
curl -X OPTIONS -I https://target.com/

# Check Allow header
curl -X OPTIONS -sI https://target.com/ | grep -i "allow"

# Example response:
# Allow: GET, HEAD, POST, OPTIONS
```

### Step 2: Test Each Method

```bash
# Test all methods
methods=("GET" "POST" "HEAD" "PUT" "DELETE" "OPTIONS"
         "TRACE" "CONNECT" "PATCH" "PROPFIND" "PROPPATCH"
         "MKCOL" "COPY" "MOVE" "LOCK" "UNLOCK")

for method in "${methods[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" -X $method https://target.com/)
    echo "$method: $status"
done
```

### Step 3: Test PUT Method (File Upload)

```bash
# Test PUT for file upload
curl -X PUT https://target.com/test.txt -d "test content"
curl -X PUT https://target.com/test.html -d "<h1>Test</h1>"
curl -X PUT https://target.com/test.php -d "<?php phpinfo(); ?>"

# Check if file was created
curl -s https://target.com/test.txt
curl -s https://target.com/test.html
curl -s https://target.com/test.php

# WebDAV PUT
curl -X PUT https://target.com/test.txt \
    -H "Content-Type: text/plain" \
    -d "test content"
```

### Step 4: Test DELETE Method

```bash
# Test DELETE (use non-critical path!)
curl -X DELETE https://target.com/test.txt -v

# Check response
# 200/204 = Successful deletion (CRITICAL!)
# 405 = Method not allowed (expected)
# 403 = Forbidden (access control working)
```

### Step 5: Test TRACE Method (XST)

```bash
# Test TRACE
curl -X TRACE https://target.com/ -v

# TRACE should echo the request back
# If enabled, can be used for XST attacks to steal cookies

# Check response
# 200 with request echo = Vulnerable
# 405 = Method disabled (secure)
```

### Step 6: Test Access Control Bypass

```bash
# Test protected page with different methods
protected_url="https://target.com/admin/"

# Normal request (may redirect to login)
curl -sI "$protected_url"

# Try different methods
for method in HEAD POST PUT OPTIONS PATCH; do
    echo "=== $method ==="
    curl -s -o /dev/null -w "%{http_code}" -X $method "$protected_url"
done

# Try arbitrary method
curl -s -o /dev/null -w "%{http_code}" -X FAKE "$protected_url"
curl -s -o /dev/null -w "%{http_code}" -X FOO "$protected_url"
```

### Step 7: Test Method Override Headers

```bash
# Method override through headers
# If PUT returns 405, try override

# X-HTTP-Method-Override
curl -X POST https://target.com/resource \
    -H "X-HTTP-Method-Override: PUT" \
    -d "content=test"

# X-HTTP-Method
curl -X POST https://target.com/resource \
    -H "X-HTTP-Method: DELETE"

# X-Method-Override
curl -X POST https://target.com/resource \
    -H "X-Method-Override: PUT"

# _method parameter (Rails, Laravel)
curl -X POST https://target.com/resource \
    -d "_method=DELETE"
```

### Step 8: Test WebDAV Methods

```bash
# WebDAV specific methods
# PROPFIND - Get properties
curl -X PROPFIND https://target.com/ \
    -H "Depth: 1" \
    -H "Content-Type: application/xml" \
    -d '<?xml version="1.0"?><propfind xmlns="DAV:"><allprop/></propfind>'

# MKCOL - Create directory
curl -X MKCOL https://target.com/newdir/

# COPY - Copy resource
curl -X COPY https://target.com/file.txt \
    -H "Destination: https://target.com/file_copy.txt"

# MOVE - Move resource
curl -X MOVE https://target.com/file.txt \
    -H "Destination: https://target.com/moved_file.txt"
```

### Step 9: Nmap HTTP Methods Script

```bash
# Nmap script for HTTP methods
nmap -p 80,443 --script http-methods target.com

# With URL path
nmap -p 80,443 --script http-methods --script-args http-methods.url-path='/admin/' target.com

# Detailed output
nmap -p 80,443 --script http-methods --script-args http-methods.test-all=true target.com
```

---

## Tools

### Command-Line Tools

| Tool | Description | Usage |
|------|-------------|-------|
| **curl** | HTTP client | `curl -X METHOD url` |
| **Nmap** | NSE scripts | `nmap --script http-methods` |
| **Netcat** | Raw requests | Manual HTTP crafting |

### Web Proxies

| Tool | Description |
|------|-------------|
| **Burp Suite** | Repeater for method testing |
| **OWASP ZAP** | Request editor |
| **mitmproxy** | Scripted testing |

### Scanners

| Tool | Description |
|------|-------------|
| **Nikto** | Web server scanner |
| **Nessus** | Vulnerability scanner |

---

## Example Commands/Payloads

### Comprehensive HTTP Methods Test Script

```bash
#!/bin/bash
TARGET=$1
PATH_TO_TEST=${2:-"/"}

echo "=== HTTP METHODS TEST ==="
echo "Target: $TARGET$PATH_TO_TEST"
echo ""

# Standard methods
echo "[+] Testing standard methods..."
methods=("GET" "POST" "HEAD" "PUT" "DELETE" "OPTIONS" "TRACE" "PATCH")

for method in "${methods[@]}"; do
    response=$(curl -s -o /dev/null -w "%{http_code}" -X $method "https://$TARGET$PATH_TO_TEST")
    echo "  $method: $response"

    # Flag potentially dangerous enabled methods
    if [ "$method" == "PUT" ] && [ "$response" != "405" ] && [ "$response" != "501" ]; then
        echo "    [!] WARNING: PUT may be enabled!"
    fi
    if [ "$method" == "DELETE" ] && [ "$response" != "405" ] && [ "$response" != "501" ]; then
        echo "    [!] WARNING: DELETE may be enabled!"
    fi
    if [ "$method" == "TRACE" ] && [ "$response" == "200" ]; then
        echo "    [!] WARNING: TRACE is enabled (XST risk)!"
    fi
done

# WebDAV methods
echo ""
echo "[+] Testing WebDAV methods..."
webdav=("PROPFIND" "PROPPATCH" "MKCOL" "COPY" "MOVE" "LOCK" "UNLOCK")

for method in "${webdav[@]}"; do
    response=$(curl -s -o /dev/null -w "%{http_code}" -X $method "https://$TARGET$PATH_TO_TEST")
    if [ "$response" != "405" ] && [ "$response" != "501" ]; then
        echo "  $method: $response [!] May be enabled!"
    fi
done

# Test arbitrary method
echo ""
echo "[+] Testing arbitrary method handling..."
response=$(curl -s -o /dev/null -w "%{http_code}" -X FOOBAR "https://$TARGET$PATH_TO_TEST")
echo "  FOOBAR: $response"
if [ "$response" == "200" ]; then
    echo "    [!] WARNING: Server accepts arbitrary methods!"
fi

# Test method override
echo ""
echo "[+] Testing method override headers..."
for header in "X-HTTP-Method-Override" "X-HTTP-Method" "X-Method-Override"; do
    response=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
        -H "$header: PUT" "https://$TARGET$PATH_TO_TEST")
    echo "  POST with $header: PUT -> $response"
done

echo ""
echo "[+] Test complete"
```

### PUT File Upload Test

```bash
#!/bin/bash
TARGET=$1
UPLOAD_PATH="/test_upload_$(date +%s).txt"

echo "[+] Testing PUT file upload to $TARGET$UPLOAD_PATH"

# Attempt upload
response=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
    "https://$TARGET$UPLOAD_PATH" \
    -H "Content-Type: text/plain" \
    -d "PUT upload test - $(date)")

echo "PUT Response: $response"

if [ "$response" == "201" ] || [ "$response" == "200" ] || [ "$response" == "204" ]; then
    echo "[!] CRITICAL: PUT upload successful!"

    # Verify file exists
    verify=$(curl -s -o /dev/null -w "%{http_code}" "https://$TARGET$UPLOAD_PATH")
    if [ "$verify" == "200" ]; then
        echo "[!] File confirmed accessible at $UPLOAD_PATH"
        echo "[!] Attempting cleanup..."
        curl -X DELETE "https://$TARGET$UPLOAD_PATH"
    fi
else
    echo "[+] PUT upload not allowed (secure)"
fi
```

---

## Remediation Guide

### 1. Disable Unnecessary Methods

#### Apache

```apache
# Allow only GET, POST, HEAD
<Directory />
    <LimitExcept GET POST HEAD>
        Require all denied
    </LimitExcept>
</Directory>

# Disable TRACE
TraceEnable Off
```

#### Nginx

```nginx
# Allow only specific methods
if ($request_method !~ ^(GET|POST|HEAD)$) {
    return 405;
}
```

#### IIS (web.config)

```xml
<system.webServer>
    <security>
        <requestFiltering>
            <verbs>
                <add verb="PUT" allowed="false" />
                <add verb="DELETE" allowed="false" />
                <add verb="TRACE" allowed="false" />
                <add verb="OPTIONS" allowed="false" />
            </verbs>
        </requestFiltering>
    </security>
</system.webServer>
```

### 2. Disable WebDAV (if not needed)

```apache
# Apache - disable WebDAV module
# Remove or comment out:
# LoadModule dav_module modules/mod_dav.so
# LoadModule dav_fs_module modules/mod_dav_fs.so
```

### 3. Consistent Access Control

```python
# Apply same authorization for all methods
@app.route('/resource', methods=['GET', 'POST', 'PUT', 'DELETE'])
@require_authentication
def resource():
    # Authorization applied to all methods
    pass
```

### 4. Disable Method Override

```python
# Django - don't use X-HTTP-Method-Override middleware
# Remove: 'django.middleware.http.MethodOverrideMiddleware'
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| PUT enabled (file upload) | 9.8 | Critical |
| DELETE enabled | 8.1 | High |
| TRACE enabled | 5.3 | Medium |
| Auth bypass via method | 8.8 | High |
| WebDAV enabled | 7.5 | High |

**PUT Enabled Vector**: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-749** | Exposed Dangerous Method | Dangerous HTTP methods enabled |
| **CWE-650** | Trusting HTTP Permission Methods | Insufficient method authorization |
| **CWE-434** | Unrestricted Upload of File | PUT file upload |

---

## References

- [OWASP WSTG - Test HTTP Methods](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/06-Test_HTTP_Methods)
- [RFC 7231 - HTTP/1.1 Semantics](https://tools.ietf.org/html/rfc7231)

---

## Checklist

```
[ ] OPTIONS request sent to enumerate methods
[ ] GET method tested
[ ] POST method tested
[ ] HEAD method tested
[ ] PUT method tested (file upload)
[ ] DELETE method tested
[ ] TRACE method tested
[ ] PATCH method tested
[ ] WebDAV methods tested (PROPFIND, etc.)
[ ] Arbitrary method tested (FOOBAR)
[ ] Method override headers tested
[ ] Access control per method verified
[ ] Dangerous methods documented
[ ] Risk assessment completed
```
