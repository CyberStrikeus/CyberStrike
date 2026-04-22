# CIS NGINX Benchmark v3.0.0 - Skills

This directory contains **44 SKILL.md files** for the CIS NGINX Benchmark v3.0.0.

## Overview

- **Benchmark Version**: 3.0.0
- **Release Date**: 12-24-2025
- **Total Controls**: 44
- **Profile Levels**: Level 1 and Level 2
- **Platform**: NGINX Web Server / Reverse Proxy on Linux
- **Assessment Status**: All Manual

## Control Breakdown by Section

| Section | Title | Controls |
|---------|-------|----------|
| 1.1 | Installation | 1 |
| 1.2 | Configure Software Updates | 2 |
| 2.1 | Minimize NGINX Modules | 1 |
| 2.2 | Account Security | 3 |
| 2.3 | Permissions and Ownership | 3 |
| 2.4 | Network Configuration | 4 |
| 2.5 | Information Disclosure | 4 |
| 3 | Logging | 4 |
| 4.1 | TLS / SSL Configuration | 12 |
| 5.1 | Access Control | 2 |
| 5.2 | Request Limits | 5 |
| 5.3 | Browser Security | 3 |
| 6 | Mandatory Access Control | 0 (reserved) |

## Section Summary

| Major Section | Title | Total |
|---------------|-------|-------|
| 1 | Initial Setup | 3 |
| 2 | Basic Configuration | 15 |
| 3 | Logging | 4 |
| 4 | Encryption | 12 |
| 5 | Request Filtering and Restrictions | 10 |
| 6 | Mandatory Access Control | 0 |
| **Total** | | **44** |

**Note:** Section 6 (Mandatory Access Control) is intentionally left blank/reserved. NGINX relies on external Identity Providers or the underlying OS for user authentication and authorization.

## Scope

Covers secure configuration for NGINX web server and reverse proxy on Linux, including:

- **Initial Setup**: Installation verification, package manager repos, update management
- **Basic Configuration**: Module minimization, service account security, file permissions, network config, information disclosure prevention
- **Logging**: Detailed logging, access logs, error logs (info level), proxy source IP
- **Encryption**: Full TLS/SSL configuration — HTTPS redirect, certificates, key permissions, modern protocols, cipher suites, DH parameters, OCSP stapling, HSTS, client certificates, session resumption, HTTP/3.0
- **Request Filtering**: IP-based access control, HTTP method restrictions, timeouts, body size limits, buffer limits, connection/rate limiting, security headers (X-Content-Type-Options, CSP, Referrer-Policy)

## NGINX-Specific Features

- Configuration via `nginx.conf`, `conf.d/`, and `sites-available/`
- Audit commands use `grep`, `nginx -T` (dump full config), `stat`, `find`
- Directives: `server_tokens`, `keepalive_timeout`, `send_timeout`, `ssl_protocols`, `ssl_ciphers`, `ssl_stapling`, `add_header`, `limit_conn`, `limit_req`, `proxy_set_header`, etc.
- Supports HTTP/3.0 (QUIC) via `quic` listen parameter (4.1.12)

## Directory Structure

```
cis-nginx-v300-{control_id}/
└── SKILL.md
```

Example: `cis-nginx-v300-1-1-1/SKILL.md` for control 1.1.1, `cis-nginx-v300-4-1-12/SKILL.md` for control 4.1.12

## Source Document

**CIS NGINX Benchmark v3.0.0**
- Platform: NGINX Web Server on Linux
- Original PDF: `CIS_NGINX_Benchmark_v3.0.0.pdf`

## Contact

- CyberStrike: cyberstrike.io
- CIS Benchmarks: cisecurity.org
