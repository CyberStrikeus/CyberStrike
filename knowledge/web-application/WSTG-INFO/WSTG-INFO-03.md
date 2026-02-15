# WSTG-INFO-03: Review Webserver Metafiles for Information Leakage

## Test ID
WSTG-INFO-03

## Test Name
Review Webserver Metafiles for Information Leakage

## High-Level Description

Web servers contain various metafiles that can inadvertently expose sensitive information about the application structure, hidden directories, restricted areas, and internal configurations. Files such as `robots.txt`, `sitemap.xml`, `security.txt`, and META tags are often overlooked but can provide attackers with valuable reconnaissance data. This test involves systematically reviewing these metafiles to identify information leakage and potential attack vectors.

---

## What to Check

### Metafiles to Examine

- [ ] `robots.txt` - Spider/crawler directives
- [ ] `sitemap.xml` - Site structure mapping
- [ ] `sitemap_index.xml` - Sitemap index files
- [ ] `security.txt` - Security policy disclosure
- [ ] `humans.txt` - Team/contributor information
- [ ] `crossdomain.xml` - Flash cross-domain policy
- [ ] `clientaccesspolicy.xml` - Silverlight policy
- [ ] `.well-known/` directory contents
- [ ] HTML META tags - Robot directives
- [ ] Open Graph and Twitter Card metadata
- [ ] `ads.txt` - Authorized digital sellers
- [ ] `app-ads.txt` - Mobile app advertising
- [ ] `assetlinks.json` - Android app links
- [ ] `apple-app-site-association` - iOS app links

### Information to Identify

- [ ] Hidden or restricted directories
- [ ] Administrative panels and login pages
- [ ] API endpoints
- [ ] Backup directories
- [ ] Development/staging paths
- [ ] Internal IP addresses
- [ ] Technology stack indicators
- [ ] Team member names and roles
- [ ] Security contact information
- [ ] PGP/GPG keys

---

## How to Test

### Step 1: Retrieve and Analyze robots.txt

```bash
# Download robots.txt
curl -s https://target.com/robots.txt

# Save to file
curl -s https://target.com/robots.txt -o robots.txt

# Check for multiple user-agent sections
curl -s https://target.com/robots.txt | grep -i "user-agent\|disallow\|allow\|sitemap"
```

#### robots.txt Directives to Analyze

| Directive | Purpose | Example |
|-----------|---------|---------|
| `User-agent` | Specifies which bot | `User-agent: *` |
| `Disallow` | Paths to exclude | `Disallow: /admin/` |
| `Allow` | Explicitly allowed paths | `Allow: /public/` |
| `Sitemap` | Sitemap location | `Sitemap: /sitemap.xml` |
| `Crawl-delay` | Delay between requests | `Crawl-delay: 10` |

#### Common Sensitive Paths in robots.txt

```
/admin/
/administrator/
/backup/
/config/
/database/
/db/
/dev/
/internal/
/login/
/logs/
/private/
/secret/
/staging/
/test/
/tmp/
/upload/
/uploads/
/wp-admin/
/api/
/cgi-bin/
```

### Step 2: Analyze Sitemaps

```bash
# Get main sitemap
curl -s https://target.com/sitemap.xml | xmllint --format -

# Check common sitemap locations
for path in sitemap.xml sitemap_index.xml sitemap1.xml sitemaps/sitemap.xml; do
    echo "=== $path ==="
    curl -s "https://target.com/$path" | head -20
done

# Extract all URLs from sitemap
curl -s https://target.com/sitemap.xml | grep -oP '(?<=<loc>)[^<]+'

# Find nested sitemaps
curl -s https://target.com/sitemap.xml | grep -i "sitemap"
```

#### Sitemap Types

| Type | Purpose |
|------|---------|
| `sitemap.xml` | Main page listing |
| `sitemap_index.xml` | Index of multiple sitemaps |
| `video-sitemap.xml` | Video content |
| `image-sitemap.xml` | Image content |
| `news-sitemap.xml` | News articles |

