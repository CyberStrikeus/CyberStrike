---
name: cis-bind-v100-2-1
description: "Run BIND as a non-root User (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, permissions-ownership]
cis_id: "2.1"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.1 — Run BIND as a non-root User

## Profile Applicability
- Authoritative Name Server Level 1
- Caching Only Name Server Level 1

## Description
To start BIND you must execute it as the root user. After the initial startup, BIND has the ability to change to a non-root user, allowing it to drop the root privileges.

## Rationale
The reason for configuring BIND to run as a non-root user is to limit the impact in case a future vulnerability is discovered and exploited. This is a common practice, which implements the principal of least privilege. This principle states that an entity, such as a service or user, should be granted only those specific privileges necessary to perform authorized actions. The server will still need to be started as root, but it should be configured to give up the root privilege after listening on port 53. The user ID under which named runs, needs to be created if it does not already exist and needs appropriate access to the DNS configuration and data files. Many systems including Red Hat Linux will come with a named user already created. Usage of the user and group id of 53 in the examples is arbitrary but is intended to be easier to recognize as it matches the listening port number.

## Impact
Not specified.

## Audit Procedure
Perform the following to ensure the `named` account exists and has an appropriate non-root and non-user UID, and the `-u named` parameter is passed to `named` on startup.

1. Run the following commands to ensure the named account exists, and has been created with a UID greater than zero and less than `MIN_UID`.

```bash
# id named
uid=53(named) gid=53(named) groups=53(named)

# grep '^UID_MIN' /etc/login.defs
UID_MIN 1000
```

2. Verify that named service has been started and that the `-u named` option was passed when the daemon was executed, and that the user (first column) is equal to `named`.

```bash
# ps axu | grep named | grep -v 'grep'
named 423 0.0 1.0 236472 20512 ? Ssl Aug22 2:46 /usr/sbin/named -u named -t /var/named/chroot
```

## Remediation
Create the named user and group if it does not already exist. Using a shell of /dev/null is best practice.

```bash
if ! id named; then
 groupadd -g 53 named
 useradd -m -u 53 -g 53 -c "BIND named" -d /var/named -s /dev/null named
fi 2>/dev/null
```

Add the `-u named` to the `OPTIONS` parameters in the `/etc/sysconfig/named` if not already present.

## Default Value
The default named startup parameters include the `-u named` value.

## References
None listed.

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v6 | 5.1 Minimize And Sparingly Use Administrative Privileges | Y | Y | Y |
| v7 | 4 Controlled Use of Administrative Privileges | Y | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Privilege Escalation | T1068 Exploitation for Privilege Escalation |
| Privilege Escalation | T1548 Abuse Elevation Control Mechanism |

## Profile
- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
