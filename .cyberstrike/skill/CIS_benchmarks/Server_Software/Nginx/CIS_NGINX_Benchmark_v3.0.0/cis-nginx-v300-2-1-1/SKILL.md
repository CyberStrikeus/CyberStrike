---
name: cis-nginx-v300-2-1-1
description: "Ensure only required dynamic modules are loaded (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, modules, basic-configuration]
cis_id: "2.1.1"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.1.1 — Ensure only required dynamic modules are loaded

## Profile Applicability
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description
NGINX functionality is provided by modules. These modules are either compiled statically into the NGINX binary or loaded dynamically at runtime via the `load_module` directive.

- **Static Modules:** These are fixed at compile time. When using official pre-built packages (e.g., from nginx.org or OS vendors), a standard set of modules is included and cannot be removed without recompiling NGINX.
- **Dynamic Modules:** These are separate `.so` files that can be loaded on demand. To reduce the attack surface and complexity, only strictly required **dynamic modules** should be loaded. Additionally, administrators should be aware of the active **static modules** to avoid configuring unused features unintentionally.

## Rationale
Minimizing the loaded code reduces the potential attack surface. While static modules in pre-built packages cannot be removed, ensuring that no unnecessary **dynamic modules** are loaded prevents the execution of unneeded code. Furthermore, understanding which **static modules** are present helps administrators avoid enabling risky features (like `autoindex` or `stub_status`) in the configuration if they are not needed.

## Impact
Removing a required dynamic module or misinterpreting the availability of a static module can cause the NGINX service to fail on restart or break specific application features.

## Audit Procedure

**1. Audit Dynamic Modules (Actionable):**

Run the following command to check for actively loaded dynamic modules:

```bash
nginx -T 2>/dev/null | grep "load_module"
```

**Evaluation:**

- If the output is empty, no dynamic modules are loaded (PASS).
- If output exists (e.g., `load_module modules/ngx_http_geoip_module.so;`), verify that each listed module is required for the application's business logic.

**2. Audit Static Modules (Informational):**

Run the following command to list all modules compiled into the binary:

```bash
nginx -V 2>&1 | grep -oEi '\-\-(with|without)-[^ ]*'
```

**Evaluation:**

Review the `--with-...` flags to understand the server's capabilities. Ensure that risky modules present in the build (e.g., `http_stub_status_module`) are not enabled in any `server` or `location` block **unless authorized**.

## Remediation

**For Dynamic Modules:**

Open the main configuration file (`/etc/nginx/nginx.conf`) or the relevant include file (e.g., in `/etc/nginx/modules-enabled/`). Comment out or remove the `load_module` directive for any module **that is not strictly necessary**.

**For Static Modules:**

Since static modules cannot be removed from pre-built packages, ensure their directives are not used in your configuration. If a specific static module poses a critical risk to your environment, you must switch to a custom build or a different package flavor that excludes it.

## Default Value
Official pre-built packages (like `nginx-stable` or `nginx-mainline`) are "feature-rich" builds containing most standard modules statically. This is a trade-off for ease of maintenance. Security hardening for these packages relies on configuration discipline (not enabling unused modules) rather than binary minimization.

## References
1. https://nginx.org/en/docs/

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 2.6 Allowlist Authorized Libraries | N | Y | Y |
| v7 | 2.8 Implement Application Whitelisting of Libraries | N | N | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Execution | T1059 - Command and Scripting Interpreter |

## Profile
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
