# CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0 - Skills

This directory contains **50 SKILL.md files** for the CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0 (ARCHIVE).

## Overview

- **Benchmark Version**: 1.0.0 (ARCHIVED)
- **Release Date**: 10-23-2020
- **Total Controls**: 50
- **Profile Levels**: Level 1 and Level 2 (Authoritative / Caching Only)
- **Platform**: ISC BIND DNS Server 9.11 on Linux (tested on CentOS 8.1)
- **Target Technology**: BIND 9.11 (Berkeley Internet Name Domain) DNS Server

## Control Breakdown by Section

| Section | Title | Controls |
|---------|-------|----------|
| 1 | Planning and Architecture | 5 |
| 2 | Restricting Permissions and Ownership | 9 |
| 3 | Restricting Queries | 4 |
| 4 | Transaction Signatures -- TSIG | 5 |
| 5 | Authenticate Zone Transfers and Updates | 3 |
| 6 | Information Leakage | 2 |
| 7 | Secure Network Communications | 4 |
| 8 | DNSSEC Digital Signatures for Authoritative Zones | 8 |
| 9 | Operations - Logging, Monitoring and Maintenance | 6 |
| 10 | Enable SELinux to Restrict BIND Processes | 4 |
| **Total** | | **50** |

## Archive Status

This benchmark is marked **ARCHIVED** by CIS. BIND 9.11 reached End-of-Life in March 2022. Any current BIND deployments should upgrade to a supported version (BIND 9.18 ESV or 9.20). This skill set is preserved for legacy system auditing and historical compliance reference.

## Scope

Covers secure configuration for ISC BIND 9.11 DNS Server running on Linux, including:

- **Planning and Architecture**: Split-horizon design, dedicated name server role, secure upstream caching
- **Permissions and Ownership**: Non-root execution, chroot isolation, file/directory permissions
- **Query Restrictions**: Recursive query controls, query origin filtering, cache query restrictions
- **TSIG**: 256-bit transaction signature keys, key file protection, unique per-host keys
- **Zone Transfers / Updates**: Authenticated transfers, dynamic updates, update forwarding
- **Information Leakage**: Version string and nameserver ID hiding
- **Secure Network Communications**: Source port randomization, DNSSEC validation, SPF/DKIM records
- **DNSSEC**: Haveged entropy, secure signing algorithms, RSA key length (2048+), NSEC/NSEC3
- **Operations**: Patching, file/syslog logging channels, HTTP stats server, RRL/DDoS mitigation
- **SELinux**: Enforcing mode, named_t confined context, SELinux booleans

## BIND-Specific Variables

Per the benchmark, audit and remediation steps reference these environment variables:

- `$CONFIG_FILES` — Primary config + included files (e.g., `/etc/named.conf`)
- `$ZONE_FILES` — Zone files referenced in configuration
- `$BIND_HOME` — BIND runtime directory (typically `/var/named` or chrooted equivalent)
- `$RUNDIR` — PID/lock directory (`/var/run/named`, `/run/named`)
- `$DYNDIR` — Dynamically updated managed keys directory
- `$SLAVEDIR` — Slave zone directory
- `$DATADIR` — Run-time statistics directory
- `$LOGDIR` — Log file directory
- `$TMPDIR` — Temporary files (`/tmp`)
- `$KEYDIR` — Signing key directory

## Directory Structure

```
cis-bind-v100-{control_id}/
└── SKILL.md
```

Example: `cis-bind-v100-1-1/SKILL.md` for control 1.1, `cis-bind-v100-10-4/SKILL.md` for control 10.4

## Source Document

**CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0**
- Platform: ISC BIND 9.11 on Linux
- Original PDF: `CIS_ISC_BIND_DNS_Server_9.11_Benchmark_v1.0.0_ARCHIVE.pdf`

## Contact

- CyberStrike: cyberstrike.io
- CIS Benchmarks: cisecurity.org
