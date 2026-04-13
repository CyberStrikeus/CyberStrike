---
name: cis-gcp-cos-4.1.2.2
description: "Ensure journald is configured to write logfiles to persistent disk"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, logging, journald, log-files]
cis_id: "4.1.2.2"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.2.2 Ensure journald is configured to write logfiles to persistent disk (Automated)

## Description

Data from journald may be stored in volatile memory or persisted locally on the server. Logs in memory will be lost upon a system reboot. By persisting logs to local disk on the server they are protected from loss.

## Rationale

Writing log data to disk will provide the ability to forensically reconstruct events which may have impacted the operations or security of a system even after a system crash or reboot.

## Audit Procedure

Review `/etc/systemd/journald.conf` and verify that logs are persisted to disk:

```bash
# grep -e Storage /etc/systemd/journald.conf
# Storage=persistent
```

## Expected Result

The output should show `Storage=persistent`.

## Remediation

Edit the `/etc/systemd/journald.conf` file and add the following line:

```
Storage=persistent
```

`/etc` is stateless on Container-Optimized OS. Therefore, `/etc` cannot be used to make these changes persistent across reboots. The steps mentioned above needs to be performed after every boot.

## Default Value

The main configuration file `/etc/systemd/journald.conf` is read before any of the custom *.conf files. If there are custom configs present, they override the main configuration parameters.

## References

1. https://github.com/konstruktoid/hardening/blob/master/systemd.adoc#etcsystemdjournaldconf

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | **8.2 Collect Audit Logs** - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets. | x | x | x |
| v8 | **8.5 Collect Detailed Audit Logs** - Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation. | | x | x |
| v7 | **6.2 Activate audit logging** - Ensure that local logging has been enabled on all systems and networking devices. | x | x | x |
| v7 | **6.3 Enable Detailed Logging** - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. | | x | x |

## Profile

- Level 1 - Server
