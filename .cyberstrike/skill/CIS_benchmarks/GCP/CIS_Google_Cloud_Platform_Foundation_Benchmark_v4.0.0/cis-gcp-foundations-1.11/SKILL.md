---
name: cis-gcp-foundations-1.11
description: "Ensure That Separation of Duties Is Enforced While Assigning KMS Related Roles to Users"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, iam, kms, encryption]
cis_id: "1.11"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.11 Ensure That Separation of Duties Is Enforced While Assigning KMS Related Roles to Users (Automated)

## Profile Applicability

- Level 2

## Description

It is recommended that the principle of 'Separation of Duties' is enforced while assigning KMS related roles to users.

## Rationale

The built-in/predefined IAM role `Cloud KMS Admin` allows the user/identity to create, delete, and manage service account(s). The built-in/predefined IAM role `Cloud KMS CryptoKey Encrypter/Decrypter` allows the user/identity (with adequate privileges on concerned resources) to encrypt and decrypt data at rest using an encryption key(s).

The built-in/predefined IAM role `Cloud KMS CryptoKey Encrypter` allows the user/identity (with adequate privileges on concerned resources) to encrypt data at rest using an encryption key(s). The built-in/predefined IAM role `Cloud KMS CryptoKey Decrypter` allows the user/identity (with adequate privileges on concerned resources) to decrypt data at rest using an encryption key(s).

Separation of duties is the concept of ensuring that one individual does not have all necessary permissions to be able to complete a malicious action. In Cloud KMS, this could be an action such as using a key to access and decrypt data a user should not normally have access to. Separation of duties is a business control typically used in larger organizations, meant to help avoid security or privacy incidents and errors. It is considered best practice.

No user(s) should have `Cloud KMS Admin` and any of the `Cloud KMS CryptoKey Encrypter/Decrypter`, `Cloud KMS CryptoKey Encrypter`, `Cloud KMS CryptoKey Decrypter` roles assigned at the same time.

## Impact

Removed roles should be assigned to another user based on business needs.

## Audit Procedure

### From Google Cloud Console

1. Go to `IAM & Admin/IAM` by visiting: https://console.cloud.google.com/iam-admin/iam
2. Ensure no member has the roles `Cloud KMS Admin` and any of the `Cloud KMS CryptoKey Encrypter/Decrypter`, `Cloud KMS CryptoKey Encrypter`, `Cloud KMS CryptoKey Decrypter` assigned.

### From Google Cloud CLI

1. List all users and role assignments:

```bash
gcloud projects get-iam-policy PROJECT_ID
```

2. Ensure that there are no common users found in the member section for roles `cloudkms.admin` and any one of `Cloud KMS CryptoKey Encrypter/Decrypter`, `Cloud KMS CryptoKey Encrypter`, `Cloud KMS CryptoKey Decrypter`.

## Expected Result

No user should have both `Cloud KMS Admin` (cloudkms.admin) and any of the CryptoKey Encrypter/Decrypter roles assigned simultaneously.

## Remediation

### From Google Cloud Console

1. Go to `IAM & Admin/IAM` using https://console.cloud.google.com/iam-admin/iam
2. For any member having `Cloud KMS Admin` and any of the `Cloud KMS CryptoKey Encrypter/Decrypter`, `Cloud KMS CryptoKey Encrypter`, `Cloud KMS CryptoKey Decrypter` roles granted/assigned, click the `Delete Bin` icon to remove the role from the member.

Note: Removing a role should be done based on the business requirement.

### From Google Cloud CLI

Remove the conflicting role from the user:

```bash
gcloud projects remove-iam-policy-binding PROJECT_ID --member=user:USER_EMAIL --role=ROLE_TO_REMOVE
```

## Default Value

By default, there are no role assignments that violate separation of duties.

## Additional Information

Users granted with Owner (roles/owner) and Editor (roles/editor) have privileges equivalent to `Cloud KMS Admin` and `Cloud KMS CryptoKey Encrypter/Decrypter`. To avoid misuse, Owner and Editor roles should be granted to a very limited group of users. Use of these primitive privileges should be minimal.

## References

1. https://cloud.google.com/kms/docs/separation-of-duties

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |
