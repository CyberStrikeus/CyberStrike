# WSTG-INFO-04: Enumerate Applications on Webserver

## Test ID
WSTG-INFO-04

## Test Name
Enumerate Applications on Webserver

## High-Level Description

A single web server can host multiple web applications accessible through different URLs, ports, or virtual hosts. This test aims to comprehensively discover all web applications running on the target infrastructure. Missing applications during enumeration can result in overlooking critical vulnerabilities. Applications may be hidden at non-standard URL paths, running on unusual ports, or accessible only through specific hostnames (virtual hosting).

---

## What to Check

### Discovery Vectors

- [ ] Non-standard URL paths (/app1, /app2, /admin, /api)
- [ ] Non-standard ports (8080, 8443, 3000, 4443, etc.)
- [ ] Virtual hosts (different hostnames on same IP)
- [ ] Subdomains (app.target.com, admin.target.com)
- [ ] Load balancer backends
- [ ] Hidden administrative interfaces
- [ ] API endpoints
- [ ] Development/staging environments
- [ ] Legacy applications

### Information to Gather

- [ ] Complete list of applications
- [ ] URL paths for each application
- [ ] Ports used by each service
- [ ] Hostnames/virtual hosts
- [ ] Technology stack per application
- [ ] Application versions
- [ ] Authentication requirements

---

## How to Test

### Step 1: Port Scanning

#### Full Port Scan with Nmap

```bash
# Comprehensive TCP scan (all ports)
nmap -Pn -sT -sV -p0-65535 target.com

# Quick scan of common web ports
nmap -Pn -sV -p 80,443,8080,8443,8000,3000,4443,5000,9000,9443 target.com

# Service version detection with scripts
nmap -sV --script=http-enum -p 80,443,8080,8443 target.com

# UDP scan for additional services
nmap -sU -p 80,443,8080 target.com
```

#### Masscan for Large Ranges

```bash
# Fast full port scan
masscan -p0-65535 target.com --rate=1000

# Scan with banner grabbing
masscan -p0-65535 target.com --rate=1000 --banners
```

#### Common Web Service Ports

| Port | Common Service |
|------|----------------|
| 80 | HTTP |
| 443 | HTTPS |
| 8080 | HTTP Proxy/Tomcat |
| 8443 | HTTPS Alt |
| 8000 | Development servers |
| 3000 | Node.js/React |
| 4443 | HTTPS Alt |
| 5000 | Flask/Development |
| 9000 | PHP-FPM/SonarQube |
| 9443 | WSO2/VMware |
| 8888 | Jupyter/Alt HTTP |
| 8081 | HTTP Alt |
| 4000 | Development |
| 5001 | Development |

### Step 2: Non-Standard URL Enumeration

#### Directory Brute-forcing

```bash
# Gobuster
gobuster dir -u https://target.com -w /usr/share/wordlists/dirb/common.txt -t 50

# With extensions
gobuster dir -u https://target.com -w wordlist.txt -x php,asp,aspx,jsp,html -t 50

# ffuf
ffuf -u https://target.com/FUZZ -w /usr/share/seclists/Discovery/Web-Content/common.txt

# Dirsearch
dirsearch -u https://target.com -e php,asp,aspx,jsp

# feroxbuster (recursive)
feroxbuster -u https://target.com -w wordlist.txt
```

#### Common Application Paths

```bash
# Check common paths manually
for path in admin administrator manager console portal api app webapp webmail mail owa cpanel phpmyadmin adminer jenkins gitlab sonar grafana kibana elastic; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://target.com/$path")
    echo "$path: $status"
done
```

#### Common Application URL Patterns

```
/admin/
/administrator/
/manager/
/console/
/portal/
/api/
/api/v1/
/api/v2/
/app/
/webapp/
/webmail/
/mail/
/owa/
/cpanel/
/phpmyadmin/
/adminer/
/jenkins/
/gitlab/
/grafana/
/kibana/
/elastic/
/solr/
/sonar/
/nagios/
/zabbix/
/cacti/
/munin/
```

