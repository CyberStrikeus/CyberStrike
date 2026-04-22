---
name: "CIS Ubuntu 14.04 LTS - 4.2.2.5 Ensure remote syslog-ng messages are only accepted on designated log hosts"
description: "Configure syslog-ng to accept remote messages only on designated log hosts"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - not-scored
  - syslog-ng
  - remote-logging
  - logging
cis_id: "4.2.2.5"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 4.2.2.5 Ensure remote syslog-ng messages are only accepted on designated log hosts (Not Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

By default, `syslog-ng` does not listen for log messages coming in from remote systems.

## Rationale

The guidance in the section ensures that remote log hosts are configured to only accept `syslog-ng` data from hosts within the specified domain and that those systems that are not designed to be log hosts do not accept any remote `syslog-ng` messages. This provides protection from spoofed log data and ensures that system administrators are reviewing reasonably complete syslog data in a central location.

## Audit Procedure

Review the `/etc/syslog-ng/syslog-ng.conf` file and verify the following lines are configured appropriately on designated log hosts:

```bash
source net{ tcp(); };
destination remote { file("/var/log/remote/${FULLHOST}-log"); };
log { source(net); destination(remote); };
```

## Expected Result

On designated log hosts, the source, destination, and log directives should be present. On non-log hosts, network sources should not be configured.

## Remediation

On designated log hosts edit the `/etc/syslog-ng/syslog-ng.conf` file and configure the following lines are appropriately:

```bash
source net{ tcp(); };
destination remote { file("/var/log/remote/${FULLHOST}-log"); };
log { source(net); destination(remote); };
```

On non designated log hosts edit the `/etc/syslog-ng/syslog-ng.conf` file and remove or edit any sources that accept network sourced log messages.

Run the following command to reload the `syslog-ng` configuration:

```bash
pkill -HUP syslog-ng
```

## Default Value

syslog-ng does not listen for remote messages by default.

## References

1. See the syslog-ng(8) man page for more information.

## Profile

- Level 1 - Server
- Level 1 - Workstation
