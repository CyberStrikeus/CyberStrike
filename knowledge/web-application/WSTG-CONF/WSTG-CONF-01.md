# WSTG-CONF-01: Test Network Infrastructure Configuration

## Test ID
WSTG-CONF-01

## Test Name
Test Network Infrastructure Configuration

## High-Level Description

This test evaluates the security configuration of network infrastructure components that support the web application. It includes assessing web servers, application servers, database servers, load balancers, and administrative interfaces for misconfigurations, default credentials, and known vulnerabilities. Proper network infrastructure hardening is essential as vulnerabilities in these components can provide attackers with direct access to sensitive systems.

---

## What to Check

### Infrastructure Components

- [ ] Web server configuration
- [ ] Application server settings
- [ ] Database server exposure
- [ ] Load balancer configuration
- [ ] Firewall rules
- [ ] Network segmentation
- [ ] Administrative interfaces
- [ ] Management ports/protocols
- [ ] Default credentials
- [ ] Patch levels and versions

### Administrative Interfaces

- [ ] Web-based admin panels
- [ ] SSH/RDP access
- [ ] FTP/SFTP services
- [ ] Database management tools (phpMyAdmin, etc.)
- [ ] Cloud management consoles
- [ ] Container orchestration UIs
- [ ] Monitoring dashboards

---

## How to Test

### Step 1: Infrastructure Discovery

```bash
# Port scanning for common services
nmap -sV -sC -p- target.com

# Quick scan of common ports
nmap -sV -p 21,22,23,25,80,110,143,443,445,3306,3389,5432,8080,8443 target.com

# UDP scan for additional services
nmap -sU -p 53,67,68,69,123,161,500 target.com
```

### Step 2: Vulnerability Scanning

```bash
# Nessus scan (commercial)
# Configure and run via web interface

# OpenVAS scan (open source)
omp -u admin -w password --xml="<create_target><name>target</name><hosts>target.com</hosts></create_target>"

# Nikto web server scan
nikto -h https://target.com

# Nmap vulnerability scripts
nmap --script vuln target.com
```

### Step 3: Administrative Interface Discovery

```bash
# Common admin paths
for path in admin administrator manager console cpanel plesk webmin phpmyadmin adminer; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://target.com/$path")
    echo "$path: $status"
done

# Common admin ports
nmap -sV -p 8080,8443,9090,10000,2082,2083,2086,2087 target.com
```

### Step 4: Default Credential Testing

#### Common Default Credentials

| Service | Username | Password |
|---------|----------|----------|
| Tomcat | admin | admin |
| Tomcat | tomcat | tomcat |
| Jenkins | admin | admin |
| JBoss | admin | admin |
| WebLogic | weblogic | weblogic |
| phpMyAdmin | root | (empty) |
| MongoDB | (none) | (none) |
| Redis | (none) | (none) |
| Elasticsearch | elastic | changeme |

```bash
# Test Tomcat default credentials
curl -u admin:admin https://target.com:8080/manager/html

# Test Jenkins
curl -u admin:admin https://target.com:8080/jenkins/

# Hydra brute force (with permission)
hydra -L users.txt -P passwords.txt target.com http-get /admin
```

### Step 5: SSL/TLS Configuration Testing

```bash
# SSL Labs style test
sslyze --regular target.com

# testssl.sh
testssl.sh target.com

# Nmap SSL scripts
nmap --script ssl-enum-ciphers -p 443 target.com
```

### Step 6: Service Configuration Review

```bash
# Check for information disclosure
curl -sI https://target.com | grep -i server

# Check security headers
curl -sI https://target.com | grep -iE 'x-frame|x-content|x-xss|strict-transport|content-security'

# Check for debugging enabled
curl -s https://target.com | grep -iE 'debug|trace|stack'
```

---

## Tools

### Vulnerability Scanners

| Tool | Type | Usage |
|------|------|-------|
| **Nessus** | Commercial | Comprehensive vulnerability scanning |
| **OpenVAS** | Open Source | Network vulnerability scanning |
| **Qualys** | Commercial | Cloud-based scanning |
| **Nexpose** | Commercial | Vulnerability management |

### Network Scanners

| Tool | Description | Usage |
|------|-------------|-------|
| **Nmap** | Port/service scanner | `nmap -sV -sC target.com` |
| **Masscan** | Fast port scanner | `masscan -p1-65535 target.com` |
| **Zmap** | Internet scanner | Large-scale scanning |

