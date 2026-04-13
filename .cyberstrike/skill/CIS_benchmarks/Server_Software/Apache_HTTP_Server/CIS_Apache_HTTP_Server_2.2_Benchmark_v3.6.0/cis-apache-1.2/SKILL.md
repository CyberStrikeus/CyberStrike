---
name: cis-apache-1.2
description: "Ensure the Server Is Not a Multi-Use System"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, planning, installation]
cis_id: "1.2"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the Server Is Not a Multi-Use System

## Description

A web server should function as only a web server, and it possible should not be mixed with other primary functions such as email, DNS, databases, or middleware. The number of services and daemons executing on the server should be limited to those necessary.

## Rationale

Default server configurations often expose a wide variety of services. The more services exposed to an attacker, the more potential vectors an attacker has to exploit the server and therefore the higher the risk for the server. Just because a server can perform many services doesn't mean it is wise to do so. Maintaining a server for a single purpose increases the security of your application and system.

## Impact

None documented

## Audit Procedure

Leverage the package or services manager for your OS to list enabled services and compare them with the documented business needs of the server. On Red Hat systems, the following will produce the list of current services enabled:

```bash
chkconfig --list | grep ':on'
```

## Remediation

Leverage the package or services manager for your OS to uninstall or disable all unneeded services. On Red Hat systems, the following will disable a given service:

```bash
chkconfig <servicename> off
```

## Default Value

No default value specified - depends on OS installation type.

## References

None documented

## CIS Controls

Version 6

9.5 Operate Critical Services On Dedicated Hosts (i.e. DNS, Mail, Web, Database)
    Operate critical services on separate physical or logical host machines, such as DNS, file, mail, web, and database servers.

Version 7

2.10 Physically or Logically Segregate High Risk Applications
    Physically or logically segregated systems should be used to isolate and run software that is required for business operations but incur higher risk for the organization.

## Profile

Level 1 | Not Scored
Level 2 | Not Scored
