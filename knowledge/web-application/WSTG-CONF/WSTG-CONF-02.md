# WSTG-CONF-02: Test Application Platform Configuration

## Test ID
WSTG-CONF-02

## Test Name
Test Application Platform Configuration

## High-Level Description

This test examines the configuration of the application platform including web servers, application servers, and their components. Misconfigurations can expose sensitive information, enable attacks, or provide unauthorized access. Key areas include default files, sample applications, debug settings, error handling, and logging mechanisms.

---

## What to Check

### Configuration Elements

- [ ] Default/sample files and applications
- [ ] Debug mode and settings
- [ ] Error handling configuration
- [ ] Logging configuration
- [ ] Server modules and extensions
- [ ] Directory listings
- [ ] Backup files
- [ ] Temporary files
- [ ] Configuration files exposure

### Logging Security

- [ ] Sensitive data in logs
- [ ] Log storage location
- [ ] Log access controls
- [ ] Log rotation policy
- [ ] Log retention period

---

## How to Test

### Step 1: Default File Discovery

```bash
# Common default/sample files
for file in \
    /examples/ \
    /samples/ \
    /docs/ \
    /manual/ \
    /test/ \
    /phpinfo.php \
    /info.php \
    /test.php \
    /server-status \
    /server-info \
    /.htaccess \
    /web.config \
    /crossdomain.xml \
    /clientaccesspolicy.xml; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://target.com$file")
    if [ "$status" != "404" ]; then
        echo "Found: $file - Status: $status"
    fi
done
```

### Step 2: Platform-Specific Checks

#### Apache

```bash
# Apache specific
curl -s https://target.com/server-status
curl -s https://target.com/server-info
curl -s https://target.com/.htaccess
curl -s https://target.com/icons/
curl -s https://target.com/manual/
```

#### IIS

```bash
# IIS specific
curl -s https://target.com/iisstart.htm
curl -s https://target.com/web.config
curl -s https://target.com/trace.axd
curl -s https://target.com/elmah.axd
```

#### Tomcat

```bash
# Tomcat specific
curl -s https://target.com/manager/html
curl -s https://target.com/host-manager/html
curl -s https://target.com/examples/
curl -s https://target.com/docs/
curl -s https://target.com/WEB-INF/web.xml
```

#### PHP

```bash
# PHP specific
curl -s https://target.com/phpinfo.php
curl -s https://target.com/info.php
curl -s https://target.com/php.ini
curl -s https://target.com/test.php
```

### Step 3: Debug Mode Detection

```bash
# Trigger errors to detect debug mode
curl -s "https://target.com/nonexistent"
curl -s "https://target.com/?id='"
curl -s "https://target.com/" -H "Content-Type: invalid"

# Check for debug headers
curl -sI https://target.com | grep -iE 'x-debug|x-trace|x-powered'

# ASP.NET trace
curl -s https://target.com/trace.axd
```

### Step 4: Error Page Analysis

```bash
# Generate different error types
curl -s "https://target.com/nonexistent-page-12345"  # 404
curl -s "https://target.com/" -X INVALID             # 405
curl -s "https://target.com/?id='"                   # 500
curl -s "https://target.com/" -H "Host: invalid"     # 400

# Check if errors reveal sensitive info
# - Stack traces
# - File paths
# - Database info
# - Framework versions
```

### Step 5: Directory Listing Check

```bash
# Check for directory listing
for dir in / /images/ /uploads/ /files/ /assets/ /static/ /css/ /js/; do
    response=$(curl -s "https://target.com$dir")
    if echo "$response" | grep -qi "index of\|directory listing\|parent directory"; then
        echo "Directory listing enabled: $dir"
    fi
done
```

### Step 6: Configuration File Exposure

```bash
# Common configuration files
for file in \
    /config.php \
    /configuration.php \
    /settings.php \
    /database.yml \
    /config.yml \
    /config.json \
    /app.config \
    /web.config \
    /.env \
    /.env.local \
    /.env.production \
    /application.properties \
    /application.yml; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://target.com$file")
    if [ "$status" == "200" ]; then
        echo "FOUND: $file"
    fi
done
```

### Step 7: Backup File Discovery

```bash
# Common backup patterns
for ext in .bak .backup .old .orig .save .swp .tmp ~; do
    for file in index config database settings; do
        for orig_ext in .php .asp .aspx .jsp .html .xml .yml .json; do
            test_file="${file}${orig_ext}${ext}"
            status=$(curl -s -o /dev/null -w "%{http_code}" "https://target.com/$test_file")
            if [ "$status" == "200" ]; then
                echo "FOUND: $test_file"
            fi
        done
    done
done
```

### Step 8: Logging Analysis

If log access is possible (gray-box testing):

```bash
# Check what's being logged
# Look for sensitive data in logs:
grep -r "password\|passwd\|secret\|token\|api_key" /var/log/apache2/
grep -r "password\|passwd\|secret\|token\|api_key" /var/log/nginx/

# Check log permissions
ls -la /var/log/apache2/
ls -la /var/log/nginx/

# Check log rotation
cat /etc/logrotate.d/apache2
```

---

## Tools

### Scanners

| Tool | Description | Usage |
|------|-------------|-------|
| **Nikto** | Web server scanner | `nikto -h target.com` |
| **Nuclei** | Template scanner | `nuclei -u target.com -t misconfigs/` |
| **Gobuster** | Directory brute-force | `gobuster dir -u target.com -w wordlist.txt` |

