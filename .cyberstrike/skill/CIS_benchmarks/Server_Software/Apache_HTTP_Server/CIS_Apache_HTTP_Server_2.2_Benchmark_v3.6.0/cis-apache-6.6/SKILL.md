---
name: cis-apache-6.6
description: "Ensure ModSecurity Is Installed and Enabled"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, modsecurity, waf, logging, monitoring]
cis_id: "6.6"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure ModSecurity Is Installed and Enabled

## Description

ModSecurity is an open source web application firewall (WAF) for real-time web application monitoring, logging, and access control. It does not include a powerful customizable rule set, which may be used to detect and block common web application attacks. Installation of ModSecurity without a rule set does not provide additional security for the protected web applications. Refer to the benchmark recommendation "Ensure the OWASP ModSecurity Core Rule Set Is Installed and Enabled" for details on a recommended rule set.

**Note:** Like other application security/application firewall systems, ModSecurity requires a significant commitment of staff resources for initial tuning of the rules and handling alerts. In some cases, this may require additional time working with application developers/maintainers to modify applications based on analysis of the results of tuning and monitoring logs. After setup, an ongoing commitment of staff is required for monitoring logs and ongoing tuning, especially after upgrades/patches. Without this commitment to tuning and monitoring, installing ModSecurity may NOT be effective and may provide a false sense of security.

## Rationale

Installation of the ModSecurity Apache module enables a customizable web application firewall rule set which may be configured to detect and block common attack patterns as well as block outbound data leakage.

## Impact

None documented

## Audit Procedure

Perform the following to determine if the security2_module has been loaded:

Use the httpd -M option as root to check that the module is loaded.

```
# httpd -M | grep security2_module
```

**Note:** If the module is correctly enabled, the output will include the module name and whether it is loaded statically or as a shared module.

## Remediation

Perform the following to enable the module:

1. Install the ModSecurity module if it is not already installed in modules/mod_security2.so. It may be installed via OS package installation (such as apt-get or yum) or built from the source files. See https://www.modsecurity.org/download.html for details.

2. Add or modify the LoadModule directive if not already present in the Apache configuration as shown below. Typically, the LoadModule directive is placed in the file named mod_security.conf, which is included in the Apache configuration:

```
LoadModule security2_module modules/mod_security2.so
```

## Default Value

The ModSecurity module is not loaded by default

## References

1. https://www.modsecurity.org/

## CIS Controls

Version 6

18.2 Deploy And Configure Web Application Firewalls
    Protect web applications by deploying web application firewalls (WAFs) that
    inspect all traffic flowing to the web application for common web application
    attacks, including but not limited to cross-site scripting, SQL injection, command
    injection, and directory traversal attacks. For applications that are not web-based,
    specific application firewalls should be deployed if such tools are available for the
    given application type. If the traffic is encrypted, the device should either sit behind
    the encryption or be capable of decrypting the traffic prior to analysis. If neither
    option is appropriate, a host-based web application firewall should be deployed.

Version 7

18.10 Deploy Web Application Firewalls (WAFs)
     Protect web applications by deploying web application firewalls (WAFs) that
     inspect all traffic flowing to the web application for common web application
     attacks. For applications that are not web-based, specific application firewalls
     should be deployed if such tools are available for the given application type. If the
     traffic is encrypted, the device should either sit behind the encryption or be
     capable of decrypting the traffic prior to analysis. If neither option is appropriate,
     a host-based web application firewall should be deployed.

## Profile

Level 2 | Scored
