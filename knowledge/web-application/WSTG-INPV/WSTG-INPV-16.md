# WSTG-INPV-16: Testing for HTTP Incoming Requests

## Test ID
WSTG-INPV-16

## Test Name
Testing for HTTP Incoming Requests

## High-Level Description

This test examines how applications handle incoming HTTP requests, including unusual methods, oversized headers, malformed requests, and protocol-level attacks. Proper handling prevents denial of service, information disclosure, and bypass of security controls.

---

## What to Check

- [ ] Oversized headers handling
- [ ] Malformed requests handling
- [ ] HTTP method handling
- [ ] Request body size limits
- [ ] Timeout handling
- [ ] Connection handling

---

## How to Test

### Step 1: Test Request Handling

```bash
#!/bin/bash
TARGET="https://target.com"

echo "[*] Testing HTTP Incoming Request Handling..."

# Oversized header
curl -s -I "$TARGET" \
    -H "X-Oversized: $(python3 -c 'print("A"*8000)')" 2>&1 | head -5

# Multiple same headers
curl -s -I "$TARGET" \
    -H "X-Test: value1" \
    -H "X-Test: value2" \
    -H "X-Test: value3" | head -10

# Malformed HTTP version
echo -e "GET / HTTP/9.9\r\nHost: $TARGET\r\n\r\n" | nc -v $TARGET 80

# Long URI
curl -s "$TARGET/$(python3 -c 'print("A"*4000)')" 2>&1 | head -5
```

### Step 2: HTTP Request Handler Tester