### Configuration Auditing

| Tool | Description |
|------|-------------|
| **CIS-CAT Lite** | CIS benchmark assessment |
| **Lynis** | Unix security auditing |
| **Microsoft Baseline Security Analyzer** | Windows auditing |

---

## Example Commands/Payloads

### Nuclei Configuration Checks

```bash
# Run misconfiguration templates
nuclei -u https://target.com -t misconfiguration/
nuclei -u https://target.com -t exposures/
nuclei -u https://target.com -t technologies/

# Specific checks
nuclei -u https://target.com -t http/misconfiguration/directory-listing.yaml
nuclei -u https://target.com -t http/exposures/configs/
```

### Comprehensive Config Scanner

```bash
#!/bin/bash
TARGET=$1

echo "=== APPLICATION PLATFORM CONFIG TEST ==="

# Default files
echo "[+] Checking default files..."
defaults=("/phpinfo.php" "/info.php" "/server-status" "/server-info"
          "/.htaccess" "/web.config" "/trace.axd" "/elmah.axd"
          "/examples/" "/manager/html" "/docs/")

for path in "${defaults[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://$TARGET$path")
    if [ "$status" != "404" ] && [ "$status" != "403" ]; then
        echo "  [!] Found: $path (Status: $status)"
    fi
done

# Backup files
echo "[+] Checking backup files..."
backups=("/index.php.bak" "/config.php.bak" "/web.config.bak"
         "/database.yml.bak" "/.env.backup" "/settings.php.old")

for path in "${backups[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://$TARGET$path")
    if [ "$status" == "200" ]; then
        echo "  [!] BACKUP FOUND: $path"
    fi
done

# Directory listing
echo "[+] Checking directory listing..."
dirs=("/" "/images/" "/uploads/" "/files/" "/assets/")

for path in "${dirs[@]}"; do
    if curl -s "https://$TARGET$path" | grep -qi "index of"; then
        echo "  [!] Directory listing: $path"
    fi
done

# Error handling
echo "[+] Testing error handling..."
error_response=$(curl -s "https://$TARGET/nonexistent-12345")
if echo "$error_response" | grep -qiE "stack trace|exception|error in|line [0-9]"; then
    echo "  [!] Verbose error messages detected"
fi

echo "[+] Scan complete"
```

---

## Remediation Guide

### 1. Remove Default Files

```bash
# Apache - remove default content
rm -rf /var/www/html/manual/
rm -rf /var/www/html/icons/

# Tomcat - remove examples
rm -rf $CATALINA_HOME/webapps/examples/
rm -rf $CATALINA_HOME/webapps/docs/

# IIS - remove default documents
# Use IIS Manager to remove default documents
```

### 2. Disable Debug Mode

```php
// PHP - php.ini
display_errors = Off
log_errors = On
error_reporting = E_ALL & ~E_DEPRECATED & ~E_STRICT
```

```xml
<!-- ASP.NET - web.config -->
<system.web>
    <customErrors mode="On" defaultRedirect="/error.html">
        <error statusCode="404" redirect="/404.html"/>
        <error statusCode="500" redirect="/500.html"/>
    </customErrors>
    <compilation debug="false"/>
    <trace enabled="false"/>
</system.web>
```

```python
# Django - settings.py
DEBUG = False
```

### 3. Custom Error Pages

```apache
# Apache
ErrorDocument 400 /errors/400.html
ErrorDocument 401 /errors/401.html
ErrorDocument 403 /errors/403.html
ErrorDocument 404 /errors/404.html
ErrorDocument 500 /errors/500.html
```

```nginx
# nginx
error_page 400 401 403 404 /40x.html;
error_page 500 502 503 504 /50x.html;
```

### 4. Disable Directory Listing

```apache
# Apache
Options -Indexes
```

```nginx
# nginx
autoindex off;
```

### 5. Secure Logging

```apache
# Apache - exclude sensitive data
# Don't log query strings with sensitive data
SetEnvIf Request_URI "password" dontlog
CustomLog logs/access.log combined env=!dontlog
```

```
# Log storage best practices:
- Store logs on separate partition/server
- Restrict log file permissions (640)
- Implement log rotation
- Define retention policy
- Never expose logs to web
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| phpinfo.php exposed | 5.3 | Medium |
| Debug mode enabled | 7.5 | High |
| Backup files accessible | 7.5 | High |
| Directory listing enabled | 5.3 | Medium |
| Sensitive config exposed | 9.8 | Critical |
| Verbose error messages | 5.3 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-16** | Configuration | Improper configuration |
| **CWE-200** | Information Exposure | Sensitive info disclosure |
| **CWE-209** | Error Message Information Exposure | Verbose errors |
| **CWE-215** | Information Exposure Through Debug | Debug info leak |
| **CWE-548** | Directory Listing | Directory enumeration |

---

## References

- [OWASP WSTG - Test Application Platform Configuration](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/02-Test_Application_Platform_Configuration)
- [CIS Benchmarks](https://www.cisecurity.org/cis-benchmarks)

---

## Checklist

```
[ ] Default files checked (phpinfo, examples, docs)
[ ] Sample applications removed/secured
[ ] Debug mode disabled
[ ] Custom error pages implemented
[ ] Directory listing disabled
[ ] Configuration files protected
[ ] Backup files scanned
[ ] Logging configuration reviewed
[ ] Sensitive data not logged
[ ] Log access restricted
[ ] Log rotation configured
[ ] Server modules minimized
[ ] Findings documented
```
