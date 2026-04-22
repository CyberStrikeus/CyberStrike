---
name: cis-nginx-v300-3-1
description: "Ensure detailed logging is enabled (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, logging]
cis_id: "3.1"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 3.1 — Ensure detailed logging is enabled

## Profile Applicability

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description

System logging must be configured to meet organizational security and privacy policies. Detailed logs provide the necessary context (event source, timestamp, user, network data) for incident response and forensic analysis. Modern logging strategies favor structured formats (JSON) over unstructured text to facilitate parsing by SIEM solutions.

**Note:** Sensitive information (e.g., session tokens, PII in query strings) should be excluded or masked in logs to prevent data leaks.

## Rationale

Detailed logs are the foundation of effective incident response. CIS Control 8.5 ("Collect Detailed Audit Logs") recommends capturing event sources, dates, users, timestamps, and network addresses. Traditional text logs require complex, fragile Regex parsing that breaks easily when formats change. Structured logging (JSON) solves this by providing a self-describing format that is natively ingested by modern analysis tools (SIEM), ensuring that critical forensic data is always indexable and searchable.

## Impact

Enabling detailed JSON logging increases the volume of log data. Ensure your log rotation policies (`logrotate`) and disk space monitoring are adjusted to handle the increased storage requirements.

## Audit Procedure

**1. Verify Log Format Configuration:**

Inspect the `log_format` directives in your configuration:

```bash
nginx -T 2>/dev/null | grep -i "log_format"
```

**Evaluation:**

- Confirm that a detailed format (preferably JSON) is defined.
- Verify that the format includes critical fields: `$time_iso8601`, `$remote_addr`, `$remote_user`, `$request`, `$status`, `$http_user_agent`.

**2. Verify Access Log Usage:**

Check that the defined format is actually used by the `access_log` directive:

```bash
nginx -T 2>/dev/null | grep "access_log"
```

**Evaluation:**

- The `access_log` directive should reference the detailed format name (e.g., `access_log /var/log/nginx/access.json main_access_json;`).

## Remediation

Define a detailed log format in the `http` block of `/etc/nginx/nginx.conf`. It is highly recommended to use JSON format for compatibility with modern SIEM tools.

**Recommended Configuration (JSON):**

```nginx
http {
    log_format main_access_json escape=json '{'
        '"timestamp":        "$time_iso8601",'
        '"remote_addr":      "$remote_addr",'
        '"remote_user":      "$remote_user",'
        '"server_name":      "$server_name",'
        '"request_method":   "$request_method",'
        '"request_uri":      "$request_uri",'
        '"status":           $status,'
        '"body_bytes_sent":  $body_bytes_sent,'
        '"http_referer":     "$http_referer",'
        '"http_user_agent":  "$http_user_agent",'
        '"x_forwarded_for":  "$http_x_forwarded_for",'
        '"request_id":       "$request_id"'
    '}';

    # Apply the format globally or per server
    access_log /var/log/nginx/access.json main_access_json;
}
```

**Legacy Configuration (Text-based):**

If JSON is not feasible, ensure the text format captures all necessary fields:

```nginx
log_format main_detailed '$remote_addr - $remote_user [$time_local] '
                          '"$request" $status $body_bytes_sent '
                          '"$http_referer" "$http_user_agent" '
                          '"$http_x_forwarded_for"';
```

## Default Value

By default, NGINX uses the `combined` log format, which is a standard text format but lacks details (e.g., request processing time, upstream information).

## References

1. https://nginx.org/en/docs/http/ngx_http_log_module.html#log_format
2. https://nginx.org/en/docs/varindex.html

## Additional Information

- **Load Balancers & Proxies:** Since NGINX often sits behind other proxies (LBs, CDNs), the `$remote_addr` variable may only show the LB's IP. Ensure you log `$http_x_forwarded_for` (as shown in the JSON example) to capture the true client IP.
- **SIEM Integration:** The `escape=json` parameter automatically handles escaping of special characters, preventing broken JSON structures.
- **Policy Compliance:** Consult your internal Logging & Monitoring Policy to determine exactly which data points are required for retention and which sensitive fields must be excluded.

## CIS Controls

| Controls Version | Control                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------- | ---- | ---- | ---- |
| v8               | 8.5 Collect Detailed Audit Logs | N    | Y    | Y    |
| v7               | 6.3 Enable Detailed Logging     | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic          | Technique                            |
| --------------- | ------------------------------------ |
| Defense Evasion | T1070 - Indicator Removal            |
| Discovery       | T1082 - System Information Discovery |

## Profile

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
