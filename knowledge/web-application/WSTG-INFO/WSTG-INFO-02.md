# WSTG-INFO-02: Fingerprint Web Server

## Test ID
WSTG-INFO-02

## Test Name
Fingerprint Web Server

## High-Level Description

Web server fingerprinting is the process of identifying the type, version, and configuration of a web server. This information is critical for penetration testers as it helps identify known vulnerabilities associated with specific server versions. Attackers use this information to find and exploit unpatched vulnerabilities. Understanding what web server software is running allows testers to focus their efforts on relevant attack vectors.

---

## What to Check

### Information to Identify

- [ ] Web server software (Apache, nginx, IIS, LiteSpeed, etc.)
- [ ] Web server version number
- [ ] Operating system information
- [ ] Installed modules and extensions
- [ ] Server configuration details
- [ ] Backend technologies (PHP, ASP.NET, Java, etc.)
- [ ] Load balancer or reverse proxy presence
- [ ] CDN (Content Delivery Network) information
- [ ] WAF (Web Application Firewall) presence

---

## How to Test

### Step 1: HTTP Header Analysis

Examine HTTP response headers to identify server information.

#### Using curl

```bash
# Basic header request
curl -I https://target.com

# Verbose output with headers
curl -v https://target.com 2>&1 | grep -i "server\|x-powered-by\|x-aspnet"

# Follow redirects
curl -ILk https://target.com
```

#### Using wget

```bash
# Get headers only
wget --server-response --spider https://target.com 2>&1 | grep -i server
```

#### Key Headers to Examine

| Header | Information Revealed |
|--------|---------------------|
| `Server` | Web server software and version |
| `X-Powered-By` | Backend technology (PHP, ASP.NET) |
| `X-AspNet-Version` | ASP.NET version |
| `X-AspNetMvc-Version` | ASP.NET MVC version |
| `X-Generator` | CMS or framework information |
| `X-Drupal-Cache` | Drupal CMS indicator |
| `X-Varnish` | Varnish cache presence |
| `Via` | Proxy server information |
| `X-Cache` | CDN/Cache information |
| `CF-Ray` | Cloudflare indicator |
| `X-Amz-Cf-Id` | AWS CloudFront indicator |

### Step 2: Banner Grabbing

#### Using Telnet (HTTP)

```bash
# Connect to HTTP port
telnet target.com 80

# Send request (type manually)
HEAD / HTTP/1.1
Host: target.com

# Press Enter twice
```

#### Using OpenSSL (HTTPS)

```bash
# Connect to HTTPS port
openssl s_client -connect target.com:443 -quiet

# Send request (type manually)
HEAD / HTTP/1.1
Host: target.com

# Press Enter twice
```

#### Using Netcat

```bash
# HTTP
echo -e "HEAD / HTTP/1.1\r\nHost: target.com\r\n\r\n" | nc target.com 80

# With timeout
echo -e "HEAD / HTTP/1.1\r\nHost: target.com\r\n\r\n" | nc -w 5 target.com 80
```

### Step 3: HTTP Header Order Analysis

Different web servers return headers in characteristic orders:

#### Apache Header Order
```
Date
Server
Last-Modified
ETag
Accept-Ranges
Content-Length
Connection
Content-Type
```

#### nginx Header Order
```
Server
Date
Content-Type
Content-Length
Connection
Last-Modified
ETag
Accept-Ranges
```

#### IIS Header Order
```
Content-Length
Content-Type
ETag
Last-Modified
Accept-Ranges
Server
X-Powered-By
Date
```

### Step 4: Malformed Request Testing

Send invalid HTTP requests to trigger error pages that may reveal server information.

```bash
# Invalid HTTP version
echo -e "GET / INVALIDVERSION/1.1\r\nHost: target.com\r\n\r\n" | nc target.com 80

# Invalid method
echo -e "INVALID / HTTP/1.1\r\nHost: target.com\r\n\r\n" | nc target.com 80

# Long URL
python3 -c "print('GET /' + 'A'*5000 + ' HTTP/1.1\r\nHost: target.com\r\n\r\n')" | nc target.com 80
```

#### Error Page Signatures

| Server | Error Page Characteristics |
|--------|---------------------------|
| Apache | DOCTYPE HTML 2.0, "Apache" in footer |
| nginx | Simple HTML, "nginx" in title/body |
| IIS | Detailed error with "Microsoft-IIS" |
| LiteSpeed | "LiteSpeed" branding |
| lighttpd | XHTML format |

