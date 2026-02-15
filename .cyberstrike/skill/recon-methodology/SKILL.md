---
name: recon-methodology
description: Bug bounty and pentest reconnaissance methodology
tags: [recon, enumeration, osint, subdomain]
version: "1.0"
---

# Reconnaissance Methodology

## Phase 1: Passive Reconnaissance

### Subdomain Enumeration (Passive)
```bash
# Certificate Transparency
curl -s "https://crt.sh/?q=%25.target.com&output=json" | jq -r '.[].name_value' | sort -u

# SecurityTrails
curl -s "https://api.securitytrails.com/v1/domain/target.com/subdomains" \
  -H "APIKEY: $API_KEY"

# Subfinder (passive)
subfinder -d target.com -silent

# Amass (passive)
amass enum -passive -d target.com

# Combined approach
subfinder -d target.com -silent | anew subs.txt
amass enum -passive -d target.com | anew subs.txt
```

### Historical Data
```bash
# Wayback Machine URLs
echo "target.com" | waybackurls | tee wayback.txt

# GAU (GetAllURLs)
echo "target.com" | gau --threads 5 | tee gau.txt

# Combined historical
cat wayback.txt gau.txt | sort -u | tee historical_urls.txt

# Find parameters
cat historical_urls.txt | grep "=" | qsreplace "FUZZ" | sort -u
```

### Technology Detection
```bash
# Wappalyzer CLI
wappalyzer https://target.com

# WhatWeb
whatweb -a 3 https://target.com

# BuiltWith API
curl "https://api.builtwith.com/v19/api.json?KEY=$KEY&LOOKUP=target.com"
```

## Phase 2: Active Reconnaissance

### DNS Enumeration
```bash
# DNS records
dig target.com ANY +noall +answer
dig target.com MX +short
dig target.com TXT +short
dig target.com NS +short

# Zone transfer attempt
dig axfr @ns1.target.com target.com

# DNSRecon
dnsrecon -d target.com -t std

# Subdomain brute force
puredns bruteforce wordlist.txt target.com -r resolvers.txt
```

### Subdomain Resolution
```bash
# Resolve discovered subdomains
cat subs.txt | dnsx -silent -a -resp | tee resolved.txt

# Filter live hosts
cat resolved.txt | httpx -silent -title -status-code -tech-detect | tee live_hosts.txt

# Screenshot
cat live_hosts.txt | cut -d' ' -f1 | gowitness file -f - --threads 10
```

### Port Scanning
```bash
# Fast scan (top 100)
nmap -F -sV target.com

# Full TCP scan
nmap -p- -T4 --min-rate 1000 target.com

# UDP scan (top 20)
nmap -sU --top-ports 20 target.com

# Service version detection
nmap -sV -sC -p 80,443,8080 target.com

# Masscan (fast)
masscan -p1-65535 --rate 10000 -oJ scan.json target.com
```

## Phase 3: Content Discovery

### Directory Fuzzing
```bash
# Feroxbuster
feroxbuster -u https://target.com -w /path/to/wordlist.txt -x php,asp,html

# FFUF
ffuf -u https://target.com/FUZZ -w wordlist.txt -mc 200,301,302,403

# Dirsearch
dirsearch -u https://target.com -e php,asp,html -t 50

# Gobuster
gobuster dir -u https://target.com -w wordlist.txt -x php,html -t 50
```

### Parameter Discovery
```bash
# Arjun
arjun -u https://target.com/page

# ParamSpider
python3 paramspider.py -d target.com

# FFUF parameter fuzzing
ffuf -u "https://target.com/page?FUZZ=value" -w params.txt -mc 200
```

### JavaScript Analysis
```bash
# Extract JS files
cat live_hosts.txt | getJS --complete | tee js_files.txt

# Find endpoints in JS
cat js_files.txt | xargs -I{} sh -c 'curl -s {} | linkfinder -i -'

# Find secrets in JS
cat js_files.txt | xargs -I{} sh -c 'curl -s {} | secretfinder -i -'

# Nuclei JS analysis
nuclei -l js_files.txt -t exposures/
```

## Phase 4: Vulnerability Discovery

### Automated Scanning
```bash
# Nuclei (comprehensive)
nuclei -l live_hosts.txt -t nuclei-templates/ -o nuclei_results.txt

# Nikto
nikto -h https://target.com -output nikto.txt

# WPScan (WordPress)
wpscan --url https://target.com --enumerate u,p,t
```

### Manual Testing Points
```
1. Authentication
   - Login forms
   - Password reset
   - Registration
   - Session management

2. Authorization
   - IDOR on IDs
   - Horizontal privilege escalation
   - Vertical privilege escalation

3. Input Validation
   - All parameters (GET, POST)
   - Headers (Host, Referer, User-Agent)
   - Cookies
   - File uploads

4. Business Logic
   - Price manipulation
   - Quantity tampering
   - Skip steps
   - Race conditions
```

## Reconnaissance Flow

```
Target Domain
     │
     ├── Passive Subdomain Enumeration
     │   ├── crt.sh, SecurityTrails
     │   ├── Subfinder, Amass (passive)
     │   └── Historical data (wayback, gau)
     │
     ├── DNS Enumeration
     │   ├── Record types (A, MX, TXT, NS)
     │   └── Zone transfer attempt
     │
     ├── Active Subdomain Enumeration
     │   └── Brute force (puredns)
     │
     ├── Resolution & Probing
     │   ├── dnsx (resolve)
     │   └── httpx (probe)
     │
     ├── Port Scanning
     │   └── nmap / masscan
     │
     ├── Content Discovery
     │   ├── Directory fuzzing
     │   ├── Parameter discovery
     │   └── JavaScript analysis
     │
     └── Vulnerability Scanning
         ├── Nuclei
         └── Manual testing
```

## Wordlists

| Purpose | Recommended Wordlist |
|---------|---------------------|
| Subdomains | SecLists/Discovery/DNS/subdomains-top1million-5000.txt |
| Directories | SecLists/Discovery/Web-Content/raft-medium-directories.txt |
| Files | SecLists/Discovery/Web-Content/raft-medium-files.txt |
| Parameters | SecLists/Discovery/Web-Content/burp-parameter-names.txt |
| Passwords | SecLists/Passwords/Common-Credentials/10-million-password-list-top-10000.txt |
