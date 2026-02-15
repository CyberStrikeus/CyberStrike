# WSTG-CONF-07: Test HTTP Strict Transport Security

## Test ID
WSTG-CONF-07

## Test Name
Test HTTP Strict Transport Security (HSTS)

## High-Level Description

HTTP Strict Transport Security (HSTS) is a security mechanism that forces browsers to communicate with websites only over HTTPS. When properly implemented, HSTS protects against protocol downgrade attacks, SSL stripping, and cookie hijacking. This test verifies that the HSTS header is present, properly configured, and includes appropriate directives.

---

## What to Check

### HSTS Header Directives

| Directive | Description | Recommended |
|-----------|-------------|-------------|
| `max-age` | Time in seconds to enforce HTTPS | >= 31536000 (1 year) |
| `includeSubDomains` | Apply HSTS to all subdomains | Yes |
| `preload` | Include in browser preload lists | Recommended |

### Verification Points

- [ ] HSTS header present on HTTPS responses
- [ ] max-age value is sufficiently long
- [ ] includeSubDomains directive present
- [ ] preload directive present (optional)
- [ ] Header not sent over HTTP
- [ ] All subdomains support HTTPS (if includeSubDomains)

---

## How to Test

### Step 1: Check HSTS Header

```bash
# Check for HSTS header
curl -sI https://target.com | grep -i strict-transport-security

# Full header analysis
curl -sI https://target.com | grep -iE 'strict-transport|content-security|x-frame|x-content'

# Check specific values
curl -sI https://target.com | grep -i strict-transport-security | \
    grep -oP 'max-age=\d+'
```

### Step 2: Verify Header Values

```bash
#!/bin/bash
TARGET=$1

echo "=== HSTS ANALYSIS ==="
echo "Target: $TARGET"

# Get HSTS header
hsts=$(curl -sI "https://$TARGET" | grep -i "strict-transport-security" | tr -d '\r')

if [ -z "$hsts" ]; then
    echo "[FAIL] HSTS header not present!"
    exit 1
fi

echo "Header: $hsts"

# Check max-age
max_age=$(echo "$hsts" | grep -oP 'max-age=\K\d+')
if [ -z "$max_age" ]; then
    echo "[FAIL] max-age not specified"
elif [ "$max_age" -lt 31536000 ]; then
    echo "[WARN] max-age is less than 1 year ($max_age seconds)"
else
    echo "[PASS] max-age: $max_age seconds"
fi

# Check includeSubDomains
if echo "$hsts" | grep -qi "includesubdomains"; then
    echo "[PASS] includeSubDomains present"
else
    echo "[WARN] includeSubDomains not present"
fi

# Check preload
if echo "$hsts" | grep -qi "preload"; then
    echo "[PASS] preload directive present"
else
    echo "[INFO] preload not present (optional)"
fi
```

### Step 3: Verify HTTP Redirect

```bash
# Check that HTTP redirects to HTTPS
curl -sI http://target.com | head -10

# Should return 301/302 redirect to HTTPS
# HSTS header should NOT be sent over HTTP
curl -sI http://target.com | grep -i strict-transport
```

### Step 4: Test Subdomain Coverage

```bash
# If includeSubDomains is set, verify all subdomains support HTTPS
subdomains=("www" "api" "mail" "app" "admin")

for sub in "${subdomains[@]}"; do
    host="${sub}.target.com"
    echo "=== $host ==="

    # Check HTTPS works
    https_status=$(curl -s -o /dev/null -w "%{http_code}" "https://$host" 2>/dev/null)
    echo "HTTPS Status: $https_status"

    # Check HSTS on subdomain
    curl -sI "https://$host" 2>/dev/null | grep -i strict-transport
done
```

### Step 5: Check Preload Status

```bash
# Check if domain is in HSTS preload list
# Visit: https://hstspreload.org/?domain=target.com

# Or use API
curl -s "https://hstspreload.org/api/v2/status?domain=target.com" | jq
```

### Step 6: Browser Testing

1. Open browser DevTools (F12)
2. Go to Network tab
3. Visit https://target.com
4. Check Response Headers for `Strict-Transport-Security`
5. Try visiting http://target.com - should auto-redirect

---

## Tools

