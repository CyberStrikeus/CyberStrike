---
name: cis-ubuntu1804-v220-5-1-1-1-4
description: "Ensure journald is not configured to receive logs from a remote client"
category: cis-logging
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, journald, logging]
cis_id: "5.1.1.1.4"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.1.1.4 Ensure journald is not configured to receive logs from a remote client (Automated)

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

Journald supports the ability to receive messages from remote hosts, thus acting as a log server. Clients should not receive data from other hosts.

Note:
- The same package, `systemd-journal-remote`, is used for both sending logs to remote hosts and receiving incoming logs.
- With regards to receiving logs, there are two services; `systemd-journal-remote.socket` and `systemd-journal-remote.service`.

## Rationale

If a client is configured to also receive data, thus turning it into a server, the client system is acting outside it's operational boundary.

## Audit Procedure

### Command Line

Run the following command to verify `systemd-journal-remote.socket` is not enabled:

```bash
systemctl is-enabled systemd-journal-remote.socket
```

Verify the output matches:

```
disabled
```

## Expected Result

The output should show `disabled`.

## Remediation

### Command Line

Run the following command to disable `systemd-journal-remote.socket`:

```bash
systemctl --now disable systemd-journal-remote.socket
```

## Default Value

systemd-journal-remote.socket is disabled by default.

## References

1. NIST SP 800-53 Rev. 5: AU-2, AU-12, CM-6, CM-7

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software - Uninstall or disable unnecessary services on enterprise assets and software. |
| v8 | 8.2 Collect Audit Logs - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets. |
| v7 | 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices. |
| v7 | 6.3 Enable Detailed Logging - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running - Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system. |
