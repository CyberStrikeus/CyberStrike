---
name: cis-ubuntu1804-v220-5-2-3-5
version: "2.2.0"
date_published: 2024-01-01
category: cis-logging
description: Ensure events that modify the system's network environment are collected
author: CIS Benchmarks
tags: [cis, ubuntu, linux, ubuntu-18.04, auditing, auditd]
target:
  platform: linux
  version: "18.04"
severity_boost: {}
---

# 5.2.3.5 Ensure events that modify the system's network environment are collected

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

Record changes to network environment files or system calls. The below parameters monitors the following system calls, and write an audit event on system call exit:

- `sethostname` - set the systems host name
- `setdomainname` - set the systems domain name

The files being monitored are:

- `/etc/issue` and `/etc/issue.net` - messages displayed pre-login
- `/etc/hosts` - file containing host names and associated IP addresses
- `/etc/networks` - symbolic names for networks
- `/etc/network/` - directory containing network interface scripts and configurations files

## Rationale

Monitoring `sethostname` and `setdomainname` will identify potential unauthorized changes to host and domainname of a system. The changing of these names could potentially break security parameters that are set based on those names. The `/etc/hosts` file is monitored for changes that can indicate an unauthorized intruder is trying to change machine associations with IP addresses and trick users and processes into connecting to unintended machines. Monitoring `/etc/issue` and `/etc/issue.net` is important, as intruders could put disinformation into those files and trick users into providing information to the intruder. Monitoring `/etc/network` is important as it can show if network interfaces or scripts are being modified in a way that can lead to the machine becoming unavailable or compromised. All audit records should have a relevant tag associated with them.

## Audit

### 64 Bit systems

#### On disk configuration

Run the following commands to check the on disk rules:

```bash
awk '/^ *-a *always,exit/ \
&&/ -F *arch=b(32|64)/ \
&&/ -S/ \
&&(/sethostname/ \
 ||/setdomainname/) \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/' /etc/audit/rules.d/*.rules

awk '/^ *-w/ \
&&(/\/etc\/issue/ \
 ||/\/etc\/issue.net/ \
 ||/\/etc\/hosts/ \
 ||/\/etc\/networks/ \
 ||/\/etc\/network\/ /) \
&&/ +-p *wa/ \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/' /etc/audit/rules.d/*.rules
```

Verify the output matches:

```
-a always,exit -F arch=b64 -S sethostname,setdomainname -k system-locale
-a always,exit -F arch=b32 -S sethostname,setdomainname -k system-locale
-w /etc/issue -p wa -k system-locale
-w /etc/issue.net -p wa -k system-locale
-w /etc/hosts -p wa -k system-locale
-w /etc/networks -p wa -k system-locale
-w /etc/network/ -p wa -k system-locale
```

#### Running configuration

Run the following command to check loaded rules:

```bash
auditctl -l | awk '/^ *-a *always,exit/ \
&&/ -F *arch=b(32|64)/ \
&&/ -S/ \
&&(/sethostname/ \
 ||/setdomainname/) \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/'

auditctl -l | awk '/^ *-w/ \
&&(/\/etc\/issue/ \
 ||/\/etc\/issue.net/ \
 ||/\/etc\/hosts/ \
 ||/\/etc\/networks/ \
 ||/\/etc\/network\/ /) \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/'
```

Verify the output includes:

```
-a always,exit -F arch=b64 -S sethostname,setdomainname -F key=system-locale
-a always,exit -F arch=b32 -S sethostname,setdomainname -F key=system-locale
-w /etc/issue -p wa -k system-locale
-w /etc/issue.net -p wa -k system-locale
-w /etc/hosts -p wa -k system-locale
-w /etc/networks -p wa -k system-locale
-w /etc/network/ -p wa -k system-locale
```

### 32 Bit systems

Follow the same procedures as for 64 bit systems and ignore any entries with `b64`.

## Remediation

### Create audit rules

Edit or create a file in the `/etc/audit/rules.d/` directory, ending in `.rules` extension, with the relevant rules to monitor events that modify the system's network environment.

#### 64 Bit systems

Example:

```bash
printf "
-a always,exit -F arch=b64 -S sethostname,setdomainname -k system-locale
-a always,exit -F arch=b32 -S sethostname,setdomainname -k system-locale
-w /etc/issue -p wa -k system-locale
-w /etc/issue.net -p wa -k system-locale
-w /etc/hosts -p wa -k system-locale
-w /etc/networks -p wa -k system-locale
-w /etc/network/ -p wa -k system-locale
" >> /etc/audit/rules.d/50-system_locale.rules
```

### Load audit rules

Merge and load the rules into active configuration:

```bash
augenrules --load
```

Check if reboot is required:

```bash
if [[ $(auditctl -s | grep "enabled") =~ "2" ]]; then printf "Reboot required to load rules\n"; fi
```

#### 32 Bit systems

Follow the same procedures as for 64 bit systems and ignore any entries with `b64`.

## References

- NIST SP 800-53 Rev. 5: AU-3, CM-6

## CIS Controls

| Version | Control | IG 1 | IG 2 | IG 3 |
|---------|---------|------|------|------|
| v8 | 8.5 Collect Detailed Audit Logs | | ● | ● |
| v7 | 5.5 Implement Automated Configuration Monitoring Systems | | ● | ● |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|----------------------------|---------|-------------|
| T1562, T1562.006 | TA0003 | M1047 |

## Additional Information

**Potential reboot required**: If the auditing configuration is locked (`-e 2`), then `augenrules` will not warn in any way that rules could not be loaded into the running configuration. A system reboot will be required to load the rules into the running configuration.

**System call structure**: For performance (`man 7 audit.rules`) reasons it is preferable to have all the system calls on one line. However, your configuration may have them on one line each or some other combination.
