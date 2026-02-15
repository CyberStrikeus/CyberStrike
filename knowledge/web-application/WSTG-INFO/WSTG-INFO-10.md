# WSTG-INFO-10: Map Application Architecture

## Test ID
WSTG-INFO-10

## Test Name
Map Application Architecture

## High-Level Description

Mapping application architecture involves identifying all components that make up the application infrastructure, including web servers, application servers, databases, load balancers, CDNs, firewalls, and security devices. Understanding the architecture helps penetration testers identify scope boundaries, potential attack vectors, and provide meaningful security recommendations. This reconnaissance phase reveals how different components interact and where security controls are implemented.

---

## What to Check

### Infrastructure Components

- [ ] Web server (Apache, nginx, IIS)
- [ ] Application server (Tomcat, JBoss, .NET)
- [ ] Database server (MySQL, PostgreSQL, MSSQL, Oracle)
- [ ] Caching layer (Redis, Memcached, Varnish)
- [ ] Message queue (RabbitMQ, Kafka)
- [ ] Search engine (Elasticsearch, Solr)
- [ ] File storage (S3, Azure Blob, local)

### Network Components

- [ ] Load balancer (F5, HAProxy, AWS ALB)
- [ ] Reverse proxy (nginx, Apache)
- [ ] CDN (Cloudflare, Akamai, CloudFront)
- [ ] API Gateway
- [ ] DNS configuration

### Security Components

- [ ] Firewall (network/host-based)
- [ ] Web Application Firewall (WAF)
- [ ] Intrusion Detection/Prevention System (IDS/IPS)
- [ ] DDoS protection
- [ ] SSL/TLS termination point

### Cloud/Platform Components

- [ ] Cloud provider (AWS, Azure, GCP)
- [ ] PaaS indicators
- [ ] Serverless functions
- [ ] Container orchestration (Kubernetes)
- [ ] Microservices architecture

### Authentication Systems

- [ ] Local authentication
- [ ] Active Directory/LDAP
- [ ] SSO (SAML, OAuth, OIDC)
- [ ] MFA provider
- [ ] Certificate-based auth

---

## How to Test

### Step 1: Web Server Identification

```bash
# HTTP headers analysis
curl -sI https://target.com | grep -i server

# Detailed fingerprinting
nmap -sV -p 80,443 target.com

# WhatWeb
whatweb https://target.com
```

### Step 2: Platform Detection

#### PaaS Indicators

| Pattern | Platform |
|---------|----------|
| *.azurewebsites.net | Azure App Service |
| *.herokuapp.com | Heroku |
| *.appspot.com | Google App Engine |
| *.elasticbeanstalk.com | AWS Elastic Beanstalk |
| *.cloudfunctions.net | Google Cloud Functions |

```bash
# Check DNS for cloud indicators
dig target.com
dig target.com CNAME

# Analyze response headers
curl -sI https://target.com | grep -iE 'x-azure|x-amz|x-goog|x-heroku'
```

#### Serverless Indicators

| Header | Platform |
|--------|----------|
| X-Amz-Cf-Id | AWS CloudFront |
| X-Amz-Request-Id | AWS API Gateway |
| X-Amz-Invocation-Type | AWS Lambda |
| X-Ms-Request-Id | Azure Functions |
| Server: Kestrel | Azure/.NET |
| X-Cloud-Trace-Context | Google Cloud |

### Step 3: Database Detection

```bash
# Port scanning for databases
nmap -sV -p 3306,5432,1433,1521,27017,6379,9200 target.com

# Database ports
# 3306 - MySQL
# 5432 - PostgreSQL
# 1433 - MSSQL
# 1521 - Oracle
# 27017 - MongoDB
# 6379 - Redis
# 9200 - Elasticsearch
```

#### Database Error Fingerprinting

| Error Pattern | Database |
|---------------|----------|
| "MySQL server" | MySQL |
| "PostgreSQL" | PostgreSQL |
| "ORA-" | Oracle |
| "Microsoft SQL Server" | MSSQL |
| "MongoDB" | MongoDB |

```bash
# Trigger errors to identify database
curl -s "https://target.com/api?id='"
curl -s "https://target.com/api?id=1 OR 1=1"
```

### Step 4: Load Balancer Detection

```bash
# Multiple requests to detect variations
for i in {1..10}; do
    echo "=== Request $i ==="
    curl -sI https://target.com | grep -iE 'server|date|x-|set-cookie'
    sleep 1
done

# Look for load balancer cookies
curl -sI https://target.com | grep -i 'set-cookie'
```

#### Load Balancer Indicators

