---
name: cis-ubuntu1804-v220-3-3-5
description: "Ensure ICMP redirects are not accepted"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, kernel-parameter]
cis_id: "3.3.5"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.3.5

## Description

ICMP redirect messages are packets that convey routing information and tell your host (acting as a router) to send packets via an alternate path. It is a way of allowing an outside routing device to update your system routing tables. By setting `net.ipv4.conf.all.accept_redirects` and `net.ipv6.conf.all.accept_redirects` to 0, the system will not accept any ICMP redirect messages, and therefore, won't allow outsiders to update the system's routing tables.

## Rationale

Attackers could use bogus ICMP redirect messages to maliciously alter the system routing tables and get them to send packets to incorrect networks and allow your system's packets to be captured.

## Impact

None.

## Audit Procedure

### Command Line

Run the following script to verify ICMP redirects are not accepted:

```bash
#!/usr/bin/bash
{
  l_output="" l_output2=""
  a_parlist=("net.ipv4.conf.all.accept_redirects=0" "net.ipv4.conf.default.accept_redirects=0" "net.ipv6.conf.all.accept_redirects=0" "net.ipv6.conf.default.accept_redirects=0")

  for l_kpe in "${a_parlist[@]}"; do
    l_kpname="$(awk -F= '{print $1}' <<< "$l_kpe")"
    l_kpvalue="$(awk -F= '{print $2}' <<< "$l_kpe")"
    l_krp="$(sysctl "$l_kpname" | awk -F= '{print $2}' | xargs)"
    if [ "$l_krp" = "$l_kpvalue" ]; then
      l_output="$l_output\n - \"$l_kpname\" is correctly set to \"$l_krp\""
    else
      l_output2="$l_output2\n - \"$l_kpname\" is incorrectly set to \"$l_krp\" and should have a value of: \"$l_kpvalue\""
    fi
  done

  if [ -z "$l_output2" ]; then
    echo -e "\n- Audit Result:\n ** PASS **\n$l_output\n"
  else
    echo -e "\n- Audit Result:\n ** FAIL **\n - Reason(s) for audit failure:\n$l_output2\n"
    [ -n "$l_output" ] && echo -e "\n- Correctly set:\n$l_output\n"
  fi
}
```

## Expected Result

All parameters should be set to `0`.

## Remediation

### Command Line

Set the following parameters in `/etc/sysctl.conf` or a `/etc/sysctl.d/*` file:

```
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
```

Run the following commands to set the active kernel parameters:

```bash
sysctl -w net.ipv4.conf.all.accept_redirects=0
sysctl -w net.ipv4.conf.default.accept_redirects=0
sysctl -w net.ipv6.conf.all.accept_redirects=0
sysctl -w net.ipv6.conf.default.accept_redirects=0
sysctl -w net.ipv4.route.flush=1
sysctl -w net.ipv6.route.flush=1
```

## Default Value

net.ipv4.conf.all.accept_redirects = 0, net.ipv4.conf.default.accept_redirects = 0, net.ipv6.conf.all.accept_redirects = 0, net.ipv6.conf.default.accept_redirects = 0

## References

1. NIST SP 800-53 Rev. 5: CM-7, SC-5, SC-7
2. CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0

## CIS Controls

Version 8

4.1 Establish and Maintain a Secure Configuration Process - Establish and maintain a secure configuration process for enterprise assets.

Version 7

5.1 Establish Secure Configurations - Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
