---
name: cis-ubuntu1204-v110-13-16
description: "Check That Reserved UIDs Are Assigned to System Accounts"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, user-management, uid, reserved, system-accounts]
cis_id: "13.16"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 13.16 Check That Reserved UIDs Are Assigned to System Accounts (Scored)

## Profile Applicability
- Level 1

## Description
UIDs below a certain threshold (typically 500 on older systems, 1000 on newer) are reserved for system accounts. Non-system (regular user) accounts should not be assigned UIDs in the reserved range, and reserved UIDs should only belong to recognized system accounts.

## Rationale
If a user is assigned a UID that is in the reserved range, even if it is not currently used by a system account, security issues may arise if that UID is later used for a system daemon or service. Ensuring that reserved UIDs are only assigned to known system accounts helps maintain proper access controls and accountability.

## Audit Procedure
### Using Command Line
This script checks to make sure all accounts with UIDs below 500 are known system accounts.
```bash
#!/bin/bash
defUsers="root bin daemon adm lp sync shutdown halt mail news uucp operator games \
gopher ftp nobody dbus usbmuxd vcsa rpc rtkit avahi-autoipd abrt haldaemon gdm ntp \
apache saslauth postfix nfsnobody sshd tcpdump oprofile messagebus pulse list \
gnats proxy www-data backup irc colord syslog libuuid man sys"
/bin/cat /etc/passwd | /usr/bin/awk -F: '($3 < 500) { print $1 " " $3 }' |\
while read user uid; do
  found=0
  for tUser in $defUsers; do
    if [ "$user" = "$tUser" ]; then
      found=1
    fi
  done
  if [ $found -eq 0 ]; then
    echo "User $user has a reserved UID ($uid)."
  fi
done
```

## Expected Result
No output should be returned. Any output indicates non-system accounts using reserved UIDs.

## Remediation
### Using Command Line
Review the accounts listed and determine if they are legitimate system accounts. If not, assign them a UID above the reserved range (500 or 1000 depending on configuration) using `usermod -u <new_uid> <username>`, and update file ownerships accordingly.

## Default Value
By default, Ubuntu system accounts are assigned UIDs below 500 (or 1000) and regular user accounts are assigned UIDs starting from 1000.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
