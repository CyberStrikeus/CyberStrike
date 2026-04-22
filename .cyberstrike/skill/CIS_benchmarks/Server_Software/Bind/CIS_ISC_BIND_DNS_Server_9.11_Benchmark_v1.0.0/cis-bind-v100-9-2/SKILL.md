---
name: cis-bind-v100-9-2
description: "Configure a Logging File Channel (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, operations, logging]
cis_id: "9.2"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: [CWE-778]
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 9.2 — Configure a Logging File Channel

## Profile Applicability

- Authoritative Name Server Level 1
- Caching Only Name Server Level 1

## Description

To capture logs to a local file, setup a channel for the file, in the logging configuration section. It's often helpful to have one log file for security related logs, and a second one with a dynamic severity level to be used as needed for debugging.

## Rationale

Logging security related events is critical for monitoring the security of the server in order to see any issues affecting the server, and to be able to respond to attacks.

## Impact

Not specified.

## Audit Procedure

Perform the following:

- Search the logging options of the configuration file for configured log files

```
# grep -C 4 channel $CONFIG_FILES | egrep '\s+file\s+\"'
file "/var/log/named.log" versions 10 size 20m;
file "/var/log/secure.log" versions 10 size 20m;
```

- Perform a security related event such as a denied zone transfer to generate a log entry.

```
dig @ns2.cisecurity.org cisecurity.org axfr
```

- Check the log file to verify the attempt was logged.

```
tail /var/log/secure.log
30-Sep-2016 08:54:58.664 client 10.11.214.113#38401 (cisecurity.org):
zone transfer 'cisecurity.org/AXFR/IN' denied
```

## Remediation

In `named.conf`, configure a channel for a local security log file with the categories `config`, `dnssec`, `network`, `security`, `updates`, `xfer-in` and `xfer-out`. The local log file will be within the `chroot` directory.

```
logging {
. . .
    channel local_security_log {
        file "/var/run/named/secure.log" versions 10 size 20m;
        severity debug;
        print-time yes;
    };
    // Config file processing
    category config { local_security_log; };
    // Processing signed responses
    category dnssec { local_security_log; };
    // Network Operations
    category network { local_security_log; };
    // Approved or unapproved requests
    category security { local_security_log; };
    // dynamic updates
    category update { local_security_log; };
    // transfers to the name server
    category xfer-in { local_security_log; };
    // transfers from the name server
    category xfer-out { local_security_log; };
    // Optional debug log file, may be enabled dynamically.
    channel local_debug_log {
        file "/var/run/named/debug.log";
        severity dynamic;
        print-time yes;
    };
    category default { local_debug_log; };
    category general { local_debug_log; };
};
```

## Default Value

There is no security log by default.

## References

None listed in benchmark.

## CIS Controls

| Controls Version | Control                                                                | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------------- | ---- | ---- | ---- |
| v6               | 6.2 Ensure Audit Log Settings Support Appropriate Log Entry Formatting | Y    | Y    | Y    |
| v7               | 6.2 Activate audit logging                                             | Y    | Y    | Y    |
| v7               | 6.3 Enable Detailed Logging                                            | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic          | Technique                               |
| --------------- | --------------------------------------- |
| Defense Evasion | T1562.002 Disable Windows Event Logging |

## Profile

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