### Step 5: Default Page and File Analysis

```bash
# Check default pages
curl -s https://target.com/server-status    # Apache
curl -s https://target.com/nginx_status     # nginx
curl -s https://target.com/server-info      # Apache
curl -s https://target.com/phpinfo.php      # PHP info
curl -s https://target.com/web.config       # IIS
curl -s https://target.com/.htaccess        # Apache

# Check favicon hash (can identify technology)
curl -s https://target.com/favicon.ico | md5sum
```

### Step 6: SSL/TLS Certificate Analysis

```bash
# Get certificate details
openssl s_client -connect target.com:443 2>/dev/null | openssl x509 -noout -text

# Quick issuer check
echo | openssl s_client -connect target.com:443 2>/dev/null | openssl x509 -noout -issuer -subject

# Check for technology in certificate
openssl s_client -connect target.com:443 2>/dev/null | openssl x509 -noout -text | grep -i "organization\|CN="
```

### Step 7: Response Behavior Analysis

```bash
# Check response to different methods
for method in GET POST PUT DELETE OPTIONS TRACE PATCH; do
    echo "=== $method ==="
    curl -X $method -I https://target.com 2>/dev/null | head -5
done

# Check OPTIONS response
curl -X OPTIONS -I https://target.com
```

---

## Tools

### Command-Line Tools

| Tool | Description | Usage |
|------|-------------|-------|
| **Nmap** | Network scanner with version detection | `nmap -sV target.com` |
| **Nikto** | Web server scanner | `nikto -h target.com` |
| **WhatWeb** | Web technology identifier | `whatweb target.com` |
| **Wappalyzer CLI** | Technology profiler | `wappalyzer https://target.com` |
| **httprint** | Web server fingerprinting | `httprint -h target.com -s signatures.txt` |
| **curl** | HTTP client | `curl -I target.com` |
| **httpx** | Fast HTTP toolkit | `echo target.com \| httpx -title -tech-detect` |

### Online Services

| Service | URL | Purpose |
|---------|-----|---------|
| Netcraft | netcraft.com | Server identification |
| BuiltWith | builtwith.com | Technology profiler |
| Wappalyzer | wappalyzer.com | Browser extension |
| Shodan | shodan.io | Banner information |
| Censys | censys.io | Certificate and banner data |
| SecurityHeaders | securityheaders.com | Header analysis |

### Browser Extensions

- Wappalyzer
- BuiltWith Technology Profiler
- Retire.js (for JavaScript libraries)

---

## Example Commands/Payloads

### Nmap Commands

```bash
# Basic version detection
nmap -sV -p 80,443 target.com

# Aggressive version detection
nmap -sV --version-intensity 5 -p 80,443 target.com

# HTTP enumeration scripts
nmap -sV --script=http-server-header -p 80,443 target.com
nmap --script=http-headers -p 80,443 target.com
nmap --script=http-enum -p 80,443 target.com

# Full HTTP reconnaissance
nmap -sV --script="http-*" -p 80,443 target.com
```

### Nikto Commands

```bash
# Basic scan
nikto -h https://target.com

# Specify port
nikto -h target.com -p 443 -ssl

# Output to file
nikto -h https://target.com -o report.html -Format html

# Scan with authentication
nikto -h https://target.com -id admin:password

# Tuning options (specific tests)
nikto -h https://target.com -Tuning 1234
```

### WhatWeb Commands

```bash
# Basic scan
whatweb target.com

# Aggressive scan
whatweb -a 3 target.com

# Verbose output
whatweb -v target.com

# JSON output
whatweb --log-json=output.json target.com

# Multiple targets
whatweb -i targets.txt
```

### httpx Commands

```bash
# Technology detection
echo "target.com" | httpx -tech-detect

# Full probe
echo "target.com" | httpx -title -tech-detect -status-code -web-server

# Multiple targets
cat targets.txt | httpx -tech-detect -o results.txt
```

### Custom Scripts

#### Python Banner Grabber

```python
#!/usr/bin/env python3
import socket
import ssl

def grab_banner(host, port=80, use_ssl=False):
    request = f"HEAD / HTTP/1.1\r\nHost: {host}\r\n\r\n"

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(10)

    if use_ssl:
        context = ssl.create_default_context()
        sock = context.wrap_socket(sock, server_hostname=host)

    sock.connect((host, port))
    sock.send(request.encode())
    response = sock.recv(4096).decode()
    sock.close()

    return response

# Usage
print(grab_banner("target.com", 443, use_ssl=True))
```

