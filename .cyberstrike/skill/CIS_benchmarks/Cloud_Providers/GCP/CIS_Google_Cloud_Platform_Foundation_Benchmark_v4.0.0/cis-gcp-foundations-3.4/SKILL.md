---
name: cis-gcp-foundations-3.4
description: "Ensure That RSASHA1 Is Not Used for the Key-Signing Key in Cloud DNS DNSSEC"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, networking, dns, dnssec]
cis_id: "3.4"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.4 Ensure That RSASHA1 Is Not Used for the Key-Signing Key in Cloud DNS DNSSEC (Automated)

## Profile Applicability

- Level 1

## Description

NOTE: Currently, the SHA1 algorithm has been removed from general use by Google, and, if being used, needs to be whitelisted on a project basis by Google and will also, therefore, require a Google Cloud support contract.

DNSSEC algorithm numbers in this registry may be used in CERT RRs. Zone signing (DNSSEC) and transaction security mechanisms (SIG(0) and TSIG) make use of particular subsets of these algorithms. The algorithm used for key signing should be a recommended one and it should be strong.

## Rationale

Domain Name System Security Extensions (DNSSEC) algorithm numbers in this registry may be used in CERT RRs. Zonesigning (DNSSEC) and transaction security mechanisms (SIG(0) and TSIG) make use of particular subsets of these algorithms.

The algorithm used for key signing should be a recommended one and it should be strong. When enabling DNSSEC for a managed zone, or creating a managed zone with DNSSEC, the user can select the DNSSEC signing algorithms and the denial-of-existence type. Changing the DNSSEC settings is only effective for a managed zone if DNSSEC is not already enabled. If there is a need to change the settings for a managed zone where it has been enabled, turn DNSSEC off and then re-enable it with different settings.

## Audit

### From Google Cloud CLI

Ensure the property algorithm for keyType keySigning is not using `RSASHA1`.

```bash
gcloud dns managed-zones describe ZONENAME --format="json(dnsName,dnssecConfig.state,dnssecConfig.defaultKeySpecs)"
```

## Remediation

### From Google Cloud CLI

1. If it is necessary to change the settings for a managed zone where it has been enabled, DNSSEC must be turned off and re-enabled with different settings. To turn off DNSSEC, run the following command:

```bash
gcloud dns managed-zones update ZONE_NAME --dnssec-state off
```

2. To update key-signing for a reported managed DNS Zone, run the following command:

```bash
gcloud dns managed-zones update ZONE_NAME --dnssec-state on --ksk-algorithm KSK_ALGORITHM --ksk-key-length KSK_KEY_LENGTH --zsk-algorithm ZSK_ALGORITHM --zsk-key-length ZSK_KEY_LENGTH --denial-of-existence DENIAL_OF_EXISTENCE
```

Supported algorithm options and key lengths are as follows:

| Algorithm       | KSK Length | ZSK Length |
| --------------- | ---------- | ---------- |
| RSASHA1         | 1024,2048  | 1024,2048  |
| RSASHA256       | 1024,2048  | 1024,2048  |
| RSASHA512       | 1024,2048  | 1024,2048  |
| ECDSAP256SHA256 | 256        | 256        |
| ECDSAP384SHA384 | 384        | 384        |

## References

1. https://cloud.google.com/dns/dnssec-advanced#advanced_signing_options

## Additional Information

1. RSASHA1 key-signing support may be required for compatibility reasons.
2. Remediation CLI works well with gcloud-cli version 221.0.0 and later.

## CIS Controls

| Controls Version | Control                                                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 4.2 Establish and Maintain a Secure Configuration Process for Network Infrastructure | x    | x    | x    |
| v7               | 11.1 Maintain Standard Security Configurations for Network Devices                   |      | x    | x    |
