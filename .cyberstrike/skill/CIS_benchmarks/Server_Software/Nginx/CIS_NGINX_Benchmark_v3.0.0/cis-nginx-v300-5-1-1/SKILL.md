---
name: cis-nginx-v300-5-1-1
description: "Ensure allow and deny filters limit access to specific IP addresses (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, access-control, request-filtering]
cis_id: "5.1.1"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 5.1.1 — Ensure allow and deny filters limit access to specific IP addresses

## Profile Applicability
- Level 2 - Webserver
- Level 2 - Proxy
- Level 2 - Loadbalancer

## Description
Access control based on IP addresses is a fundamental defense-in-depth mechanism. By using NGINX's `allow` and `deny` directives, access to the entire server or specific `location` blocks can be restricted to trusted network sources, such as internal subnets, specific hosts, or VPN ranges. This is particularly effective for protecting non-public administrative interfaces or internal APIs from the public internet.

## Rationale
Applying the principle of least privilege at the network layer is a highly effective security measure. By explicitly defining which IP addresses or CIDR ranges are permitted to access sensitive resources and implicitly denying all others with `deny all;`, the attack surface is significantly reduced. This prevents unauthorized network segments from even attempting to exploit potential application-layer vulnerabilities.

## Impact
A misconfigured IP filter list can lead to service denial for legitimate users or services. In dynamic environments where IP addresses can change (e.g., cloud instances without static IPs), this can be a particular challenge. Maintaining accurate and up-to-date IP allow-lists requires operational discipline.

## Audit Procedure
Run the following command to inspect the fully loaded NGINX configuration for `allow` and `deny` rules:

```bash
nginx -T 2>/dev/null | grep -E '^\s*(allow|deny)'
```

Then, manually review the active rules within the `http`, `server`, or `location` blocks. Verify that the configured IP addresses and CIDR ranges align with the documented list of trusted sources and that a `deny all;` rule is present to enforce a default-deny policy.

## Remediation
Identify the specific `location` block you wish to protect (e.g., an admin login page or internal stats). Compile a list of trusted source IP addresses and network ranges. Add `allow` directives for each trusted source, followed by a final `deny all;` directive. NGINX processes rules in order, and stops at the first match.

```nginx
location /admin_login/ {
    # Allow a specific monitoring server
    allow 192.168.1.100;

    # Allow the internal office network range
    allow 10.20.30.0/24;

    # Deny all other access to this location
    deny all;

    # ... other directives for the admin location, e.g., proxy_pass ...
}
```

## Default Value
By default, no IP-based restrictions are configured. NGINX will process requests from any source IP address unless `allow` or `deny` directives are specified.

## References
1. https://nginx.org/en/docs/http/ngx_http_access_module.html

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 13.10 Perform Application Layer Filtering | N | N | Y |
| v7 | 9.5 Implement Application Firewalls | N | N | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Initial Access | T1190 - Exploit Public-Facing Application |
| Lateral Movement | T1021 - Remote Services |

## Profile
- Level 2 - Webserver
- Level 2 - Proxy
- Level 2 - Loadbalancer
