# WSTG-CONF-08: Test RIA Cross Domain Policy

## Test ID
WSTG-CONF-08

## Test Name
Test RIA Cross Domain Policy

## Status

> **Note**: This test case has been **deprecated** by OWASP as Flash and Silverlight technologies are no longer widely used. However, legacy applications may still use these technologies.

---

## High-Level Description

Rich Internet Application (RIA) cross-domain policy files control how Flash and Silverlight applications can access resources across different domains. Misconfigured policy files can allow unauthorized cross-domain access, leading to data theft and other security issues. While these technologies are largely obsolete, legacy applications may still require this testing.

---

## What to Check

### Policy Files

- [ ] `/crossdomain.xml` (Adobe Flash)
- [ ] `/clientaccesspolicy.xml` (Microsoft Silverlight)
- [ ] Wildcard permissions (`*`)
- [ ] Overly permissive configurations
- [ ] Unnecessary cross-domain access

---

## How to Test

### Step 1: Retrieve Policy Files

```bash
# Check for Flash crossdomain.xml
curl -s https://target.com/crossdomain.xml

# Check for Silverlight clientaccesspolicy.xml
curl -s https://target.com/clientaccesspolicy.xml
```

### Step 2: Analyze crossdomain.xml

```xml
<!-- VULNERABLE - Allows any domain -->
<?xml version="1.0"?>
<!DOCTYPE cross-domain-policy SYSTEM "http://www.adobe.com/xml/dtds/cross-domain-policy.dtd">
<cross-domain-policy>
    <allow-access-from domain="*"/>
</cross-domain-policy>

<!-- SECURE - Specific domains only -->
<?xml version="1.0"?>
<cross-domain-policy>
    <allow-access-from domain="trusted.example.com"/>
    <allow-access-from domain="api.example.com"/>
</cross-domain-policy>
```

### Step 3: Analyze clientaccesspolicy.xml

```xml
<!-- VULNERABLE - Allows any domain -->
<?xml version="1.0" encoding="utf-8"?>
<access-policy>
    <cross-domain-access>
        <policy>
            <allow-from http-request-headers="*">
                <domain uri="*"/>
            </allow-from>
            <grant-to>
                <resource path="/" include-subpaths="true"/>
            </grant-to>
        </policy>
    </cross-domain-access>
</access-policy>

<!-- SECURE - Specific domains only -->
<?xml version="1.0" encoding="utf-8"?>
<access-policy>
    <cross-domain-access>
        <policy>
            <allow-from http-request-headers="SOAPAction">
                <domain uri="https://trusted.example.com"/>
            </allow-from>
            <grant-to>
                <resource path="/api/" include-subpaths="true"/>
            </grant-to>
        </policy>
    </cross-domain-access>
</access-policy>
```

### Step 4: Check for Vulnerable Patterns

```bash
# Check for wildcard in crossdomain.xml
curl -s https://target.com/crossdomain.xml | grep -E 'domain="\*"|domain="\*\.|secure="false"'

# Check for wildcard in clientaccesspolicy.xml
curl -s https://target.com/clientaccesspolicy.xml | grep -E 'uri="\*"|uri="http://'
```

---

## Tools

| Tool | Description | Usage |
|------|-------------|-------|
| **curl** | Retrieve policy files | `curl -s url/crossdomain.xml` |
| **Nikto** | Web scanner | Includes RIA policy checks |
| **Burp Suite** | Proxy | Analyze policy files |

---

## Remediation Guide

### 1. Remove If Not Needed

If Flash/Silverlight are not used, remove policy files:
```bash
rm /var/www/html/crossdomain.xml
rm /var/www/html/clientaccesspolicy.xml
```

### 2. Restrict Access (If Needed)

```xml
<!-- crossdomain.xml - Specific domains only -->
<?xml version="1.0"?>
<cross-domain-policy>
    <site-control permitted-cross-domain-policies="master-only"/>
    <allow-access-from domain="trusted.example.com" secure="true"/>
</cross-domain-policy>
```

### 3. Modern Alternative - Use CORS

Instead of RIA policies, implement proper CORS headers for modern applications:
```
Access-Control-Allow-Origin: https://trusted.example.com
Access-Control-Allow-Methods: GET, POST
Access-Control-Allow-Headers: Content-Type
```

---

## Risk Assessment

### CVSS Score

**Wildcard Cross-Domain Policy**
- **Base Score**: 7.5 (High)
- **Vector**: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-942** | Overly Permissive Cross-domain Whitelist |
| **CWE-346** | Origin Validation Error |

---

## References

- [OWASP Testing Guide](https://owasp.org/www-project-web-security-testing-guide/)
- For modern cross-origin testing, see: **WSTG-CLNT-07: Test Cross Origin Resource Sharing (CORS)**

---

## Checklist

```
[ ] crossdomain.xml checked
[ ] clientaccesspolicy.xml checked
[ ] Wildcard permissions identified
[ ] Overly permissive configs documented
[ ] If RIA not used, recommend removal
[ ] For modern apps, test CORS instead
```
