---
name: cis-ubuntu1804-v220-2-1-4-2
description: "Ensure ntp is configured with authorized timeserver"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, services, ntp]
cis_id: "2.1.4.2"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.4.2 Ensure ntp is configured with authorized timeserver (Manual)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The various modes are determined by the command keyword and the type of the required IP address. Addresses are classed by type as (s) a remote server or peer (IPv4 class A, B and C), (b) the broadcast address of a local interface, (m) a multicast address (IPv4 class D), or (r) a reference clock address (127.127.x.x).

- **pool** - For type s addresses, this command mobilizes a persistent client mode association with a number of remote servers. In this mode the local clock can synchronized to the remote server, but the remote server can never be synchronized to the local clock.
- **server** - For type s and r addresses, this command mobilizes a persistent client mode association with the specified remote server or local radio clock. In this mode the local clock can synchronized to the remote server, but the remote server can never be synchronized to the local clock. This command should not be used for type b or m addresses.

## Rationale

Time synchronization is important to support time sensitive security mechanisms and to ensure log files have consistent time records across the enterprise to aid in forensic investigations.

## Audit Procedure

### Command Line

IF ntp is in use on the system, run the following command to display the server and/or pool mode:

```bash
# grep -P -- '^\h*(server|pool)\h+\H+' /etc/ntp.conf
```

Verify that at least one `pool` line and/or at least three `server` lines are returned, and the timeserver on the returned lines follows local site policy.

## Expected Result

Output examples:

pool mode:

```
pool time.nist.gov iburst maxsources 4 #The maxsources option is unique to the pool directive
```

server mode:

```
server time-a-g.nist.gov iburst
server 132.163.97.3 iburst
server time-d-b.nist.gov iburst
```

## Remediation

### Command Line

Edit `/etc/ntp.conf` and add or edit server or pool lines as appropriate according to local site policy:

```
<[server|pool]> <[remote-server|remote-pool]>
```

Examples:

pool mode:

```
pool time.nist.gov iburst
```

server mode:

```
server time-a-g.nist.gov iburst
server 132.163.97.3 iburst
server time-d-b.nist.gov iburst
```

Run the following command to load the updated time sources into ntp running config:

```bash
# systemctl restart ntp
```

OR

If another time synchronization service is in use on the system, run the following command to remove ntp from the system:

```bash
# apt purge ntp
```

## References

1. http://www.ntp.org/
2. https://tf.nist.gov/tf-cgi/servers.cgi
3. ntp.conf(5)
4. ntpd(8)
5. NIST SP 800-53 Rev. 5: AU-8

## CIS Controls

- v8: 8.4 - Standardize Time Synchronization
- v7: 6.1 - Utilize Three Synchronized Time Sources