### Step 3: Virtual Host Discovery

#### DNS Enumeration

```bash
# Get nameservers
dig NS target.com
host -t ns target.com
nslookup -type=ns target.com

# Attempt zone transfer
dig axfr target.com @ns1.target.com
host -l target.com ns1.target.com

# Reverse DNS lookup
dig -x <target_ip>
host <target_ip>
```

#### Subdomain Enumeration

```bash
# Amass
amass enum -d target.com

# Subfinder
subfinder -d target.com

# Assetfinder
assetfinder target.com

# DNSRecon
dnsrecon -d target.com -t std

# Sublist3r
sublist3r -d target.com
```

#### Certificate Transparency

```bash
# crt.sh
curl -s "https://crt.sh/?q=%.target.com&output=json" | jq -r '.[].name_value' | sort -u

# Certspotter
curl -s "https://api.certspotter.com/v1/issuances?domain=target.com&include_subdomains=true" | jq '.[].dns_names[]'
```

#### Virtual Host Brute-forcing

```bash
# ffuf vhost discovery
ffuf -u https://target.com -H "Host: FUZZ.target.com" -w subdomains.txt -fs <filter_size>

# Gobuster vhost
gobuster vhost -u https://target.com -w subdomains.txt

# Virtual host scanner
python3 VHostScan.py -t target.com -w wordlist.txt
```

### Step 4: SSL/TLS Certificate Analysis

```bash
# Extract SAN from certificate
echo | openssl s_client -connect target.com:443 2>/dev/null | openssl x509 -noout -text | grep -A1 "Subject Alternative Name"

# Full certificate details
echo | openssl s_client -connect target.com:443 2>/dev/null | openssl x509 -noout -text

# Extract CN and SAN
openssl s_client -connect target.com:443 </dev/null 2>/dev/null | openssl x509 -noout -text | grep -E 'DNS:|Subject:'

# Multiple hosts
for host in target.com www.target.com api.target.com; do
    echo "=== $host ==="
    echo | openssl s_client -connect $host:443 -servername $host 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName
done
```

### Step 5: Reverse IP Lookup

```bash
# Using online services (manual)
# - viewdns.info/reverseip/
# - bing.com (ip:x.x.x.x)
# - shodan.io

# Bing search for IP
# ip:93.184.216.34

# Shodan CLI
shodan host <target_ip>
```

### Step 6: Search Engine Discovery

```
# Google dorks
site:target.com
site:*.target.com
site:target.com inurl:admin
site:target.com inurl:login

# Bing
site:target.com
ip:<target_ip>
```

### Step 7: Verify Discovered Applications

```bash
# Check each discovered host/port
for url in $(cat discovered_urls.txt); do
    echo "=== $url ==="
    curl -sI "$url" | head -10
done

# httpx for bulk verification
cat hosts.txt | httpx -title -status-code -tech-detect

# EyeWitness for screenshots
eyewitness --web -f urls.txt -d output/
```

---

## Tools

### Port Scanning

| Tool | Description | Usage |
|------|-------------|-------|
| **Nmap** | Network scanner | `nmap -sV -p- target.com` |
| **Masscan** | Fast port scanner | `masscan -p0-65535 target.com` |
| **RustScan** | Fast scanner + Nmap | `rustscan -a target.com` |
| **Zmap** | Internet-wide scanner | `zmap -p 80 target.com/24` |

### Directory/Application Discovery

| Tool | Description | Usage |
|------|-------------|-------|
| **Gobuster** | Directory brute-forcer | `gobuster dir -u target.com -w wordlist.txt` |
| **ffuf** | Fast web fuzzer | `ffuf -u target.com/FUZZ -w wordlist.txt` |
| **Dirsearch** | Directory scanner | `dirsearch -u target.com` |
| **Feroxbuster** | Recursive scanner | `feroxbuster -u target.com` |
| **Dirb** | Directory scanner | `dirb https://target.com` |

