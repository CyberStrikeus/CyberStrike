---
name: cis-ubuntu2004-v300-6-3-3-17
version: "3.0.0"
tags:
  - cis
  - ubuntu
  - linux
  - ubuntu-20.04
  - auditing
  - auditd
category: cis-logging
severity_boost: {}
---

# CIS Ubuntu 20.04 LTS Benchmark v3.0.0 - 6.3.3.17

**Control:** Ensure successful and unsuccessful attempts to use the chacl command are collected

**Profile Applicability:** Level 2 - Server, Level 2 - Workstation

**Description:**
The operating system must generate audit records for successful/unsuccessful uses of the chacl command.

chacl is an IRIX-compatibility command, and is maintained for those users who are familiar with its use from either XFS or IRIX.

**Rationale:**
chacl changes the ACL(s) for a file or directory. Without generating audit records that are specific to the security and mission needs of the organization, it would be difficult to establish, correlate, and investigate the events relating to an incident or identify those responsible for one.

Audit records can be generated from various components within the information system (e.g., module or policy filter).

## Audit

### On disk configuration

Run the following command to check the on disk rules:

```bash
UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
[ -n "${UID_MIN}" ] || UID_MIN=1000
awk "/^\s*-a\s+always,exit\s+/&&/\s+-F\s+auid>=${UID_MIN}\s+/&&/\s+-F\s+auid!=4294967295\s+/&&/\s+-F\s+perm=x\s+/&&/\s+-F\s+path=\/usr\/bin\/chacl\s+/" /etc/audit/rules.d/*.rules || printf "ERROR: Variable 'UID_MIN' is unset.\n"
```

Verify the output matches:

```
-a always,exit -F path=/usr/bin/chacl -F perm=x -F auid>=1000 -F auid!=4294967295 -k perm_chng
```

### Running configuration

Run the following command to check loaded rules:

```bash
UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
[ -n "${UID_MIN}" ] || auditctl -l | awk "/^\s*-a\s+always,exit\s+/&&/\s+-F\s+auid>=${UID_MIN}\s+/&&/\s+-F\s+auid!=4294967295\s+/&&/\s+-F\s+perm=x\s+/" || printf "ERROR: Variable 'UID_MIN' is unset.\n"
```

Verify the output matches:

```
-a always,exit -F path=/usr/bin/chacl -F perm=x -F auid>=1000 -F auid!=4294967295 -k perm_chng
```

## Remediation

Create audit rules by editing or creating a file in the `/etc/audit/rules.d/` directory, ending in `.rules` extension, with the relevant rules to monitor successful and unsuccessful attempts to use the chacl command.

Example:

```bash
UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
[ -n "${UID_MIN}" ] && printf "
-a always,exit -F path=/usr/bin/chacl -F perm=x -F auid>=${UID_MIN} -F auid!=unset -k perm_chng
" >> /etc/audit/rules.d/50-perm_chng.rules || printf "ERROR: Variable 'UID_MIN' is unset.\n"
```

Load audit rules:

```bash
augenrules --load
```

Check if reboot is required:

```bash
if [[ $(auditctl -s | grep "enabled") =~ "2" ]]; then printf "Reboot required to load rules\n"; fi
```

**Additional Information:**

Potential reboot required - If the auditing configuration is locked (-e 2), then augenrules will not warn in any way that rules could not be loaded into the running configuration. A system reboot will be required to load the rules into the running configuration.

System call structure - For performance (man 7 audit.rules) reasons it is preferable to have all the system calls on one line. However, your configuration may have them on one line each or some other combination. This is important to understand for both the auditing and remediation sections as the examples given are optimized for performance as per the man page.

**CIS Controls:**

- v8: 8.2 Collect Audit Logs - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets.
- v7: 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices.

**MITRE ATT&CK Mappings:**

- Techniques: T1562, T1562.006
- Tactics: TA0005
- Mitigations: M1022

**References:**

- NIST SP 800-53 Rev. 5: AU-2, AU-12, SI-5
