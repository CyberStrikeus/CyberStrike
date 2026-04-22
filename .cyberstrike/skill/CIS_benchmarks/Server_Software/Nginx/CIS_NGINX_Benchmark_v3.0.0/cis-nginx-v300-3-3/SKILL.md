---
name: cis-nginx-v300-3-3
description: "Ensure error logging is enabled and set to the info logging level (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, logging]
cis_id: "3.3"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 3.3 — Ensure error logging is enabled and set to the info logging level

## Profile Applicability
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description
The `error_log` directive configures logging for server errors and operational messages. Unlike access logs, error logs capture diagnostic information about failed requests, upstream connection issues, and configuration errors. The log level determines the verbosity of these messages and should be set to capture sufficient detail (typically `notice` or `info`) without overwhelming the storage system.

## Rationale
While access logs capture incoming request patterns, error logs provide the internal system context required to diagnose why a request failed. They are essential for identifying:

1. **Upstream Failures:** Connection timeouts or refused connections to backend servers (e.g., application server is down).
2. **Process Anomalies:** Unexpected worker process terminations or restarts, which may indicate resource exhaustion or exploitation attempts.
3. **Configuration Errors:** Invalid request handling that NGINX rejects before logging to access logs (e.g., header size limits exceeded).

Without error logs, an administrator sees a "500 Internal Server Error" in the access log but has no way to determine the root cause.

## Impact
Setting the log level to `info` (or even `debug`) can generate a significant volume of log data, especially on busy servers or during denial-of-service attacks. This increases disk I/O and storage requirements. Ensure that log rotation (e.g., via `logrotate`) is configured and storage usage is monitored to prevent disk exhaustion.

## Audit Procedure

**1. Verify Configuration:**

Check the fully loaded configuration for error log settings:

```bash
nginx -T 2>/dev/null | grep -i "error_log"
```

**Evaluation:**

- **Presence:** Verify that `error_log` is defined globally in the `main` context (or `http` block).
- **Destination:** Ensure it points to a valid local file (e.g., `/var/log/nginx/error.log`) accessible for ingestion by log shippers.
- **Level:** Confirm the level is set according to your internal "Monitoring and Logging" policy.
- **Fail:** If `error_log` points to `/dev/null` or the level is set to `crit`, `alert`, or `emerg` (which suppresses too many relevant warnings).

## Remediation
Configure the `error_log` directive in the `main` context (at the top of `nginx.conf`) to capture operational events.

**Configuration Example:**

```nginx
# Log errors to a specific file with the 'notice' level
error_log /var/log/nginx/error.log notice;

http {
    # ...
}
```

**Note:** The specific logging level should be aligned with the organization's "Monitoring and Logging" Policy, balancing the need for forensic detail against storage and processing costs. Typically, `info` or `notice` is recommended.

## Default Value
By default, NGINX logs errors to `logs/error.log` with the severity level `error`. This configuration misses `warn`, `notice`, and `info` events.

## References
1. https://nginx.org/en/docs/ngx_core_module.html#error_log
2. https://docs.nginx.com/nginx/admin-guide/monitoring/logging/

## Additional Information
Unlike access logs, NGINX Open Source uses a hardcoded text format for error logs and does not support custom `log_format` definitions (e.g., JSON, additional variables).

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
