---
name: cis-gcp-foundations-1.10
description: "Ensure KMS Encryption Keys Are Rotated Within a Period of 90 Days"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, iam, kms, encryption]
cis_id: "1.10"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.10 Ensure KMS Encryption Keys Are Rotated Within a Period of 90 Days (Automated)

## Profile Applicability

- Level 1

## Description

Google Cloud Key Management Service stores cryptographic keys in a hierarchical structure designed for useful and elegant access control management.

The format for the rotation schedule depends on the client library that is used. For the gcloud command-line tool, the next rotation time must be in `ISO` or `RFC3339` format, and the rotation period must be in the form `INTEGER[UNIT]`, where units can be one of seconds (s), minutes (m), hours (h) or days (d).

## Rationale

Set a key rotation period and starting time. A key can be created with a specified `rotation period`, which is the time between when new key versions are generated automatically. A key can also be created with a specified next rotation time. A key is a named object representing a `cryptographic key` used for a specific purpose. The key material, the actual bits used for `encryption`, can change over time as new key versions are created.

A key is used to protect some `corpus of data`. A collection of files could be encrypted with the same key and people with `decrypt` permissions on that key would be able to decrypt those files. Therefore, it's necessary to make sure the `rotation period` is set to a specific time.

## Impact

After a successful key rotation, the older key version is required in order to decrypt the data encrypted by that previous key version.

## Audit Procedure

### From Google Cloud Console

1. Go to `Cryptographic Keys` by visiting: https://console.cloud.google.com/security/kms
2. Click on each key ring, then ensure each key in the keyring has `Next Rotation` set for less than 90 days from the current date.

### From Google Cloud CLI

1. Ensure rotation is scheduled by `ROTATION_PERIOD` and `NEXT_ROTATION_TIME` for each key:

```bash
gcloud kms keys list --keyring=<KEY_RING> --location=<LOCATION> --format=json'(rotationPeriod)'
```

## Expected Result

Ensure outcome values for `rotationPeriod` and `nextRotationTime` satisfy the below criteria:

- `rotationPeriod` is <= `129600m`
- `rotationPeriod` is <= `7776000s`
- `rotationPeriod` is <= `2160h`
- `rotationPeriod` is <= `90d`
- `nextRotationTime` is <= `90days` from current DATE

## Remediation

### From Google Cloud Console

1. Go to `Cryptographic Keys` by visiting: https://console.cloud.google.com/security/kms
2. Click on the specific key ring.
3. From the list of keys, choose the specific key and Click on `Right side pop up the blade (3 dots)`.
4. Click on `Edit rotation period`.
5. On the pop-up window, `Select a new rotation period` in days which should be less than 90 and then choose `Starting on` date (date from which the rotation period begins).

### From Google Cloud CLI

1. Update and schedule rotation by `ROTATION_PERIOD` and `NEXT_ROTATION_TIME` for each key:

```bash
gcloud kms keys update new --keyring=KEY_RING --location=LOCATION --next-rotation-time=NEXT_ROTATION_TIME --rotation-period=ROTATION_PERIOD
```

## Default Value

By default, KMS encryption keys are rotated every 90 days.

## Additional Information

- Key rotation does NOT re-encrypt already encrypted data with the newly generated key version. If you suspect unauthorized use of a key, you should re-encrypt the data protected by that key and then disable or schedule destruction of the prior key version.
- It is not recommended to rely solely on irregular rotation, but rather to use irregular rotation if needed in conjunction with a regular rotation schedule.

## References

1. https://cloud.google.com/kms/docs/key-rotation#frequency_of_key_rotation
2. https://cloud.google.com/kms/docs/re-encrypt-data

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.11 Encrypt Sensitive Data at Rest | | x | x |
| v7 | 14.8 Encrypt Sensitive Information at Rest | | | x |
