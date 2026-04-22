---
name: cis-bind-v100-9-6
description: "Ensure Signing Keys are Scheduled to be Replaced Periodically (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, operations, dnssec]
cis_id: "9.6"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: [CWE-324]
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 9.6 — Ensure Signing Keys are Scheduled to be Replaced Periodically

## Profile Applicability
- Authoritative Name Server Level 2

## Description
Implement a periodic key rollover process for both the Zone Signing Keys (ZSK) and the Key Signing Keys (KSK). The ZSK should be replaced within 2 years or less. The KSK should be replaced within 6 years or less. Keys are replaced by generating a new key before the existing key expires, and scheduling a rollover date when the new key will phase out and replace the old key.

## Rationale
Cryptographic keys like passwords need to be periodically replaced. By using strong key algorithms and appropriately long bit lengths, the lifetime for keys can be longer than a generally recommended for passwords. Typically, the Zone Signing Keys are rolled over more frequently than the Key Signing Keys.

## Impact
Not specified.

## Audit Procedure
Perform the following steps to determine if the recommended state is implemented:

- Locate all of the ZSK key files for the name server by searching for the `256` key code using the following command.

```
# ZKEYS=$(find $KEYDIR -name '*.key' | xargs grep -l 'DNSKEY 256 3' )
```

- Check that the ZSK activation date is more recent then 2 years prior to the current date with the following commands. To automate the two year date calculation the -u option could be used for `dnssec-settime` to report the date in seconds since the start of the UNIX epoch.

```
# for zk in $ZKEYS; do echo -n "$zk:  "; dnssec-settime -pA $zk; done
./Kcisecurity.com.+013+45248.key:  Activate: Mon Mar  2 16:35:58 2020
```

- Locate all of the KSK key files for the name server by searching for the `257` key code using the following command.

```
# KKEYS=$(find $KEYDIR -name '*.key' | xargs grep -l 'DNSKEY 257 3' )
```

- Check that the KSK Activation date is more recent than six years prior to the current date. With the following command.

```
# for kk in $KKEYS; do echo -n "$kk:  "; dnssec-settime -pA $kk; done
./Kcisecurity.com.+013+45248.key:  Activate: Mon Mar  2 16:35:58 2020
```

If all ZSK activation dates are less than two years prior, and the KSK activation dates are less than six years prior, than the server is compliant.

## Remediation
To replace an aged key, perform the following:

- Generate a new key to replace the old key using `dnssec-keygen` and one of the recommended algorithms. An example command is shown below:

```
# dnssec-keygen -a ED25519 example.org
# dnssec-keygen -a ED25519 -f KSK example.org
```

- Implement a rollover period to phase out the old key and replace it with the newly generated key. The older key should have dates set for the keys to be inactive and then deleted.

```
# dnssec-settime -I +30d -D +60d  Kexample.org.+013+46651.key
```

- Once the date for key deletion has passed, and the key is no longer included in the zone, then remove the key files.

## Default Value
Signing key rollover is NOT implemented by default.

## References
1. https://www.dnsinstitute.com/documentation/dnssec-guide/ch06s04.html
2. https://downloads.isc.org/isc/dnssec-guide/dnssec-guide.pdf
3. https://tools.ietf.org/html/rfc7583

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v7 | N/A | N | N | N |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Credential Access | T1552 Unsecured Credentials |

## Profile
- Level 2 - Authoritative Name Server
