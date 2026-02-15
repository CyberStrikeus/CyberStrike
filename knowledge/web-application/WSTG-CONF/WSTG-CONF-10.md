# WSTG-CONF-10: Test for Subdomain Takeover

## Test ID
WSTG-CONF-10

## Test Name
Test for Subdomain Takeover

## High-Level Description

Subdomain takeover occurs when a subdomain's DNS record points to an external service that is no longer in use or has been deleted. Attackers can claim the abandoned resource and host their own content on the victim's subdomain. This can lead to credential theft, phishing, cookie stealing, and reputation damage. Common targets include cloud services (AWS, Azure, GitHub Pages), CDNs, and SaaS platforms.

---

## What to Check

### DNS Record Types

- [ ] A records pointing to decommissioned IPs
- [ ] CNAME records pointing to unclaimed services
- [ ] NS records pointing to expired domains
- [ ] MX records pointing to abandoned mail services

### Vulnerable Services

| Service | Vulnerable Indicator |
|---------|---------------------|
| GitHub Pages | 404 - "There isn't a GitHub Pages site here" |
| Heroku | "No such app" |
| AWS S3 | "NoSuchBucket" |
| Azure | "404 Web Site not found" |
| Shopify | "Sorry, this shop is currently unavailable" |
| Tumblr | "There's nothing here" |
| Fastly | "Fastly error: unknown domain" |
| Pantheon | "404 error unknown site" |
| Zendesk | "Help Center Closed" |
| Unbounce | "The requested URL was not found" |

---

## How to Test

### Step 1: Subdomain Enumeration

```bash
# Amass
amass enum -d target.com -o subdomains.txt

# Subfinder
subfinder -d target.com -o subdomains.txt

# Assetfinder
assetfinder target.com >> subdomains.txt

# Certificate Transparency
curl -s "https://crt.sh/?q=%.target.com&output=json" | jq -r '.[].name_value' | sort -u >> subdomains.txt

# Combine and dedupe
sort -u subdomains.txt -o subdomains.txt
```

### Step 2: DNS Resolution Check

```bash
#!/bin/bash
# Check DNS status for each subdomain

while read subdomain; do
    result=$(dig +short "$subdomain")
    if [ -z "$result" ]; then
        echo "[NXDOMAIN] $subdomain"
    else
        echo "[RESOLVED] $subdomain -> $result"
    fi
done < subdomains.txt
```

### Step 3: Identify CNAME Records

```bash
# Check CNAME records
while read subdomain; do
    cname=$(dig +short CNAME "$subdomain")
    if [ ! -z "$cname" ]; then
        echo "$subdomain -> CNAME: $cname"

        # Check if CNAME target resolves
        target_ip=$(dig +short "$cname")
        if [ -z "$target_ip" ]; then
            echo "  [!] POTENTIAL TAKEOVER: CNAME target doesn't resolve!"
        fi
    fi
done < subdomains.txt
```

### Step 4: Check for Vulnerable Services

```bash
#!/bin/bash
# Check HTTP response for takeover indicators

while read subdomain; do
    response=$(curl -s -L -o /dev/null -w "%{http_code}" "https://$subdomain" 2>/dev/null)

    if [ "$response" == "000" ]; then
        # Connection failed - check CNAME
        cname=$(dig +short CNAME "$subdomain")
        if [ ! -z "$cname" ]; then
            echo "[CHECK] $subdomain (CNAME: $cname) - No HTTP response"
        fi
    elif [ "$response" == "404" ]; then
        # Get page content
        content=$(curl -s -L "https://$subdomain" 2>/dev/null)

        # Check for known vulnerable patterns
        if echo "$content" | grep -qi "There isn't a GitHub Pages site here"; then
            echo "[VULN] $subdomain - GitHub Pages takeover!"
        elif echo "$content" | grep -qi "NoSuchBucket"; then
            echo "[VULN] $subdomain - AWS S3 takeover!"
        elif echo "$content" | grep -qi "No such app"; then
            echo "[VULN] $subdomain - Heroku takeover!"
        elif echo "$content" | grep -qi "this shop is currently unavailable"; then
            echo "[VULN] $subdomain - Shopify takeover!"
        else
            echo "[CHECK] $subdomain - 404 response, manual check needed"
        fi
    fi
done < subdomains.txt
```