### Web Scanners

| Tool | Description | Usage |
|------|-------------|-------|
| **Nikto** | Web server scanner | `nikto -h target.com` |
| **Nuclei** | Template-based scanner | `nuclei -u target.com` |
| **WPScan** | WordPress scanner | `wpscan --url target.com` |

### SSL/TLS Testing

| Tool | Description | Usage |
|------|-------------|-------|
| **testssl.sh** | SSL testing | `testssl.sh target.com` |
| **sslyze** | SSL analysis | `sslyze target.com` |
| **SSL Labs** | Online testing | ssllabs.com |

---

## Example Commands/Payloads

### Comprehensive Infrastructure Scan

```bash
#!/bin/bash
TARGET=$1

echo "=== INFRASTRUCTURE SECURITY SCAN ==="

# 1. Port Discovery
echo "[+] Port Scanning..."
nmap -sV -sC -oN nmap_results.txt $TARGET

# 2. Vulnerability Scan
echo "[+] Vulnerability Scanning..."
nmap --script vuln -oN vuln_results.txt $TARGET

# 3. SSL/TLS Check
echo "[+] SSL/TLS Analysis..."
testssl.sh $TARGET > ssl_results.txt

# 4. Web Server Scan
echo "[+] Web Server Scanning..."
nikto -h https://$TARGET -o nikto_results.txt

# 5. Admin Interface Discovery
echo "[+] Admin Interface Discovery..."
gobuster dir -u https://$TARGET -w /usr/share/seclists/Discovery/Web-Content/common.txt -o dirs.txt

echo "[+] Scan Complete"
```

### Nuclei Infrastructure Templates

```bash
# Install nuclei
go install -v github.com/projectdiscovery/nuclei/v2/cmd/nuclei@latest

# Run infrastructure templates
nuclei -u https://target.com -t cves/
nuclei -u https://target.com -t misconfigurations/
nuclei -u https://target.com -t default-logins/
nuclei -u https://target.com -t exposed-panels/
```

---

## Remediation Guide

### 1. Patch Management

- Maintain current patch levels on all systems
- Subscribe to vendor security advisories
- Implement automated patch management
- Test patches before production deployment

### 2. Hardening Guidelines

```bash
# Disable unnecessary services
systemctl disable telnet
systemctl disable ftp

# Configure firewall (iptables example)
iptables -A INPUT -p tcp --dport 22 -s trusted_ip -j ACCEPT
iptables -A INPUT -p tcp --dport 22 -j DROP

# Restrict administrative access
# Allow admin interfaces only from internal network
```

### 3. Default Credential Removal

- Change all default credentials immediately after installation
- Implement strong password policies
- Use key-based authentication where possible
- Document all credential changes

### 4. Network Segmentation

```
[Internet]
    |
[DMZ - Web Servers]
    |
[Internal - App Servers]
    |
[Restricted - Database Servers]
    |
[Management - Admin Access]
```

### 5. Access Control

- Restrict administrative interfaces to internal networks
- Implement IP whitelisting
- Use VPN for remote administration
- Enable MFA for all admin access

---

## Risk Assessment

### CVSS Score

Variable based on findings. Common scenarios:

| Finding | CVSS | Severity |
|---------|------|----------|
| Default credentials on admin panel | 9.8 | Critical |
| Unpatched critical vulnerability | 9.8 | Critical |
| Exposed database port | 7.5 | High |
| Missing security headers | 5.3 | Medium |
| Version disclosure | 5.3 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-16** | Configuration | Improper configuration |
| **CWE-200** | Information Exposure | Version/config disclosure |
| **CWE-287** | Improper Authentication | Default credentials |
| **CWE-693** | Protection Mechanism Failure | Missing hardening |

---

## References

- [OWASP WSTG - Test Network Infrastructure](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/01-Test_Network_Infrastructure_Configuration)
- [CIS Benchmarks](https://www.cisecurity.org/cis-benchmarks)
- [NIST Checklist Program](https://nvd.nist.gov/ncp/repository)

---

## Checklist

```
[ ] Port scan completed
[ ] Service versions identified
[ ] Vulnerability scan performed
[ ] Administrative interfaces discovered
[ ] Default credentials tested
[ ] SSL/TLS configuration reviewed
[ ] Security headers checked
[ ] Patch levels assessed
[ ] Network segmentation verified
[ ] Access controls reviewed
[ ] Findings documented
[ ] Risk ratings assigned
```
