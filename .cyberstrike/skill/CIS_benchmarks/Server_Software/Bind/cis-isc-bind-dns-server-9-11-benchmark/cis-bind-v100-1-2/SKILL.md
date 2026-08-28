---
name: cis-bind-v100-1-2
description: "Do Not Install a Multi-Use System (Manual)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, planning-and-architecture]
cis_id: "1.2"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 1.2 — Do Not Install a Multi-Use System

## Profile Applicability

- Authoritative Name Server Level 1
- Caching Only Name Server Level 1

## Description

Default server configurations often expose a wide variety of services unnecessarily increasing the risk to the system. Just because a server can perform many services doesn't mean it is wise to do so. The number of services and daemons executing on the ISC BIND DNS server should be limited to those necessary, with the DNS service being the only primary function of the server.

## Rationale

Maintaining a server for a single purpose increases the security of your system. The more services which are exposed to an attacker, the more potential vectors an attacker has to exploit the system and therefore the higher the risk for the server. A DNS server should function as only a name server and should not be mixed with other primary functions such as email, web, or database.

## Impact

Not specified.

## Audit Procedure

Leverage the package or services manager for your OS to list enabled services and review to ensure each service is necessary and has a documented business need. On Red Hat systems, the following commands will produce the list of current services enabled. The `systemctl` command lists any `systemd` based services, which are common on current Linux systems while `chkconfig` will list any older traditional SysV based services.

```bash
# systemctl -t service --state enabled list-unit-files
# chkconfig --list | grep ':on'
```

## Remediation

Disable all unnecessary services or move necessary primary services other than DNS to another server. Leverage the package or services manager for your OS to uninstall or disable unneeded services. On Red Hat systems, the following commands may be used to uninstall a package or disable a service:

```bash
# yum erase <package name>
# systemctl disable <service name>
```

## Default Value

Depends on the platform

## References

None listed.

## CIS Controls

| Controls Version | Control                                                                          | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v6               | 9.5 Operate Critical Services On Dedicated Hosts (i.e. DNS, Mail, Web, Database) | N    | Y    | Y    |
| v7               | 9 Limitation and Control of Network Ports, Protocols, and Services               | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic           | Technique                               |
| ---------------- | --------------------------------------- |
| Initial Access   | T1190 Exploit Public-Facing Application |
| Lateral Movement | T1210 Exploitation of Remote Services   |

## Profile

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
