---
name: cis-ubuntu2004-v300-3-2-4
description: "Ensure sctp kernel module is not available"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, kernel-module]
cis_id: "3.2.4"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.2.4 Ensure sctp kernel module is not available (Automated)

## Profile

- Level 2 - Server
- Level 2 - Workstation

## Description

The Stream Control Transmission Protocol (SCTP) is a transport layer protocol used to support message oriented communication, with several streams of messages in one connection. It serves a similar function as TCP and UDP, incorporating features of both. It is message-oriented like UDP, and ensures reliable in-sequence transport of messages with congestion control like TCP.

## Rationale

- IF - the protocol is not being used, it is recommended that kernel module not be loaded, disabling the service to reduce the potential attack surface.

## Impact

None expected if the SCTP protocol is not in use.

## Audit Procedure

### Command Line

Verify the sctp kernel module is not available on the system or has been disabled. This can be verified by performing the following or by running the audit script included below.

Run the following script to determine if the sctp kernel module is available on the system:

```bash
#!/usr/bin/env bash

{
  l_mod_name="sctp" l_mod_type="net"
  while IFS= read -r l_mod_path; do
      if [ -d "$l_mod_path/${l_mod_name//\-/\/}" ] && [ -n "$(ls -A "$l_mod_path/${l_mod_name//\-/\/}")" ]; then
          printf '%s\n' "$l_mod_name exists in $l_mod_path"
      fi
  done < <(readlink -f /usr/lib/modules/**/kernel/$l_mod_type || readlink -f
/lib/modules/**/kernel/$l_mod_type)
}
```

If nothing is returned, the sctp kernel module is not available on the system and no further audit steps are required.
Note: Some systems may include the sctp filesystem as part of the kernel opposed to being available as a kernel module. In this case, the above audit will not return anything. This is also considered a passing state.

If anything is returned, verify the sctp kernel module is not loaded and not loadable by performing the following:

Run the following command to verify the sctp kernel module is not loaded:

```bash
# lsmod | grep 'sctp'
```

Nothing should be returned.

Run the following command to verify the sctp kernel module is not loadable:

```bash
# modprobe --showconfig | grep -P -- '\b(install|blacklist)\h+sctp\b'
```

Verify the output includes:

```
blacklist sctp
 -AND-
install sctp /bin/false
 -OR-
install sctp /bin/true
```

## Expected Result

The sctp kernel module should not be available, or if present, it should be blacklisted and set to install /bin/false or /bin/true, and not currently loaded.

## Remediation

### Command Line

Run the following to unload and disable the sctp kernel module. This can also be done by running the script included below.

Run the following commands to unload the sctp kernel module:

```bash
# modprobe -r sctp 2>/dev/null
# rmmod sctp 2>/dev/null
```

Perform the following to disable the sctp kernel module:
Create a file ending in `.conf` with `install sctp /bin/false` in the `/etc/modprobe.d/` directory.
Example:

```bash
# printf '\n%s\n' "install sctp /bin/false" >> sctp.conf
```

Create a file ending in `.conf` with `blacklist sctp` in the `/etc/modprobe.d/` directory.
Example:

```bash
# printf '\n%s\n' "blacklist sctp" >> sctp.conf
```

## Default Value

sctp kernel module is available but not loaded by default.

## References

1. NIST SP 800-53 Rev. 5: SI-4, CM-7
2. NIST SP 800-53A :: CM-7.1 (ii)
3. RHEL 8 STIG Vul ID: V-230496
4. RHEL 8 STIG Rule ID: SV-230496r942924

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running              |      | x    | x    |
