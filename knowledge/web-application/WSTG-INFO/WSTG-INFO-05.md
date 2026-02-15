# WSTG-INFO-05: Review Web Page Content for Information Leakage

## Test ID
WSTG-INFO-05

## Test Name
Review Web Page Content for Information Leakage

## High-Level Description

Web pages often contain more information than what is visually displayed to users. HTML comments, JavaScript files, metadata, and debug artifacts can inadvertently expose sensitive information such as credentials, internal paths, infrastructure details, and business logic. This test involves systematically reviewing web page source code, scripts, and associated files to identify information leakage that could aid attackers in compromising the application.

---

## What to Check

### Content Types to Review

- [ ] HTML comments (`<!-- -->`)
- [ ] META tags
- [ ] JavaScript files (external and inline)
- [ ] Source maps (`.map` files)
- [ ] CSS files and comments
- [ ] Hidden form fields
- [ ] Data attributes
- [ ] JSON embedded in HTML
- [ ] Error messages in responses
- [ ] Redirect response bodies

### Sensitive Information Types

- [ ] Credentials (passwords, API keys, tokens)
- [ ] Database connection strings
- [ ] Internal IP addresses and hostnames
- [ ] File system paths
- [ ] Administrative routes/endpoints
- [ ] Developer comments/TODOs
- [ ] Version information
- [ ] Debug/test data
- [ ] Business logic details
- [ ] User information (PII)
- [ ] Cloud service credentials (AWS, Azure, GCP)

---

## How to Test

### Step 1: HTML Comment Analysis

#### Manual Review

```bash
# Download page and extract comments
curl -s https://target.com | grep -o '<!--.*-->'

# Extract multi-line comments
curl -s https://target.com | grep -Pzo '<!--[\s\S]*?-->'

# View page source in browser
# Right-click > View Page Source
# Ctrl+U / Cmd+U
```

#### Common Vulnerable Patterns in Comments

```html
<!-- Database: mysql://admin:password123@localhost/db -->
<!-- TODO: Remove before production -->
<!-- Debug mode enabled -->
<!-- Admin panel at /secret-admin-2024 -->
<!-- User: testuser / Pass: test123 -->
<!-- Internal IP: 10.0.0.50 -->
<!-- Last modified by john.doe@company.com -->
<!-- Version 2.3.1 - Build 4521 -->
```

### Step 2: META Tag Analysis

```bash
# Extract all META tags
curl -s https://target.com | grep -i '<meta'

# Look for specific information
curl -s https://target.com | grep -iE 'author|generator|description|keywords|robots|csrf'
```

#### META Tags of Interest

```html
<meta name="author" content="John Doe">
<meta name="generator" content="WordPress 6.0">
<meta name="csrf-token" content="abc123xyz">
<meta name="api-base" content="https://api.internal.target.com">
<meta property="og:url" content="https://staging.target.com/page">
```

### Step 3: JavaScript Analysis

#### Locate JavaScript Files

```bash
# Extract all script sources
curl -s https://target.com | grep -oP 'src="[^"]*\.js[^"]*"'

# Download JavaScript files
curl -s https://target.com | grep -oP '(?<=src=")[^"]*\.js[^"]*' | while read js; do
    echo "=== $js ==="
    curl -s "https://target.com$js" | head -50
done
```

#### Search for Sensitive Data in JavaScript

```bash
# Download all JS and search for patterns
curl -s https://target.com/app.js | grep -iE 'api_key|apikey|secret|password|token|auth|key'

# AWS credentials
grep -iE 'AKIA[0-9A-Z]{16}|aws_secret|aws_access' *.js

# API endpoints
grep -oP 'https?://[^\s"<>]+' *.js | sort -u

# Internal paths
grep -iE '/admin|/api/|/internal|/private' *.js
```

#### Common Secrets in JavaScript

```javascript
// API Keys
const API_KEY = "AIzaSyD-xxxxxxxxxxx";
const STRIPE_KEY = "sk_live_xxxxxxxx";
const GOOGLE_MAPS_KEY = "AIzaxxxxxxxx";

// Credentials
const DB_PASSWORD = "password123";
const ADMIN_TOKEN = "eyJhbGciOiJIUzI1NiIs...";

// Internal URLs
const API_BASE = "https://internal-api.company.com";
const ADMIN_URL = "/super-secret-admin";

// AWS Credentials
const AWS_ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE";
const AWS_SECRET_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
```

### Step 4: Source Map Discovery

```bash
# Check for source maps
for js in app.js main.js bundle.js chunk.js vendor.js; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://target.com/$js.map")
    echo "$js.map: $status"
done

# Download and analyze source map
curl -s https://target.com/main.js.map | jq '.sources'

# Extract original source code
curl -s https://target.com/main.js.map | jq -r '.sourcesContent[]'
```

