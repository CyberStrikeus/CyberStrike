# WSTG-CRYP-01: Testing for Weak Transport Layer Security

## Test ID
WSTG-CRYP-01

## Test Name
Testing for Weak Transport Layer Security

## High-Level Description

Transport Layer Security (TLS) protects data in transit between clients and servers. Weak TLS configurations can allow attackers to intercept, decrypt, or modify communications. This test evaluates the strength of TLS implementation including protocol versions, cipher suites, certificate validity, and proper configuration.

---

## What to Check

### TLS Configuration

- [ ] Protocol versions (TLS 1.2/1.3 only)
- [ ] Cipher suite strength
- [ ] Certificate validity and chain
- [ ] HSTS implementation
- [ ] Certificate pinning (mobile)
- [ ] Mixed content issues
- [ ] Forward secrecy support

### Known Vulnerabilities

| Issue | Description |
|-------|-------------|
| SSLv2/SSLv3 | Obsolete, insecure protocols |
| TLS 1.0/1.1 | Deprecated, weak |
| BEAST | CBC vulnerability |
| POODLE | SSLv3 vulnerability |
| Heartbleed | OpenSSL vulnerability |
| CRIME/BREACH | Compression attacks |

---

## How to Test

### Step 1: Test TLS Configuration with Nmap

```bash
#!/bin/bash
TARGET="target.com"

# Enumerate SSL/TLS
nmap --script ssl-enum-ciphers -p 443 $TARGET

# Check for specific vulnerabilities
nmap --script ssl-heartbleed -p 443 $TARGET
nmap --script ssl-poodle -p 443 $TARGET
nmap --script ssl-ccs-injection -p 443 $TARGET
```

### Step 2: Test with SSLScan

```bash
# Comprehensive SSL/TLS scan
sslscan target.com

# Specific checks
sslscan --no-failed target.com
sslscan --show-certificate target.com
```

### Step 3: Test with testssl.sh

```bash
# Full scan
./testssl.sh target.com

# Specific tests
./testssl.sh --protocols target.com
./testssl.sh --ciphers target.com
./testssl.sh --vulnerable target.com
./testssl.sh --headers target.com
```

### Step 4: OpenSSL Manual Tests

```bash
#!/bin/bash
TARGET="target.com:443"

# Test TLS versions
echo "=== Testing Protocol Versions ==="
for version in ssl2 ssl3 tls1 tls1_1 tls1_2 tls1_3; do
    result=$(echo | openssl s_client -connect $TARGET -$version 2>&1)
    if echo "$result" | grep -q "CONNECTED"; then
        echo "$version: SUPPORTED"
    else
        echo "$version: NOT SUPPORTED"
    fi
done

# Test cipher suites
echo -e "\n=== Testing Cipher Suites ==="
openssl s_client -connect $TARGET -cipher 'NULL' 2>&1 | grep -q "CONNECTED" && \
    echo "[VULN] NULL cipher supported"

openssl s_client -connect $TARGET -cipher 'EXPORT' 2>&1 | grep -q "CONNECTED" && \
    echo "[VULN] EXPORT cipher supported"

openssl s_client -connect $TARGET -cipher 'DES' 2>&1 | grep -q "CONNECTED" && \
    echo "[VULN] DES cipher supported"

openssl s_client -connect $TARGET -cipher 'RC4' 2>&1 | grep -q "CONNECTED" && \
    echo "[VULN] RC4 cipher supported"

# Check certificate
echo -e "\n=== Certificate Info ==="
echo | openssl s_client -connect $TARGET 2>/dev/null | \
    openssl x509 -noout -dates -subject -issuer
```

### Step 5: Check HSTS and Headers

```bash
#!/bin/bash
TARGET="https://target.com"

echo "=== Security Headers ==="
curl -sI "$TARGET" | grep -iE "strict-transport|content-security|x-frame|x-content"

# HSTS specific
hsts=$(curl -sI "$TARGET" | grep -i "strict-transport-security")
if [ -n "$hsts" ]; then
    echo "[OK] HSTS: $hsts"

    # Check max-age
    max_age=$(echo "$hsts" | grep -oP "max-age=\K\d+")
    if [ "$max_age" -lt 31536000 ]; then
        echo "[WARN] HSTS max-age less than 1 year"
    fi

    # Check includeSubDomains
    if echo "$hsts" | grep -qi "includeSubDomains"; then
        echo "[OK] includeSubDomains present"
    else
        echo "[WARN] Missing includeSubDomains"
    fi
else
    echo "[VULN] HSTS header missing!"
fi
```

### Step 6: TLS Analysis Script