### Step 5: Check NS Records

```bash
# Check for dangling NS records
ns_records=$(dig +short NS target.com)
for ns in $ns_records; do
    # Check if NS resolves
    ns_ip=$(dig +short "$ns")
    if [ -z "$ns_ip" ]; then
        echo "[CRITICAL] NS record doesn't resolve: $ns"
    fi

    # Check if NS domain is available for registration
    whois "${ns%.}" | grep -i "No match\|not found"
done
```

### Step 6: Use Automated Tools

```bash
# Subjack
subjack -w subdomains.txt -t 100 -timeout 30 -o results.txt -ssl

# Nuclei subdomain takeover templates
nuclei -l subdomains.txt -t http/takeovers/

# Can-I-Take-Over-XYZ check
# Reference: https://github.com/EdOverflow/can-i-take-over-xyz
```

---

## Tools

### Subdomain Enumeration

| Tool | Description | Usage |
|------|-------------|-------|
| **Amass** | Comprehensive enum | `amass enum -d target.com` |
| **Subfinder** | Fast discovery | `subfinder -d target.com` |
| **Assetfinder** | Asset discovery | `assetfinder target.com` |

### Takeover Detection

| Tool | Description | Usage |
|------|-------------|-------|
| **Subjack** | Takeover scanner | `subjack -w subs.txt -ssl` |
| **Nuclei** | Template scanner | `nuclei -t takeovers/` |
| **SubOver** | Takeover checker | `SubOver -l subs.txt` |
| **tko-subs** | Takeover detection | `tko-subs -data providers.csv` |

### DNS Tools

| Tool | Description | Usage |
|------|-------------|-------|
| **dig** | DNS lookup | `dig CNAME subdomain.target.com` |
| **dnsrecon** | DNS enumeration | `dnsrecon -d target.com` |
| **dnsx** | DNS toolkit | `dnsx -l subs.txt -cname` |

---

## Example Commands/Payloads

### Comprehensive Takeover Scanner

```bash
#!/bin/bash
TARGET=$1
OUTPUT_DIR="takeover_scan_$(date +%Y%m%d)"
mkdir -p $OUTPUT_DIR

echo "=== SUBDOMAIN TAKEOVER SCAN ==="
echo "Target: $TARGET"
echo ""

# 1. Enumerate subdomains
echo "[+] Enumerating subdomains..."
subfinder -d $TARGET -silent > "$OUTPUT_DIR/subdomains_subfinder.txt"
amass enum -passive -d $TARGET -o "$OUTPUT_DIR/subdomains_amass.txt" 2>/dev/null
curl -s "https://crt.sh/?q=%.$TARGET&output=json" | jq -r '.[].name_value' 2>/dev/null | sort -u > "$OUTPUT_DIR/subdomains_crt.txt"

# Combine
cat "$OUTPUT_DIR"/subdomains_*.txt | sort -u > "$OUTPUT_DIR/all_subdomains.txt"
echo "Found $(wc -l < "$OUTPUT_DIR/all_subdomains.txt") unique subdomains"

# 2. Check DNS resolution
echo ""
echo "[+] Checking DNS resolution..."
while read sub; do
    cname=$(dig +short CNAME "$sub" 2>/dev/null)
    if [ ! -z "$cname" ]; then
        echo "$sub,$cname" >> "$OUTPUT_DIR/cname_records.txt"
    fi
done < "$OUTPUT_DIR/all_subdomains.txt"

# 3. Run subjack
echo ""
echo "[+] Running subjack..."
subjack -w "$OUTPUT_DIR/all_subdomains.txt" -t 100 -timeout 30 -o "$OUTPUT_DIR/subjack_results.txt" -ssl -a 2>/dev/null

# 4. Run nuclei takeover templates
echo ""
echo "[+] Running nuclei takeover checks..."
nuclei -l "$OUTPUT_DIR/all_subdomains.txt" -t http/takeovers/ -o "$OUTPUT_DIR/nuclei_results.txt" 2>/dev/null

# Results
echo ""
echo "[+] Scan complete. Results in $OUTPUT_DIR/"
echo "Potential takeovers:"
cat "$OUTPUT_DIR/subjack_results.txt" 2>/dev/null
cat "$OUTPUT_DIR/nuclei_results.txt" 2>/dev/null
```

