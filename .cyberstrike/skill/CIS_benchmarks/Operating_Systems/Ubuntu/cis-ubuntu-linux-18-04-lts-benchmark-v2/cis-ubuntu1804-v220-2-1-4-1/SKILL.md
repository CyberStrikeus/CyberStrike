---
name: cis-ubuntu1804-v220-2-1-4-1
description: "Ensure ntp access control is configured"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, services, ntp]
cis_id: "2.1.4.1"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.4.1 Ensure ntp access control is configured (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

ntp Access Control Commands:

```
restrict address [mask mask] [ippeerlimit int] [flag ...]
```

The `address` argument expressed in dotted-quad form is the address of a host or network. Alternatively, the address argument can be a valid host DNS name.

The `mask` argument expressed in dotted-quad form defaults to 255.255.255.255, meaning that the address is treated as the address of an individual host. A default entry (address 0.0.0.0, mask 0.0.0.0) is always included and is always the first entry in the list. Note: the text string default, with no mask option, may be used to indicate the default entry.

The `ippeerlimit` directive limits the number of peer requests for each IP to int, where a value of -1 means "unlimited", the current default. A value of 0 means "none". There would usually be at most 1 peering request per IP, but if the remote peering requests are behind a proxy there could well be more than 1 per IP.

One or more of the following flags may be specified:

- `kod` - If this flag is set when an access violation occurs, a kiss-o'-death (KoD) packet is sent. KoD packets are rate limited to no more than one per second. If another KoD packet occurs within one second after the last one, the packet is dropped.
- `limited` - Deny service if the packet spacing violates the lower limits specified in the discard command.
- `lowpriotrap` - Declare traps set by matching hosts to be low priority.
- `noepeer` - Deny ephemeral peer requests, even if they come from an authenticated source.
- `nomodify` - Deny ntpq and ntpdc queries which attempt to modify the state of the server (i.e., run time reconfiguration). Queries which return information are permitted.
- `noquery` - Deny ntpq and ntpdc queries. Time service is not affected.
- `nopeer` - Deny unauthenticated packets which would result in mobilizing a new association.
- `noserve` - Deny all packets except ntpq and ntpdc queries.
- `notrap` - Decline to provide mode 6 control message trap service to matching hosts.
- `notrust` - Deny service unless the packet is cryptographically authenticated.
- `ntpport` - This is a match algorithm modifier, rather than a restriction flag.

## Rationale

If ntp is in use on the system, proper configuration is vital to ensuring time synchronization is accurate.

## Audit Procedure

### Command Line

IF ntp is in use on the system, run the following command to verify the `restrict` lines:

```bash
# grep -P -- '^\h*restrict\h+(-4\h+)?|-6\h+)?default\h+(?:[^#\n\r]+\h+)*(?!.*\bkod\b\h*|\h*\bnomodify\b\h*|\h*\bnotrap\b\h*|\h*\bnopeer\b\h*|\h*\bnoquery\b\h*)' /etc/ntp.conf
```

Output should be similar to:

```
restrict -4 default kod notrap nomodify nopeer noquery
restrict -6 default kod notrap nomodify nopeer noquery
```

Verify that the output includes two lines, and both lines include: `default`, `kod`, `nomodify`, `notrap`, `nopeer`, and `noquery`.

Note: The `-4` in the first line is optional, options after `default` may appear in any order, and additional options may exist.

## Expected Result

Two lines matching the restrict pattern with `default`, `kod`, `nomodify`, `notrap`, `nopeer`, and `noquery` flags.

## Remediation

### Command Line

Add or edit restrict lines in `/etc/ntp.conf` to match the following:

```
restrict -4 default kod nomodify notrap nopeer noquery
restrict -6 default kod nomodify notrap nopeer noquery
```

OR

If another time synchronization service is in use on the system, run the following command to remove ntp from the system:

```bash
# apt purge ntp
```

## Default Value

```
restrict -4 default kod notrap nomodify nopeer noquery limited
restrict -6 default kod notrap nomodify nopeer noquery limited
```

## References

1. http://www.ntp.org/
2. ntp.conf(5)
3. ntpd(8)
4. NIST SP 800-53 Rev. 5: AU-8

## CIS Controls

- v8: 8.4 - Standardize Time Synchronization
- v7: 6.1 - Utilize Three Synchronized Time Sources
