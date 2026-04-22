---
name: cis-apache24-2.6
description: "Ensure the Proxy Modules Are Disabled if not in use"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, modules, proxy]
cis_id: "2.6"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.6 Ensure the Proxy Modules Are Disabled if not in use (Automated)

## Profile Applicability

- Level 1

## Description

The Apache proxy modules allow the server to act as a proxy (either forward or reverse proxy) of HTTP and other protocols with additional proxy modules loaded. If the Apache installation is not intended to proxy requests to or from another network then the proxy module should not be loaded.

## Rationale

Proxy servers can act as an important security control when properly configured, however a secure proxy server is not within the scope of this benchmark. A web server should be primarily a web server or a proxy server but not both, for the same reasons that other multi-use servers are not recommended. Scanning for web servers that will also proxy requests is a very common attack, as proxy servers are useful for anonymizing attacks on other servers, or possibly proxying requests into an otherwise protected network.

## Audit

Perform the following to determine if the modules are enabled.

Run the `httpd` server with the `-M` option to list enabled modules:

```bash
# httpd -M | grep proxy_
```

**Note**: If the modules are correctly disabled, there will be no output when executing the above command.

## Remediation

Perform either one of the following to disable the proxy module:

1. For source builds with static modules, run the Apache `./configure` script without including the `mod_proxy` in the `--enable-modules=configure` script options.
   - `$ cd $DOWNLOAD_HTTPD`
   - `$ ./configure`
2. For dynamically loaded modules, comment out or remove the LoadModule directive for `mod_proxy` module and all other proxy modules from the `httpd.conf` file.
   - `##LoadModule proxy_module modules/mod_proxy.so`
   - `##LoadModule proxy_connect_module modules/mod_proxy_connect.so`
   - `##LoadModule proxy_ftp_module modules/mod_proxy_ftp.so`
   - `##LoadModule proxy_http_module modules/mod_proxy_http.so`
   - `##LoadModule proxy_fcgi_module modules/mod_proxy_fcgi.so`
   - `##LoadModule proxy_scgi_module modules/mod_proxy_scgi.so`
   - `##LoadModule proxy_ajp_module modules/mod_proxy_ajp.so`
   - `##LoadModule proxy_balancer_module modules/mod_proxy_balancer.so`
   - `##LoadModule proxy_express_module modules/mod_proxy_express.so`
   - `##LoadModule proxy_wstunnel_module modules/mod_proxy_wstunnel.so`
   - `##LoadModule proxy_fdpass_module modules/mod_proxy_fdpass.so`

## Default Value

The `mod_proxy` module and other proxy modules are NOT enabled with a default source build.

## References

1. https://httpd.apache.org/docs/2.4/mod/mod_proxy.html

## CIS Controls

- v8: 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
- v7: 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

## Profile

- Level 1
