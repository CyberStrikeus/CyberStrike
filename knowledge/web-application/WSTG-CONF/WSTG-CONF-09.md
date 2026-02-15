# WSTG-CONF-09: Test File Permission

## Test ID
WSTG-CONF-09

## Test Name
Test File Permission

## High-Level Description

Incorrect file permissions can expose sensitive data, allow unauthorized modifications, or enable code execution. This test examines file and directory permissions to identify overly permissive settings that could be exploited by attackers. Proper file permissions are a critical component of defense-in-depth security.

---

## What to Check

### Files and Directories to Review

- [ ] Web application files
- [ ] Configuration files
- [ ] Sensitive data files (encrypted data, keys)
- [ ] Log files
- [ ] Executable files (scripts, binaries)
- [ ] Database files
- [ ] Temporary files
- [ ] Upload directories
- [ ] Backup files

### Permission Issues

- [ ] World-readable sensitive files
- [ ] World-writable directories
- [ ] Executable permissions on data files
- [ ] SUID/SGID binaries
- [ ] Incorrect ownership

---

## How to Test

### Step 1: List File Permissions (Linux)

```bash
# List permissions in web directory
ls -la /var/www/html/

# Recursive listing
ls -laR /var/www/html/

# Using namei for path permissions
namei -l /var/www/html/config/database.php

# Find world-writable files
find /var/www/html -perm -0002 -type f

# Find world-writable directories
find /var/www/html -perm -0002 -type d

# Find SUID files
find /var/www/html -perm -4000 -type f

# Find files owned by root
find /var/www/html -user root -type f
```

### Step 2: Check Sensitive Files

```bash
# Configuration files
ls -la /var/www/html/config/
ls -la /var/www/html/.env
ls -la /var/www/html/wp-config.php

# Should be readable only by web server user
# Recommended: 640 or 600

# Log files
ls -la /var/log/apache2/
ls -la /var/log/nginx/

# Database files
ls -la /var/lib/mysql/
```

### Step 3: Check Upload Directories

```bash
# Upload directories should not allow execution
ls -la /var/www/html/uploads/
ls -la /var/www/html/media/
ls -la /var/www/html/files/

# Check for executable files in upload dirs
find /var/www/html/uploads -type f \( -name "*.php" -o -name "*.sh" -o -name "*.pl" \)
```

### Step 4: Windows Permission Check

```powershell
# List permissions
icacls C:\inetpub\wwwroot\

# Recursive
icacls C:\inetpub\wwwroot\ /T

# Check specific file
icacls C:\inetpub\wwwroot\web.config
```

### Step 5: Remote Testing (Black Box)

```bash
# Try to access sensitive files via web
curl -s https://target.com/.htaccess
curl -s https://target.com/web.config
curl -s https://target.com/config/database.yml
curl -s https://target.com/.env

# Check for directory listing
curl -s https://target.com/uploads/
curl -s https://target.com/config/
curl -s https://target.com/logs/
```

---

## Tools

### Linux Tools

| Tool | Description | Usage |
|------|-------------|-------|
| **ls** | List files | `ls -la /path` |
| **namei** | Path permissions | `namei -l /path/to/file` |
| **find** | Find files | `find /path -perm mode` |
| **stat** | File status | `stat /path/to/file` |
| **getfacl** | ACL permissions | `getfacl /path/to/file` |

### Windows Tools

| Tool | Description |
|------|-------------|
| **icacls** | Display/modify ACLs |
| **AccessChk** | Sysinternals tool |
| **AccessEnum** | Permission enumeration |

### Automated

| Tool | Description |
|------|-------------|
| **Lynis** | Security auditing |
| **Linux Exploit Suggester** | Permission checks |

---

## Example Commands/Payloads

### Permission Audit Script (Linux)

