# CIS Ubuntu 18.04 v2.2.0 - Section 5.2.4 Auditd File Access

## Overview

Created 11 skills for auditd file access controls (section 5.2.4):

### 5.2.4.1-5.2.4.3: Audit Log Files
- **5.2.4.1** - Ensure audit log files are mode 0640 or less permissive
- **5.2.4.2** - Ensure only authorized users own audit log files
- **5.2.4.3** - Ensure only authorized groups are assigned ownership of audit log files

### 5.2.4.4: Audit Log Directory
- **5.2.4.4** - Ensure the audit log directory is 0750 or more restrictive

### 5.2.4.5-5.2.4.7: Audit Configuration Files
- **5.2.4.5** - Ensure audit configuration files are 640 or more restrictive
- **5.2.4.6** - Ensure audit configuration files are owned by root
- **5.2.4.7** - Ensure audit configuration files belong to group root

### 5.2.4.8-5.2.4.11: Audit Tools
- **5.2.4.8** - Ensure audit tools are 755 or more restrictive
- **5.2.4.9** - Ensure audit tools are owned by root
- **5.2.4.10** - Ensure audit tools belong to group root
- **5.2.4.11** - Ensure cryptographic mechanisms are used to protect the integrity of audit tools (Level 1)

## Metadata

- **Profile Applicability:** Level 2 - Server, Level 2 - Workstation (except 5.2.4.11 which is Level 1)
- **Category:** cis-logging
- **Tags:** cis, ubuntu, linux, ubuntu-18.04, auditing, auditd
- **Version:** 2.2.0
- **Automated:** Yes (all controls)

## MITRE ATT&CK Mapping

All controls map to:
- **Tactics:** TA0007 (Discovery)
- **Techniques:** T1070 (Indicator Removal on Host), T1070.002 (Clear Linux/Mac System Logs), T1083 (File and Directory Discovery), T1083.000
- **Mitigations:** M1047 (Audit), M1022 (Restrict File and Directory Permissions - where applicable)

## CIS Controls

All controls map to:
- **v8:** 3.3 Configure Data Access Control Lists
- **v7:** 14.6 Protect Information through Access Control Lists

## References

- NIST SP 800-53 Rev. 5: AU-3

## Files Protected

### Audit Log Files
- Located in directory specified by `log_file` parameter in `/etc/audit/auditd.conf`
- Typically `/var/log/audit/audit.log*`

### Audit Configuration Files
- `/etc/audit/*.conf`
- `/etc/audit/*.rules`
- `/etc/audit/audit.conf.d/*.conf`

### Audit Tools
- `/sbin/auditctl`
- `/sbin/aureport`
- `/sbin/ausearch`
- `/sbin/autrace`
- `/sbin/auditd`
- `/sbin/augenrules`

## Notes

- Control 5.2.4.3 requires setting `log_group` parameter in `/etc/audit/auditd.conf` to `adm` or `root`
- Control 5.2.4.11 uses AIDE (Advanced Intrusion Detection Environment) for file integrity monitoring
- Some remediation actions require restarting the auditd service
