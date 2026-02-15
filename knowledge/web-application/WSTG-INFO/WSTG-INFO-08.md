# WSTG-INFO-08: Fingerprint Web Application Framework

## Test ID
WSTG-INFO-08

## Test Name
Fingerprint Web Application Framework

## High-Level Description

Web application framework fingerprinting identifies the underlying technologies, libraries, and frameworks used to build a web application. This information helps penetration testers understand the testing landscape, identify known vulnerabilities specific to detected frameworks, and tailor their testing approach. Common frameworks include WordPress, Django, Laravel, Spring, ASP.NET, and many others, each with their own security characteristics and common vulnerabilities.

---

## What to Check

### Framework Indicators

- [ ] HTTP response headers (X-Powered-By, Server)
- [ ] Cookies (framework-specific names)
- [ ] HTML source code patterns
- [ ] META tags (generator)
- [ ] File extensions (.php, .asp, .jsp)
- [ ] Directory structure
- [ ] Error messages and stack traces
- [ ] JavaScript libraries
- [ ] CSS patterns
- [ ] Default files and pages

### Frameworks to Identify

- [ ] CMS: WordPress, Drupal, Joomla, Magento
- [ ] PHP: Laravel, Symfony, CodeIgniter, CakePHP
- [ ] Python: Django, Flask, FastAPI
- [ ] Java: Spring, Struts, JSF
- [ ] .NET: ASP.NET MVC, ASP.NET Core, Blazor
- [ ] JavaScript: Express, Next.js, Nuxt.js
- [ ] Ruby: Rails, Sinatra

---

## How to Test

### Step 1: HTTP Header Analysis

```bash
# Check response headers
curl -sI https://target.com | grep -iE 'server|x-powered-by|x-aspnet|x-drupal|x-generator'

# Full header dump
curl -sI https://target.com
```

#### Common Framework Headers

| Header | Value | Framework |
|--------|-------|-----------|
| X-Powered-By | PHP/7.4 | PHP |
| X-Powered-By | ASP.NET | ASP.NET |
| X-Powered-By | Express | Node.js/Express |
| X-Drupal-Cache | HIT | Drupal |
| X-Generator | Drupal 9 | Drupal |
| X-Pingback | /xmlrpc.php | WordPress |
| Server | Werkzeug | Flask |
| Server | gunicorn | Python (often Django) |

### Step 2: Cookie Analysis

```bash
# Check Set-Cookie headers
curl -sI https://target.com | grep -i 'set-cookie'

# Check cookies on multiple pages
for path in / /login /admin; do
    echo "=== $path ==="
    curl -sI "https://target.com$path" | grep -i 'set-cookie'
done
```

#### Framework-Specific Cookies

| Cookie Name | Framework |
|-------------|-----------|
| PHPSESSID | PHP |
| ASP.NET_SessionId | ASP.NET |
| JSESSIONID | Java |
| csrftoken, sessionid | Django |
| laravel_session | Laravel |
| CAKEPHP | CakePHP |
| ci_session | CodeIgniter |
| wordpress_logged_in | WordPress |
| Drupal.visitor | Drupal |
| _rails_session | Ruby on Rails |
| connect.sid | Express.js |

### Step 3: HTML Source Analysis

```bash
# Download and analyze HTML
curl -s https://target.com | grep -iE 'generator|powered|framework|cms'

# Check for meta generator tag
curl -s https://target.com | grep -i '<meta name="generator"'

# Check for framework-specific comments
curl -s https://target.com | grep -oE '<!--.*?-->' | head -20
```

#### HTML Indicators

```html
<!-- WordPress -->
<meta name="generator" content="WordPress 6.0">
<link rel="stylesheet" href="/wp-content/themes/theme/style.css">
<script src="/wp-includes/js/jquery/jquery.min.js"></script>

<!-- Drupal -->
<meta name="Generator" content="Drupal 9">
<link rel="stylesheet" href="/sites/default/files/css/...">

<!-- Joomla -->
<meta name="generator" content="Joomla! - Open Source Content Management">

<!-- Django -->
<input type="hidden" name="csrfmiddlewaretoken" value="...">

<!-- Laravel -->
<meta name="csrf-token" content="...">
<input type="hidden" name="_token" value="...">
```

### Step 4: URL Structure and File Extensions

```bash
# Check file extensions
curl -s https://target.com/sitemap.xml | grep -oP 'https?://[^\s<]+' | grep -oP '\.[a-z]+$' | sort | uniq -c

# Test common framework paths
for path in \
    /wp-admin \
    /wp-login.php \
    /administrator \
    /admin \
    /user/login \
    /rails/info \
    /.env \
    /config.php \
    /web.config; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://target.com$path")
    echo "$path: $status"
done
```