#### Bash One-Liner for Multiple Targets

```bash
# Scan multiple targets for server headers
while read target; do
    echo "=== $target ==="
    curl -sI "https://$target" 2>/dev/null | grep -i "^server:"
done < targets.txt
```

---

## Remediation Guide

### 1. Suppress Server Headers

#### Apache

```apache
# In httpd.conf or apache2.conf
ServerTokens Prod
ServerSignature Off

# Using mod_headers
<IfModule mod_headers.c>
    Header unset Server
    Header always unset X-Powered-By
</IfModule>
```

#### nginx

```nginx
# In nginx.conf
server_tokens off;

# Using headers-more module
more_clear_headers Server;
```

#### IIS

```xml
<!-- In web.config -->
<system.webServer>
    <httpProtocol>
        <customHeaders>
            <remove name="X-Powered-By" />
            <remove name="Server" />
        </customHeaders>
    </httpProtocol>
    <security>
        <requestFiltering removeServerHeader="true" />
    </security>
</system.webServer>
```

### 2. Custom Error Pages

Configure custom error pages that don't reveal server information:

#### Apache

```apache
ErrorDocument 400 /errors/400.html
ErrorDocument 401 /errors/401.html
ErrorDocument 403 /errors/403.html
ErrorDocument 404 /errors/404.html
ErrorDocument 500 /errors/500.html
```

#### nginx

```nginx
error_page 400 401 403 404 500 502 503 504 /error.html;
location = /error.html {
    internal;
}
```

### 3. Use Reverse Proxy

Deploy a hardened reverse proxy (nginx, HAProxy) in front of application servers to mask backend server information.

### 4. Keep Software Updated

- Regularly apply security patches
- Subscribe to vendor security advisories
- Use automated patch management

### 5. Remove Default Pages

- Delete default welcome pages
- Remove server info pages (phpinfo, server-status)
- Disable directory listing

---

## Risk Assessment

### CVSS Score

**Base Score**: 5.3 (Medium)

**CVSS Vector**: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N

| Metric | Value | Description |
|--------|-------|-------------|
| Attack Vector | Network | Accessible via internet |
| Attack Complexity | Low | Simple techniques required |
| Privileges Required | None | No authentication needed |
| User Interaction | None | No user interaction required |
| Scope | Unchanged | Impact scope unchanged |
| Confidentiality | Low | Server version disclosure |
| Integrity | None | No integrity impact |
| Availability | None | No availability impact |

> **Note**: While fingerprinting itself is low severity, it enables further attacks. If an outdated vulnerable version is detected, the combined risk increases significantly.

### Severity Levels

| Finding | Severity | Description |
|---------|----------|-------------|
| Server header visible | Info | General information |
| Exact version disclosed | Low | Version number exposed |
| Outdated version detected | Medium | Known vulnerabilities may exist |
| Critically vulnerable version | High | Active exploits available |
| Default pages exposed | Medium | Sensitive configuration visible |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-200** | Exposure of Sensitive Information to an Unauthorized Actor | Server version disclosure |
| **CWE-16** | Configuration | Improper server configuration |
| **CWE-693** | Protection Mechanism Failure | Missing security hardening |

---

## References

### OWASP References
- [OWASP WSTG - Fingerprint Web Server](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/02-Fingerprint_Web_Server)

### Tools Documentation
- [Nmap Documentation](https://nmap.org/docs.html)
- [Nikto Documentation](https://github.com/sullo/nikto/wiki)
- [WhatWeb](https://github.com/urbanadventurer/WhatWeb)

### Additional Resources
- [HTTP Headers - MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers)
- [Apache Security Tips](https://httpd.apache.org/docs/current/misc/security_tips.html)
- [nginx Security Controls](https://docs.nginx.com/nginx/admin-guide/security-controls/)

---

## Checklist

```
[ ] HTTP response headers analyzed (curl/wget)
[ ] Banner grabbing performed (telnet/openssl/netcat)
[ ] Server header order analyzed
[ ] Malformed request testing completed
[ ] Default pages checked
[ ] Error pages analyzed
[ ] SSL/TLS certificate examined
[ ] Nmap version detection performed
[ ] Nikto scan completed
[ ] WhatWeb/Wappalyzer analysis done
[ ] Online services checked (Netcraft, BuiltWith)
[ ] CDN/WAF presence identified
[ ] Findings documented
[ ] Risk assessment completed
```
