---
name: cis-gcp-cos-5.1.20
description: "Ensure SSH AllowTcpForwarding is disabled"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, ssh, sshd, sshd-config]
cis_id: "5.1.20"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.20 Ensure SSH AllowTcpForwarding is disabled (Automated)

## Description

SSH port forwarding is a mechanism in SSH for tunneling application ports from the client to the server, or servers to clients. It can be used for adding encryption to legacy applications, going through firewalls, and some system administrators and IT professionals use it for opening backdoors into the internal network from their home machines.

## Rationale

Leaving port forwarding enabled can expose the organization to security risks and backdoors.

SSH connections are protected with strong encryption. This makes their contents invisible to most deployed network monitoring and traffic filtering solutions. This invisibility carries considerable risk potential if it is used for malicious purposes such as data exfiltration. Cybercriminals or malware could exploit SSH to hide their unauthorized communications, or to exfiltrate stolen data from the target network.

## Impact

SSH tunnels are widely used in many corporate environments that employ mainframe systems as their application backends. In those environments the applications themselves may have very limited native support for security. By utilizing tunneling, compliance with SOX, HIPAA, PCI-DSS, and other standards can be achieved without having to modify the applications.

## Audit Procedure

Run the following command and verify that output matches:

```bash
# sshd -T | grep -i allowtcpforwarding

AllowTcpForwarding no
```

## Expected Result

Output should show `AllowTcpForwarding no`.

## Remediation

Edit the /etc/ssh/sshd_config file to set the parameter as follows:

```
AllowTcpForwarding no
```

## Default Value

AllowTcpForwarding yes

## References

1. https://www.ssh.com/ssh/tunneling/example

## CIS Controls

| Controls Version | Control                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 4.4 Implement and Manage a Firewall on Servers                     | x    | x    | x    |
| v8               | 4.5 Implement and Manage a Firewall on End-User Devices            | x    | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running |      | x    | x    |

## Profile

- Level 2 - Server
