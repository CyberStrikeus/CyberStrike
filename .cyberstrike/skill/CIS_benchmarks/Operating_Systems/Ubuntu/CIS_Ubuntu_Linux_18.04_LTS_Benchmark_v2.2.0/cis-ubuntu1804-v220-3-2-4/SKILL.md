---
name: cis-ubuntu1804-v220-3-2-4
description: "Ensure sctp kernel module is not available"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, kernel-module]
cis_id: "3.2.4"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.2.4

## Description

The Stream Control Transmission Protocol (SCTP) is a transport layer protocol used to support message oriented communication, with several streams of messages in one connection. It serves a similar function as TCP and UDP, incorporating features of both. It is message-oriented like UDP and ensures reliable in-sequence transport of messages with congestion control like TCP.

## Rationale

If the protocol is not being used, it is recommended that the kernel module drivers not be installed to reduce the potential attack surface.

## Impact

None.

## Audit Procedure

### Command Line

Run the following script to verify the `sctp` module is not available:

```bash
#!/usr/bin/bash
{
  l_mname="sctp"
  l_mtype="net"
  l_output="" l_output2=""

  l_loadable="$(modprobe -n -v "$l_mname")"
  [ "$(wc -l <<< "$l_loadable")" -gt "1" ] && l_loadable="$(grep -P -- "(^\h*install|\b$l_mname)\b" <<< "$l_loadable")"
  if grep -Pq -- '^\h*install \/bin\/(true|false)' <<< "$l_loadable"; then
    l_output="$l_output\n - module: \"$l_mname\" is not loadable: \"$l_loadable\""
  else
    l_output2="$l_output2\n - module: \"$l_mname\" is loadable: \"$l_loadable\""
  fi

  if ! lsmod | grep "$l_mname" > /dev/null 2>&1; then
    l_output="$l_output\n - module: \"$l_mname\" is not loaded"
  else
    l_output2="$l_output2\n - module: \"$l_mname\" is loaded"
  fi

  if modprobe --showconfig | grep -Pq -- "^\h*blacklist\h+$l_mname\b"; then
    l_output="$l_output\n - module: \"$l_mname\" is deny listed in: \"$(grep -Pl -- "^\h*blacklist\h+$l_mname\b" /etc/modprobe.d/*)\""
  else
    l_output2="$l_output2\n - module: \"$l_mname\" is not deny listed"
  fi

  if [ -z "$l_output2" ]; then
    echo -e "\n- Audit Result:\n ** PASS **\n$l_output\n"
  else
    echo -e "\n- Audit Result:\n ** FAIL **\n - Reason(s) for audit failure:\n$l_output2\n"
    [ -n "$l_output" ] && echo -e "\n- Correctly set:\n$l_output\n"
  fi
}
```

## Expected Result

```
- Audit Result:
 ** PASS **
 - module: "sctp" is not loadable: "install /bin/true"
 - module: "sctp" is not loaded
 - module: "sctp" is deny listed in: "/etc/modprobe.d/<filename>.conf"
```

## Remediation

### Command Line

Run the following script to disable the `sctp` module:

```bash
#!/usr/bin/bash
{
  l_mname="sctp"

  if ! modprobe -n -v "$l_mname" | grep -P -- '^\h*install \/bin\/(true|false)'; then
    echo -e " - setting module: \"$l_mname\" to be not loadable"
    echo -e "install $l_mname /bin/false" >> /etc/modprobe.d/"$l_mname".conf
  fi

  if lsmod | grep "$l_mname" > /dev/null 2>&1; then
    echo -e " - unloading module \"$l_mname\""
    modprobe -r "$l_mname"
  fi

  if ! modprobe --showconfig | grep -Pq -- "^\h*blacklist\h+$l_mname\b"; then
    echo -e " - deny listing \"$l_mname\""
    echo -e "blacklist $l_mname" >> /etc/modprobe.d/"$l_mname".conf
  fi
}
```

## Default Value

sctp module is available by default.

## References

1. NIST SP 800-53 Rev. 5: CM-7
2. CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0

## CIS Controls

Version 8

4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software - Uninstall or disable unnecessary services on enterprise assets and software.

Version 7

9.2 Ensure Only Approved Ports, Protocols and Services Are Running - Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Assessment Status

Automated
