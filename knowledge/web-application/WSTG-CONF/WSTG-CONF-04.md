# WSTG-CONF-04: Review Old Backup and Unreferenced Files for Sensitive Information

## Test ID
WSTG-CONF-04

## Test Name
Review Old Backup and Unreferenced Files for Sensitive Information

## High-Level Description

Old backup files, unreferenced pages, and forgotten content can expose sensitive information including source code, credentials, and outdated vulnerable functionality. These files often contain debugging information, database credentials, or reveal application logic that aids attackers. This test focuses on discovering such files through inference, brute-forcing, and examining publicly available information.

---

## What to Check

### File Types to Discover

- [ ] Backup files (.bak, .old, .backup, ~)
- [ ] Temporary files (.tmp, .swp, .temp)
- [ ] Archive files (.zip, .tar, .gz, .rar)
- [ ] Editor files (.bak, ~, .orig)
- [ ] Unreferenced pages
- [ ] Old versions of files
- [ ] Development/test files
- [ ] Snapshot directories
- [ ] Log files
- [ ] Database dumps

### Naming Conventions

| Pattern | Description |
|---------|-------------|
| file~ | Emacs backup |
| file.bak | Generic backup |
| file.old | Old version |
| file.orig | Original version |
| file.save | Saved version |
| file.swp | Vim swap file |
| file.tmp | Temporary file |
| Copy of file | Manual copy |
| file (1).ext | Duplicate |
| file_backup | Backup naming |
| file_YYYYMMDD | Date-based backup |

---

## How to Test

### Step 1: Inference from Naming Schemes

```bash
# If you find viewuser.asp, try:
files=("edituser.asp" "adduser.asp" "deleteuser.asp"
       "listuser.asp" "createuser.asp" "updateuser.asp"
       "modifyuser.asp" "removeuser.asp")

for file in "${files[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://target.com/$file")
    echo "$file: $status"
done
```

### Step 2: Test Backup Extensions

```bash
#!/bin/bash
TARGET=$1
FILE=$2  # e.g., config.php

# Backup extensions
extensions=(
    ".bak" ".backup" ".old" ".orig" ".save" ".swp" ".tmp"
    ".copy" ".1" ".2" "~" "_backup" "_old" "_bak"
    ".txt" ".src" ".inc" ".dev" ".test"
    "-backup" "-old" "-copy" ".BACKUP" ".BAK"
)

for ext in "${extensions[@]}"; do
    test_file="${FILE}${ext}"
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://$TARGET/$test_file")
    if [ "$status" == "200" ]; then
        echo "[FOUND] $test_file"
    fi
done

# Also test prefix patterns
prefixes=("backup_" "old_" "copy_" "bak_" "." "_")
for prefix in "${prefixes[@]}"; do
    test_file="${prefix}${FILE}"
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://$TARGET/$test_file")
    if [ "$status" == "200" ]; then
        echo "[FOUND] $test_file"
    fi
done
```

### Step 3: Archive File Discovery

```bash
# Common archive files
archives=(
    "backup.zip" "backup.tar.gz" "backup.tar" "backup.rar"
    "site.zip" "www.zip" "html.zip" "web.zip"
    "database.sql" "db.sql" "dump.sql" "backup.sql"
    "files.zip" "archive.zip" "old.zip"
)

for file in "${archives[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://target.com/$file")
    if [ "$status" == "200" ]; then
        echo "[CRITICAL] Archive found: $file"
    fi
done

# Date-based backups
for year in 2023 2024 2025; do
    for month in 01 02 03 04 05 06 07 08 09 10 11 12; do
        file="backup_${year}${month}.zip"
        status=$(curl -s -o /dev/null -w "%{http_code}" "https://target.com/$file")
        if [ "$status" == "200" ]; then
            echo "[FOUND] $file"
        fi
    done
done
```

### Step 4: Source Code Review

```bash
# Look in HTML source for hidden links
curl -s https://target.com | grep -oP 'href="[^"]*"' | sort -u

# Look for commented code
curl -s https://target.com | grep -oP '<!--.*?-->'

# Look in JavaScript
curl -s https://target.com | grep -oP 'src="[^"]*\.js[^"]*"' | while read js; do
    curl -s "https://target.com$js" | grep -iE 'admin|backup|test|dev|hidden'
done
```

### Step 5: Robots.txt Analysis

```bash
# Check robots.txt for hidden paths
curl -s https://target.com/robots.txt

# Test disallowed paths
curl -s https://target.com/robots.txt | grep "Disallow" | awk '{print $2}' | while read path; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://target.com$path")
    echo "$path: $status"
done
```

### Step 6: Search Engine Discovery

```
# Google dorks for backups
site:target.com filetype:bak
site:target.com filetype:sql
site:target.com filetype:zip
site:target.com filetype:tar
site:target.com filetype:old
site:target.com "index of" backup
site:target.com inurl:backup
site:target.com intitle:"index of" "backup"
```

### Step 7: Directory Brute-forcing

```bash
# Gobuster
gobuster dir -u https://target.com \
    -w /usr/share/seclists/Discovery/Web-Content/common.txt \
    -x bak,old,backup,zip,tar,gz,sql,tmp \
    -o backup_scan.txt

# ffuf
ffuf -u https://target.com/FUZZ \
    -w /usr/share/seclists/Discovery/Web-Content/backup-filenames.txt \
    -mc 200
```

