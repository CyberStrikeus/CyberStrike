---
name: cis-ubuntu1604-v200-1-4-1
description: "Ensure permissions on bootloader config are not overridden"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, bootloader, grub, permissions, secure-boot]
cis_id: "1.4.1"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 1.4.1

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The permissions on `/boot/grub/grub.cfg` are changed to 444 when `grub.cfg` is updated by the `update-grub` command.

## Rationale

Setting the permissions to read and write for root only prevents non-root users from seeing the boot parameters or changing them. Non-root users who read the boot parameters may be able to identify weaknesses in security upon boot and be able to exploit them.

## Audit Procedure

### Command Line

Run the following command and verify the output:

```bash
grep -E '^\s*chmod\s+[0-7][0-7][0-7]\s+\$\{grub_cfg\}\.new' -A 1 -B1 /usr/sbin/grub-mkconfig
```

Verify the output is:

```
if [ "x${grub_cfg}" != "x" ]; then
  chmod 400 ${grub_cfg}.new || true
fi
```

## Expected Result

The `chmod` command in `/usr/sbin/grub-mkconfig` should use `400` (not `444`) for `${grub_cfg}.new`.

## Remediation

### Command Line

Run the following command to update `chmod 444` to `chmod 400` in `/usr/sbin/grub-mkconfig`:

```bash
sed -ri 's/chmod\s+[0-7][0-7][0-7]\s+\$\{grub_cfg\}\.new/chmod 400 ${grub_cfg}.new/' /usr/sbin/grub-mkconfig
```

Run the following command to remove check on password not being set to before running `chmod` command:

```bash
sed -ri 's/ && ! grep "\^password" \$\{grub_cfg\}.new >\/dev\/null//' /usr/sbin/grub-mkconfig
```

## Default Value

```
if [ "x${grub_cfg}" != "x" ] && ! grep "^password" ${grub_cfg}.new >/dev/null; then
  chmod 444 ${grub_cfg}.new || true
fi
```

## References

None.

## CIS Controls

| Controls Version | Control                                               |
| ---------------- | ----------------------------------------------------- |
| v7               | 14.6 Protect Information through Access Control Lists |

## Assessment Status

Automated
