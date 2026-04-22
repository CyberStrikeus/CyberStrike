---
name: cis-nginx-v300-4-1-1
description: "Ensure HTTP is redirected to HTTPS (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, tls-ssl, encryption]
cis_id: "4.1.1"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 4.1.1 — Ensure HTTP is redirected to HTTPS

## Profile Applicability
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description
Browsers and clients establish encrypted connections with servers by leveraging HTTPS. Requests leveraging HTTP are unencrypted. Unencrypted requests should be redirected so they are encrypted. Any listening HTTP port on your web server should redirect to a server profile that uses encryption. The default HTTP (unencrypted) port is `80`.

## Rationale
Redirecting user agent traffic to HTTPS helps to ensure all user traffic is encrypted. Modern browsers alert users that your website is insecure when HTTPS is not used. This can decrease user trust in your website and ultimately result in decreased use of your web services. Redirection from HTTP to HTTPS couples security with usability; users are able to access your website even if they lack the security awareness to use HTTPS over HTTP when requesting your website.

## Impact
Use of HTTPS does result in a performance reduction in traffic to your website, however, due to the increased value of the security, many businesses consider this to be a cost of doing business.

## Audit Procedure
To verify your server listening configuration, check your web server or proxy configuration file. The default web server configuration file is `/etc/nginx/conf.d/default.conf`, and the default proxy configuration file is `/etc/nginx/nginx.conf`. The configuration file should return a statement redirecting to HTTPS. This should be similar to the code below, where cisecurity.org is used as an example.

```nginx
server {
    listen 80;

    server_name cisecurity.org;

    return 301 https://$host$request_uri;
}
```

## Remediation
Edit your web server or proxy configuration file to redirect all unencrypted listening ports, such as port `80`, using a redirection through the return directive (cisecurity.org is used as an example server name).

```nginx
server {
    listen 80;

    server_name cisecurity.org;

    return 301 https://$host$request_uri;
}
```

## Default Value
NGINX is not configured to use HTTPS or redirect to it by default.

## References
1. https://nginx.org/en/docs/http/ngx_http_core_module.html

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.10 Encrypt Sensitive Data in Transit | N | Y | Y |
| v7 | 14.4 Encrypt All Sensitive Information in Transit | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Credential Access | T1557 - Adversary-in-the-Middle |
| Collection | T1185 - Browser Session Hijacking |

## Profile
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