#### Source Map Contents

Source maps can reveal:
- Original unminified source code
- File paths (`/home/developer/project/src/`)
- Development comments
- Debug code
- Environment configurations

### Step 5: Hidden Form Fields

```bash
# Extract hidden inputs
curl -s https://target.com | grep -i 'type="hidden"'
curl -s https://target.com | grep -i "type='hidden'"

# Look for sensitive hidden fields
curl -s https://target.com | grep -iE 'hidden.*value|hidden.*name'
```

#### Suspicious Hidden Fields

```html
<input type="hidden" name="debug" value="true">
<input type="hidden" name="admin" value="0">
<input type="hidden" name="price" value="100">
<input type="hidden" name="role" value="user">
<input type="hidden" name="discount" value="0">
```

### Step 6: Data Attributes

```bash
# Extract data attributes
curl -s https://target.com | grep -oP 'data-[a-zA-Z-]+="[^"]*"'

# Look for sensitive data attributes
curl -s https://target.com | grep -iE 'data-api|data-token|data-key|data-user|data-id'
```

### Step 7: Inline JSON/Data

```bash
# Find JSON in script tags
curl -s https://target.com | grep -oP '<script[^>]*type="application/json"[^>]*>[\s\S]*?</script>'

# Find window/global variables
curl -s https://target.com | grep -oP 'window\.[a-zA-Z_]+\s*=\s*\{[^}]+\}'
```

#### Common Inline Data Patterns

```html
<script>
    window.__CONFIG__ = {
        apiKey: "secret123",
        environment: "staging",
        debugMode: true
    };
</script>

<script type="application/json" id="app-data">
    {"user": {"id": 1, "role": "admin", "token": "xyz"}}
</script>
```

### Step 8: Error Messages and Debug Info

```bash
# Trigger errors and capture responses
curl -s "https://target.com/api/test?id='"
curl -s "https://target.com/nonexistent-page-12345"
curl -s "https://target.com/" -H "Content-Type: invalid"
```

### Step 9: Redirect Response Bodies

```bash
# Capture full response including body for redirects
curl -sL -D - https://target.com/redirect-page

# Using Burp/ZAP to intercept redirect responses
# Disable "Follow redirects" and examine 3xx response bodies
```

### Step 10: Historical Content (Wayback Machine)

```bash
# Get historical URLs
waybackurls target.com | grep -iE '\.js$|\.json$|config|admin'

# Check archived versions for leaked data
curl -s "https://web.archive.org/web/2020/https://target.com/app.js"
```

---

## Tools

### Command-Line Tools

| Tool | Description | Usage |
|------|-------------|-------|
| **curl/wget** | HTTP client | `curl -s https://target.com` |
| **grep** | Pattern search | `grep -iE 'api_key\|secret'` |
| **jq** | JSON processor | `jq '.sources' file.map` |
| **waybackurls** | Historical URLs | `waybackurls target.com` |
| **gau** | Get All URLs | `gau target.com` |

### Specialized Secret Scanners

| Tool | Description | Usage |
|------|-------------|-------|
| **truffleHog** | Git secret scanner | `trufflehog filesystem .` |
| **gitleaks** | Secret detection | `gitleaks detect --source=.` |
| **SecretFinder** | JS secret finder | `python3 SecretFinder.py -i url` |
| **LinkFinder** | Endpoint extractor | `python3 linkfinder.py -i url` |
| **JSParser** | JavaScript parser | Extracts URLs from JS |

### Browser Extensions

| Extension | Purpose |
|-----------|---------|
| Wappalyzer | Technology detection |
| Retire.js | Vulnerable JS libraries |
| BuiltWith | Tech stack analysis |
| Source Detector | Source map finder |

### Web Proxies

| Tool | Description |
|------|-------------|
| Burp Suite | Intercept and analyze traffic |
| OWASP ZAP | Automated scanning |
| Fiddler | Traffic analysis |
| Charles | HTTP debugging proxy |

### API Key Validators

| Service | Purpose |
|---------|---------|
| KeyHacks | API key validation |
| API Key Scanner | Cloud key detection |
| Google Maps API Scanner | Maps key testing |

---

## Example Commands/Payloads

### Comprehensive Content Scanner

