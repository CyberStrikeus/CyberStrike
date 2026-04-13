---
name: cis-apache-2.6
description: "Ensure the Proxy Modules Are Disabled"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, modules, proxy]
cis_id: "2.6"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the Proxy Modules Are Disabled

## Description

The Apache proxy modules allow the server to act as a proxy (either forward or reverse proxy) for HTTP and other protocols with additional proxy modules loaded. If the Apache installation is not intended to proxy requests to or from another network, the proxy module should not be loaded.

## Rationale

Proxy servers can act as an important security control when properly configured. However, a secure proxy server is not within the scope of this benchmark. A web server should be primarily a web server or a proxy but not both, for the same reasons that other multi-use servers are not recommended. Scanning for web servers that will also proxy requests is a very common attack because proxy servers are useful for anonymizing attacks on other servers, or possibly proxying requests into an otherwise protected network.

## Impact

None documented

## Audit Procedure

Perform the following to determine if the proxy modules are disabled.

Run the `httpd` server with the `-M` option to list enabled modules:

```bash
# httpd -M | grep proxy
```

**Note**: If the modules are correctly disabled, the only output when executing the above command should be `Syntax OK`.

## Remediation

Perform either one of the following to disable the proxy modules:

1. For source builds with static modules, run the Apache `./configure` script without including the `mod_proxy` and all other proxy modules in the `--enable-modules=configure` script options.

```bash
$ cd $DOWNLOAD/httpd-2.2.22
$ ./configure
```

2. For dynamically loaded modules, comment out or remove the `LoadModule` directive for the `mod_proxy` module and all other proxy modules from the `httpd.conf` file.

```bash
##LoadModule proxy_module modules/mod_proxy.so
##LoadModule proxy_balancer_module modules/mod_proxy_balancer.so
##LoadModule proxy_ftp_module modules/mod_proxy_ftp.so
##LoadModule proxy_http_module modules/mod_proxy_http.so
##LoadModule proxy_connect_module modules/mod_proxy_connect.so
##LoadModule proxy_ajp_module modules/mod_proxy_ajp.so
```

## Default Value

The proxy modules are disabled with a default source build.

## References

1. https://httpd.apache.org/docs/2.2/mod/mod_proxy.html

## CIS Controls

Version 6

9.1 Limit Open Ports, Protocols, and Services
Ensure that only ports, protocols, and services with validated business needs are running on each system.

Version 7

9.2 Ensure Only Approved Ports, Protocols and Services Are Running
Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.

## Profile

Level 1 | Scored
Level 2 | Scored
