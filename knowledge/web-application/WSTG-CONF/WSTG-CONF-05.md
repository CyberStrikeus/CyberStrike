# WSTG-CONF-05: Enumerate Infrastructure and Application Admin Interfaces

## Test ID
WSTG-CONF-05

## Test Name
Enumerate Infrastructure and Application Admin Interfaces

## High-Level Description

Administrative interfaces provide privileged access to application and infrastructure management functions. These interfaces are high-value targets for attackers as they often allow configuration changes, user management, and access to sensitive data. This test identifies hidden or poorly protected admin interfaces through directory enumeration, port scanning, and analysis of application behavior.

---

## What to Check

### Admin Interface Types

- [ ] Application admin panels
- [ ] CMS admin interfaces
- [ ] Database management tools
- [ ] Server management consoles
- [ ] Cloud management portals
- [ ] API management interfaces
- [ ] Monitoring dashboards
- [ ] Log viewers

### Discovery Methods

- [ ] Common path enumeration
- [ ] Non-standard ports
- [ ] Subdomain enumeration
- [ ] Parameter/cookie manipulation
- [ ] Source code analysis
- [ ] Documentation review

---

## How to Test

### Step 1: Common Admin Path Enumeration

```bash
#!/bin/bash
TARGET=$1

# Common admin paths
admin_paths=(
    "/admin" "/admin/" "/administrator" "/administrator/"
    "/admin.php" "/admin.html" "/admin.asp" "/admin.aspx"
    "/login" "/login.php" "/signin" "/auth"
    "/manage" "/manager" "/management"
    "/console" "/dashboard" "/control" "/controlpanel"
    "/panel" "/cpanel" "/portal"
    "/backend" "/backoffice" "/system"
    "/sysadmin" "/superadmin" "/root"
    "/secure" "/private" "/internal"
)

echo "=== ADMIN INTERFACE ENUMERATION ==="
for path in "${admin_paths[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://$TARGET$path")
    if [ "$status" != "404" ]; then
        echo "[+] $path - Status: $status"
    fi
done
```

### Step 2: CMS-Specific Admin Paths

```bash
# WordPress
wp_paths=("/wp-admin" "/wp-admin/" "/wp-login.php"
          "/wp-admin/admin-ajax.php" "/xmlrpc.php")

# Joomla
joomla_paths=("/administrator" "/administrator/"
              "/administrator/index.php")

# Drupal
drupal_paths=("/admin" "/user/login" "/user" "/admin/content")

# Magento
magento_paths=("/admin" "/admin_xxxxx" "/backend")

# Test all CMS paths
for path in "${wp_paths[@]}" "${joomla_paths[@]}" "${drupal_paths[@]}" "${magento_paths[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://target.com$path")
    echo "$path: $status"
done
```

### Step 3: Server Admin Interfaces

```bash
# Web server status pages
curl -s https://target.com/server-status    # Apache
curl -s https://target.com/server-info      # Apache
curl -s https://target.com/nginx_status     # Nginx

# Application servers
curl -s https://target.com:8080/manager/html     # Tomcat
curl -s https://target.com:8080/host-manager     # Tomcat
curl -s https://target.com/jmx-console           # JBoss
curl -s https://target.com/web-console           # JBoss
curl -s https://target.com/admin-console         # WebLogic

# Database interfaces
curl -s https://target.com/phpmyadmin
curl -s https://target.com/pma
curl -s https://target.com/adminer
curl -s https://target.com/adminer.php
```

### Step 4: Port-Based Admin Discovery

```bash
# Common admin ports
nmap -sV -p 8080,8443,9090,9443,10000,2082,2083,2086,2087,8000,3000,4443,5000 target.com

# Specific service ports
# 8080 - Tomcat, Jenkins, alternative HTTP
# 8443 - HTTPS alternative
# 9090 - Cockpit, Prometheus
# 10000 - Webmin
# 2082/2083 - cPanel
# 2086/2087 - WHM
# 8000 - Django dev, various
# 3000 - Grafana, Node.js
# 5000 - Flask
```

### Step 5: Subdomain Admin Interfaces

```bash
# Common admin subdomains
subdomains=("admin" "administrator" "manage" "management"
            "panel" "console" "dashboard" "backend"
            "cms" "control" "portal" "secure"
            "internal" "intranet" "staff" "sysadmin")

for sub in "${subdomains[@]}"; do
    host="${sub}.target.com"
    if host "$host" > /dev/null 2>&1; then
        echo "[+] Found: $host"
        curl -sI "https://$host" | head -5
    fi
done
```

### Step 6: Parameter/Cookie Manipulation

```bash
# Check for admin parameters
curl -s "https://target.com/index.php?admin=true"
curl -s "https://target.com/index.php?debug=1"
curl -s "https://target.com/index.php?test=1"

# Check cookies
curl -sI https://target.com | grep -i "set-cookie"

# Test with modified cookies
curl -s https://target.com -H "Cookie: admin=1"
curl -s https://target.com -H "Cookie: isAdmin=true"
curl -s https://target.com -H "Cookie: role=admin"
```

### Step 7: Source Code Analysis