| Indicator | Load Balancer |
|-----------|---------------|
| BIGipServer cookie | F5 BIG-IP |
| AWSALB/AWSALBCORS cookie | AWS ALB |
| X-Amz-Cf-Id header | AWS CloudFront |
| X-Cache header | Various |
| Via header | Proxy/LB |
| Inconsistent Server headers | Multiple backends |
| Varying response times | Distribution |

### Step 5: CDN Detection

```bash
# WHOIS lookup on resolved IP
dig +short target.com | xargs whois | grep -i 'org-name\|netname'

# Check known CDN ranges
curl -sI https://target.com | grep -iE 'cf-ray|x-cdn|x-cache|x-amz-cf|akamai|fastly|cloudflare'
```

#### CDN Indicators

| Header/Pattern | CDN |
|----------------|-----|
| CF-Ray | Cloudflare |
| X-Amz-Cf-Id | AWS CloudFront |
| X-Akamai-* | Akamai |
| X-Fastly-* | Fastly |
| X-CDN | Generic CDN |
| Server: cloudflare | Cloudflare |

### Step 6: Reverse Proxy Detection

```bash
# Look for proxy indicators
curl -sI https://target.com | grep -iE 'via|x-forwarded|x-real-ip|x-proxy'

# Check for header mismatches
# e.g., nginx Server header but ASP.NET errors
```

#### Proxy Indicators

- `Via` header present
- `X-Forwarded-For` header accepted
- Server header mismatch with error pages
- Different Server headers on different endpoints

### Step 7: WAF Detection

```bash
# Test with common attack patterns
curl -s "https://target.com/?id=<script>alert(1)</script>"
curl -s "https://target.com/?id=' OR 1=1--"
curl -s "https://target.com/?id=../../../etc/passwd"

# Check response for WAF signatures
curl -sI "https://target.com/?id=<script>" | grep -iE 'waf|firewall|blocked|forbidden'
```

#### WAF Signatures

| Response/Header | WAF |
|-----------------|-----|
| "Blocked by Cloudflare" | Cloudflare |
| "ModSecurity" | ModSecurity |
| "Request blocked" | Various |
| "AWS WAF" | AWS WAF |
| X-Sucuri-ID | Sucuri |
| X-CDN: Imperva | Imperva |

### Step 8: Authentication Architecture

```bash
# Check for authentication headers
curl -sI https://target.com/admin | grep -i 'www-authenticate'

# Look for SSO indicators
curl -s https://target.com/login | grep -iE 'saml|oauth|openid|sso|adfs'

# Check for MFA indicators
curl -s https://target.com/login | grep -iE 'mfa|2fa|authenticator|otp'
```

#### Authentication Indicators

| Pattern | Mechanism |
|---------|-----------|
| WWW-Authenticate: Basic | HTTP Basic Auth |
| WWW-Authenticate: NTLM | NTLM/AD |
| WWW-Authenticate: Negotiate | Kerberos |
| /adfs/ in URL | ADFS |
| accounts.google.com redirect | Google OAuth |
| login.microsoftonline.com | Azure AD |

### Step 9: Microservices Detection

```bash
# Look for API gateway patterns
curl -s https://target.com/api/ | head -20

# Check for service mesh headers
curl -sI https://target.com | grep -iE 'x-envoy|x-istio|x-b3'

# Different error formats suggest different services
curl -s "https://target.com/api/users/invalid"
curl -s "https://target.com/api/orders/invalid"
```

### Step 10: Document Architecture Diagram

Create a visual representation:

```
                    [Internet]
                        |
                   [Cloudflare CDN/WAF]
                        |
                   [AWS ALB]
                    /      \
            [nginx]        [nginx]
               |              |
         [Node.js API]  [Node.js API]
               |              |
           [Redis Cache]      |
               \             /
                [PostgreSQL]
                    |
               [S3 Storage]
```

---

## Tools

### Network Scanning

| Tool | Description | Usage |
|------|-------------|-------|
| **Nmap** | Port/service scanner | `nmap -sV -p- target.com` |
| **Masscan** | Fast port scanner | `masscan -p1-65535 target.com` |
| **Shodan** | Internet-wide scanning | `shodan host target_ip` |

### Web Analysis

| Tool | Description | Usage |
|------|-------------|-------|
| **WhatWeb** | Technology detection | `whatweb target.com` |
| **Wappalyzer** | Stack identification | Browser extension |
| **httpx** | HTTP probing | `httpx -tech-detect` |

### DNS/Network

| Tool | Description | Usage |
|------|-------------|-------|
| **dig** | DNS lookup | `dig target.com ANY` |
| **whois** | Registration info | `whois target.com` |
| **traceroute** | Network path | `traceroute target.com` |

### WAF Detection

| Tool | Description | Usage |
|------|-------------|-------|
| **wafw00f** | WAF fingerprinting | `wafw00f https://target.com` |
| **nmap http-waf-detect** | WAF detection | `nmap --script http-waf-detect` |

