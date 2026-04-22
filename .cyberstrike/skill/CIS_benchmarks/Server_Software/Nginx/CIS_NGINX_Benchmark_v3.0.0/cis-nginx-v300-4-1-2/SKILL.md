---
name: cis-nginx-v300-4-1-2
description: "Ensure a trusted certificate and trust chain is installed (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, tls-ssl, encryption]
cis_id: "4.1.2"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 4.1.2 — Ensure a trusted certificate and trust chain is installed

## Profile Applicability
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description
Certificates and their trust chains are needed to establish the identity of a web server as legitimate and trusted. Certificate authorities validate a web server's identity and that you are the owner of that web server domain name.

## Rationale
Without a certificate and full trust chain installed on your web server, modern browsers will flag your web server as untrusted.

## Audit Procedure
Run this command to find the file location of your certificate:

```bash
grep -ir ssl_certificate /etc/nginx/
```

The output of your command should look similar to the below output. If there is no output, you do not have a certificate installed.

**Web Server:**

```
/etc/nginx/nginx.conf:    ssl_certificate /etc/nginx/cert.pem;
/etc/nginx/nginx.conf:    ssl_certificate_key /etc/nginx/nginx.key;
```

Open the file to the right of the `ssl_certificate` directive using the following command:

```bash
cat /etc/nginx/cert.pem
```

The output of your command should look similar to the below. It should include the full certificate chain.

```
-----BEGIN CERTIFICATE-----
Insert Your Web Server Certificate
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
Insert Your Certificate Authority Intermediate Certificate
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
Insert Your Certificate Authority Root Certificate
-----END CERTIFICATE-----
```

## Remediation
Use the following procedure to install a certificate and its signing certificate chain onto your web server, load balancer, or proxy.

**Step 1:** Create the server's private key and a certificate signing request.

The following command will create your certificate's private key with 4096-bit key strength. It will also output your certificate signing request to the `nginx.csr` file in your present working directory.

```bash
openssl req -new -newkey rsa:4096 -keyout nginx.key -out nginx.csr
```

Enter the below information about your private key:

```
Country Name (2 letter code) [XX]: Your Country
State or Province Name (full name) []: Your State
Locality Name (eg, city) [Default City]: Your City
Organization Name (eg, company) [Default Company Ltd]: Your City
Organizational Unit Name (eg, section) []: Your Organizational Unit
Common Name (eg, your name or your server's hostname) []: Your server's DNS name
Email Address []: Your email address
```

**Step 2:** Obtain a signed certificate from your certificate authority.

Provide your chosen certificate authority with your certificate signing request. Follow your certificate authority's signing procedures in order to obtain a certificate and the certificate's trust chain. A full trust chain is typically delivered in `.pem` format.

**Step 3:** Install certificate and signing certificate chain on your web server.

Place the `.pem` file from your certificate authority into the directory of your choice. Locate your created key file from the command you used to generate your certificate signing request. Open your website configuration file and edit your encrypted listener to leverage the ssl_certificate and `ssl_certificate_key` directives for a web server as shown below. You should also inspect include files inside your `nginx.conf`. This should be part of the server block.

```nginx
server {
    listen               443 ssl http2;
    listen               [::]:443 ssl http2;
    ssl_certificate      /etc/nginx/cert.crt;
    ssl_certificate_key /etc/nginx/nginx.key;
    ...
}
```

After editing this file, you must restart the nginx systemd service for these changes to take effect. This can be done with the following command:

```bash
sudo systemctl restart nginx
```

## Default Value
No certificate is installed by default.

## References
1. https://nginx.org/en/docs/http/configuring_https_servers.html#chains
2. https://support.globalsign.com/customer/portal/articles/1290470-install-certificate--nginx

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.10 Encrypt Sensitive Data in Transit | N | Y | Y |
| v7 | 14.4 Encrypt All Sensitive Information in Transit | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Credential Access | T1557 - Adversary-in-the-Middle |
| Initial Access | T1190 - Exploit Public-Facing Application |

## Profile
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
