# WSTG-CONF-03: Test File Extensions Handling for Sensitive Information

## Test ID
WSTG-CONF-03

## Test Name
Test File Extensions Handling for Sensitive Information

## High-Level Description

This test examines how the web server handles different file extensions. Misconfigured servers may expose source code, include files, backup files, or other sensitive content when requested with specific extensions. Attackers exploit these misconfigurations to access database credentials, API keys, and other sensitive information stored in files that should never be served directly.

---

## What to Check

### Extension Handling

- [ ] Source code disclosure via extensions
- [ ] Include files (.inc, .config)
- [ ] Backup files (.bak, .old, .backup)
- [ ] Temporary files (.tmp, .swp, ~)
- [ ] Archive files (.zip, .tar, .gz)
- [ ] Configuration files
- [ ] Database files (.sql, .db)
- [ ] Log files (.log)
- [ ] Version control files (.git, .svn)

### Server Behavior

- [ ] Which extensions execute vs serve
- [ ] Case sensitivity handling
- [ ] Double extension handling
- [ ] Null byte handling
- [ ] 8.3 filename handling (Windows)

---

## How to Test

### Step 1: Identify Existing Files

```bash
# Spider the site to find existing files
wget --spider -r -l 3 https://target.com 2>&1 | grep -oP 'https?://[^\s]+' > urls.txt

# Extract unique extensions
cat urls.txt | grep -oP '\.[a-zA-Z0-9]+$' | sort -u
```

### Step 2: Test Alternative Extensions

```bash
# For each discovered file, test alternatives
BASE_FILE="config.php"

for ext in \
    .bak .backup .old .orig .save .swp .tmp \
    .txt .inc .src .dev .test \
    .php~ .php.bak .php.old .php.save \
    .1 .2 _backup _old _copy; do

    test_file="${BASE_FILE}${ext}"
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://target.com/$test_file")
    if [ "$status" == "200" ]; then
        echo "FOUND: $test_file"
    fi
done
```

### Step 3: Test Dangerous Extensions

```bash
# Extensions that should never be served
dangerous_exts=(".inc" ".config" ".conf" ".cfg" ".ini"
               ".sql" ".db" ".sqlite" ".mdb"
               ".log" ".bak" ".backup" ".old"
               ".asa" ".asax" ".ascx" ".ashx" ".asmx"
               ".yml" ".yaml" ".json" ".xml"
               ".env" ".htaccess" ".htpasswd")

for ext in "${dangerous_exts[@]}"; do
    # Test common filenames with this extension
    for name in config database connection settings credentials secrets; do
        test_file="${name}${ext}"
        status=$(curl -s -o /dev/null -w "%{http_code}" "https://target.com/$test_file")
        if [ "$status" == "200" ]; then
            echo "FOUND: $test_file"
        fi
    done
done
```

### Step 4: Include File Discovery

```bash
# Common include file patterns
includes=("connection.inc" "config.inc" "database.inc" "db.inc"
          "conn.inc" "settings.inc" "common.inc" "global.inc"
          "init.inc" "functions.inc" "class.inc")

for file in "${includes[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://target.com/$file")
    if [ "$status" == "200" ]; then
        echo "INCLUDE FILE FOUND: $file"
        # Check content for sensitive data
        curl -s "https://target.com/$file" | head -50
    fi
done
```

### Step 5: Version Control Exposure

```bash
# Git directory
curl -s https://target.com/.git/config
curl -s https://target.com/.git/HEAD
curl -s https://target.com/.git/index

# SVN directory
curl -s https://target.com/.svn/entries
curl -s https://target.com/.svn/wc.db

# If .git is accessible, dump repository
# git-dumper (https://github.com/arthaud/git-dumper)
git-dumper https://target.com/.git/ output_dir/
```

### Step 6: Case Sensitivity Testing

```bash
# Test case variations (especially on Windows/IIS)
original="config.php"

variations=("Config.php" "CONFIG.PHP" "config.PHP" "CONFIG.php"
            "config.Php" "cOnFiG.pHp")

for var in "${variations[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://target.com/$var")
    echo "$var: $status"
done
```

### Step 7: Double Extension Testing