#### Extension-Technology Mapping

| Extension | Technology |
|-----------|------------|
| .php | PHP |
| .asp, .aspx | ASP.NET |
| .jsp, .jsf | Java |
| .do | Java Struts |
| .action | Java Struts 2 |
| .cfm | ColdFusion |
| .pl | Perl |
| .py | Python (rare) |

### Step 5: Directory Structure Analysis

```bash
# WordPress indicators
curl -s -o /dev/null -w "%{http_code}" https://target.com/wp-content/
curl -s -o /dev/null -w "%{http_code}" https://target.com/wp-includes/

# Drupal indicators
curl -s -o /dev/null -w "%{http_code}" https://target.com/sites/default/
curl -s -o /dev/null -w "%{http_code}" https://target.com/core/

# Joomla indicators
curl -s -o /dev/null -w "%{http_code}" https://target.com/components/
curl -s -o /dev/null -w "%{http_code}" https://target.com/modules/

# Laravel indicators
curl -s -o /dev/null -w "%{http_code}" https://target.com/storage/
curl -s -o /dev/null -w "%{http_code}" https://target.com/public/
```

### Step 6: Error Message Analysis

```bash
# Trigger errors to reveal framework
curl -s "https://target.com/nonexistent-page-12345"
curl -s "https://target.com/?id='"
curl -s "https://target.com/index.php?test[]=1"
```

#### Framework-Specific Error Pages

| Error Pattern | Framework |
|---------------|-----------|
| "Fatal error: Uncaught" | PHP |
| "Server Error in '/' Application" | ASP.NET |
| "Whitelabel Error Page" | Spring Boot |
| "DoesNotExist at /" | Django |
| "Routing Error" | Ruby on Rails |
| "Cannot GET /..." | Express.js |

### Step 7: JavaScript Library Detection

```bash
# Extract JavaScript files
curl -s https://target.com | grep -oP 'src="[^"]*\.js[^"]*"'

# Check for known libraries
curl -s https://target.com | grep -iE 'jquery|react|angular|vue|backbone'

# Look for version comments
curl -s https://target.com/js/jquery.min.js | head -5
```

### Step 8: Use Automated Tools

#### WhatWeb

```bash
# Basic scan
whatweb https://target.com

# Aggressive scan
whatweb -a 3 https://target.com

# Verbose output
whatweb -v https://target.com

# Multiple targets
whatweb -i targets.txt
```

#### Wappalyzer CLI

```bash
# Install
npm i -g wappalyzer

# Scan
wappalyzer https://target.com

# JSON output
wappalyzer https://target.com --pretty
```

#### Nikto

```bash
# Nikto includes framework detection
nikto -h https://target.com
```

---

## Tools

### Command-Line Tools

| Tool | Description | Usage |
|------|-------------|-------|
| **WhatWeb** | Web fingerprinting | `whatweb https://target.com` |
| **Wappalyzer CLI** | Technology detection | `wappalyzer https://target.com` |
| **Nikto** | Web scanner | `nikto -h target.com` |
| **httpx** | HTTP toolkit | `echo target.com \| httpx -tech-detect` |
| **Webanalyze** | Technology detection | `webanalyze -host target.com` |

### Browser Extensions

| Extension | Browser |
|-----------|---------|
| Wappalyzer | Chrome, Firefox |
| BuiltWith | Chrome, Firefox |
| Retire.js | Chrome, Firefox |
| WhatRuns | Chrome |

### Online Services

| Service | URL |
|---------|-----|
| BuiltWith | builtwith.com |
| Netcraft | toolbar.netcraft.com |
| W3Techs | w3techs.com |
| SimilarTech | similartech.com |

---

## Example Commands/Payloads

### Comprehensive Framework Detection Script

```bash
#!/bin/bash
TARGET=$1

echo "=== FRAMEWORK FINGERPRINTING ==="
echo "Target: $TARGET"
echo ""

# Headers
echo "[+] Checking HTTP headers..."
curl -sI "https://$TARGET" | grep -iE 'server|x-powered|x-generator|x-drupal|x-aspnet'

echo ""

# Cookies
echo "[+] Checking cookies..."
curl -sI "https://$TARGET" | grep -i 'set-cookie'

echo ""

# Meta tags
echo "[+] Checking meta tags..."
curl -s "https://$TARGET" | grep -i '<meta name="generator"'

echo ""

# Common paths
echo "[+] Checking framework paths..."
declare -A paths=(
    ["/wp-admin"]="WordPress"
    ["/wp-login.php"]="WordPress"
    ["/administrator"]="Joomla"
    ["/user/login"]="Drupal"
    ["/admin"]="Generic Admin"
    ["/rails/info"]="Rails"
)

for path in "${!paths[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://$TARGET$path")
    if [ "$status" != "404" ]; then
        echo "Found: $path (${paths[$path]}) - Status: $status"
    fi
done

echo ""

# WhatWeb
echo "[+] Running WhatWeb..."
whatweb -q "https://$TARGET"
```