### Subdomain/Virtual Host Discovery

| Tool | Description | Usage |
|------|-------------|-------|
| **Amass** | Subdomain enumeration | `amass enum -d target.com` |
| **Subfinder** | Subdomain discovery | `subfinder -d target.com` |
| **DNSRecon** | DNS enumeration | `dnsrecon -d target.com` |
| **Sublist3r** | Subdomain enumeration | `sublist3r -d target.com` |
| **Assetfinder** | Find domains | `assetfinder target.com` |

### Verification/Analysis

| Tool | Description | Usage |
|------|-------------|-------|
| **httpx** | HTTP toolkit | `cat hosts.txt \| httpx` |
| **EyeWitness** | Screenshot tool | `eyewitness -f urls.txt` |
| **Aquatone** | Screenshot tool | `cat hosts.txt \| aquatone` |
| **WhatWeb** | Tech identifier | `whatweb target.com` |

### Online Services

| Service | URL | Purpose |
|---------|-----|---------|
| Shodan | shodan.io | Host discovery |
| Censys | censys.io | Certificate search |
| crt.sh | crt.sh | CT logs |
| ViewDNS | viewdns.info | Reverse IP |
| SecurityTrails | securitytrails.com | DNS history |

---

## Example Commands/Payloads

### Comprehensive Enumeration Script

```bash
#!/bin/bash
TARGET=$1

echo "=== APPLICATION ENUMERATION ==="
echo "Target: $TARGET"
echo ""

# 1. Port Scan
echo "[+] Port Scanning..."
nmap -sV -p 80,443,8080,8443,8000,3000,4443,5000,9000 $TARGET -oN nmap_web.txt

# 2. Subdomain Enumeration
echo "[+] Subdomain Enumeration..."
subfinder -d $TARGET -o subdomains.txt
amass enum -passive -d $TARGET >> subdomains.txt
sort -u subdomains.txt -o subdomains.txt

# 3. Certificate Analysis
echo "[+] Certificate Analysis..."
echo | openssl s_client -connect $TARGET:443 2>/dev/null | openssl x509 -noout -text | grep -E 'DNS:|Subject:' > cert_info.txt

# 4. DNS Zone Transfer Attempt
echo "[+] Zone Transfer Attempt..."
for ns in $(dig NS $TARGET +short); do
    dig axfr $TARGET @$ns
done

# 5. Directory Brute-force
echo "[+] Directory Enumeration..."
gobuster dir -u https://$TARGET -w /usr/share/seclists/Discovery/Web-Content/common.txt -o dirs.txt -q

# 6. Virtual Host Discovery
echo "[+] Virtual Host Discovery..."
ffuf -u https://$TARGET -H "Host: FUZZ.$TARGET" -w /usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt -o vhosts.txt -fs 0

# 7. Verify all discovered hosts
echo "[+] Verifying Hosts..."
cat subdomains.txt | httpx -silent -title -status-code -tech-detect -o live_hosts.txt

echo "[+] Enumeration Complete"
```

### Nmap Web Service Detection

```bash
# Detect all HTTP services
nmap -sV -p- --script=http-title,http-server-header target.com

# Scan common web ports with NSE scripts
nmap -p 80,443,8080,8443 --script=http-enum,http-headers,http-methods target.com

# Identify web application technologies
nmap -p 80,443 --script=http-generator,http-php-version target.com
```

### Mass Virtual Host Check

```bash
#!/bin/bash
IP=$1
DOMAIN=$2
WORDLIST=$3

while read subdomain; do
    host="$subdomain.$DOMAIN"
    response=$(curl -s -H "Host: $host" -o /dev/null -w "%{http_code}:%{size_download}" http://$IP)
    code=$(echo $response | cut -d: -f1)
    size=$(echo $response | cut -d: -f2)
    echo "$host - Status: $code, Size: $size"
done < $WORDLIST
```

### Aquatone Pipeline

```bash
# Full discovery pipeline
cat domains.txt | amass enum -passive -df - | httpx -silent | aquatone -out screenshots/
```

