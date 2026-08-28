---
name: cis-ubuntu2004-v300-2-1-12
description: "Ensure rpcbind services are not in use"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, services]
cis_id: "2.1.12"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.12 Ensure rpcbind services are not in use (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The rpcbind utility maps RPC services to the ports on which they listen. RPC processes notify rpcbind when they start, registering the ports they are listening on and the RPC program numbers they expect to serve. The client system then contacts rpcbind on the server with a particular RPC program number. The rpcbind service redirects the client to the proper port number so it can communicate with the requested service.

## Rationale

If the system does not require rpc based services, it is recommended that rpcbind be disabled to reduce the remote attack surface. rpcbind can be exploited for DDoS amplification attacks.

## Audit Procedure

### Command Line

Run the following command to verify rpcbind is not installed:

```bash
# dpkg-query -W -f='${binary:Package}\t${Status}\t${db:Status-Status}\n' rpcbind
```

If installed, run:

```bash
# systemctl is-enabled rpcbind.socket rpcbind.service
# systemctl is-active rpcbind.socket rpcbind.service
```

Verify the services are not enabled and not active.

## Expected Result

rpcbind should not be installed, or if installed, the services should be stopped and masked.

## Remediation

### Command Line

Run the following commands to stop and mask rpcbind:

```bash
# systemctl stop rpcbind.socket rpcbind.service
# systemctl mask rpcbind.socket rpcbind.service
```

Note: rpcbind may be a dependency for other packages. Use `apt purge rpcbind` only if no dependent packages require it, otherwise mask the service.

## Default Value

rpcbind may be installed as a dependency.

## References

1. NIST SP 800-53 Rev. 5: CM-6, CM-7

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running              |      | x    | x    |

MITRE ATT&CK Mappings: T1203, T1210, T1498, T1498.002, T1543, T1543.002 | TA0008 | M1042