```bash
#!/bin/bash
WEBROOT=${1:-"/var/www/html"}

echo "=== FILE PERMISSION AUDIT ==="
echo "Web Root: $WEBROOT"
echo ""

# World-writable files
echo "[+] World-writable files:"
find "$WEBROOT" -perm -0002 -type f 2>/dev/null

# World-writable directories
echo ""
echo "[+] World-writable directories:"
find "$WEBROOT" -perm -0002 -type d 2>/dev/null

# SUID files
echo ""
echo "[+] SUID files:"
find "$WEBROOT" -perm -4000 -type f 2>/dev/null

# Config files with loose permissions
echo ""
echo "[+] Config files with permissions > 640:"
find "$WEBROOT" -name "*.conf" -o -name "*.config" -o -name "*.ini" -o -name "*.env" 2>/dev/null | while read file; do
    perms=$(stat -c %a "$file" 2>/dev/null)
    if [ "$perms" -gt 640 ]; then
        echo "$file: $perms"
    fi
done

# PHP files in upload directories
echo ""
echo "[+] PHP files in upload directories:"
for dir in uploads files media documents; do
    find "$WEBROOT/$dir" -name "*.php" 2>/dev/null
done

echo ""
echo "[+] Audit complete"
```

### Recommended Permissions

```bash
# Web files (read-only)
find /var/www/html -type f -exec chmod 644 {} \;

# Directories (read + execute)
find /var/www/html -type d -exec chmod 755 {} \;

# Configuration files (restrictive)
chmod 640 /var/www/html/config/*.php
chmod 640 /var/www/html/.env

# Upload directories (no execution)
chmod 755 /var/www/html/uploads
# Use .htaccess to prevent PHP execution
```

---

## Remediation Guide

### 1. Standard Web Permissions

```bash
# Set ownership
chown -R www-data:www-data /var/www/html

# Files: 644 (rw-r--r--)
find /var/www/html -type f -exec chmod 644 {} \;

# Directories: 755 (rwxr-xr-x)
find /var/www/html -type d -exec chmod 755 {} \;
```

### 2. Sensitive File Permissions

```bash
# Config files: 640 (rw-r-----)
chmod 640 /var/www/html/config/*
chmod 640 /var/www/html/.env
chmod 640 /var/www/html/wp-config.php

# Private keys: 600 (rw-------)
chmod 600 /var/www/html/keys/*
chmod 600 ~/.ssh/id_rsa
```

### 3. Upload Directory Security

```bash
# Set permissions
chmod 755 /var/www/html/uploads

# Apache - Prevent PHP execution
# Create /var/www/html/uploads/.htaccess
echo "php_flag engine off" > /var/www/html/uploads/.htaccess

# Or use FilesMatch
cat > /var/www/html/uploads/.htaccess << 'EOF'
<FilesMatch "\.(php|phtml|php3|php4|php5|php7|phps|phar)$">
    Require all denied
</FilesMatch>
EOF
```

```nginx
# Nginx - Prevent PHP execution in uploads
location ~* /uploads/.*\.php$ {
    deny all;
}
```

### 4. Log File Permissions

```bash
# Logs readable only by root/admin
chmod 640 /var/log/apache2/*
chmod 640 /var/log/nginx/*

# Owned by root
chown root:adm /var/log/apache2/*
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| World-writable config file | 9.8 | Critical |
| Executable in upload dir | 9.8 | Critical |
| World-readable credentials | 7.5 | High |
| Overly permissive directories | 5.3 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-732** | Incorrect Permission Assignment for Critical Resource | Improper file permissions |
| **CWE-276** | Incorrect Default Permissions | Default permissions too permissive |
| **CWE-284** | Improper Access Control | Access control failure |

---

## References

- [OWASP WSTG - Test File Permission](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/09-Test_File_Permission)
- [Linux File Permissions](https://wiki.archlinux.org/title/File_permissions_and_attributes)

---

## Checklist

```
[ ] Web directory permissions reviewed
[ ] Configuration file permissions checked
[ ] Sensitive files restricted (600/640)
[ ] Upload directories checked
[ ] No PHP files in upload directories
[ ] Log file permissions verified
[ ] World-writable files identified
[ ] SUID/SGID files reviewed
[ ] Ownership verified
[ ] Remediation recommendations provided
```
