---
name: cis-ubuntu1804-v220-1-3-1
description: "Ensure updates, patches, and additional security software are installed"
category: cis-storage
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, patching, updates, apt]
cis_id: "1.3.1"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.3.1 Ensure updates, patches, and additional security software are installed (Manual)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Periodically patches are released for included software either due to security flaws or to include additional functionality.

## Rationale

Newer patches may contain security enhancements that would not be available through the latest full update. As a result, it is recommended that the latest software patches be used to take advantage of the latest functionality. As with any software installation, organizations need to determine if a given update meets their requirements and verify the compatibility and supportability of any additional software against the update revision that is selected.

## Audit Procedure

### Command Line

Verify there are no updates or patches to install:

```bash
apt -s upgrade
```

## Expected Result

No pending updates or patches should be listed.

## Remediation

### Command Line

Run the following command to update all packages following local site policy guidance on applying updates and patches:

```bash
apt upgrade
```

OR

```bash
apt dist-upgrade
```

## Additional Information

Site policy may mandate a testing period before install onto production systems for available updates.

- upgrade - is used to install the newest versions of all packages currently installed on the system from the sources enumerated in /etc/apt/sources.list. Packages currently installed with new versions available are retrieved and upgraded; under no circumstances are currently installed packages removed, or packages not already installed retrieved and installed. New versions of currently installed packages that cannot be upgraded without changing the install status of another package will be left at their current version. An update must be performed first so that apt knows that new versions of packages are available.
- dist-upgrade - in addition to performing the function of upgrade, also intelligently handles changing dependencies with new versions of packages; apt has a "smart" conflict resolution system, and it will attempt to upgrade the most important packages at the expense of less important ones if necessary. So, dist-upgrade command may remove some packages. The /etc/apt/sources.list file contains a list of locations from which to retrieve desired package files. See also apt_preferences(5) for a mechanism for overriding the general settings for individual packages.

## References

1. NIST SP 800-53 Rev. 5: SI-2

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 7.3 Perform Automated Operating System Patch Management | X | X | X |
| v7 | 3.4 Deploy Automated Operating System Patch Management Tools | X | X | X |
| v7 | 3.5 Deploy Automated Software Patch Management Tools | X | X | X |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1211, T1211.000 | TA0004, TA0008 | M1051 |
