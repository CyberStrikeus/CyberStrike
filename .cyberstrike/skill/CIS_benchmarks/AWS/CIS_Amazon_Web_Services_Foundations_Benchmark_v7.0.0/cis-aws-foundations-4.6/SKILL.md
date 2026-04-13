---
name: cis-aws-foundations-4.6
description: "Ensure rotation for customer-created symmetric CMKs is enabled"
category: cis-logging
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, logging, kms, key-rotation, cmk, encryption]
cis_id: "4.6"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-4.5]
prerequisites: []
severity_boost: {}
---

# Ensure rotation for customer-created symmetric CMKs is enabled

## Description
AWS Key Management Service (KMS) allows customers to rotate the backing key, which is key material stored within the KMS that is tied to the key ID of the customer-created customer master key (CMK). The backing key is used to perform cryptographic operations such as encryption and decryption. Automated key rotation currently retains all prior backing keys so that decryption of encrypted data can occur transparently. It is recommended that CMK key rotation be enabled for symmetric keys. Key rotation cannot be enabled for any asymmetric CMK.

## Rationale
Rotating encryption keys helps reduce the potential impact of a compromised key, as data encrypted with a new key cannot be accessed with a previous key that may have been exposed. Keys should be rotated every year or upon an event that could result in the compromise of that key.

## Impact
Creation, management, and storage of CMKs may require additional time from an administrator.

## Audit Procedure

### Using AWS Console
1. Sign in to the AWS Management Console and open the KMS console at: https://console.aws.amazon.com/kms.
2. In the left navigation pane, click `Customer-managed keys`.
3. Select a customer-managed CMK where `Key spec = SYMMETRIC_DEFAULT`.
4. Select the `Key rotation` tab.
5. Ensure the `Automatically rotate this KMS key every year` box is checked.
6. Repeat steps 3-5 for all customer-managed CMKs where `Key spec = SYMMETRIC_DEFAULT`.

### Using AWS CLI
1. Run the following command to get a list of all keys and their associated `KeyIds`:

```bash
aws kms list-keys
```

2. For each key, note the KeyId and run the following command:

```bash
aws kms describe-key --key-id <key-id>
```

3. If the response contains `"KeySpec = SYMMETRIC_DEFAULT"`, run the following command:

```bash
aws kms get-key-rotation-status --key-id <kms-key-id>
```

4. Ensure `KeyRotationEnabled` is set to `true`.
5. Repeat steps 2-4 for all remaining CMKs.
6. Alternatively, the following command can be used to check all keys more comprehensively:

```bash
KEY_IDS=$(aws kms list-keys --query "Keys[].KeyId" --output text)

for KEY_ID in $KEY_IDS; do
  aws kms get-key-rotation-status --key-id "$KEY_ID" --query "{KeyId:KeyId,RotationEnabled:KeyRotationEnabled}" --output table
done
```

## Expected Result
All customer-managed symmetric CMKs (`KeySpec = SYMMETRIC_DEFAULT`) have `KeyRotationEnabled` set to `true`.

## Remediation

### Using AWS Console
1. Sign in to the AWS Management Console and open the KMS console at: https://console.aws.amazon.com/kms.
2. In the left navigation pane, click `Customer-managed keys`.
3. Select a key with `Key spec = SYMMETRIC_DEFAULT` that does not have automatic rotation enabled.
4. Select the `Key rotation` tab.
5. Check the `Automatically rotate this KMS key every year` box.
6. Click `Save`.
7. Repeat steps 3-6 for all customer-managed CMKs that do not have automatic rotation enabled.

### Using AWS CLI
1. Run the following command to enable key rotation:

```bash
aws kms enable-key-rotation --key-id <kms-key-id>
```

## Default Value
By default, automatic key rotation is disabled for customer-managed symmetric CMKs. Key rotation must be explicitly enabled after key creation.

## References
1. https://aws.amazon.com/kms/pricing/
2. https://csrc.nist.gov/publications/detail/sp/800-57-part-1/rev-5/final
3. CCE-78920-6

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.11 Encrypt Sensitive Data at Rest - Encrypt sensitive data at rest on servers, applications, and databases containing sensitive data. | | x | x |
| v7 | 14.8 Encrypt Sensitive Information at Rest - Encrypt all sensitive information at rest using a tool that requires a secondary authentication mechanism not integrated into the operating system. | | | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1530 | TA0009 | M1041 |

## Profile
Level 2 | Automated
