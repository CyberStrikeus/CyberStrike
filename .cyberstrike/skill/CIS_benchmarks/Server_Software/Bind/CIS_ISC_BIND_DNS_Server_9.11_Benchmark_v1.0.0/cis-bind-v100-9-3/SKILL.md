---
name: cis-bind-v100-9-3
description: "Configure a Logging Syslog Channel (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, operations, logging]
cis_id: "9.3"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: [CWE-778]
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 9.3 — Configure a Logging Syslog Channel

## Profile Applicability

- Authoritative Name Server Level 1
- Caching Only Name Server Level 1

## Description

The `syslog` option of the logging configuration allows specification of the syslog facility to send log events. A syslog channel should be configured with the value of `daemon` or other appropriate syslog facility. The `default` and `general` categories should be included and the severity level should be info or lower.

## Rationale

Configuring a syslog channel allows BIND to log important information via the standard system syslog facility. It is important that the BIND logs be included with the system monitoring and response that is performed on other system logs, and the syslog facility is helpful to ensure that the important log information isn't lost, or ignored.

## Impact

Not specified.

## Audit Procedure

Search the configuration file for a syslog logging channel, as shown below.

```
# grep -C 3 channel $CONFIG_FILES | egrep '\s+syslog\s+'
            syslog daemon;         # send to syslog's daemon facility
```

Usage of the syslog facility _daemon_ is common practice, but other facilities may be configured.

## Remediation

Configure a syslog channel to capture at least the default and general categories of log events. For external authoritative name servers, the category `lame-servers` may be redirect to null, so that it is not logged. Using lame name servers is common for the domains used for SPAM and may overload the log with information that is not very useful.

```
logging {
. . .
        // Syslog
        channel default_syslog {
            syslog daemon;         # send to syslog's daemon facility
            severity info;         # only send priority info and higher
        };
        category default { default_syslog; };
        category general { default_syslog; };
        // Too many lame servers, especially from SPAM
        category lame-servers { null; };
```

## Default Value

There is no syslog channel by default.

## References

None listed in benchmark.

## CIS Controls

| Controls Version | Control                                                                          | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v6               | 6.6 Deploy A SIEM OR Log Analysis Tools For Aggregation And Correlation/Analysis | N    | Y    | Y    |
| v7               | 6.6 Deploy SIEM or Log Analytic tool                                             | N    | Y    | Y    |
| v7               | 6.8 Regularly Tune SIEM                                                          | N    | N    | Y    |

## MITRE ATT&CK Mappings

| Tactic          | Technique                               |
| --------------- | --------------------------------------- |
| Defense Evasion | T1562.002 Disable Windows Event Logging |

## Profile

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
