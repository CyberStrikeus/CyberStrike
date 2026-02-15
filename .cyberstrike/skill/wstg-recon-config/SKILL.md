---
name: wstg-recon-config
description: WSTG reconnaissance, configuration, error handling, and cryptography testing techniques
tags: [recon, config, headers, tls, wstg]
version: "1.0"
---

# Recon & Configuration Testing (WSTG-INFO + CONF + ERRH + CRYP)

## Google Dork Templates
Replace `TARGET` with the actual domain:
```
site:TARGET filetype:pdf | filetype:doc | filetype:xls
site:TARGET inurl:admin | inurl:login | inurl:dashboard
site:TARGET ext:php inurl:?
site:TARGET intitle:"index of"
site:TARGET inurl:wp-content | inurl:wp-includes
site:TARGET ext:log | ext:cfg | ext:env | ext:ini | ext:bak
site:TARGET "error" | "warning" | "fatal" | "exception"
inurl:"q=" site:TARGET
"TARGET" site:pastebin.com | site:github.com | site:trello.com
```

## Directory & File Discovery

### ffuf Commands
```bash
# Directory brute force
ffuf -u https://TARGET/FUZZ -w /usr/share/seclists/Discovery/Web-Content/raft-medium-directories.txt -mc 200,301,302,403 -ac

# File discovery
ffuf -u https://TARGET/FUZZ -w /usr/share/seclists/Discovery/Web-Content/raft-medium-files.txt -mc 200,301,302 -ac

# Extension fuzzing
ffuf -u https://TARGET/indexFUZZ -w /usr/share/seclists/Discovery/Web-Content/web-extensions.txt -mc 200

# Virtual host discovery
ffuf -u https://TARGET -H "Host: FUZZ.TARGET" -w /usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt -ac

# Parameter discovery
ffuf -u "https://TARGET/page?FUZZ=test" -w /usr/share/seclists/Discovery/Web-Content/burp-parameter-names.txt -mc 200 -ac
```

### Backup File Patterns
Test for these at discovered paths:
```
.bak, .old, .orig, .save, .swp, .swo, ~
.git/, .svn/, .hg/, .env, .DS_Store
config.php.bak, web.config.old, .htaccess.bak
wp-config.php.bak, database.yml.old
Copy of *, backup-*, archive-*
```

## Security Header Checklist

Check with `curl -I https://TARGET`:

| Header | Expected Value | Risk if Missing |
|--------|---------------|-----------------|
| Strict-Transport-Security | `max-age=31536000; includeSubDomains` | MITM, SSL stripping |
| Content-Security-Policy | No `unsafe-inline`, no `unsafe-eval` | XSS |
| X-Content-Type-Options | `nosniff` | MIME sniffing |
| X-Frame-Options | `DENY` or `SAMEORIGIN` | Clickjacking |
| Referrer-Policy | `strict-origin-when-cross-origin` | Info leakage |
| Permissions-Policy | Restrict camera, microphone, geolocation | Feature abuse |
| X-XSS-Protection | `0` (deprecated, CSP preferred) | N/A |
| Cache-Control | `no-store` on sensitive pages | Cached credentials |

## TLS/SSL Testing

```bash
# testssl.sh (comprehensive)
testssl.sh --severity HIGH https://TARGET

# sslscan (quick)
sslscan --no-failed TARGET:443

# Check specific issues
# SSLv2/SSLv3 support
openssl s_client -connect TARGET:443 -ssl3 2>&1 | grep -i "alert"

# Certificate details
openssl s_client -connect TARGET:443 </dev/null 2>/dev/null | openssl x509 -text -noout

# Check for HSTS preload
curl -sI https://TARGET | grep -i strict-transport
```

**TLS Issues to Check:**
- SSLv3, TLS 1.0, TLS 1.1 supported (should be disabled)
- Weak ciphers (RC4, DES, 3DES, NULL, EXPORT)
- Missing Perfect Forward Secrecy (PFS)
- Certificate: expired, self-signed, wrong CN/SAN, weak signature (SHA1)
- BEAST, POODLE, Heartbleed, CRIME, BREACH, ROBOT

## HTTP Methods Testing

```bash
# Check allowed methods
curl -X OPTIONS https://TARGET/ -I

# Test dangerous methods
curl -X TRACE https://TARGET/ -I
curl -X PUT https://TARGET/test.txt -d "test" -I
curl -X DELETE https://TARGET/test.txt -I

# Method override headers
curl -X POST https://TARGET/admin -H "X-HTTP-Method-Override: PUT"
curl -X POST https://TARGET/admin -H "X-Method-Override: DELETE"
```

## Error Triggering Payloads

Force errors to check for information disclosure:
```bash
# Non-existent pages
curl -s https://TARGET/nonexistent-page-12345

# Invalid parameters
curl -s "https://TARGET/page?id='"
curl -s "https://TARGET/page?id=-1"
curl -s "https://TARGET/page?id=99999999"

# Large input
curl -s "https://TARGET/page?id=$(python3 -c 'print("A"*10000)')"

# Special characters
curl -s "https://TARGET/page?id=%00%0a%0d"

# Content-type mismatch
curl -s -X POST https://TARGET/api/endpoint -H "Content-Type: application/xml" -d "<test>"
```

**Look for in error responses:** stack traces, file paths, database names, framework versions, SQL error messages, internal IP addresses.

## Subdomain & Cloud Storage

```bash
# Subdomain enumeration
subfinder -d TARGET -silent | tee subs.txt
cat subs.txt | httpx -silent -status-code -title | tee live.txt

# Subdomain takeover check
subjack -w subs.txt -t 100 -o takeover.txt

# Cloud storage checks
# AWS S3
aws s3 ls s3://TARGET --no-sign-request 2>/dev/null
aws s3 ls s3://TARGET-backup --no-sign-request 2>/dev/null
aws s3 ls s3://TARGET-assets --no-sign-request 2>/dev/null

# Azure Blob
curl -s "https://TARGET.blob.core.windows.net/\$root?restype=container&comp=list"

# GCS
curl -s "https://storage.googleapis.com/TARGET"
```

For detailed procedures on any test, read:
`knowledge/web-application/WSTG-INFO/WSTG-INFO-{NN}.md`
`knowledge/web-application/WSTG-CONF/WSTG-CONF-{NN}.md`
`knowledge/web-application/WSTG-ERRH/WSTG-ERRH-{NN}.md`
`knowledge/web-application/WSTG-CRYP/WSTG-CRYP-{NN}.md`
