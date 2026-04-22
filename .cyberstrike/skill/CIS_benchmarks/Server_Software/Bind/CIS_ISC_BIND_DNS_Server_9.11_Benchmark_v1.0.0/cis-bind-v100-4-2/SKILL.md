---
name: cis-bind-v100-4-2
description: "Include Cryptographic Key Files (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, tsig]
cis_id: "4.2"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 4.2 — Include Cryptographic Key Files

## Profile Applicability
- Authoritative Name Server Level 1
- Caching Only Name Server Level 1

## Description
Do not place keys directly in the BIND `named.conf`, but use separate configuration files for the keys and include them into the `named.conf` file, in order to protect the keys from unintentional disclosure.

## Rationale
Although the keys may be placed directly in the named.conf file, putting it in a separate file will limit the number of times it needs to be viewed, and make it independent of viewing and changes to the main configuration file.

## Impact
Not specified in the PDF.

## Audit Procedure
Use the grep command below to search the `named.conf` file to ensure it doesn't have any secret keys placed in the file.

```
# grep -C 3 secret /etc/named.conf

key host1-host2.cisecurity.org {
    algorithm hmac-sha256;
    secret "1R3DP9D81/yWXjqf3hlg2beRpti1883JnZ3s7RVb1HU=";
};
```

## Remediation
Move each key definition statement from the `named.conf` file into its own key file. It is recommended to name both the key and the key file after the two hosts that will be sharing the secret key, in order to avoid confusion. Then include the key files with include statements in the `named.conf`. An example is shown below with the key definition statement moved to a separate key file, however it is also accepted for only the secret statement to be moved to another file.

```
# grep -C 1 include /etc/named.conf

// Include the key file used for the host1 and host2 TSIG comms
include "/etc/private/host1-host2.cisecurity.org.key";
```

```
# cat /var/named/chroot/etc/private/host1-host2.cisecurity.org.key
key host1-host2.cisecurity.org {
 algorithm hmac-sha256;
 secret "1R3DP9D81/yWXjqf3hlg2beRpti1883JnZ3s7RVb1HU=";
};
```

## Default Value
During a default install an `rndc` key is generated in a separate file `/etc/rndc.key` and included in the `named.conf`.

## References
Not specified in the PDF.

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v6 | 14 Controlled Access Based on the Need to Know | N | Y | Y |
| v7 | 13 Data Protection | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Credential Access | T1552.001 - Unsecured Credentials: Credentials In Files |
| Defense Evasion | T1550 - Use Alternate Authentication Material |

## Profile
- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