```bash
# Look for admin links in source
curl -s https://target.com | grep -iE 'admin|manage|dashboard|console|control'

# Check JavaScript files
curl -s https://target.com | grep -oP 'src="[^"]*\.js"' | while read js; do
    curl -s "https://target.com$js" | grep -iE 'admin|/manage|/control|/dashboard'
done
```

### Step 8: Hidden Form Field Analysis

```bash
# Look for hidden admin fields
curl -s https://target.com/login | grep -i 'type="hidden"'

# Common hidden fields to look for:
# <input type="hidden" name="admin" value="0">
# <input type="hidden" name="role" value="user">
# <input type="hidden" name="isAdmin" value="false">
```

---

## Tools

### Directory Enumeration

| Tool | Description | Usage |
|------|-------------|-------|
| **Gobuster** | Directory brute-force | `gobuster dir -u target.com -w admin-wordlist.txt` |
| **ffuf** | Fast fuzzer | `ffuf -u target.com/FUZZ -w admin-paths.txt` |
| **Dirb** | Directory scanner | `dirb https://target.com` |
| **ZAP Forced Browse** | OWASP scanner | GUI-based |

### Port Scanning

| Tool | Description | Usage |
|------|-------------|-------|
| **Nmap** | Port scanner | `nmap -sV -p- target.com` |
| **Masscan** | Fast scanner | `masscan -p1-65535 target.com` |

### Brute Force

| Tool | Description | Usage |
|------|-------------|-------|
| **Hydra** | Password brute-force | `hydra -L users.txt -P pass.txt target.com http-form-post` |
| **Burp Intruder** | Web brute-force | GUI-based |

---

## Example Commands/Payloads

### Comprehensive Admin Scanner

```bash
#!/bin/bash
TARGET=$1

echo "=== ADMIN INTERFACE SCANNER ==="
echo "Target: $TARGET"
echo ""

# 1. Directory enumeration
echo "[+] Scanning admin paths..."
gobuster dir -u "https://$TARGET" \
    -w /usr/share/seclists/Discovery/Web-Content/combined-wordlists/combined-admin-paths.txt \
    -t 50 -q -o admin_paths.txt

# 2. Port scanning
echo "[+] Scanning admin ports..."
nmap -sV -p 8080,8443,9090,9443,10000,2082,2083,2086,2087 $TARGET -oN admin_ports.txt

# 3. Subdomain check
echo "[+] Checking admin subdomains..."
for sub in admin manage panel console dashboard; do
    host="${sub}.$TARGET"
    if dig +short "$host" | grep -q '^[0-9]'; then
        echo "  [!] Found subdomain: $host"
    fi
done

# 4. CMS detection and specific paths
echo "[+] Checking CMS-specific paths..."
# WordPress
if curl -s "https://$TARGET/wp-login.php" | grep -q "WordPress"; then
    echo "  [!] WordPress detected"
    echo "  Admin: https://$TARGET/wp-admin/"
fi

# Joomla
if curl -s "https://$TARGET/administrator/" | grep -qi "joomla"; then
    echo "  [!] Joomla detected"
    echo "  Admin: https://$TARGET/administrator/"
fi

echo "[+] Scan complete. Review output files."
```

### Nuclei Admin Templates

```bash
# Run admin panel detection templates
nuclei -u https://target.com -t http/exposed-panels/
nuclei -u https://target.com -t http/default-logins/
```

---

## Remediation Guide

### 1. Access Control

```apache
# Apache - Restrict admin to IP
<Location /admin>
    Require ip 10.0.0.0/8
    Require ip 192.168.0.0/16
</Location>
```

```nginx
# Nginx - IP restriction
location /admin {
    allow 10.0.0.0/8;
    allow 192.168.0.0/16;
    deny all;
}
```

### 2. Non-Standard Paths

- Use unpredictable admin URLs
- Implement URL obfuscation
- Don't rely solely on obscurity

### 3. Authentication Hardening

- Implement MFA for admin access
- Use strong password policies
- Enable account lockout
- Implement session timeout

### 4. Network Segmentation

- Place admin interfaces on internal network
- Require VPN for remote admin access
- Use dedicated admin networks

### 5. Monitoring

- Log all admin access attempts
- Alert on failed login attempts
- Monitor for unauthorized access patterns

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Admin panel with default creds | 9.8 | Critical |
| Admin panel accessible externally | 7.5 | High |
| Admin panel with weak auth | 8.8 | High |
| Admin subdomain discovered | 5.3 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-200** | Information Exposure | Admin interface disclosure |
| **CWE-284** | Improper Access Control | Insufficient protection |
| **CWE-287** | Improper Authentication | Weak admin authentication |

---

## References

- [OWASP WSTG - Enumerate Admin Interfaces](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/05-Enumerate_Infrastructure_and_Application_Admin_Interfaces)
- [SecLists Admin Paths](https://github.com/danielmiessler/SecLists)

---

## Checklist

```
[ ] Common admin paths tested
[ ] CMS-specific paths checked
[ ] Alternative ports scanned
[ ] Admin subdomains enumerated
[ ] Source code analyzed for admin links
[ ] Hidden form fields examined
[ ] Parameter manipulation tested
[ ] Cookie manipulation tested
[ ] Default credentials tested
[ ] Access controls verified
[ ] Findings documented
```
