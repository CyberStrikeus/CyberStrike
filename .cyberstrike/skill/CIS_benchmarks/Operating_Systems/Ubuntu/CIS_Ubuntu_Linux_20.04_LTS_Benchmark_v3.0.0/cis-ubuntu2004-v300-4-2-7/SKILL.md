---
name: cis-ubuntu2004-v300-4-2-7
description: "Ensure ufw firewall rules exist for all open ports"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, firewall, ufw]
cis_id: "4.2.7"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0 - Control 4.2.7

## Profile
- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

Services and ports can be accepted or explicitly rejected.

Note:
- Changing firewall settings while connected over network can result in being locked out of the system
- The remediation command opens up the port to traffic from all sources. Consult ufw documentation and set any restrictions in compliance with site policy

## Rationale

To reduce the attack surface of a system, all services and ports should be blocked unless required.

- Any ports that have been opened on non-loopback addresses need firewall rules to govern traffic.
- Without a firewall rule configured for open ports, the default firewall policy will drop all packets to these ports.
- Required ports should have a firewall rule created to allow approved connections in accordance with local site policy.
- Unapproved ports should have an explicit deny rule created.

## Audit Procedure

### Command Line

Run the following script to verify a firewall rule exists for all open ports:

```bash
#!/usr/bin/env bash

{
  unset a_ufwout
  unset a_openports

  # Read UFW Ports
  while read -r l_ufwport; do
    [ -n "$l_ufwport" ] && a_ufwout+=("$l_ufwport")
  done < <(ufw show raw 2>&1 |grep -Po 'dpt:\K\d+' |sort -u)

  # Read Multiport Rules
  while read -r l_multiport; do
    for port in $(echo "$l_multiport" | awk -F'--dports ' '{print $2}' | awk -F' ' '{print $1}' | tr ',' '\n');
  do
      if [[ "$port" == *:* ]]; then
        IFS=':' read -r start_port end_port <<< "$port"
        for ((i=start_port; i<=end_port; i++)); do
          a_ufwout+=("$i")
        done
      else
        a_ufwout+=("$port")
      fi
    done
  done < /etc/ufw/user.rules

  # Read Open Ports
  while read -r l_openport; do
    [ -n "$l_openport" ] && a_openports+=("$l_openport")
  done < <(ss -tuln | awk '($5!~/%lo:/ && $5!~/^127\./ && $5!~/\[?::1\]?:/) {split($5, a, ":"); print a[2]}' |
  sort -u)

  # Find Differences
  a_diff=("$(printf '%s\n' "${a_openports[@]}" "${a_ufwout[@]}" "${a_ufwout[@]}" | sort | uniq -u)")

  # Conditional Check and Output
  if [[ -n "${a_diff[*]}" ]]; then
    echo -e "\n- Audit Result:\n ** FAIL **\n- The following port(s) don't have a rule in UFW: $(printf '%s\n'
\\n"${a_diff[*]}")\n- End List"
  else
    echo -e "\n - Audit Passed -\n- All open ports have a rule in UFW\n"
  fi
}
```

## Expected Result

```
- Audit Passed -
- All open ports have a rule in UFW
```

## Remediation

### Command Line

For each port identified in the audit which does not have a firewall rule, evaluate the service listening on the port and add a rule for accepting or denying inbound connections in accordance with local site policy:
Examples:

```bash
ufw allow in <port>/<tcp or udp protocol>
```

```bash
ufw deny in <port>/<tcp or udp protocol>
```

Note: Examples create rules for from any, to any. More specific rules should be concentered when allowing inbound traffic e.g only traffic from this network.
Example to allow traffic on port 443 using the tcp protocol from the 192.168.1.0 network:

```bash
ufw allow from 192.168.1.0/24 to any proto tcp port 443
```

## Default Value

Not applicable.

## References

1. NIST SP 800-53 Rev. 5: SC-7

## CIS Controls

v8 - 4.4 Implement and Manage a Firewall on Servers
v7 - 9.4 Apply Host-based Firewalls or Port Filtering

MITRE ATT&CK Mappings: T1562, T1562.004 | TA0011 | M1031, M1037
