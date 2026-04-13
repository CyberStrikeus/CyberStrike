---
name: cis-gcp-cos-4.1.1.3
description: "Ensure logging is configured"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, logging, stackdriver, log-files]
cis_id: "4.1.1.3"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.1.3 Ensure logging is configured (Manual)

## Description

For an image using stackdriver, the `/etc/stackdriver/logging.config.d/*.conf` files specifies rules for logging and which files are to be used to log certain classes of messages. An image using fluent-bit uses `/usr/share/fluent-bit/fluent-bit.conf` for the same purpose.

## Rationale

A great deal of important security-related information is sent via logging (e.g., successful and failed su attempts, failed login attempts, root login attempts, etc.).

## Audit Procedure

Review the contents of the `/etc/stackdriver/logging.config.d/*.conf` if using an image with stackdriver or `/usr/share/fluent-bit/fluent-bit.conf` if using an image with fluent-bit to ensure appropriate logging is set. In addition, run the following command and verify that the log files are logging information:

```bash
# ls -l /var/log/
```

## Expected Result

The output should show log files with recent timestamps, indicating active logging.

## Remediation

Edit the contents of `/etc/stackdriver/logging.config.d/*.conf` if using an image with stackdriver or `/usr/share/fluent-bit/fluent-bit.conf` if using an image with fluent-bit as appropriate for your environment.

Then run the following commands to reload the logging configuration:

For stackdriver-logging:

```bash
# systemctl restart stackdriver-logging
```

For fluent-bit:

```bash
# systemctl restart fluent-bit
```

`/etc` is stateless on Container-Optimized OS. Therefore, `/etc` cannot be used to make these changes persistent across reboots. The steps mentioned above need to be performed after every boot for images using stackdriver. This is not the case for fluent-bit as the logging agent is in `/usr/share/` which isn't stateless so changes will be persistent across reboots.

## References

1. See the rsyslog.conf(5) man page for more information.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | **8.2 Collect Audit Logs** - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets. | x | x | x |
| v8 | **8.5 Collect Detailed Audit Logs** - Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation. | | x | x |
| v7 | **6.2 Activate audit logging** - Ensure that local logging has been enabled on all systems and networking devices. | x | x | x |
| v7 | **6.3 Enable Detailed Logging** - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. | | x | x |

## Profile

- Level 2 - Server
