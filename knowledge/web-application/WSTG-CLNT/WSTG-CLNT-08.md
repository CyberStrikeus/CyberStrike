# WSTG-CLNT-08: Testing for Cross-Site Flashing

## Test ID
WSTG-CLNT-08

## Test Name
Testing for Cross-Site Flashing

## High-Level Description

Cross-Site Flashing (XSF) vulnerabilities occur in Flash/SWF applications when user input is improperly handled. Although Flash is deprecated, legacy applications may still use it. Similar vulnerabilities can exist in other rich media technologies.

---

## What to Check

- [ ] Flash files on target site
- [ ] crossdomain.xml configuration
- [ ] External data loading in SWF
- [ ] User input in Flash parameters
- [ ] Legacy rich media content

---

## How to Test

### Step 1: Find Flash Content

```bash
#!/bin/bash
TARGET="target.com"

# Find SWF files
curl -s "https://$TARGET" | grep -oP '[^"]+\.swf'

# Check crossdomain.xml
curl -s "https://$TARGET/crossdomain.xml"

# Common paths
paths=("/crossdomain.xml" "/clientaccesspolicy.xml" "/flash/crossdomain.xml")
for path in "${paths[@]}"; do
    curl -s "https://$TARGET$path"
done
```

### Step 2: Analyze crossdomain.xml

```xml
<!-- Vulnerable configuration -->
<?xml version="1.0"?>
<cross-domain-policy>
    <allow-access-from domain="*"/>  <!-- VULNERABLE -->
</cross-domain-policy>

<!-- Secure configuration -->
<?xml version="1.0"?>
<cross-domain-policy>
    <allow-access-from domain="trusted.com"/>
    <allow-access-from domain="*.trusted.com"/>
</cross-domain-policy>
```

---

## Remediation

```xml
<!-- Restrict cross-domain access -->
<?xml version="1.0"?>
<!DOCTYPE cross-domain-policy SYSTEM "http://www.adobe.com/xml/dtds/cross-domain-policy.dtd">
<cross-domain-policy>
    <site-control permitted-cross-domain-policies="master-only"/>
    <allow-access-from domain="www.trusted.com" secure="true"/>
</cross-domain-policy>
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| Wildcard crossdomain.xml | 5.3 | Medium |
| XSF vulnerability | 6.1 | Medium |

---

## Checklist

```
[ ] Flash files identified
[ ] crossdomain.xml analyzed
[ ] SWF parameters tested
[ ] clientaccesspolicy.xml checked
[ ] Findings documented
```