### Step 8: Snapshot Directory Check

```bash
# Common snapshot paths
snapshots=(
    "/.snapshot/"
    "/.snap/"
    "/~snapshot/"
    "/backup/"
    "/backups/"
    "/old/"
    "/archive/"
    "/archived/"
)

for path in "${snapshots[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://target.com$path")
    if [ "$status" != "404" ]; then
        echo "Potential snapshot: $path - Status: $status"
    fi
done
```

---

## Tools

### Directory/File Scanners

| Tool | Description | Usage |
|------|-------------|-------|
| **Gobuster** | Directory brute-force | `gobuster dir -u url -w wordlist -x bak,old` |
| **ffuf** | Fast fuzzer | `ffuf -u url/FUZZ -w wordlist` |
| **Dirb** | Directory scanner | `dirb https://target.com` |
| **Dirsearch** | Web path scanner | `dirsearch -u target.com` |

### Web Spiders

| Tool | Description |
|------|-------------|
| **wget** | Recursive download |
| **HTTrack** | Website copier |
| **Burp Spider** | Web crawler |

### Vulnerability Scanners

| Tool | Description |
|------|-------------|
| **Nikto** | Web server scanner |
| **Nessus** | Vulnerability scanner |
| **Nuclei** | Template-based scanner |

---

## Example Commands/Payloads

### Comprehensive Backup Scanner

```bash
#!/bin/bash
TARGET=$1

echo "=== BACKUP FILE SCANNER ==="
echo "Target: $TARGET"

# Wordlist of common backup files
backup_files=(
    "backup.zip" "backup.tar.gz" "backup.sql" "database.sql"
    "site.zip" "www.zip" "html.zip" "web.zip"
    "db_backup.sql" "dump.sql" "data.sql"
    "config.php.bak" "wp-config.php.bak" ".htaccess.bak"
    "web.config.bak" "config.yml.bak"
)

# Test each file
for file in "${backup_files[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://$TARGET/$file")
    if [ "$status" == "200" ]; then
        size=$(curl -sI "https://$TARGET/$file" | grep -i content-length | awk '{print $2}' | tr -d '\r')
        echo "[CRITICAL] Found: $file (Size: $size bytes)"
    fi
done

# Test common directories with date patterns
echo ""
echo "[+] Testing date-based backups..."
current_year=$(date +%Y)
for year in $((current_year-1)) $current_year; do
    for month in {01..12}; do
        for ext in zip tar.gz sql; do
            file="backup-${year}-${month}.$ext"
            status=$(curl -s -o /dev/null -w "%{http_code}" "https://$TARGET/$file")
            if [ "$status" == "200" ]; then
                echo "[FOUND] $file"
            fi
        done
    done
done

echo "[+] Scan complete"
```

### Nuclei Backup Templates

```bash
# Run backup-related templates
nuclei -u https://target.com -t http/exposures/backups/
nuclei -u https://target.com -t http/exposures/files/
```

---

## Remediation Guide

### 1. Remove All Backup Files

```bash
# Find and remove backup files
find /var/www/html -name "*.bak" -delete
find /var/www/html -name "*.backup" -delete
find /var/www/html -name "*.old" -delete
find /var/www/html -name "*~" -delete
find /var/www/html -name "*.swp" -delete
find /var/www/html -name "*.tmp" -delete

# Find archives
find /var/www/html -name "*.zip" -o -name "*.tar*" -o -name "*.sql"
```

### 2. Block Backup Extensions

```apache
# Apache
<FilesMatch "\.(bak|backup|old|orig|save|swp|tmp|sql|tar|gz|zip|rar)$">
    Require all denied
</FilesMatch>
```

```nginx
# Nginx
location ~* \.(bak|backup|old|orig|save|swp|tmp|sql|tar|gz|zip|rar)$ {
    deny all;
    return 404;
}
```

### 3. Configuration Management

- Never create backups in web-accessible directories
- Use version control (Git) instead of manual backups
- Implement automated deployment without manual file copying
- Store backups in secure, non-web-accessible locations

### 4. Monitoring

- Implement file integrity monitoring
- Alert on new backup file creation
- Regular audits for backup files

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Source code backup exposed | 7.5 | High |
| Database dump accessible | 9.8 | Critical |
| Config file with credentials | 9.8 | Critical |
| Old vulnerable page | Variable | Variable |

**Typical Vector**: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-530** | Exposure of Backup File | Backup accessible to attackers |
| **CWE-538** | Sensitive Information in Files | Sensitive data in public files |
| **CWE-200** | Information Exposure | Information disclosure |

---

## References

- [OWASP WSTG - Review Old Backup and Unreferenced Files](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/04-Review_Old_Backup_and_Unreferenced_Files_for_Sensitive_Information)
- [SecLists Backup Filenames](https://github.com/danielmiessler/SecLists)

---

## Checklist

```
[ ] Backup extension scanning completed
[ ] Archive files checked (.zip, .tar, .sql)
[ ] Date-based backup patterns tested
[ ] Robots.txt paths tested
[ ] Search engine dorking performed
[ ] Source code reviewed for hidden links
[ ] Snapshot directories checked
[ ] Directory brute-forcing completed
[ ] Unreferenced pages identified
[ ] Sensitive files documented
[ ] Risk assessment completed
```
