---
name: cis-ubuntu2004-v300-3-3-8
description: "Ensure source routed packets are not accepted"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, kernel-parameter]
cis_id: "3.3.8"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.3.8 Ensure source routed packets are not accepted (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

In networking, source routing allows a sender to partially or fully specify the route packets take through a network. In contrast, non-source routed packets travel a path determined by routers in the network. In some cases, systems may not be routable or reachable from some locations (e.g. private addresses vs. Internet routable), and so source routed packets would need to be used.

## Rationale

Setting `net.ipv4.conf.all.accept_source_route`, `net.ipv4.conf.default.accept_source_route`, `net.ipv6.conf.all.accept_source_route` and `net.ipv6.conf.default.accept_source_route` to 0 disables the system from accepting source routed packets. Assume this system was capable of routing packets to Internet routable addresses on one interface and private addresses on another interface. Assume that the private addresses were not routable to the Internet routable addresses and vice versa. Under normal routing circumstances, an attacker from the Internet routable addresses could not use the system as a way to reach the private address systems. If, however, source routed packets were allowed, they could be used to gain access to the private address systems as the route could be specified, rather than rely on routing protocols that did not allow this routing.

## Impact

None expected.

## Audit Procedure

### Command Line

Run the following script to verify the following kernel parameters are set in the running configuration and correctly loaded from a kernel parameter configuration file:

- `net.ipv4.conf.all.accept_source_route` is set to 0
- `net.ipv4.conf.default.accept_source_route` is set to 0
- `net.ipv6.conf.all.accept_source_route` is set to 0
- `net.ipv6.conf.default.accept_source_route` is set to 0

Note:

- kernel parameters are loaded by file and parameter order precedence. The following script observes this precedence as part of the auditing procedure. The parameters being checked may be set correctly in a file. If that file is superseded, the parameter is overridden by an incorrect setting later in that file, or in a canonically later file, that "correct" setting will be ignored both by the script and by the system during a normal kernel parameter load sequence.
- IPv6 kernel parameters only apply to systems where IPv6 is enabled

## Expected Result

Audit Result: ** PASS ** with all four accept_source_route parameters set to 0 (or IPv6 parameters not applicable if IPv6 is disabled).

## Remediation

### Command Line

Set the following parameters in `/etc/sysctl.conf` or a file in `/etc/sysctl.d/` ending in `.conf`:

- `net.ipv4.conf.all.accept_source_route = 0`
- `net.ipv4.conf.default.accept_source_route = 0`

Example:

```bash
# printf '%s\n' "net.ipv4.conf.all.accept_source_route = 0" "net.ipv4.conf.default.accept_source_route = 0" >>
/etc/sysctl.d/60-netipv4_sysctl.conf
```

Run the following script to set the active kernel parameters:

```bash
#!/usr/bin/env bash

{
  sysctl -w net.ipv4.conf.all.accept_source_route=0
  sysctl -w net.ipv4.conf.default.accept_source_route=0
  sysctl -w net.ipv4.route.flush=1
}
```

- IF - IPv6 is enabled on the system:
  Set the following parameters in `/etc/sysctl.conf` or a file in `/etc/sysctl.d/` ending in `.conf`:

- `net.ipv6.conf.all.accept_source_route = 0`
- `net.ipv6.conf.default.accept_source_route = 0`

Example:

```bash
# printf '%s\n' "net.ipv6.conf.all.accept_source_route = 0" "net.ipv6.conf.default.accept_source_route = 0" >>
/etc/sysctl.d/60-netipv6_sysctl.conf
```

Run the following command to set the active kernel parameters:

```bash
#!/usr/bin/env bash

{
  sysctl -w net.ipv6.conf.all.accept_source_route=0
  sysctl -w net.ipv6.conf.default.accept_source_route=0
  sysctl -w net.ipv6.route.flush=1
}
```

Note: If these settings appear in a canonically later file, or later in the same file, these settings will be overwritten.

## Default Value

net.ipv4.conf.all.accept_source_route = 0

net.ipv4.conf.default.accept_source_route = 0

net.ipv6.conf.all.accept_source_route = 0

net.ipv6.conf.default.accept_source_route = 0

## References

1. NIST SP 800-53 :: CM-6 b
2. NIST SP 800-53A :: CM-6.1 (iv)
3. RHEL 8 STIG GROUP ID: V-230538
4. RHEL 8 STIG RULE ID: SV-230538r858801
5. RHEL 8 STIG GROUP ID: V-230539
6. RHEL 8 STIG RULE ID: SV-230539r861085
7. RHEL 8 STIG GROUP ID: V-230541
8. RHEL 8 STIG RULE ID: SV-230541r858812
9. RHEL 8 STIG GROUP ID: V-230542
10. RHEL 8 STIG RULE ID: SV-230542r858814

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running              |      | x    | x    |