---

## Example Commands/Payloads

### Comprehensive Architecture Mapping Script

```bash
#!/bin/bash
TARGET=$1

echo "=== ARCHITECTURE MAPPING ==="
echo "Target: $TARGET"
echo ""

# DNS Resolution
echo "[+] DNS Information..."
echo "A Records:"
dig +short $TARGET
echo ""
echo "CNAME Records:"
dig +short $TARGET CNAME
echo ""
echo "MX Records:"
dig +short $TARGET MX
echo ""
echo "NS Records:"
dig +short $TARGET NS

echo ""

# WHOIS (IP)
echo "[+] IP WHOIS..."
IP=$(dig +short $TARGET | head -1)
whois $IP | grep -iE 'org-name|netname|country|descr' | head -10

echo ""

# HTTP Headers
echo "[+] HTTP Headers..."
curl -sI "https://$TARGET" | grep -iE 'server|x-powered|x-cache|cf-ray|via|x-amz|set-cookie'

echo ""

# WAF Detection
echo "[+] WAF Detection..."
wafw00f "https://$TARGET" 2>/dev/null

echo ""

# Port Scan (common ports)
echo "[+] Port Scan..."
nmap -sV -p 80,443,8080,8443,3306,5432,1433,27017,6379 $TARGET

echo ""

# Technology Detection
echo "[+] Technology Stack..."
whatweb -q "https://$TARGET"

echo ""

# Load Balancer Detection
echo "[+] Load Balancer Check..."
for i in 1 2 3; do
    echo "Request $i:"
    curl -sI "https://$TARGET" | grep -i 'server\|date' | head -2
    sleep 1
done

echo ""
echo "[+] Mapping Complete"
```

### wafw00f Usage

```bash
# Install
pip install wafw00f

# Basic detection
wafw00f https://target.com

# List all detectable WAFs
wafw00f -l

# Verbose output
wafw00f -v https://target.com
```

### Nmap Architecture Scripts

```bash
# Service detection
nmap -sV -sC target.com

# HTTP enumeration
nmap --script http-enum,http-headers,http-methods target.com

# SSL/TLS analysis
nmap --script ssl-enum-ciphers -p 443 target.com

# Database detection
nmap -sV -p 3306,5432,1433,1521,27017 target.com
```

---

## Remediation Guide

### 1. Minimize Information Disclosure

```nginx
# nginx - Hide server version
server_tokens off;

# Hide backend details
proxy_hide_header X-Powered-By;
proxy_hide_header Server;
```

### 2. Network Segmentation

```
[Internet]
    |
[DMZ - Web Servers]
    |
[Internal - Application Servers]
    |
[Restricted - Database Servers]
```

### 3. Proper Firewall Configuration

- Block direct database access from internet
- Restrict management interfaces to internal networks
- Implement least privilege access

### 4. WAF Hardening

- Configure WAF to hide its presence
- Customize error pages
- Implement rate limiting

### 5. Documentation

Maintain accurate architecture documentation:
- Network diagrams
- Data flow diagrams
- Component inventory
- Security control mapping

---

## Risk Assessment

### CVSS Score

This is a **reconnaissance activity**, not a direct vulnerability.

**Base Score**: 5.3 (Medium) - for information disclosure

**CVSS Vector**: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N

### Finding Severity

| Finding | Severity | Impact |
|---------|----------|--------|
| Architecture visible | Info | Reconnaissance data |
| Database ports exposed | High | Direct attack vector |
| No WAF detected | Medium | Reduced protection |
| Admin interfaces exposed | High | Attack target |
| Internal IPs disclosed | Medium | Network mapping |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-200** | Exposure of Sensitive Information | Architecture disclosure |
| **CWE-16** | Configuration | Network misconfig |
| **CWE-693** | Protection Mechanism Failure | Missing security layers |

---

## References

### OWASP References
- [OWASP WSTG - Map Application Architecture](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/10-Map_Application_Architecture)

### Tools
- [Nmap](https://nmap.org/)
- [wafw00f](https://github.com/EnableSecurity/wafw00f)
- [WhatWeb](https://github.com/urbanadventurer/WhatWeb)
- [Shodan](https://www.shodan.io/)

---

## Checklist

```
[ ] DNS records analyzed
[ ] WHOIS information gathered
[ ] Web server identified
[ ] Application server identified
[ ] Database type determined
[ ] Load balancer detected
[ ] CDN identified
[ ] Reverse proxy detected
[ ] WAF detection performed
[ ] Cloud platform identified
[ ] PaaS/Serverless indicators checked
[ ] Authentication mechanism identified
[ ] Network path traced
[ ] Security components mapped
[ ] Architecture diagram created
[ ] Scope boundaries documented
```
