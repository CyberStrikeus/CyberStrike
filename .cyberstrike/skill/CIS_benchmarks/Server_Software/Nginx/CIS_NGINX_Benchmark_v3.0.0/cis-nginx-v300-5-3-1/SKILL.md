---
name: cis-nginx-v300-5-3-1
description: "Ensure X-Content-Type-Options header is configured and enabled (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, browser-security, request-filtering]
cis_id: "5.3.1"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 5.3.1 — Ensure X-Content-Type-Options header is configured and enabled

## Profile Applicability
- Level 1 - Webserver

## Description
The `X-Content-Type-Options` header instructs the browser to strictly follow the MIME types declared in the `Content-Type` headers and **not to guess ("sniff") the content type based on the file's actual content**.

## Rationale
Implementing the `X-Content-Type-Options` header with the `nosniff` directive helps to prevent drive-by download attacks where a user agent is sniffing content types in responses.

This header prevents "MIME type confusion" attacks. Without this header, browsers might interpret a file declared as text (e.g., `snippet.txt`) as executable if it contains script code. Setting the `nosniff` directive **forces the browser to reject the file if the declared type doesn't match the context in which it's loaded** (e.g., loading a text file as a script).

## Impact
**Low Risk:** In rare cases, legacy applications or misconfigured servers might rely on the browser's ability to correct wrong Content-Type headers (e.g., serving JavaScript with a `text/plain` header). Enabling `nosniff` will break these applications because the browser will refuse to execute the script. Ensuring correct MIME types in the NGINX configuration (`mime.types`) is a prerequisite.

## Audit Procedure
Run the following command to inspect the fully loaded NGINX configuration:

```bash
nginx -T 2>/dev/null | grep -i 'X-Content-Type-Options'
```

**Verify the output:**

- Verify that the configuration contains the line: `add_header X-Content-Type-Options "nosniff" always;`
- Specifically check for the `always` parameter at the end of the directive. Without it, the header will be missing on error pages.

## Remediation
Open the NGINX configuration file that contains your `server` blocks. Add the below line into your `server` block to add `X-Content-Type-Options` header and direct your user agent to **not** sniff content types.

```nginx
add_header X-Content-Type-Options "nosniff" always;
```

## Default Value
This header is not implemented by default.

## References
1. https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Content-Type-Options
2. https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html#x-content-type-options
3. https://nginx.org/en/docs/http/ngx_http_headers_module.html

## Additional Information
The `always` parameter ensures that the header is applied to the HTTP **response** no matter what the HTTP response code is.

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 16.1 Establish and Maintain a Secure Application Development Process | N | Y | Y |
| v7 | 18.1 Establish Secure Coding Practices | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Initial Access | T1189 - Drive-by Compromise |
| Execution | T1059.007 - JavaScript |

## Profile
- Level 1 - Webserver
