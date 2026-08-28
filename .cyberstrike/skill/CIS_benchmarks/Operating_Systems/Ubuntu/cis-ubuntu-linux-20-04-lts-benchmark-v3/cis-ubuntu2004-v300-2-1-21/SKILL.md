---
name: cis-ubuntu2004-v300-2-1-21
description: "Ensure mail transfer agents are configured for local-only mode"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, services]
cis_id: "2.1.21"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.21 Ensure mail transfer agents are configured for local-only mode (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Mail Transfer Agents (MTA), including postfix, exim, and sendmail, are used to listen for incoming mail and transfer the messages to the appropriate user or mail server. If the system is not intended to be a mail server, it is recommended that the MTA be configured to only process local mail.

## Rationale

The software for all Mail Transfer Agents is complex and most have a long history of security issues. While it is important to ensure that the system can process local mail messages, it is not necessary to have the MTA's daemon listening on a port unless the server is intended to be a mail server that receives and processes mail from other systems.

## Audit Procedure

### Command Line

Run the following script to verify the MTA is not listening on any non-loopback address:

```bash
#!/usr/bin/env bash

{
  l_output="" l_output2=""
  a_port_list=("25" "465" "587")
  for l_port in "${a_port_list[@]}"; do
    if ss -plntu | grep -P -- ':'"$l_port"'\b' | grep -Pvq -- '\h+(127\.0\.0\.1|::1):'"$l_port"'\b'; then
      l_output2="$l_output2\n - Port \"$l_port\" is listening on a non-loopback network interface"
    else
      l_output="$l_output\n - Port \"$l_port\" is not listening on a non-loopback network interface"
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

No MTA should be listening on non-loopback addresses (ports 25, 465, 587).

## Remediation

### Command Line

Edit the configuration for the installed MTA to disable listening on non-loopback addresses. For postfix, edit `/etc/postfix/main.cf` and add the following line:

```
inet_interfaces = loopback-only
```

Then restart the service:

```bash
# systemctl restart postfix
```

## Default Value

postfix is installed and configured to listen on all interfaces.

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running              |      | x    | x    |

MITRE ATT&CK Mappings: T1018, T1210 | TA0008 | M1042
