---
name: cis-gcp-cos-2.1.4
description: "Ensure rsync service is not enabled"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, rsync, services]
cis_id: "2.1.4"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.4 Ensure rsync service is not enabled (Automated)

## Description

The `rsyncd` service can be used to synchronize files between systems over network links.

## Rationale

The `rsyncd` service presents a security risk as it uses unencrypted protocols for communication.

## Audit Procedure

Run the following command to verify `rsyncd` is not enabled:

```bash
# systemctl is-enabled rsyncd
disabled
```

Verify result is not "enabled".

## Expected Result

The command should return `disabled`, confirming that the rsync service is not enabled.

## Remediation

Run the following command to disable `rsyncd`:

```bash
# systemctl --now disable rsyncd
```

`/etc` is stateless on Container-Optimized OS. Therefore, the steps mentioned above needs to be performed after every boot.

**Additional Information:**

Additional methods of disabling a service exist. Consult your distribution documentation for appropriate methods.

On some distributions the rsync service is known as `rsync`, not `rsyncd`.

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | **4.4 Implement and Manage a Firewall on Servers** - Implement and manage a firewall on servers, where supported. Example implementations include a virtual firewall, operating system firewall, or a third-party firewall agent.                                 | X    | X    | X    |
| v8               | **4.5 Implement and Manage a Firewall on End-User Devices** - Implement and manage a host-based firewall or port-filtering tool on end-user devices, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed. | X    | X    | X    |
| v8               | **4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software** - Uninstall or disable unnecessary services on enterprise assets and software, such as an unused file sharing service, web application module, or service function.           |      | X    | X    |
| v7               | **9.2 Ensure Only Approved Ports, Protocols and Services Are Running** - Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.                                                 |      | X    | X    |

## Profile

- Level 1 - Server