### Step 3: Check security.txt

```bash
# RFC 9116 compliant location
curl -s https://target.com/.well-known/security.txt

# Alternative location
curl -s https://target.com/security.txt

# Extract useful information
curl -s https://target.com/.well-known/security.txt | grep -i "contact\|encryption\|policy\|hiring\|acknowledgments"
```

#### security.txt Fields

| Field | Description |
|-------|-------------|
| `Contact` | Security team contact |
| `Encryption` | PGP key location |
| `Acknowledgments` | Hall of fame page |
| `Policy` | Disclosure policy URL |
| `Hiring` | Security jobs page |
| `Expires` | File expiration date |
| `Preferred-Languages` | Preferred languages |

### Step 4: Examine humans.txt

```bash
# Get humans.txt
curl -s https://target.com/humans.txt

# Look for names and roles
curl -s https://target.com/humans.txt | grep -i "team\|developer\|designer\|lead\|manager"
```

### Step 5: Scan .well-known Directory

```bash
# Common .well-known files
for file in \
    security.txt \
    openid-configuration \
    assetlinks.json \
    apple-app-site-association \
    change-password \
    dnt-policy.txt \
    host-meta \
    host-meta.json \
    mta-sts.txt \
    nodeinfo \
    webfinger \
    matrix/client \
    matrix/server \
    acme-challenge \
    pki-validation \
    traffic-advice; do
    echo "=== .well-known/$file ==="
    curl -s "https://target.com/.well-known/$file" | head -10
done
```

### Step 6: Analyze HTML META Tags

```bash
# Get page source and extract META tags
curl -s https://target.com | grep -i "<meta"

# Look for robot directives
curl -s https://target.com | grep -i "name=\"robots\""

# Extract Open Graph data
curl -s https://target.com | grep -i "og:"

# Find generator information
curl -s https://target.com | grep -i "generator"
```

#### META Tag Analysis

```html
<!-- Robot directives -->
<meta name="robots" content="noindex, nofollow">
<meta name="googlebot" content="noindex">

<!-- Generator (CMS info) -->
<meta name="generator" content="WordPress 6.0">

<!-- Technology indicators -->
<meta name="csrf-token" content="...">
<meta name="viewport" content="...">
```

### Step 7: Check Additional Metafiles

```bash
# Cross-domain policy files
curl -s https://target.com/crossdomain.xml
curl -s https://target.com/clientaccesspolicy.xml

# Advertising files
curl -s https://target.com/ads.txt
curl -s https://target.com/app-ads.txt

# App association files
curl -s https://target.com/.well-known/assetlinks.json
curl -s https://target.com/.well-known/apple-app-site-association
curl -s https://target.com/apple-app-site-association
```

### Step 8: Google Dorking for Metafiles

```
# Find robots.txt via Google
site:target.com inurl:robots.txt

# Find sitemaps
site:target.com inurl:sitemap filetype:xml

# Find exposed directories from robots.txt
site:target.com inurl:admin OR inurl:backup OR inurl:config
```

---

## Tools

### Command-Line Tools

| Tool | Description | Usage |
|------|-------------|-------|
| **curl** | HTTP client | `curl -s https://target.com/robots.txt` |
| **wget** | File retrieval | `wget https://target.com/robots.txt` |
| **xmllint** | XML parser | `xmllint --format sitemap.xml` |
| **Gobuster** | Directory fuzzer | `gobuster dir -u target.com -w wordlist.txt` |
| **ffuf** | Fast web fuzzer | `ffuf -u https://target.com/FUZZ -w wordlist.txt` |
| **httpx** | HTTP toolkit | `httpx -path /robots.txt -l targets.txt` |

### Automated Scanners