### Subjack Usage

```bash
# Install
go install github.com/haccer/subjack@latest

# Basic scan
subjack -w subdomains.txt -t 100 -timeout 30 -ssl

# With output
subjack -w subdomains.txt -t 100 -timeout 30 -ssl -o results.txt

# Verbose
subjack -w subdomains.txt -t 100 -timeout 30 -ssl -v
```

### Nuclei Takeover Templates

```bash
# Run all takeover templates
nuclei -l subdomains.txt -t http/takeovers/

# Specific service
nuclei -l subdomains.txt -t http/takeovers/github-takeover.yaml
nuclei -l subdomains.txt -t http/takeovers/aws-bucket-takeover.yaml
```

---

## Remediation Guide

### 1. Remove Dangling DNS Records

```bash
# Identify and remove unused DNS records
# In DNS management console:
# - Delete CNAME records pointing to decommissioned services
# - Delete A records pointing to released IPs
# - Update NS records if domains expired
```

### 2. Continuous Monitoring

```bash
# Set up regular scanning
# Add to cron:
0 0 * * * /path/to/takeover_scan.sh target.com

# Use OWASP Domain Protect or similar
```

### 3. Service Decommissioning Checklist

1. Remove service/application
2. **Remove DNS records pointing to service**
3. Update documentation
4. Verify DNS cleanup

### 4. Preventive Measures

- Maintain inventory of all subdomains
- Document all external service integrations
- Implement DNS record change alerts
- Regular subdomain audits
- Use TXT records to verify ownership before creating CNAMEs

---

## Risk Assessment

### CVSS Score

**Subdomain Takeover**
- **Base Score**: 8.6 (High)
- **Vector**: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:N/A:N

| Metric | Value | Description |
|--------|-------|-------------|
| Attack Vector | Network | Remote exploitation |
| Attack Complexity | Low | Easy to exploit |
| Privileges Required | None | No auth needed |
| User Interaction | None | Passive attack |
| Scope | Changed | Affects other components |
| Confidentiality | High | Credential theft possible |

### Impact

- Phishing attacks from trusted subdomain
- Cookie stealing (if parent domain)
- Credential harvesting
- Malware distribution
- Brand/reputation damage
- SEO manipulation

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-284** | Improper Access Control | DNS record management |
| **CWE-668** | Exposure of Resource to Wrong Sphere | Subdomain exposure |

---

## References

- [OWASP WSTG - Test for Subdomain Takeover](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/10-Test_for_Subdomain_Takeover)
- [Can I Take Over XYZ?](https://github.com/EdOverflow/can-i-take-over-xyz)
- [Subjack](https://github.com/haccer/subjack)
- [OWASP Amass](https://github.com/owasp-amass/amass)

---

## Checklist

```
[ ] Subdomain enumeration completed
[ ] DNS records analyzed (A, CNAME, NS)
[ ] CNAME targets verified
[ ] Dangling records identified
[ ] HTTP responses checked for takeover indicators
[ ] Automated tools run (subjack, nuclei)
[ ] NS records verified
[ ] Expired domains checked
[ ] Vulnerable subdomains documented
[ ] Risk assessment completed
[ ] Remediation plan provided
```
