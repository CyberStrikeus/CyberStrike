---
name: cis-ubuntu2004-v300-4-1-1
description: "Ensure a single firewall configuration utility is in use"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, firewall, ufw, nftables, iptables]
cis_id: "4.1.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0 - Control 4.1.1

## Profile
- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

In Linux security, employing a single, effective firewall configuration utility ensures that only legitimate traffic gets processed, reducing the system's exposure to potential threats. The choice between `ufw`, `nftables`, and `iptables` depends on organizational needs.

Note: `iptables` is being phased out, and support for `iptables` will be reduced over time. It is recommended to transition towards either `nftables` or `ufw` as the default firewall management tool.

## Rationale

Proper configuration of a single firewall utility minimizes cyber threats and protects services and data, while avoiding vulnerabilities like open ports or exposed services. Standardizing on a single tool simplifies management, reduces errors, and fortifies security across Linux systems.

## Impact

The use of more than one firewall utility may produce unexpected results.

## Audit Procedure

### Command Line

Run the following script to verify that a single firewall utility is in use on the system:

```bash
#!/usr/bin/env bash

{
  active_firewall=() firewalls=("ufw" "nftables" "iptables")
  # Determine which firewall is in use
  for firewall in "${firewalls[@]}"; do
    case $firewall in
      nftables)
        cmd="nft" ;;
      *)
        cmd=$firewall ;;
    esac
    if command -v $cmd &> /dev/null && systemctl is-enabled --quiet $firewall && systemctl is-active --quiet $firewall; then
      active_firewall+=("$firewall")
    fi
  done
  # Display audit results
  if [ ${#active_firewall[@]} -eq 1 ]; then
    printf '%s\n' "" " Audit Results:" " ** PASS **" " - A single firewall is in use follow the recommendation in ${active_firewall[0]} subsection ONLY"
  elif [ ${#active_firewall[@]} -eq 0 ]; then
    printf '%s\n' "" " Audit Results:" " ** FAIL **" "- No firewall in use or unable to determine firewall status"
  else
    printf '%s\n' "" " Audit Results:" " ** FAIL **" " - Multiple firewalls are in use: ${active_firewall[*]}"
  fi
}
```

## Expected Result

```
Audit Results:
 ** PASS ** - A single firewall is in use follow the recommendation in <firewall> subsection ONLY
```

## Remediation

### Command Line

Remediating to a single firewall configuration is a complex process and involves several steps. The following provides the basic steps to follow for a single firewall configuration:

1. Determine which firewall utility best fits organizational needs
2. Follow the recommendations in the subsequent subsection for the single firewall to be used
   Note: Review the firewall subsection overview for the selected firewall to be used, it contains a script to simplify this process.
3. Return to this recommendation to ensure a single firewall configuration utility is in use

## Default Value

Not applicable.

## References

1. https://wiki.debian.org/DebianFirewall
2. https://wiki.ubuntu.com/UncomplicatedFirewall
3. https://assets.ubuntu.com/v1/544d9904-ubuntu-server-guide-2024-01-22.pdf
4. https://www.debian.org/doc/manuals/debian-reference/debian-reference.en.pdf

## CIS Controls

v8 - 4.4 Implement and Manage a Firewall on Servers
v8 - 4.5 Implement and Manage a Firewall on End-User Devices
v7 - 9.4 Apply Host-based Firewalls or Port Filtering

MITRE ATT&CK Mappings: T1562, T1562.004 | TA0011 | M1031, M1037
