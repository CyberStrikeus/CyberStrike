# CIS Apache Tomcat 8 Benchmark v1.1.0 - Skills

This directory contains **63 SKILL.md files** for the CIS Apache Tomcat 8 Benchmark v1.1.0.

## Overview

- **Benchmark Version**: 1.1.0
- **Total Controls**: 63
- **Profile Levels**: Level 1 and Level 2

## Control Breakdown by Section

| Section | Title | Controls |
|---------|-------|----------|
| 1 | Remove Extraneous Resources | 2 |
| 2 | Limit Server Platform Information Leaks | 6 |
| 3 | Protect the Shutdown Port | 2 |
| 4 | Protect Tomcat Configurations | 14 |
| 5 | Configure Realms | 2 |
| 6 | Connector Security | 6 |
| 7 | Establish and Protect Logging Facilities | 7 |
| 8 | Configure Catalina Policy | 1 |
| 9 | Application Deployment | 3 |
| 10 | Miscellaneous Configuration Settings | 19 |
| 11 | HTTP Request Methods | 1 |

## Directory Structure

Each control has its own directory following the naming convention:
```
cis-tomcat8-v110-{control_id}/
└── SKILL.md
```

## Additional Controls (vs v1.0.0)

- **6.6** - Control the maximum size of a POST request (maxPostSize)
- **11.1** - Limit HTTP Request Methods

## Important Notes

This benchmark is ARCHIVED. CIS recommends migrating to a more recent, supported version of Apache Tomcat.

## Source Document

**CIS Apache Tomcat 8 Benchmark v1.1.0**
- Platform: Linux
- Original PDF: `CIS_Apache_Tomcat_8_Benchmark_v1.1.0_ARCHIVE.pdf`

## Contact

- CyberStrike: cyberstrike.io
- CIS Benchmarks: cisecurity.org
