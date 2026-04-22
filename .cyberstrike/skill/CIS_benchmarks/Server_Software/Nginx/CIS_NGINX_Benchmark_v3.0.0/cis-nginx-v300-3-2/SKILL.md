---
name: cis-nginx-v300-3-2
description: "Ensure access logging is enabled (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, logging]
cis_id: "3.2"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 3.2 — Ensure access logging is enabled

## Profile Applicability
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description
The `access_log` directive enables the logging of client requests. While NGINX enables this by default, it allows granular control per server or location context. Based on enterprise requirements, the log should be enriched with relevant variables or converted to structured JSON format for modern SIEM integration. Refer to Recommendation 3.1 for detailed configuration of log formats and variables. Ensure that access logging is active for all critical services.

## Rationale
Access logs are the primary record of system usage, detailing who accessed what resources and when and general troubleshooting. Without active access logs, incident responders are blind to web-based attacks (such as SQL injection, XSS probing, or Brute Force attempts) and auditors cannot verify compliance or user activity. Disabling logs globally (`access_log off;`) effectively destroys the forensic chain of custody for security events.

## Impact
Enabling detailed access logging increases disk space usage significantly. Without proper log rotation (e.g., `logrotate`) and monitoring, log files can rapidly consume available disk space, potentially causing the server to stop processing requests or crash. Ensure sufficient storage capacity and retention policies are in place.

## Audit Procedure

**1. Verify Configuration:**

Inspect the fully loaded configuration for log settings:

```bash
nginx -T 2>/dev/null | grep -i "access_log"
```

**Evaluation:**

- **Destination Check:** Verify that `access_log` directives point to a valid local file path (e.g., `/var/log/nginx/access.json`) for ingestion by log shippers.
- **Status Check:** Identify any instances of `access_log off;`.
- **Pass:** If `access_log off;` is absent, or strictly limited to non-critical assets (e.g., `location = /favicon.ico`, static assets, or internal health checks).
- **Fail:** If `access_log off;` is applied globally in the `http` block or to `server` blocks handling business logic.

## Remediation
Enable access logging in the `http` block to set a secure global default, or configure it explicitly within specific `server` blocks. It is recommended to use the detailed log format defined in Recommendation 3.1.

**Configuration Example:**

```nginx
http {
    # Enable global logging using the detailed JSON format from Rec 3.1
    access_log /var/log/nginx/access.json main_access_json;

    server {
        # Inherits the global log setting, or can be overridden:
        access_log /var/log/nginx/example.com.access.json main_access_json;

        location / {
            # ...
        }

        # Exception: Disable logging for favicon to reduce noise (Optional)
        location = /favicon.ico {
            access_log  off;
            log_not_found off;
        }
    }
}
```

## Default Value
Access logging is enabled by default, typically logging to `logs/access.log` or `/var/log/nginx/access.log` using the standard `combined` format.

## References
1. https://nginx.org/en/docs/http/ngx_http_log_module.html#access_log
2. https://nginx.org/en/docs/http/ngx_http_core_module.html#log_not_found

## Additional Information
Embedded Variables for NGINX

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 8.5 Collect Detailed Audit Logs | N | Y | Y |
| v7 | 6.3 Enable Detailed Logging | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Defense Evasion | T1070 - Indicator Removal |
| Discovery | T1082 - System Information Discovery |

## Profile
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