```bash
# Double extension bypass attempts
for ext in .php .asp .aspx .jsp; do
    test_files=(
        "file${ext}.txt"
        "file${ext}.jpg"
        "file.txt${ext}"
        "file${ext}."
        "file${ext}::DATA"  # NTFS alternate data stream
    )

    for file in "${test_files[@]}"; do
        status=$(curl -s -o /dev/null -w "%{http_code}" "https://target.com/$file")
        echo "$file: $status"
    done
done
```

### Step 8: Windows 8.3 Filename Testing

```bash
# Windows short filename exploitation
# If file exists as "configuration.php", test:
short_names=("CONFIG~1.PHP" "CONFIG~1.PHT" "SHELL~1.PHP")

for name in "${short_names[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://target.com/$name")
    echo "$name: $status"
done
```

### Step 9: Null Byte Testing (Legacy)

```bash
# Null byte injection (older systems)
curl -s "https://target.com/config.php%00.txt"
curl -s "https://target.com/config.php%00.jpg"
```

---

## Tools

### Automated Scanners

| Tool | Description | Usage |
|------|-------------|-------|
| **Nikto** | Web scanner | `nikto -h target.com` |
| **Dirb** | Directory brute-force | `dirb https://target.com` |
| **Gobuster** | Directory/file enumeration | `gobuster dir -u target.com -w wordlist.txt -x bak,old,txt` |
| **ffuf** | Fast fuzzer | `ffuf -u target.com/FUZZ -w wordlist.txt` |

### Specialized Tools

| Tool | Description | Usage |
|------|-------------|-------|
| **git-dumper** | Git repository extraction | `git-dumper url output/` |
| **svn-extractor** | SVN extraction | Extract SVN repos |
| **GitTools** | Git exploitation | Multiple tools |

---

## Example Commands/Payloads

### Comprehensive Extension Scanner

```bash
#!/bin/bash
TARGET=$1
BASE_PATH=$2  # e.g., /includes/

echo "=== FILE EXTENSION HANDLER TEST ==="

# Dangerous extensions
dangerous=(".inc" ".config" ".conf" ".cfg" ".ini" ".env"
           ".sql" ".db" ".sqlite" ".log" ".bak" ".backup"
           ".old" ".save" ".swp" ".tmp" ".orig")

# Common filenames
filenames=("config" "database" "db" "connection" "conn"
           "settings" "credentials" "secrets" "password"
           "backup" "dump" "export" "import")

# Test combinations
for name in "${filenames[@]}"; do
    for ext in "${dangerous[@]}"; do
        file="${name}${ext}"
        url="https://$TARGET$BASE_PATH$file"
        status=$(curl -s -o /dev/null -w "%{http_code}" "$url")
        if [ "$status" == "200" ]; then
            echo "[CRITICAL] FOUND: $url"
            # Show first 10 lines
            curl -s "$url" | head -10
            echo "---"
        fi
    done
done

# Test for backup extensions on known files
echo "[+] Testing backup extensions..."
known_files=("index.php" "config.php" "database.php" "wp-config.php")
backup_exts=(".bak" ".backup" ".old" ".save" "~" ".orig" ".1" ".2")

for file in "${known_files[@]}"; do
    for ext in "${backup_exts[@]}"; do
        test_url="https://$TARGET/${file}${ext}"
        status=$(curl -s -o /dev/null -w "%{http_code}" "$test_url")
        if [ "$status" == "200" ]; then
            echo "[HIGH] BACKUP FOUND: $test_url"
        fi
    done
done

# Version control
echo "[+] Checking version control..."
vc_files=(".git/config" ".git/HEAD" ".svn/entries" ".svn/wc.db"
          ".hg/hgrc" ".bzr/README" "CVS/Root")

for file in "${vc_files[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://$TARGET/$file")
    if [ "$status" == "200" ]; then
        echo "[CRITICAL] VERSION CONTROL EXPOSED: $file"
    fi
done

echo "[+] Scan complete"
```

### Gobuster with Extensions

```bash
# Scan with multiple extensions
gobuster dir -u https://target.com \
    -w /usr/share/seclists/Discovery/Web-Content/common.txt \
    -x php,bak,old,txt,inc,config,sql,log,backup,env \
    -o gobuster_results.txt

# Specifically for backup files
gobuster dir -u https://target.com \
    -w /usr/share/seclists/Discovery/Web-Content/common.txt \
    -x bak,backup,old,save,orig,swp,tmp,1,2 \
    -o backup_files.txt
```

