---
name: cis-ubuntu1804-v220-2-1-1-1
description: "Ensure a single time synchronization daemon is in use"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, services, time-synchronization]
cis_id: "2.1.1.1"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.1.1 Ensure a single time synchronization daemon is in use (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

System time should be synchronized between all systems in an environment. This is typically done by establishing an authoritative time server or set of servers and having all systems synchronize their clocks to them.

Note:

- On virtual systems where host based time synchronization is available consult your virtualization software documentation and verify that host based synchronization is in use and follows local site policy. In this scenario, this section should be skipped
- Only one time synchronization method should be in use on the system. Configuring multiple time synchronization methods could lead to unexpected or unreliable results

## Rationale

Time synchronization is important to support time sensitive security mechanisms and ensures log files have consistent time records across the enterprise, which aids in forensic investigations.

## Audit Procedure

### Command Line

On physical systems, and virtual systems where host based time synchronization is not available.
One of the three time synchronization daemons should be available; `chrony`, `systemd-timesyncd`, or `ntp`

Run the following script to verify that a single time synchronization daemon is available on the system:

```bash
#!/usr/bin/env bash

{
   output="" l_tsd="" l_sdtd="" chrony="" l_ntp=""
   dpkg-query -W chrony > /dev/null 2>&1 && l_chrony="y"
   dpkg-query -W ntp > /dev/null 2>&1 && l_ntp="y" || l_ntp=""
   systemctl list-units --all --type=service | grep -q 'systemd-timesyncd.service' && systemctl is-enabled systemd-timesyncd.service | grep -q 'enabled' && l_sdtd="y"
   if [[ "$l_chrony" = "y" && "$l_ntp" != "y" && "$l_sdtd" != "y" ]]; then
      l_tsd="chrony"
      output="$output\n- chrony is in use on the system"
   elif [[ "$l_chrony" != "y" && "$l_ntp" != "y" && "$l_sdtd" != "y" ]]; then
      l_tsd="ntp"
      output="$output\n- ntp is in use on the system"
   elif [[ "$l_chrony" != "y" && "$l_ntp" != "y" ]]; then
      if systemctl list-units --all --type=service | grep -q 'systemd-timesyncd.service' && systemctl is-enabled systemd-timesyncd.service | grep -Eq '(enabled|disabled|masked)'; then
         l_tsd="sdtd"
         output="$output\n- systemd-timesyncd is in use on the system"
      fi
   else
      [[ "$l_chrony" = "y" && "$l_ntp" = "y" ]] && output="$output\n- both chrony and ntp are in use on the system"
      [[ "$l_chrony" = "y" && "$l_sdtd" = "y" ]] && output="$output\n- both chrony and systemd-timesyncd are in use on the system"
      [[ "$l_ntp" = "y" && "$l_sdtd" = "y" ]] && output="$output\n- both ntp and systemd-timesyncd are in use on the system"
   fi
   if [ -n "$l_tsd" ]; then
      echo -e "\n- PASS:\n$output\n"
   else
      echo -e "\n- FAIL:\n$output\n"
   fi
}
```

Note: Follow the guidance in the subsection for the time synchronization daemon available on the system and skip the other two time synchronization daemon subsections.

## Expected Result

PASS: One of chrony, systemd-timesyncd, or ntp is in use on the system.

## Remediation

### Command Line

On physical systems, and virtual systems where host based time synchronization is not available.
Select one of the three time synchronization daemons; `chrony` (1), `systemd-timesyncd` (2), or `ntp` (3), and follow the remediation procedure for the selected daemon.

Note: enabling more than one synchronization daemon could lead to unexpected or unreliable results.

**1. chrony**

Run the following command to install chrony:

```bash
# apt install chrony
```

Run the following commands to stop and mask the systemd-timesyncd daemon:

```bash
# systemctl stop systemd-timesyncd.service
# systemctl --now mask systemd-timesyncd.service
```

Run the following command to remove the ntp package:

```bash
# apt purge ntp
```

**2. systemd-timesyncd**

Run the following command to remove the chrony package:

```bash
# apt purge chrony
```

Run the following command to remove the ntp package:

```bash
# apt purge ntp
```

**3. ntp**

Run the following command to install ntp:

```bash
# apt install ntp
```

Run the following commands to stop and mask the systemd-timesyncd daemon:

```bash
# systemctl stop systemd-timesyncd.service
# systemctl --now mask systemd-timesyncd.service
```

Run the following command to remove the chrony package:

```bash
# apt purge chrony
```

## References

1. NIST SP 800-53 Rev. 5: AU-3, AU-12

## CIS Controls

- v8: 8.4 - Standardize Time Synchronization
- v7: 6.1 - Utilize Three Synchronized Time Sources
