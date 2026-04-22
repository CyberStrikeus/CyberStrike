# CIS Apache Tomcat 7 Benchmark v1.1.0 - Skills

This directory contains **61 SKILL.md files** for the CIS Apache Tomcat 7 Benchmark v1.1.0.

## Overview

- **Benchmark Version**: 1.1.0
- **Release Date**: 04-26-2016
- **Total Controls**: 61
  - **Scored Controls**: 51
  - **Not Scored Controls**: 10
- **Profile Levels**: Level 1 and Level 2

## Control Breakdown by Section

| Section | Title                                    | Controls | Scored | Not Scored |
| ------- | ---------------------------------------- | -------- | ------ | ---------- |
| 1       | Remove Extraneous Resources              | 2        | 1      | 1          |
| 2       | Limit Server Platform Information Leaks  | 6        | 6      | 0          |
| 3       | Protect the Shutdown Port                | 2        | 1      | 1          |
| 4       | Protect Tomcat Configurations            | 14       | 14     | 0          |
| 5       | Configure Realms                         | 2        | 2      | 0          |
| 6       | Connector Security                       | 5        | 4      | 1          |
| 7       | Establish and Protect Logging Facilities | 7        | 7      | 0          |
| 8       | Configure Catalina Policy                | 1        | 1      | 0          |
| 9       | Application Deployment                   | 3        | 3      | 0          |
| 10      | Miscellaneous Configuration Settings     | 19       | 12     | 7          |

## Directory Structure

Each control has its own directory following the naming convention:

```
cis-tomcat7-v110-{control_id}/
└── SKILL.md
```

For example:

- `cis-tomcat7-v110-1.1/SKILL.md` - Remove extraneous files and directories
- `cis-tomcat7-v110-2.4/SKILL.md` - Disable X-Powered-By HTTP Header
- `cis-tomcat7-v110-4.1/SKILL.md` - Restrict access to $CATALINA_HOME
- `cis-tomcat7-v110-10.6/SKILL.md` - Enable strict servlet Compliance

## SKILL.md Format

Each SKILL.md file contains:

```yaml
---
name: cis-tomcat7-v110-{id}
description: "{control title}"
category: cis-tomcat
version: "1.1.0"
author: cyberstrike-official
tags: [cis, tomcat, tomcat-7, { section-specific-tags }]
cis_id: "{id}"
cis_benchmark: "CIS Apache Tomcat 7 Benchmark v1.1.0"
tech_stack: [tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---
```

Followed by markdown sections:

- **Profile Applicability**: Level 1 or Level 2
- **Description**: Control description
- **Audit Procedure**: Commands to check compliance
- **Remediation**: Steps to remediate
- **References**: Links and citations
- **CIS Controls**: Mapping to CIS Controls
- **Assessment Status**: Scored/Not Scored status

## Current Status

✅ **All 61 SKILL.md files have been generated**

The files currently contain skeleton content with proper frontmatter and structure. To complete them:

1. **Refer to the CIS Apache Tomcat 7 Benchmark PDF** (pages 9-90)
2. **Fill in detailed content** for each control:
   - Complete description and rationale from PDF
   - Exact audit commands
   - Step-by-step remediation procedures
   - Impact analysis
   - Default values
   - CWE mappings (where applicable)

## Tag Categories Used

Controls are tagged with relevant categories:

- **hardening**: General hardening measures
- **file-permissions**: File/directory permission controls
- **information-disclosure**: Information leakage prevention
- **authentication**: Authentication-related controls
- **ssl-tls**: SSL/TLS and encryption
- **logging**: Logging and monitoring
- **deployment**: Application deployment security
- **dos**: Denial of Service prevention
- **access-control**: Access control and authorization
- **security-manager**: Java Security Manager
- **configuration**: Configuration hardening

## Profile Distribution

- **Level 1 Controls**: 28 (baseline security)
- **Level 2 Controls**: 33 (defense in depth)

Level 1 controls are practical and prudent, providing a clear security benefit without inhibiting the utility of the technology beyond acceptable means.

Level 2 controls are intended for environments where security is paramount and may negatively inhibit the utility or performance of the technology.

## Source Document

**CIS Apache Tomcat 7 Benchmark v1.1.0**

- Archived benchmark (migrated to newer Tomcat versions)
- Platform: Linux
- Original PDF: `CIS_Apache_Tomcat_7_Benchmark_v1.1.0_ARCHIVE.pdf`

## Generation

These files were auto-generated using:

```bash
./generate_tomcat7_skills.sh
```

The generation script is included in this directory for reference and regeneration if needed.

## Next Steps

To use these skills in CyberStrike:

1. **Complete the content** by adding detailed audit/remediation steps from the PDF
2. **Add CWE mappings** where vulnerabilities are addressed
3. **Define chains_with** to link related controls
4. **Test audit procedures** in a Tomcat 7 environment
5. **Validate remediation steps** don't break functionality

## Important Notes

⚠️ **This benchmark is ARCHIVED**. CIS recommends migrating to a more recent, supported version of Apache Tomcat.

The controls in this benchmark were tested against Apache Tomcat 7.0 as installed by tar packages provided by Apache.

## Contact

For questions about these skills:

- CyberStrike: cyberstrike.io
- CIS Benchmarks: cisecurity.org
