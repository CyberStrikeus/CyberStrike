---
name: cis-ubuntu1204-v110-6-5
description: "Configure Network Time Protocol (NTP)"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, ntp, time-synchronization, network]
cis_id: "6.5"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.5 Configure Network Time Protocol (NTP) (Scored)

## Profile Applicability
- Level 1

## Description
The Network Time Protocol (NTP) is designed to synchronize system clocks across a variety of systems and use a source that is highly accurate. NTP can be configured to be a client and/or a server.

## Rationale
It is recommended that physical systems and virtual guests lacking direct access to the physical host's clock be configured as NTP clients to synchronize their clocks (especially to support time sensitive security mechanisms like Kerberos). This also ensures log files have consistent time records across the enterprise, which aids in forensic investigations.

## Audit Procedure
### Using Command Line
Run the following to ensure `ntp` is installed:
```bash
dpkg -s ntp
```

Check for the correct parameters on restrict default and restrict -6 default:
```bash
grep "restrict .* default" /etc/ntp.conf
```

Determine if the system is configured to use an NTP Server and that the ntp daemon is running as an unprivileged user:
```bash
grep "^server" /etc/ntp.conf
grep "RUNASUSER=ntp" /etc/init.d/ntp
```

## Expected Result
- Package status is `installed ok installed`.
- Restrict lines show: `restrict -4 default kod nomodify notrap nopeer noquery` and `restrict -6 default kod nomodify notrap nopeer noquery`.
- At least one NTP server is configured.
- `RUNASUSER=ntp` is present.

## Remediation
### Using Command Line
Install `ntp`:
```bash
apt-get install ntp
```

Ensure the following lines are in `/etc/ntp.conf`:
```
restrict -4 default kod nomodify notrap nopeer noquery
restrict -6 default kod nomodify notrap nopeer noquery
```

Also, make sure `/etc/ntp.conf` has at least one NTP server specified:
```
server <ntp-server>
```

**Note:** `<ntp-server>` is the IP address or hostname of a trusted time server.

## Default Value
NTP is not installed by default on Ubuntu 12.04 LTS Server.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0
- http://www.ntp.org

## Profile
Level 1 - Scored