```bash
#!/bin/bash
TARGET=$1
OUTPUT_DIR="content_scan_$(date +%Y%m%d)"
mkdir -p $OUTPUT_DIR

echo "[+] Scanning $TARGET for information leakage..."

# 1. Download main page
echo "[+] Downloading main page..."
curl -s $TARGET -o "$OUTPUT_DIR/index.html"

# 2. Extract and check comments
echo "[+] Extracting HTML comments..."
grep -o '<!--.*-->' "$OUTPUT_DIR/index.html" > "$OUTPUT_DIR/comments.txt"

# 3. Extract META tags
echo "[+] Extracting META tags..."
grep -i '<meta' "$OUTPUT_DIR/index.html" > "$OUTPUT_DIR/meta_tags.txt"

# 4. Extract JavaScript URLs
echo "[+] Finding JavaScript files..."
grep -oP '(?<=src=")[^"]*\.js[^"]*' "$OUTPUT_DIR/index.html" | sort -u > "$OUTPUT_DIR/js_files.txt"

# 5. Download JavaScript files
echo "[+] Downloading JavaScript files..."
mkdir -p "$OUTPUT_DIR/js"
while read js; do
    filename=$(basename "$js")
    if [[ $js == /* ]]; then
        curl -s "${TARGET}${js}" -o "$OUTPUT_DIR/js/$filename"
    else
        curl -s "$js" -o "$OUTPUT_DIR/js/$filename"
    fi
done < "$OUTPUT_DIR/js_files.txt"

# 6. Search for secrets in JavaScript
echo "[+] Searching for secrets..."
grep -rihE 'api_key|apikey|api-key|secret|password|token|auth|credential|AKIA|private_key' "$OUTPUT_DIR/js/" > "$OUTPUT_DIR/potential_secrets.txt"

# 7. Check for source maps
echo "[+] Checking for source maps..."
while read js; do
    if [[ $js == /* ]]; then
        mapurl="${TARGET}${js}.map"
    else
        mapurl="${js}.map"
    fi
    status=$(curl -s -o /dev/null -w "%{http_code}" "$mapurl")
    if [ "$status" == "200" ]; then
        echo "Found: $mapurl" >> "$OUTPUT_DIR/source_maps.txt"
    fi
done < "$OUTPUT_DIR/js_files.txt"

# 8. Extract endpoints from JS
echo "[+] Extracting endpoints..."
grep -rohE '["'"'"']/[a-zA-Z0-9/_-]+["'"'"']' "$OUTPUT_DIR/js/" | sort -u > "$OUTPUT_DIR/endpoints.txt"

# 9. Extract URLs
echo "[+] Extracting URLs..."
grep -rohE 'https?://[^\s"<>'"'"']+' "$OUTPUT_DIR/js/" | sort -u > "$OUTPUT_DIR/urls.txt"

echo "[+] Scan complete. Results in $OUTPUT_DIR/"
```

### SecretFinder Usage

```bash
# Install
git clone https://github.com/m4ll0k/SecretFinder.git
cd SecretFinder
pip3 install -r requirements.txt

# Scan single URL
python3 SecretFinder.py -i https://target.com/app.js -o cli

# Scan with regex
python3 SecretFinder.py -i https://target.com/app.js -o cli -r 'api[_-]?key'
```

### LinkFinder Usage

```bash
# Install
git clone https://github.com/GerbenJavado/LinkFinder.git
cd LinkFinder
pip3 install -r requirements.txt

# Find endpoints
python3 linkfinder.py -i https://target.com/app.js -o cli

# Output to file
python3 linkfinder.py -i https://target.com -d -o results.html
```

### Regex Patterns for Secret Detection

```bash
# AWS Access Key
AKIA[0-9A-Z]{16}

# AWS Secret Key
[0-9a-zA-Z/+]{40}

# Google API Key
AIza[0-9A-Za-z\\-_]{35}

# Stripe API Key
sk_live_[0-9a-zA-Z]{24}

# Private Key
-----BEGIN (RSA|DSA|EC|OPENSSH) PRIVATE KEY-----

# Generic Secret
[s|S][e|E][c|C][r|R][e|E][t|T].*['|"][0-9a-zA-Z]{32,45}['|"]

# Generic API Key
[a|A][p|P][i|I][_]?[k|K][e|E][y|Y].*['|"][0-9a-zA-Z]{32,45}['|"]

# JWT
eyJ[A-Za-z0-9-_=]+\.eyJ[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*

# Basic Auth
basic [a-zA-Z0-9=:_\+\/-]{5,100}

# Bearer Token
bearer [a-zA-Z0-9_\-\.=:_\+\/]{5,100}
```

---

## Remediation Guide

### 1. Remove Comments Before Production

```bash
# Use build tools to strip comments
# Webpack: terser-webpack-plugin
# Gulp: gulp-strip-comments
# npm: strip-json-comments
```

#### Webpack Configuration

