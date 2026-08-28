---
name: cis-ubuntu1604-v200-2-3
description: "Ensure nonessential services are removed or masked"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.3"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.3 Ensure nonessential services are removed or masked (Manual)

## Description

A network port is identified by its number, the associated IP address, and the type of the communication protocol such as TCP or UDP.

A listening port is a network port on which an application or process listens on, acting as a communication endpoint.

Each listening port can be open or closed (filtered) using a firewall. In general terms, an open port is a network port that accepts incoming packets from remote locations.

## Rationale

Services listening on the system pose a potential risk as an attack vector. These services should be reviewed, and if not required, the service should be stopped, and the package containing the service should be removed. If required packages have a dependency, the service should be stopped and masked to reduce the attack surface of the system.

## Audit Procedure

### Command Line

Run the following command:

```bash
lsof -i -P -n | grep -v "(ESTABLISHED)"
```

Review the output to ensure that all services listed are required on the system. If a listed service is not required, remove the package containing the service. If the package containing a non-essential service is required, stop and mask the non-essential service.

## Expected Result

Only required services should be listed in the output. No unnecessary listening services should be present.

## Remediation

### Command Line

Run the following command to remove the package containing the service:

```bash
apt purge <package_name>
```

OR If required packages have a dependency:

Run the following command to stop and mask the service:

```bash
systemctl --now mask <service_name>
```

## Default Value

Varies by installation type and packages installed.

## References

1. CIS Controls v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

## Profile

- Level 1 - Server
- Level 1 - Workstation