### Command-Line

| Tool | Description | Usage |
|------|-------------|-------|
| **curl** | HTTP client | `curl -sI https://target.com` |
| **testssl.sh** | SSL/TLS tester | `testssl.sh --hsts target.com` |
| **sslyze** | SSL analyzer | `sslyze --hsts target.com` |

### Online Tools

| Tool | URL | Purpose |
|------|-----|---------|
| SSL Labs | ssllabs.com/ssltest | Comprehensive SSL test |
| HSTS Preload | hstspreload.org | Preload list check |
| Security Headers | securityheaders.com | Header analysis |

---

## Example Commands/Payloads

### testssl.sh HSTS Check

```bash
# Install testssl.sh
git clone https://github.com/drwetter/testssl.sh.git

# Run HSTS check
./testssl.sh --hsts target.com

# Full test
./testssl.sh target.com
```

### sslyze HSTS Check

```bash
# Install
pip install sslyze

# Run scan
sslyze --hsts target.com
```

### Nuclei HSTS Template

```bash
# Check for missing HSTS
nuclei -u https://target.com -t http/misconfiguration/http-missing-security-headers.yaml
```

---

## Remediation Guide

### 1. Implement HSTS Header

#### Apache

```apache
# In httpd.conf or .htaccess
<IfModule mod_headers.c>
    Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
</IfModule>
```

#### Nginx

```nginx
# In server block
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
```

#### IIS (web.config)

```xml
<system.webServer>
    <httpProtocol>
        <customHeaders>
            <add name="Strict-Transport-Security" value="max-age=31536000; includeSubDomains; preload" />
        </customHeaders>
    </httpProtocol>
</system.webServer>
```

### 2. HSTS Preload Submission

1. Ensure HSTS header includes `preload` directive
2. Ensure `includeSubDomains` is present
3. Ensure `max-age` is at least 31536000 (1 year)
4. Ensure HTTP redirects to HTTPS on same host
5. Submit at https://hstspreload.org

### 3. Implementation Steps

1. Start with short max-age (e.g., 300) for testing
2. Verify all resources load over HTTPS
3. Gradually increase max-age
4. Add includeSubDomains (ensure all subdomains support HTTPS)
5. Add preload directive
6. Submit to preload list

### 4. Common Issues

- Mixed content (HTTP resources on HTTPS page)
- Subdomains without HTTPS support
- Certificate errors on subdomains
- HSTS sent over HTTP (should only be HTTPS)

---

## Risk Assessment

### CVSS Score

**Missing HSTS**
- **Base Score**: 5.9 (Medium)
- **Vector**: CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:N/A:N

| Metric | Value | Description |
|--------|-------|-------------|
| Attack Vector | Network | Remote attack |
| Attack Complexity | High | Requires MITM position |
| Privileges Required | None | No auth needed |
| User Interaction | Required | User visits site |
| Confidentiality | High | Session hijacking possible |

### Severity Levels

| Finding | Severity | Description |
|---------|----------|-------------|
| HSTS not implemented | Medium | SSL stripping possible |
| Low max-age value | Low | Reduced protection window |
| Missing includeSubDomains | Low | Subdomain attacks possible |
| Not in preload list | Info | First visit vulnerable |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-319** | Cleartext Transmission of Sensitive Information | Missing encryption enforcement |
| **CWE-523** | Unprotected Transport of Credentials | Credential exposure risk |
| **CWE-16** | Configuration | Security misconfiguration |

---

## References

- [OWASP WSTG - Test HTTP Strict Transport Security](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/07-Test_HTTP_Strict_Transport_Security)
- [OWASP HSTS Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.html)
- [RFC 6797 - HSTS](https://tools.ietf.org/html/rfc6797)
- [HSTS Preload List](https://hstspreload.org/)

---

## Checklist

```
[ ] HSTS header checked on HTTPS response
[ ] max-age value verified (>= 31536000)
[ ] includeSubDomains directive checked
[ ] preload directive checked
[ ] HTTP to HTTPS redirect verified
[ ] HSTS not sent over HTTP
[ ] Subdomain HTTPS support verified
[ ] Preload list status checked
[ ] Mixed content issues checked
[ ] Browser testing completed
[ ] Findings documented
```