```javascript
// webpack.config.js
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
    optimization: {
        minimize: true,
        minimizer: [
            new TerserPlugin({
                terserOptions: {
                    format: {
                        comments: false,
                    },
                },
                extractComments: false,
            }),
        ],
    },
};
```

### 2. Externalize Secrets

```javascript
// BAD
const API_KEY = "AIzaSyD-xxxxxxxxxxx";

// GOOD
const API_KEY = process.env.API_KEY;
```

#### Environment Variable Best Practices

```bash
# .env file (never commit)
API_KEY=your_api_key
DB_PASSWORD=your_password

# Add to .gitignore
.env
.env.local
.env.*.local
```

### 3. Disable Source Maps in Production

```javascript
// webpack.config.js
module.exports = {
    devtool: process.env.NODE_ENV === 'production' ? false : 'source-map',
};
```

```json
// Angular: angular.json
{
    "configurations": {
        "production": {
            "sourceMap": false
        }
    }
}
```

### 4. Restrict API Keys

```javascript
// Google Cloud Console
// - Add HTTP referrer restrictions
// - Add IP restrictions
// - Limit API scope

// AWS IAM
// - Use least privilege
// - Set resource restrictions
// - Enable key rotation
```

### 5. Code Review Checklist

```
[ ] No hardcoded credentials
[ ] No internal IPs in code
[ ] No developer comments in production
[ ] Source maps disabled
[ ] Environment variables used
[ ] Debug code removed
[ ] Test data removed
```

### 6. CI/CD Secret Scanning

```yaml
# GitHub Actions example
- name: Scan for secrets
  uses: trufflesecurity/trufflehog@main
  with:
    path: ./
    base: main
    extra_args: --only-verified
```

---

## Risk Assessment

### CVSS Score

**Base Score**: Variable (5.3 - 9.8 depending on exposed data)

#### Information Disclosure (Generic)
**CVSS Vector**: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N
**Score**: 5.3 (Medium)

#### Credential Exposure
**CVSS Vector**: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H
**Score**: 9.8 (Critical)

### Severity Levels

| Finding | Severity | Impact |
|---------|----------|--------|
| Developer comments | Info | Limited exposure |
| Version information | Low | Aids targeted attacks |
| Internal paths/URLs | Low | Reconnaissance data |
| API endpoints | Medium | Attack surface mapping |
| Internal IP addresses | Medium | Network information |
| Non-sensitive API keys | Medium | Service abuse potential |
| Admin credentials | Critical | Full compromise |
| Cloud credentials (AWS) | Critical | Infrastructure compromise |
| Database passwords | Critical | Data breach |

---

## CWE Categories

| CWE ID | Title | Description |
|--------|-------|-------------|
| **CWE-200** | Exposure of Sensitive Information | General information disclosure |
| **CWE-312** | Cleartext Storage of Sensitive Information | Hardcoded credentials |
| **CWE-615** | Inclusion of Sensitive Information in Source Code Comments | Comments with secrets |
| **CWE-540** | Inclusion of Sensitive Information in Source Code | Secrets in code |
| **CWE-798** | Use of Hard-coded Credentials | Hardcoded passwords |
| **CWE-209** | Generation of Error Message Containing Sensitive Information | Verbose errors |

---

## References

### OWASP References
- [OWASP WSTG - Review Web Page Content](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/05-Review_Web_Page_Content_for_Information_Leakage)
- [OWASP Cheat Sheet - Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)

### Tools
- [SecretFinder](https://github.com/m4ll0k/SecretFinder)
- [LinkFinder](https://github.com/GerbenJavado/LinkFinder)
- [truffleHog](https://github.com/trufflesecurity/trufflehog)
- [gitleaks](https://github.com/gitleaks/gitleaks)

### Additional Resources
- [KeyHacks](https://github.com/streaak/keyhacks)
- [OWASP Source Code Analysis Tools](https://owasp.org/www-community/Source_Code_Analysis_Tools)

---

## Checklist

```
[ ] HTML source code reviewed for comments
[ ] META tags analyzed
[ ] All JavaScript files downloaded
[ ] JavaScript searched for secrets (API keys, passwords)
[ ] JavaScript searched for internal URLs/paths
[ ] Source maps checked and analyzed
[ ] Hidden form fields reviewed
[ ] Data attributes examined
[ ] Inline JSON/data reviewed
[ ] Error responses analyzed
[ ] Redirect response bodies checked
[ ] Historical versions checked (Wayback)
[ ] Automated secret scanner run
[ ] Endpoints extracted and documented
[ ] Sensitive findings categorized by severity
[ ] Risk assessment completed
[ ] Remediation recommendations prepared
```
