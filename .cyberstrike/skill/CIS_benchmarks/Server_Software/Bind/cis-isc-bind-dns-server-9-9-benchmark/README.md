# CIS ISC BIND DNS Server 9.9 Benchmark v3.0.1 - Skills

This directory contains **35 SKILL.md files** for the CIS ISC BIND DNS Server 9.9 Benchmark v3.0.1 (ARCHIVE).

## Overview

- **Benchmark Version**: 3.0.1 (ARCHIVED)
- **Release Date**: 07-10-2017
- **Total Controls**: 35
- **Profile Levels**: Level 1 and Level 2 (Authoritative / Caching Only)
- **Platform**: ISC BIND DNS Server 9.9 on Linux (tested on CentOS 7.2)
- **Assessment Status**: Scored / Not Scored (pre-Automated/Manual terminology)

## Control Breakdown by Section

| Section   | Title                                            | Controls |
| --------- | ------------------------------------------------ | -------- |
| 1         | Planning and Architecture                        | 5        |
| 2         | Restricting Permissions and Ownership            | 9        |
| 3         | Restricting Queries                              | 4        |
| 4         | Transaction Signatures -- TSIG                   | 5        |
| 5         | Authenticate Zone Transfers and Updates          | 3        |
| 6         | Information Leakage                              | 2        |
| 7         | Secure Network Communications                    | 3        |
| 8         | Operations - Logging, Monitoring and Maintenance | 4        |
| **Total** |                                                  | **35**   |

## Archive Status

This benchmark is marked **ARCHIVED** by CIS. BIND 9.9 reached End-of-Life. The successor benchmark is CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0 (50 controls), which adds:

- Section 7.4: SPF/DKIM DNS records
- Section 8 (renamed S9 in v1.0.0): DNSSEC Digital Signatures (8 controls)
- Section 9.5-9.6 (renamed S10 in v1.0.0): RRL/DDoS mitigation, key rotation
- Section 10 (new in v1.0.0): SELinux BIND restrictions (4 controls)

## Differences from BIND 9.11 v1.0.0

| Feature           | BIND 9.9 v3.0.1      | BIND 9.11 v1.0.0        |
| ----------------- | -------------------- | ----------------------- |
| Total Controls    | 35                   | 50                      |
| Assessment Type   | Scored / Not Scored  | Automated / Manual      |
| CIS Controls      | v6                   | v6 + v7                 |
| DNSSEC Signatures | Not included         | Section 8 (8 controls)  |
| SELinux           | Not included         | Section 10 (4 controls) |
| SPF/DKIM          | Not included         | 7.4                     |
| RRL/DDoS          | Not included         | 9.5                     |
| Key Rotation      | Not included         | 9.6                     |
| S2.7              | Group+Other combined | Separate 2.7 + 2.8      |

## Directory Structure

```
cis-bind9-v301-{control_id}/
└── SKILL.md
```

Example: `cis-bind9-v301-1-1/SKILL.md` for control 1.1

## Source Document

**CIS ISC BIND DNS Server 9.9 Benchmark v3.0.1**

- Platform: ISC BIND 9.9 on Linux
- Original PDF: `CIS_ISC_BIND_DNS_Server_9.9_Benchmark_v3.0.1_ARCHIVE.pdf`

## Contact

- CyberStrike: cyberstrike.io
- CIS Benchmarks: cisecurity.org