```python
#!/usr/bin/env python3
"""
HTTP Incoming Request Handler Tester
"""

import socket
import ssl
import time
from urllib.parse import urlparse

class HTTPRequestTester:
    def __init__(self, url):
        self.url = url
        self.parsed = urlparse(url)
        self.host = self.parsed.netloc.split(':')[0]
        self.port = 443 if self.parsed.scheme == 'https' else 80
        self.findings = []

    def send_raw(self, data, timeout=10):
        """Send raw data to server"""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)

            if self.parsed.scheme == 'https':
                context = ssl.create_default_context()
                sock = context.wrap_socket(sock, server_hostname=self.host)

            sock.connect((self.host, self.port))
            sock.send(data.encode() if isinstance(data, str) else data)

            response = b""
            try:
                while True:
                    chunk = sock.recv(4096)
                    if not chunk:
                        break
                    response += chunk
            except socket.timeout:
                pass

            sock.close()
            return response.decode('utf-8', errors='ignore')

        except Exception as e:
            return f"Error: {str(e)}"

    def test_oversized_headers(self):
        """Test handling of oversized headers"""
        print("\n[*] Testing oversized header handling...")

        sizes = [1000, 4000, 8000, 16000, 32000]

        for size in sizes:
            header_value = "A" * size
            request = f"""GET / HTTP/1.1\r
Host: {self.host}\r
X-Oversized: {header_value}\r
\r
"""
            response = self.send_raw(request)

            if 'HTTP/1.1 413' in response:
                print(f"  [OK] {size} bytes: 413 Request Entity Too Large")
            elif 'HTTP/1.1 431' in response:
                print(f"  [OK] {size} bytes: 431 Request Header Fields Too Large")
            elif 'HTTP/1.1 400' in response:
                print(f"  [OK] {size} bytes: 400 Bad Request")
            elif 'HTTP/1.' in response:
                print(f"  [INFO] {size} bytes: Accepted")
            else:
                print(f"  [WARN] {size} bytes: Unexpected response")

    def test_long_uri(self):
        """Test handling of long URIs"""
        print("\n[*] Testing long URI handling...")

        sizes = [1000, 2000, 4000, 8000, 16000]

        for size in sizes:
            long_path = "/" + "A" * size
            request = f"""GET {long_path} HTTP/1.1\r
Host: {self.host}\r
\r
"""
            response = self.send_raw(request)

            if 'HTTP/1.1 414' in response:
                print(f"  [OK] {size} char URI: 414 URI Too Long")
            elif 'HTTP/1.1 400' in response:
                print(f"  [OK] {size} char URI: 400 Bad Request")
            elif 'HTTP/1.' in response:
                print(f"  [INFO] {size} char URI: Accepted")

    def test_malformed_requests(self):
        """Test handling of malformed requests"""
        print("\n[*] Testing malformed request handling...")

        malformed_requests = [
            ("GET / HTTP/9.9\r\nHost: {host}\r\n\r\n", "Invalid HTTP version"),
            ("INVALID / HTTP/1.1\r\nHost: {host}\r\n\r\n", "Invalid method"),
            ("GET /\r\nHost: {host}\r\n\r\n", "Missing HTTP version"),
            ("GET / HTTP/1.1\r\n\r\n", "Missing Host header"),
            ("GET / HTTP/1.1\r\nHost:\r\n\r\n", "Empty Host header"),
            ("GET HTTP/1.1\r\nHost: {host}\r\n\r\n", "Missing path"),
            ("\x00GET / HTTP/1.1\r\nHost: {host}\r\n\r\n", "Null byte prefix"),
        ]

        for request_template, description in malformed_requests:
            request = request_template.format(host=self.host)
            response = self.send_raw(request)

            if 'HTTP/1.1 400' in response or 'HTTP/1.1 505' in response:
                print(f"  [OK] {description}: Properly rejected")
            elif 'HTTP/1.1 200' in response:
                print(f"  [WARN] {description}: Accepted (possible issue)")
                self.findings.append({
                    'type': 'Malformed Request Accepted',
                    'description': description,
                    'severity': 'Low'
                })
            else:
                print(f"  [INFO] {description}: {response[:50]}")

    def test_duplicate_headers(self):
        """Test handling of duplicate headers"""
        print("\n[*] Testing duplicate header handling...")

        # Multiple Host headers (potential smuggling vector)
        request = f"""GET / HTTP/1.1\r
Host: {self.host}\r
Host: evil.com\r
\r
"""
        response = self.send_raw(request)
        print(f"  Multiple Host headers: {'Rejected' if '400' in response else 'Accepted'}")

        # Multiple Content-Length
        request = f"""POST / HTTP/1.1\r
Host: {self.host}\r
Content-Length: 10\r
Content-Length: 20\r
\r
1234567890"""

        response = self.send_raw(request)
        if '400' in response:
            print(f"  [OK] Multiple Content-Length: Rejected")
        else:
            print(f"  [WARN] Multiple Content-Length: Accepted")
            self.findings.append({
                'type': 'Duplicate Headers Accepted',
                'header': 'Content-Length',
                'severity': 'Medium'
            })

    def test_slow_request(self):
        """Test slow HTTP request handling (Slowloris-style)"""
        print("\n[*] Testing slow request handling...")

        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(60)

            if self.parsed.scheme == 'https':
                context = ssl.create_default_context()
                sock = context.wrap_socket(sock, server_hostname=self.host)

            sock.connect((self.host, self.port))

            # Send partial request
            sock.send(f"GET / HTTP/1.1\r\nHost: {self.host}\r\n".encode())

            # Wait and send more
            start_time = time.time()
            for i in range(10):
                time.sleep(2)
                sock.send(b"X-Header: value\r\n")
                elapsed = time.time() - start_time

                if elapsed > 15:
                    print(f"  [INFO] Connection maintained for {elapsed:.0f}s")
                    break

            sock.close()

            if elapsed > 10:
                print(f"  [WARN] Server allows slow requests (potential DoS)")
                self.findings.append({
                    'type': 'Slow Request Allowed',
                    'duration': elapsed,
                    'severity': 'Medium'
                })

        except socket.timeout:
            print(f"  [OK] Connection timed out properly")
        except Exception as e:
            print(f"  [INFO] {str(e)}")

    def test_large_body(self):
        """Test large request body handling"""
        print("\n[*] Testing large body handling...")

        sizes = [(1024, "1KB"), (1024*1024, "1MB"), (10*1024*1024, "10MB")]

        for size, label in sizes:
            body = "A" * size
            request = f"""POST / HTTP/1.1\r
Host: {self.host}\r
Content-Type: application/x-www-form-urlencoded\r
Content-Length: {len(body)}\r
\r
{body}"""

            response = self.send_raw(request, timeout=30)

            if '413' in response:
                print(f"  [OK] {label}: 413 Payload Too Large")
                break
            elif '400' in response or '500' in response:
                print(f"  [INFO] {label}: Rejected with error")
            else:
                print(f"  [INFO] {label}: Accepted")

    def generate_report(self):
        """Generate findings report"""
        print("\n" + "="*60)
        print("HTTP REQUEST HANDLING REPORT")
        print("="*60)

        if not self.findings:
            print("\nNo significant issues found.")
        else:
            for f in self.findings:
                print(f"\n[{f['severity']}] {f['type']}")
                if 'description' in f:
                    print(f"  Description: {f['description']}")

    def run_tests(self):
        """Run all tests"""
        self.test_oversized_headers()
        self.test_long_uri()
        self.test_malformed_requests()
        self.test_duplicate_headers()
        self.test_slow_request()
        self.test_large_body()
        self.generate_report()

# Usage
tester = HTTPRequestTester("https://target.com")
tester.run_tests()
```

---

## Tools

| Tool | Purpose |
|------|---------|
| curl | Basic testing |
| netcat | Raw request sending |
| slowhttptest | Slow HTTP DoS testing |

---

## Remediation

```nginx
# Nginx - Request limits
client_max_body_size 10m;
client_header_buffer_size 1k;
large_client_header_buffers 4 8k;
client_body_timeout 10s;
client_header_timeout 10s;
```

```apache
# Apache - Request limits
LimitRequestBody 10485760
LimitRequestFields 100
LimitRequestFieldSize 8190
LimitRequestLine 8190
Timeout 60
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| No request size limits | 5.3 | Medium |
| Slow HTTP DoS possible | 5.3 | Medium |
| Malformed request acceptance | 4.3 | Medium |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-400** | Uncontrolled Resource Consumption |

---

## Checklist

```
[ ] Oversized headers tested
[ ] Long URIs tested
[ ] Malformed requests tested
[ ] Duplicate headers tested
[ ] Slow requests tested
[ ] Large body tested
[ ] Findings documented
```
