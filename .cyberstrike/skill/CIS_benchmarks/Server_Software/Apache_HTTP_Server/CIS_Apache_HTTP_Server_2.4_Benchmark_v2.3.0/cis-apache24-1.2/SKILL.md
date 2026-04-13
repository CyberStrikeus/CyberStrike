---
name: cis-apache24-1.2
description: "Ensure the Server Is Not a Multi-Use System"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, planning, installation]
cis_id: "1.2"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2 Ensure the Server Is Not a Multi-Use System (Manual)

## Profile Applicability
- Level 1

## Description
Default server configurations often expose a wide variety of services unnecessarily increasing the risk to the system. Just because a server can perform many services doesn't mean it is wise to do so. The number of services and daemons executing on the Apache Web server should be limited to those necessary, with the Web server being the only primary function of the server.

## Rationale
Maintaining a server for a single purpose increases the security of your application and system. The more services which are exposed to an attacker, the more potential vectors an attacker has to exploit the system and therefore the higher the risk for the server. A Web server should function as only a web server and if possible, should not be mixed with other primary functions such as mail, DNS, database or middleware.

## Audit
Leverage the package or services manager for your OS to list enabled services and review with documented business needs of the server. On Red Hat systems, the following will produce the list of enabled services enabled:

```bash
systemctl list-unit-files --state enabled
```

## Remediation
Leverage the package or services manager for your OS to uninstall or disable unneeded services. On Red Hat systems, the following will disable a given service:

```bash
chkconfig <servicename> off
```

## Default Value
Depends on operating system platform

## CIS Controls
- v8: 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
- v7: 2.10 Physically or Logically Segregate High Risk Applications

## Profile
- Level 1