### WordPress Detection

```bash
# WordPress specific checks
curl -s https://target.com | grep -i 'wp-content\|wp-includes\|wordpress'
curl -s https://target.com/wp-json/ | head -20
curl -s https://target.com/readme.html | grep -i 'version'
curl -s https://target.com/license.txt | head -10

# WordPress version from feed
curl -s https://target.com/feed/ | grep -i 'generator'

# Enumerate WordPress users
curl -s "https://target.com/?author=1"
curl -s https://target.com/wp-json/wp/v2/users
```

### Drupal Detection

```bash
# Drupal specific checks
curl -s https://target.com | grep -i 'drupal'
curl -s https://target.com/CHANGELOG.txt | head -20
curl -s https://target.com/core/CHANGELOG.txt | head -20
curl -s -I https://target.com | grep -i 'x-drupal\|x-generator'
```

---

## Remediation Guide

### 1. Suppress Framework Headers

#### Apache

```apache
# Remove X-Powered-By
Header unset X-Powered-By

# Custom Server header
ServerTokens Prod
ServerSignature Off
```

#### Nginx

```nginx
# Remove version
server_tokens off;

# Using headers-more module
more_clear_headers 'X-Powered-By';
more_clear_headers 'Server';
```

#### PHP

```ini
; php.ini
expose_php = Off
```

### 2. Customize Cookie Names

```php
// PHP
session_name('CUSTOMSESSION');

// Laravel (.env)
SESSION_COOKIE=custom_session
```

```python
# Django (settings.py)
SESSION_COOKIE_NAME = 'custom_session'
CSRF_COOKIE_NAME = 'custom_csrf'
```

### 3. Remove Generator Tags

```php
// WordPress (functions.php)
remove_action('wp_head', 'wp_generator');
```

```python
# Django - don't include in templates
```

### 4. Custom Error Pages

```apache
# Apache
ErrorDocument 404 /errors/404.html
ErrorDocument 500 /errors/500.html
```

```python
# Django (settings.py)
DEBUG = False
```

### 5. Security Note

> **Important**: Obscuring framework information is "security through obscurity" and should not be the primary defense. Focus on:
> - Keeping frameworks updated
> - Proper security configuration
> - Regular vulnerability scanning
> - Web Application Firewall (WAF)

---

## Risk Assessment

### CVSS Score

**Base Score**: 5.3 (Medium)

**CVSS Vector**: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N

| Metric | Value | Description |
|--------|-------|-------------|
| Attack Vector | Network | Internet accessible |
| Attack Complexity | Low | Simple techniques |
| Privileges Required | None | No authentication |
| User Interaction | None | No interaction needed |
| Confidentiality | Low | Technology disclosure |
| Integrity | None | No integrity impact |
| Availability | None | No availability impact |

### Severity Based on Findings

| Finding | Severity | Impact |
|---------|----------|--------|
| Framework version visible | Low | Aids targeted attacks |
| Outdated framework detected | Medium-High | Known vulnerabilities |
| Debug mode enabled | High | Detailed error info |
| Default credentials possible | Critical | Direct access |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-200** | Exposure of Sensitive Information | Technology disclosure |
| **CWE-16** | Configuration | Improper configuration |

---

## References

### OWASP References
- [OWASP WSTG - Fingerprint Web Application Framework](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/08-Fingerprint_Web_Application_Framework)

### Tools
- [WhatWeb](https://github.com/urbanadventurer/WhatWeb)
- [Wappalyzer](https://www.wappalyzer.com/)
- [BuiltWith](https://builtwith.com/)

---

## Checklist

```
[ ] HTTP headers analyzed
[ ] Cookies examined for framework indicators
[ ] HTML source reviewed for patterns
[ ] META generator tag checked
[ ] File extensions noted
[ ] Directory structure probed
[ ] Error messages triggered and analyzed
[ ] JavaScript libraries identified
[ ] WhatWeb scan completed
[ ] Wappalyzer scan completed
[ ] Framework version determined
[ ] Known vulnerabilities researched
[ ] Technology stack documented
```