### ffuf Extension Fuzzing

```bash
# Fuzz file extensions
ffuf -u https://target.com/config.FUZZ \
    -w /usr/share/seclists/Discovery/Web-Content/web-extensions.txt \
    -mc 200

# Fuzz filename with extension
ffuf -u https://target.com/FUZZ.bak \
    -w /usr/share/seclists/Discovery/Web-Content/common.txt \
    -mc 200
```

---

## Remediation Guide

### 1. Block Dangerous Extensions

#### Apache

```apache
# Block specific extensions
<FilesMatch "\.(inc|config|sql|bak|backup|old|log|env)$">
    Require all denied
</FilesMatch>

# Block backup patterns
<FilesMatch "(\.(bak|backup|old|save|swp|tmp)|~)$">
    Require all denied
</FilesMatch>

# Block version control
<DirectoryMatch "^\.|\/\.">
    Require all denied
</DirectoryMatch>
```

#### Nginx

```nginx
# Block dangerous extensions
location ~* \.(inc|config|sql|bak|backup|old|log|env)$ {
    deny all;
    return 404;
}

# Block backup files
location ~* \.(bak|backup|old|save|swp|tmp)$ {
    deny all;
}

# Block version control
location ~ /\. {
    deny all;
}
```

#### IIS (web.config)

```xml
<system.webServer>
    <security>
        <requestFiltering>
            <fileExtensions>
                <add fileExtension=".inc" allowed="false" />
                <add fileExtension=".config" allowed="false" />
                <add fileExtension=".sql" allowed="false" />
                <add fileExtension=".bak" allowed="false" />
                <add fileExtension=".log" allowed="false" />
            </fileExtensions>
            <hiddenSegments>
                <add segment=".git" />
                <add segment=".svn" />
            </hiddenSegments>
        </requestFiltering>
    </security>
</system.webServer>
```

### 2. Use Proper File Locations

```
# Keep sensitive files outside web root
/var/www/html/          <- Web root (public)
/var/www/includes/      <- Include files (outside web root)
/var/www/config/        <- Configuration (outside web root)

# PHP include path
include('/var/www/includes/database.php');
```

### 3. Remove Unnecessary Files

```bash
# Find and remove backup files
find /var/www/html -name "*.bak" -delete
find /var/www/html -name "*.backup" -delete
find /var/www/html -name "*.old" -delete
find /var/www/html -name "*~" -delete
find /var/www/html -name "*.swp" -delete
```

### 4. Rename Include Files

```php
// Use .php extension for include files
// Instead of: database.inc
// Use: database.inc.php

// This ensures PHP processes the file instead of serving it
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Source code disclosure | 7.5 | High |
| Database credentials in .inc | 9.8 | Critical |
| .git directory exposed | 9.8 | Critical |
| Backup files with credentials | 9.8 | Critical |
| Configuration file readable | 7.5-9.8 | High-Critical |
| SQL dump accessible | 9.8 | Critical |

**Typical Vector**: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-200** | Information Exposure | Sensitive file disclosure |
| **CWE-219** | Storage of File with Sensitive Data Under Web Root | Files in wrong location |
| **CWE-530** | Exposure of Backup File to an Unauthorized Control Sphere | Backup file exposure |
| **CWE-538** | Insertion of Sensitive Information into Externally-Accessible File | Config in public files |

---

## References

- [OWASP WSTG - Test File Extensions Handling](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/03-Test_File_Extensions_Handling_for_Sensitive_Information)
- [Git Dumper](https://github.com/arthaud/git-dumper)

---

## Checklist

```
[ ] Known file extensions identified
[ ] Alternative extensions tested (.bak, .old, etc.)
[ ] Include files (.inc) checked
[ ] Configuration files tested
[ ] Backup files scanned
[ ] Version control directories checked (.git, .svn)
[ ] Case sensitivity tested
[ ] Double extensions tested
[ ] Null byte injection tested (legacy)
[ ] Windows 8.3 names tested
[ ] Source code disclosure verified
[ ] Sensitive data exposure documented
[ ] Risk ratings assigned
[ ] Remediation recommendations provided
```
