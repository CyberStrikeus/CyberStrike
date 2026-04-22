---
name: cis-ubuntu2004-v300-3-1-1
description: "Ensure IPv6 status is identified"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, network]
cis_id: "3.1.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.1 Ensure IPv6 status is identified (Manual)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Internet Protocol Version 6 (IPv6) is the most recent version of Internet Protocol (IP). It's designed to supply IP addressing and additional security to support the predicted growth of connected devices. IPv6 is based on 128-bit addressing and can support 340 undecillion, which is 340,282,366,920,938,463,463,374,607,431,768,211,456 unique addresses.

Features of IPv6:

- Hierarchical addressing and routing infrastructure
- Statefull and Stateless configuration
- Support for quality of service (QoS)
- An ideal protocol for neighboring node interaction

## Rationale

IETF RFC 4038 recommends that applications are built with an assumption of dual stack. It is recommended that IPv6 be enabled and configured in accordance with Benchmark recommendations.

- IF - dual stack and IPv6 are not used in your environment, IPv6 may be disabled to reduce the attack surface of the system, and recommendations pertaining to IPv6 can be skipped.

Note: It is recommended that IPv6 be enabled and configured unless this is against local site policy

## Impact

IETF RFC 4038 recommends that applications are built with an assumption of dual stack.

When enabled, IPv6 will require additional configuration to reduce risk to the system.

## Audit Procedure

### Command Line

Run the following script to identify if IPv6 is enabled on the system:

```bash
#!/usr/bin/env bash

{
  l_output=""
  ! grep -Pqs -- '^\h*0\b' /sys/module/ipv6/parameters/disable && l_output="- IPv6 is not enabled"
  if sysctl net.ipv6.conf.all.disable_ipv6 | grep -Pqs -- "^\h*net\.ipv6\.conf\.all\.disable_ipv6\h*=\h*1\b" \
&& \
      sysctl net.ipv6.conf.default.disable_ipv6 | grep -Pqs -- \
"^\h*net\.ipv6\.conf\.default\.disable_ipv6\h*=\h*1\b"; then
      l_output="- IPv6 is not enabled"
  fi
  [ -z "$l_output" ] && l_output="- IPv6 is enabled"
  echo -e "\n$l_output\n"
}
```

## Expected Result

The output should indicate whether IPv6 is enabled or not enabled on the system.

## Remediation

### Command Line

Enable or disable IPv6 in accordance with system requirements and local site policy

## Default Value

IPv6 is enabled

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | | x | x |