| Tool | Description |
|------|-------------|
| **Burp Suite** | Spider/crawler module |
| **OWASP ZAP** | Automated spider |
| **Nikto** | Web server scanner |
| **Parsero** | robots.txt analyzer |

### Online Tools

| Service | URL | Purpose |
|---------|-----|---------|
| Google Search Console | search.google.com/search-console | robots.txt tester |
| Bing Webmaster Tools | bing.com/webmasters | robots.txt validator |
| SEO Site Checkup | seositecheckup.com | Sitemap analysis |

---

## Example Commands/Payloads

### Comprehensive Metafile Scan Script

```bash
#!/bin/bash
TARGET=$1

echo "=== METAFILE SCANNER ==="
echo "Target: $TARGET"
echo ""

# robots.txt
echo "[+] Checking robots.txt..."
curl -s "https://$TARGET/robots.txt" -o robots.txt
if [ -s robots.txt ]; then
    echo "Found robots.txt:"
    cat robots.txt
    echo ""
    echo "Disallowed paths:"
    grep -i "disallow" robots.txt | awk '{print $2}'
fi

echo ""

# sitemap.xml
echo "[+] Checking sitemap.xml..."
curl -s "https://$TARGET/sitemap.xml" -o sitemap.xml
if [ -s sitemap.xml ]; then
    echo "Found sitemap.xml"
    echo "URLs count: $(grep -c "<loc>" sitemap.xml)"
fi

echo ""

# security.txt
echo "[+] Checking security.txt..."
for path in ".well-known/security.txt" "security.txt"; do
    response=$(curl -s "https://$TARGET/$path")
    if [[ ! -z "$response" && ! "$response" =~ "404" ]]; then
        echo "Found at /$path:"
        echo "$response"
        break
    fi
done

echo ""

# humans.txt
echo "[+] Checking humans.txt..."
curl -s "https://$TARGET/humans.txt"

echo ""

# .well-known directory
echo "[+] Scanning .well-known/..."
for file in security.txt openid-configuration assetlinks.json apple-app-site-association; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://$TARGET/.well-known/$file")
    if [ "$status" == "200" ]; then
        echo "Found: .well-known/$file"
    fi
done
```

### Parsero - robots.txt Analyzer

```bash
# Install
pip install parsero

# Basic usage
parsero -u https://target.com

# Check disallowed entries
parsero -u https://target.com -sb

# Output to file
parsero -u https://target.com -o output.txt
```

### Burp Suite Crawler Configuration

1. Target > Site map > Right-click target
2. Spider this host
3. Spider > Control > Start
4. Review discovered paths in Site map

### OWASP ZAP Spider

```bash
# Using ZAP CLI
zap-cli quick-scan -s all -r https://target.com

# Spider specific URL
zap-cli spider https://target.com
```

### Extract URLs from Sitemap (Python)

```python
#!/usr/bin/env python3
import requests
import xml.etree.ElementTree as ET

def parse_sitemap(url):
    response = requests.get(url)
    root = ET.fromstring(response.content)

    # Handle namespace
    ns = {'ns': 'http://www.sitemaps.org/schemas/sitemap/0.9'}

    urls = []
    for url_elem in root.findall('.//ns:loc', ns):
        urls.append(url_elem.text)

    return urls

# Usage
urls = parse_sitemap('https://target.com/sitemap.xml')
for url in urls:
    print(url)
```

---

## Remediation Guide

### 1. robots.txt Best Practices

```
# Good - Generic exclusions
User-agent: *
Disallow: /cgi-bin/
Disallow: /tmp/

# Bad - Reveals sensitive paths
User-agent: *
Disallow: /admin-secret-panel/
Disallow: /backup-20240115/
Disallow: /api/v2/internal/
```

**Recommendations:**
- Do not use robots.txt as a security mechanism
- Use authentication for sensitive areas instead
- Consider not listing truly sensitive paths at all
- Monitor for unauthorized access to "disallowed" paths

### 2. Sitemap Security

