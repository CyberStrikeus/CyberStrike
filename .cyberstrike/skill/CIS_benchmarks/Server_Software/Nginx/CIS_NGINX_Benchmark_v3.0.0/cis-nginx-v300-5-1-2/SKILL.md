---
name: cis-nginx-v300-5-1-2
description: "Ensure only approved HTTP methods are allowed (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, access-control, request-filtering]
cis_id: "5.1.2"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 5.1.2 — Ensure only approved HTTP methods are allowed

## Profile Applicability
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description
Following the principle of least functionality, an NGINX server should be configured to reject any HTTP methods that are not explicitly required by the application. While standard web browsing typically only needs `GET`, `POST`, and `HEAD`, modern RESTful APIs might require methods like `PUT`, `PATCH`, or `DELETE`. Any method not essential for the application's functionality should be blocked at the web server level.

## Rationale
Disabling unused HTTP methods mitigates the risk of unintended server interaction and can prevent certain classes of web application attacks. For example, if an attacker finds a way to bypass application-layer authentication, an enabled but unused `PUT` or `DELETE` method on the web server could potentially lead to unauthorized file modification or deletion. By explicitly denying such methods, NGINX ensures that requests never even reach the backend application and therefore significantly reducing the attack surface.

## Impact
An overly restrictive filter can block legitimate application functionality. Before implementing these restrictions, it is crucial to coordinate with application developers to get a definitive list of all required HTTP methods for every application endpoint. Incorrectly blocking a required method (e.g., `PUT` for a file upload feature) will cause parts of the application to fail.

## Audit Procedure

**1. Configuration Inspection:**

Run the following command to analyze the fully loaded NGINX configuration for any method-limiting directives:

```bash
nginx -T 2>/dev/null | grep -E '(\$request_method|limit_except)'
```

Review the configuration to ensure that either a `limit_except` block or an `if ($request_method)` block is correctly implemented for the relevant location.

**2. Active Testing:**

Send a request with a non-approved method (e.g., `OPTIONS` or `DELETE`) using `curl` and verify that the server responds with the correct status code, **not** a `200 OK` or `404 Not Found`.

```bash
# Send a disallowed OPTIONS request
curl -X OPTIONS -I https://example.loc/api.html
```

**Expected Output:** The server should return either `HTTP/1.1 405 Not Allowed` or `HTTP/1.1 444 Connection Closed Without Response`. Any other `2xx` or `4xx` code indicates a potential misconfiguration.

## Remediation
There are two recommended methods to restrict HTTP verbs.

**Method 1 (Preferred):** Using `limit_except` This directive is designed for this purpose and is considered the cleanest approach. It restricts all methods **except** for the ones listed.

```nginx
location /api_login/ {

    # Only allow GET, HEAD, and POST methods for this location.
    limit_except GET HEAD POST {
        deny all;
    }

    # ... other directives ...
}
```

**Method 2 (Alternative):** Using an `if` condition This method offers more flexibility, such as **returning a non-standard status code** like `444`, which simply closes the connection without sending a response header.

```nginx
location / {

    # If the request method is NOT one of GET, HEAD, or POST
    if ($request_method !~ ^(GET|HEAD|POST)$) {
        # --> close the connection immediately.
        return 444;
    }

    # ... other directives ...
}
```

## Default Value
All methods are allowed.

## References
1. https://nginx.org/en/docs/http/ngx_http_core_module.html#limit_except

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 16.10 Apply Secure Design Principles in Application Architectures | N | Y | Y |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Initial Access | T1190 - Exploit Public-Facing Application |
| Execution | T1059 - Command and Scripting Interpreter |

## Profile
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