```python
#!/usr/bin/env python3
import ssl
import socket
import datetime

class TLSAnalyzer:
    def __init__(self, hostname, port=443):
        self.hostname = hostname
        self.port = port
        self.findings = []

    def analyze(self):
        """Run full TLS analysis"""
        print(f"[*] Analyzing TLS for {self.hostname}:{self.port}")

        self.check_certificate()
        self.check_protocol_support()
        self.check_cipher_suites()

        return self.findings

    def check_certificate(self):
        """Check certificate validity"""
        print("\n[*] Checking certificate...")

        context = ssl.create_default_context()
        try:
            with socket.create_connection((self.hostname, self.port)) as sock:
                with context.wrap_socket(sock, server_hostname=self.hostname) as ssock:
                    cert = ssock.getpeercert()

                    # Check expiration
                    not_after = datetime.datetime.strptime(
                        cert['notAfter'], '%b %d %H:%M:%S %Y %Z'
                    )
                    days_left = (not_after - datetime.datetime.now()).days

                    print(f"  Subject: {cert.get('subject')}")
                    print(f"  Expires: {not_after} ({days_left} days)")

                    if days_left < 30:
                        self.findings.append({
                            "issue": f"Certificate expires in {days_left} days",
                            "severity": "High" if days_left < 7 else "Medium"
                        })

                    # Check for wildcard
                    san = cert.get('subjectAltName', [])
                    for type_, value in san:
                        if value.startswith('*.'):
                            print(f"  [INFO] Wildcard certificate: {value}")

        except ssl.CertificateError as e:
            print(f"  [VULN] Certificate error: {e}")
            self.findings.append({
                "issue": f"Certificate error: {e}",
                "severity": "High"
            })

    def check_protocol_support(self):
        """Check supported TLS versions"""
        print("\n[*] Checking protocol support...")

        protocols = {
            'SSLv2': ssl.PROTOCOL_SSLv2 if hasattr(ssl, 'PROTOCOL_SSLv2') else None,
            'SSLv3': ssl.PROTOCOL_SSLv3 if hasattr(ssl, 'PROTOCOL_SSLv3') else None,
            'TLSv1.0': ssl.PROTOCOL_TLSv1 if hasattr(ssl, 'PROTOCOL_TLSv1') else None,
            'TLSv1.1': ssl.PROTOCOL_TLSv1_1 if hasattr(ssl, 'PROTOCOL_TLSv1_1') else None,
            'TLSv1.2': ssl.PROTOCOL_TLSv1_2 if hasattr(ssl, 'PROTOCOL_TLSv1_2') else None,
        }

        deprecated = ['SSLv2', 'SSLv3', 'TLSv1.0', 'TLSv1.1']

        for name, protocol in protocols.items():
            if protocol is None:
                continue

            try:
                context = ssl.SSLContext(protocol)
                context.check_hostname = False
                context.verify_mode = ssl.CERT_NONE

                with socket.create_connection((self.hostname, self.port)) as sock:
                    with context.wrap_socket(sock) as ssock:
                        print(f"  {name}: SUPPORTED")

                        if name in deprecated:
                            print(f"  [VULN] {name} should be disabled")
                            self.findings.append({
                                "issue": f"Deprecated protocol {name} supported",
                                "severity": "High" if name in ['SSLv2', 'SSLv3'] else "Medium"
                            })

            except (ssl.SSLError, socket.error):
                print(f"  {name}: NOT SUPPORTED")

    def check_cipher_suites(self):
        """Check for weak cipher suites"""
        print("\n[*] Checking cipher suites...")

        context = ssl.create_default_context()
        try:
            with socket.create_connection((self.hostname, self.port)) as sock:
                with context.wrap_socket(sock, server_hostname=self.hostname) as ssock:
                    cipher = ssock.cipher()
                    print(f"  Current cipher: {cipher[0]}")
                    print(f"  Protocol: {cipher[1]}")
                    print(f"  Bits: {cipher[2]}")

                    # Check for weak bits
                    if cipher[2] < 128:
                        self.findings.append({
                            "issue": f"Weak cipher ({cipher[2]} bits)",
                            "severity": "High"
                        })

        except Exception as e:
            print(f"  [ERROR] {e}")

    def generate_report(self):
        """Generate TLS report"""
        print("\n" + "="*50)
        print("TLS ANALYSIS REPORT")
        print("="*50)

        if not self.findings:
            print("\nNo critical issues found.")
            return

        print(f"\nFindings: {len(self.findings)}")
        for f in self.findings:
            print(f"\n  [{f['severity']}] {f['issue']}")

# Usage
analyzer = TLSAnalyzer("target.com")
analyzer.analyze()
analyzer.generate_report()
```

---

## Tools

| Tool | Description | Usage |
|------|-------------|-------|
| **testssl.sh** | Comprehensive TLS testing | `./testssl.sh target.com` |
| **sslscan** | SSL/TLS scanner | `sslscan target.com` |
| **sslyze** | Python-based scanner | `sslyze target.com` |
| **Qualys SSL Labs** | Online scanner | Web-based |

---

## Remediation Guide

### Nginx Configuration

```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
ssl_prefer_server_ciphers on;
ssl_session_timeout 1d;
ssl_session_cache shared:SSL:50m;

# HSTS
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
```

### Apache Configuration

```apache
SSLProtocol all -SSLv2 -SSLv3 -TLSv1 -TLSv1.1
SSLCipherSuite ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256
SSLHonorCipherOrder on

Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
```

---

## Risk Assessment

| Finding | CVSS | Severity |
|---------|------|----------|
| SSLv2/SSLv3 supported | 7.5 | High |
| TLS 1.0/1.1 supported | 5.3 | Medium |
| Weak cipher suites | 5.3 | Medium |
| Missing HSTS | 4.3 | Medium |
| Expired certificate | 7.5 | High |

---

## CWE Categories

| CWE ID | Title |
|--------|-------|
| **CWE-326** | Inadequate Encryption Strength |
| **CWE-327** | Use of Broken or Risky Cryptographic Algorithm |
| **CWE-295** | Improper Certificate Validation |

---

## Checklist

```
[ ] TLS versions tested
[ ] Cipher suites analyzed
[ ] Certificate validity checked
[ ] HSTS header verified
[ ] Forward secrecy tested
[ ] Known vulnerabilities checked
[ ] Findings documented
```
