---
name: cis-ubuntu1804-v220-2-4
description: "Ensure nonessential services are removed or masked"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, services, nonessential-services]
cis_id: "2.4"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.4 Ensure nonessential services are removed or masked (Manual)

## Profile

- Level 1 - Server
- Level 1 - Workstation

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
# ss -plntu
```

Review the output to ensure that all services listed are required on the system. If a listed service is not required, remove the package containing the service. If the package containing the service is required, stop and mask the service.

## Expected Result

Only required services are listening on the system.

## Remediation

### Command Line

Run the following commands to remove the package containing the service:

```bash
# apt purge <package_name>
```

OR

Run the following commands to stop and mask the service:

```bash
# systemctl stop <service_name>
# systemctl mask <service_name>
```

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

- v8: 4.8 - Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
- v7: 9.2 - Ensure Only Approved Ports, Protocols and Services Are Running
