---
name: cis-nginx-v300-4-1-3
description: "Ensure private key permissions are restricted (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, tls-ssl, encryption]
cis_id: "4.1.3"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 4.1.3 — Ensure private key permissions are restricted

## Profile Applicability
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description
The server's and potentially its vhost's private keys should be protected from unauthorized access by limiting access based on the principle of least privilege.

## Rationale
A server's private key file should be restricted to `400` permissions. This ensures only the owner of the private key file can access it. This is the minimum necessary permissions for the server to operate. If the private key file is not protected, an unauthorized user with access to the server may be able to find the private key file and use it to decrypt traffic sent to your server.

## Audit Procedure
Verify the permissions on the key file are `400`. This can be found by running the following command. You should replace `/etc/nginx/nginx.key` with the location of your key file.

```bash
find /etc/nginx/ -name '*.key' -exec stat -Lc "%n %a" {} +
```

The output should show mode 400 or more restrictive.

**Example:**

```
/etc/nginx/nginx.key 400
```

## Remediation
Run the following command to remove excessive permissions on key files in the `/etc/nginx/` directory.

**Note:** The directory `/etc/nginx/` should be replaced with the location of your key file.

```bash
find /etc/nginx/ -name '*.key' -exec chmod u-wx,go-rwx {} +
```

## Default Value
The default permissions on the server's private key are `644` or `-rw-r--r--`.

## References
1. https://nginx.org/en/docs/http/configuring_https_servers.html

## Additional Information
**Important Note:** This recommendation should be applied to both the keys of your server certificate and the key of your client certificate if you are looking to mutually authenticate a proxy server.

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | Y | Y | Y |
| v7 | 14.6 Protect Information through Access Control Lists | Y | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Credential Access | T1552 - Unsecured Credentials |
| Credential Access | T1552.004 - Private Keys |

## Profile
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
