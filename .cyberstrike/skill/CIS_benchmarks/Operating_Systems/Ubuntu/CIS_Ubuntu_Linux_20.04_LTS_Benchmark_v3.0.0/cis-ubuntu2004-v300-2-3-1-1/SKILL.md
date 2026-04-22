---
name: cis-ubuntu2004-v300-2-3-1-1
description: "Ensure a single time synchronization daemon is in use"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, time-sync, systemd-timesyncd, chrony]
cis_id: "2.3.1.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure a single time synchronization daemon is in use

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

System time should be synchronized between all systems in an environment. This is typically done by establishing an authoritative time server or set of servers and having all systems synchronize their clocks to them.

**Note:**

- On virtual systems where host based time synchronization is available consult your virtualization software documentation and verify that host based synchronization is in use and follows local site policy. In this scenario, this section should be skipped
- Only one time synchronization method should be in use on the system. Configuring multiple time synchronization methods could lead to unexpected or unreliable results

## Rationale

Time synchronization is important to support time sensitive security mechanisms and ensures log files have consistent time records across the enterprise, which aids in forensic investigations.

## Audit

On physical systems, and virtual systems where host based time synchronization is not available.

One of the two time synchronization daemons should be available; chrony or systemd-timesyncd

Run the following script to verify that a single time synchronization daemon is available on the system:

### Command Line

```bash
#!/usr/bin/env bash
{
  l_output="" l_output2=""
  service_not_enabled_chk()
  {
    l_out2=""
    if systemctl is-enabled "$l_service_name" 2>/dev/null | grep -q 'enabled'; then
      l_out2="$l_out2\n - Daemon: \"$l_service_name\" is enabled on the system"
    fi
    if systemctl is-active "$l_service_name" 2>/dev/null | grep -q 'active'; then
      l_out2="$l_out2\n - Daemon: \"$l_service_name\" is active on the system"
    fi
  }
  l_service_name="systemd-timesyncd.service" # Check systemd-timesyncd daemon
  service_not_enabled_chk
  if [ -n "$l_out2" ]; then
    l_timesyncd="y"
    l_out_tsd="$l_out2"
  else
    l_timesyncd="n"
    l_out_tsd="\n - Daemon: \"$l_service_name\" is not enabled and not active on the system"
  fi
  l_service_name="chrony.service" # Check chrony
  service_not_enabled_chk
  if [ -n "$l_out2" ]; then
    l_chrony="y"
    l_out_chrony="$l_out2"
  else
    l_chrony="n"
    l_out_chrony="\n - Daemon: \"$l_service_name\" is not enabled and not active on the system"
  fi
  l_status="$l_timesyncd$l_chrony"
  case "$l_status" in
    yy)
      l_output2=" - More than one time sync daemon is in use on the system$l_out_tsd$l_out_chrony"
      ;;
    nn)
      l_output2=" - No time sync daemon is in use on the system$l_out_tsd$l_out_chrony"
      ;;
    yn|ny)
      l_output=" - Only one time sync daemon is in use on the system$l_out_tsd$l_out_chrony"
      ;;
    *)
      l_output2=" - Unable to determine time sync daemon(s) status"
      ;;
  esac
  if [ -z "$l_output2" ]; then
    echo -e "\n- Audit Result:\n  ** PASS **\n$l_output\n"
  else
    echo -e "\n- Audit Result:\n  ** FAIL **\n - * Reasons for audit failure * :$l_output2\n"
  fi
}
```

## Expected Result

**Note:** Follow the guidance in the subsection for the time synchronization daemon available on the system and skip the other time synchronization daemon subsection.

## Remediation

On physical systems, and virtual systems where host based time synchronization is not available.

Select one of the two time synchronization daemons; chrony (1) or systemd-timesyncd (2) and following the remediation procedure for the selected daemon.

**Note:** enabling more than one synchronization daemon could lead to unexpected or unreliable results:

### 1. chrony

Run the following command to install chrony:

```bash
# apt install chrony
```

Run the following commands to stop and mask the systemd-timesyncd daemon:

```bash
# systemctl stop systemd-timesyncd.service
# systemctl mask systemd-timesyncd.service
```

**Note:**

- Subsection: Configure chrony should be followed
- Subsection: Configure systemd-timesyncd should be skipped

### 2. systemd-timesyncd

Run the following command to remove the chrony package:

```bash
# apt purge chrony
# apt autoremove chrony
```

**Note:**

- Subsection: Configure systemd-timesyncd should be followed
- Subsection: Configure chrony should be skipped

## References

1. NIST SP 800-53 Rev. 5: AU-3, AU-12

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.4 Standardize Time Synchronization<br/>Standardize time synchronization. Configure at least two synchronized time sources across enterprise assets, where supported. | | ● | ● |
| v7 | 6.1 Utilize Three Synchronized Time Sources<br/>Use at least three synchronized time sources from which all servers and network devices retrieve time information on a regular basis so that timestamps in logs are consistent. | | ● | ● |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1070, T1070.002, T1562, T1562.001 | TA0005 | |
