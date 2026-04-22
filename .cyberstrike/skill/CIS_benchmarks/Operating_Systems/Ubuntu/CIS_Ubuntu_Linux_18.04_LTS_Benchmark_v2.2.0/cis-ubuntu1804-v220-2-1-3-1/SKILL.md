---
name: cis-ubuntu1804-v220-2-1-3-1
description: "Ensure systemd-timesyncd configured with authorized timeserver"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, services, systemd-timesyncd]
cis_id: "2.1.3.1"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.3.1 Ensure systemd-timesyncd configured with authorized timeserver (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

- **NTP=** - A space-separated list of NTP server host names or IP addresses. During runtime this list is combined with any per-interface NTP servers acquired from systemd-networkd.service(8). systemd-timesyncd will contact all configured system or per-interface servers in turn, until one responds. When the empty string is assigned, the list of NTP servers is reset, and all prior assignments will have no effect. This setting defaults to an empty list.
- **FallbackNTP=** - A space-separated list of NTP server host names or IP addresses to be used as the fallback NTP servers. Any per-interface NTP servers obtained from systemd-networkd.service(8) take precedence over this setting, as do any servers set via NTP= above. This setting is hence only relevant if no other NTP server information is known. When the empty string is assigned, the list of NTP servers is reset, and all prior assignments will have no effect. If this option is not given, a compiled-in list of NTP servers is used.

## Rationale

Time synchronization is important to support time sensitive security mechanisms and to ensure log files have consistent time records across the enterprise to aid in forensic investigations.

## Audit Procedure

### Command Line

IF systemd-timesyncd is in use on the system, run the following command:

```bash
# grep -Ph '^\h*(NTP|FallbackNTP)=\H+' /etc/systemd/timesyncd.conf
```

Verify that `NTP=<space_separated_list_of_servers>` and/or `FallbackNTP=<space_separated_list_of_servers>` is returned and that the time server(s) shown follows local site policy.

## Expected Result

Example Output:
```
/etc/systemd/timesyncd.conf:NTP=time.nist.gov
/etc/systemd/timesyncd.conf:FallbackNTP=time-a-g.nist.gov time-b-g.nist.gov time-c-g.nist.gov
```

## Remediation

### Command Line

Edit `/etc/systemd/timesyncd.conf` and add the `NTP=` and/or `FallbackNTP=` lines to the `[Time]` section:

Example:
```
[Time]
NTP=time.nist.gov # Uses the generic name for NIST's time servers
-AND/OR-
FallbackNTP=time-a-g.nist.gov time-b-g.nist.gov time-c-g.nist.gov # Space separated list of NIST time servers
```

Note: Servers added to these line(s) should follow local site policy. NIST servers are for example.

Run the following command to reload the systemd-timesyncd configuration:
```bash
# systemctl try-reload-or-restart systemd-timesyncd
```

-OR-

If another time synchronization service is in use on the system, run the following command to stop and mask systemd-timesyncd:
```bash
# systemctl --now mask systemd-timesyncd
```

## Default Value

#NTP=

#FallbackNTP=

## References

1. https://www.freedesktop.org/software/systemd/man/timesyncd.conf.html
2. https://tf.nist.gov/tf-cgi/servers.cgi
3. NIST SP 800-53 Rev. 5: AU-7, AU-8

## CIS Controls

- v8: 8.4 - Standardize Time Synchronization
- v7: 6.1 - Utilize Three Synchronized Time Sources