- Exclude sensitive URLs from sitemaps
- Keep sitemaps updated (remove deprecated pages)
- Don't include internal/development URLs
- Consider requiring authentication for full sitemaps

### 3. META Tag Hardening

```html
<!-- Remove generator information -->
<!-- Bad -->
<meta name="generator" content="WordPress 6.0">

<!-- Good - Remove entirely or use generic -->
<meta name="generator" content="Custom CMS">

<!-- Restrict indexing for sensitive pages -->
<meta name="robots" content="noindex, nofollow">
```

### 4. security.txt Guidelines (RFC 9116)

```
# Include useful information
Contact: mailto:security@example.com
Encryption: https://example.com/.well-known/pgp-key.txt
Policy: https://example.com/security-policy
Preferred-Languages: en
Expires: 2025-12-31T23:59:59.000Z

# Sign the file with PGP for authenticity
```

### 5. humans.txt Considerations

- Avoid exposing full names
- Don't include email addresses
- Use roles instead of personal details
- Consider removing if not necessary

### 6. .well-known Directory

- Audit all files in .well-known
- Remove unnecessary entries
- Restrict access to sensitive configurations
- Monitor for unauthorized additions

---

## Risk Assessment

### CVSS Score

**Base Score**: 5.3 (Medium)

**CVSS Vector**: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N

| Metric | Value | Description |
|--------|-------|-------------|
| Attack Vector | Network | Accessible via internet |
| Attack Complexity | Low | Simple file retrieval |
| Privileges Required | None | No authentication needed |
| User Interaction | None | No user interaction required |
| Scope | Unchanged | Impact scope unchanged |
| Confidentiality | Low | Directory/path disclosure |
| Integrity | None | No integrity impact |
| Availability | None | No availability impact |

### Severity Levels

| Finding | Severity | Description |
|---------|----------|-------------|
| Standard robots.txt | Info | Normal crawler directives |
| Sensitive paths in robots.txt | Low | Hidden admin/backup paths revealed |
| Internal IPs in metafiles | Medium | Network architecture exposed |
| Credentials in metafiles | High | Direct security compromise |
| Full team roster in humans.txt | Low | Social engineering vector |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-200** | Exposure of Sensitive Information to an Unauthorized Actor | Information disclosure via metafiles |
| **CWE-538** | Insertion of Sensitive Information into Externally-Accessible File or Directory | Sensitive data in public files |
| **CWE-548** | Exposure of Information Through Directory Listing | Path disclosure |
| **CWE-1230** | Exposure of Sensitive Information Through Metadata | Metadata-based information leak |

---

## References

### OWASP References
- [OWASP WSTG - Review Webserver Metafiles](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/03-Review_Webserver_Metafiles_for_Information_Leakage)

### Standards
- [RFC 9116 - security.txt](https://www.rfc-editor.org/rfc/rfc9116)
- [RFC 5785 - .well-known URIs](https://www.rfc-editor.org/rfc/rfc5785)
- [Google robots.txt Specification](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt)
- [Sitemaps Protocol](https://www.sitemaps.org/protocol.html)

### Tools
- [Parsero](https://github.com/behindthefirewalls/Parsero)
- [Gobuster](https://github.com/OJ/gobuster)

---

## Checklist

```
[ ] robots.txt retrieved and analyzed
[ ] Disallowed paths documented
[ ] Sitemap.xml retrieved and parsed
[ ] All sitemap URLs extracted
[ ] security.txt checked (both locations)
[ ] humans.txt retrieved
[ ] .well-known directory scanned
[ ] HTML META tags analyzed
[ ] crossdomain.xml checked
[ ] clientaccesspolicy.xml checked
[ ] ads.txt checked
[ ] App association files checked
[ ] Hidden paths verified for accessibility
[ ] Sensitive information documented
[ ] Risk assessment completed
[ ] Remediation recommendations prepared
```
