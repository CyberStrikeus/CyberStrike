---
name: cis-ubuntu1804-v220-2-1-2-1
description: "Ensure chrony is configured with authorized timeserver"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, services, chrony]
cis_id: "2.1.2.1"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.2.1 Ensure chrony is configured with authorized timeserver (Manual)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

- **server** - The server directive specifies an NTP server which can be used as a time source. The client-server relationship is strictly hierarchical: a client might synchronize its system time to that of the server, but the server's system time will never be influenced by that of a client. This directive can be used multiple times to specify multiple servers. The directive is immediately followed by either the name of the server, or its IP address.
- **pool** - The syntax of this directive is similar to that for the server directive, except that it is used to specify a pool of NTP servers rather than a single NTP server. The pool name is expected to resolve to multiple addresses which might change over time. This directive can be used multiple times to specify multiple pools. All options valid in the server directive can be used in this directive too.

## Rationale

Time synchronization is important to support time sensitive security mechanisms and to ensure log files have consistent time records across the enterprise to aid in forensic investigations.

## Audit Procedure

### Command Line

IF chrony is in use on the system, run the following command to display the server and/or pool directive:

```bash
# grep -Pr --include=*.{sources,conf} '^\h*(server|pool)\h+\H+' /etc/chrony/
```

Verify that at least one `pool` line and/or at least three `server` lines are returned, and the timeserver on the returned lines follows local site policy.

## Expected Result

Output examples:

pool directive:
```
pool time.nist.gov iburst maxsources 4 #The maxsources option is unique to the pool directive
```

server directive:
```
server time-a-g.nist.gov iburst
server 132.163.97.3 iburst
server time-d-b.nist.gov iburst
```

## Remediation

### Command Line

Edit `/etc/chrony/chrony.conf` or a file ending in `.sources` in `/etc/chrony/sources.d/` and add or edit server or pool lines as appropriate according to local site policy:

```
<[server|pool]> <[remote-server|remote-pool]>
```

Examples:

pool directive:
```
pool time.nist.gov iburst maxsources 4 #The maxsources option is unique to the pool directive
```

server directive:
```
server time-a-g.nist.gov iburst
server 132.163.97.3 iburst
server time-d-b.nist.gov iburst
```

Run one of the following commands to load the updated time sources into chronyd running config:

```bash
# systemctl restart chronyd
```

OR if sources are in a .sources file:
```bash
# chronyc reload sources
```

OR

If another time synchronization service is in use on the system, run the following command to remove chrony from the system:
```bash
# apt purge chrony
```

Additional Information:

If pool and/or server directive(s) are set in a sources file in `/etc/chrony/sources.d`, the line `sourcedir /etc/chrony/sources.d` must be present in `/etc/chrony/chrony.conf`.

## Default Value

Not configured.

## References

1. chrony.conf(5) Manual Page
2. https://tf.nist.gov/tf-cgi/servers.cgi
3. NIST SP 800-53 Rev. 5: AU-3, AU-12

## CIS Controls

- v8: 8.4 - Standardize Time Synchronization
- v7: 6.1 - Utilize Three Synchronized Time Sources
