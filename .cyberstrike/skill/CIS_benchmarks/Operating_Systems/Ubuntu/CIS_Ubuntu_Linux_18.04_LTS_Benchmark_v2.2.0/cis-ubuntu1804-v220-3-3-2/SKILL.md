---
name: cis-ubuntu1804-v220-3-3-2
description: "Ensure packet redirect sending is disabled"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, kernel-parameter]
cis_id: "3.3.2"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.3.2

## Description

ICMP Redirects are used to send routing information to other hosts. As a host itself does not act as a router (in a host only configuration), there is no need to send redirects.

## Rationale

An attacker could use a compromised host to send invalid ICMP redirects to other router devices in an attempt to corrupt routing and have users access a system set up by the attacker as opposed to a valid system.

## Impact

None.

## Audit Procedure

### Command Line

Run the following script to verify packet redirect sending is disabled:

```bash
#!/usr/bin/bash
{
  l_output="" l_output2=""
  a_parlist=("net.ipv4.conf.all.send_redirects=0" "net.ipv4.conf.default.send_redirects=0")

  for l_kpe in "${a_parlist[@]}"; do
    l_kpname="$(awk -F= '{print $1}' <<< "$l_kpe")"
    l_kpvalue="$(awk -F= '{print $2}' <<< "$l_kpe")"
    l_krp="$(sysctl "$l_kpname" | awk -F= '{print $2}' | xargs)"
    if [ "$l_krp" = "$l_kpvalue" ]; then
      l_output="$l_output\n - \"$l_kpname\" is correctly set to \"$l_krp\" in the running configuration"
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

```
- Audit Result:
 ** PASS **
 - "net.ipv4.conf.all.send_redirects" is correctly set to "0" in the running configuration
 - "net.ipv4.conf.default.send_redirects" is correctly set to "0" in the running configuration
```

## Remediation

### Command Line

Set the following parameters in `/etc/sysctl.conf` or a `/etc/sysctl.d/*` file:

```
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
```

Run the following commands to set the active kernel parameters:

```bash
sysctl -w net.ipv4.conf.all.send_redirects=0
sysctl -w net.ipv4.conf.default.send_redirects=0
sysctl -w net.ipv4.route.flush=1
```

## Default Value

net.ipv4.conf.all.send_redirects = 1, net.ipv4.conf.default.send_redirects = 1

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