---

## Remediation Guide

### 1. Application Inventory

- Maintain comprehensive documentation of all web applications
- Include URLs, ports, hostnames, and responsible teams
- Regular audits to identify undocumented applications
- Implement change management for new applications

### 2. Network Segmentation

```
# Example: Separate admin interfaces
- Public applications: DMZ segment
- Admin interfaces: Internal network only
- Development: Isolated segment
```

### 3. Access Control

- Restrict administrative interfaces to internal networks
- Implement IP whitelisting where possible
- Use VPN for remote admin access
- Enable authentication for all applications

### 4. DNS Security

```bash
# Restrict zone transfers (BIND example)
zone "example.com" {
    type master;
    file "example.com.zone";
    allow-transfer { none; };
    # Or specific IPs only
    allow-transfer { 192.168.1.2; };
};
```

### 5. Port Management

- Close unnecessary ports
- Use firewall rules to restrict access
- Monitor for new services
- Regular port audits

### 6. Virtual Host Configuration

```apache
# Apache - Disable default vhost response
<VirtualHost *:80>
    ServerName default.invalid
    Redirect 404 /
</VirtualHost>
```

```nginx
# nginx - Default server block
server {
    listen 80 default_server;
    server_name _;
    return 444;
}
```

### 7. Monitoring

- Implement logging for all web services
- Monitor for unauthorized applications
- Alert on new services starting
- Regular security scans

---

## Risk Assessment

### CVSS Score

**Base Score**: 5.3 (Medium)

**CVSS Vector**: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N

| Metric | Value | Description |
|--------|-------|-------------|
| Attack Vector | Network | Accessible via internet |
| Attack Complexity | Low | Standard enumeration techniques |
| Privileges Required | None | No authentication needed |
| User Interaction | None | No user interaction required |
| Scope | Unchanged | Impact scope unchanged |
| Confidentiality | Low | Application existence disclosure |
| Integrity | None | No integrity impact |
| Availability | None | No availability impact |

### Severity Levels

| Finding | Severity | Description |
|---------|----------|-------------|
| Public applications discovered | Info | Normal discovery |
| Admin interface on non-standard port | Low | Obscurity is not security |
| Unprotected admin interface | High | Direct administrative access |
| Development/staging exposed | Medium | Potentially vulnerable apps |
| Undocumented applications | Medium | Shadow IT risk |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-200** | Exposure of Sensitive Information | Application enumeration disclosure |
| **CWE-16** | Configuration | Improper server configuration |
| **CWE-693** | Protection Mechanism Failure | Lack of access controls |
| **CWE-284** | Improper Access Control | Insufficient access restrictions |

---

## References

### OWASP References
- [OWASP WSTG - Enumerate Applications on Webserver](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/04-Enumerate_Applications_on_Webserver)

### Tools Documentation
- [Nmap Documentation](https://nmap.org/docs.html)
- [Gobuster GitHub](https://github.com/OJ/gobuster)
- [Amass GitHub](https://github.com/owasp-amass/amass)
- [ffuf GitHub](https://github.com/ffuf/ffuf)

### Wordlists
- [SecLists](https://github.com/danielmiessler/SecLists)
- [Assetnote Wordlists](https://wordlists.assetnote.io/)

---

## Checklist

```
[ ] Full port scan completed (all 65535 ports)
[ ] Common web ports verified
[ ] Non-standard URL paths enumerated
[ ] Subdomain enumeration performed
[ ] DNS zone transfer attempted
[ ] Certificate transparency checked
[ ] SSL/TLS certificates analyzed for SANs
[ ] Virtual host brute-forcing completed
[ ] Reverse IP lookup performed
[ ] Search engine reconnaissance done
[ ] All discovered applications documented
[ ] Applications verified and accessible
[ ] Technologies identified per application
[ ] Screenshots captured (EyeWitness/Aquatone)
[ ] Risk assessment completed
[ ] Findings documented
```
