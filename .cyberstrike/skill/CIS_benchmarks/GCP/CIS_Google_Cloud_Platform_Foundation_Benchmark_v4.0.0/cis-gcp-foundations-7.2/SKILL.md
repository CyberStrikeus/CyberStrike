---
name: cis-gcp-foundations-7.2
description: "Ensure That All BigQuery Tables Are Encrypted With Customer-Managed Encryption Key (CMEK)"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, bigquery, encryption, cmek]
cis_id: "7.2"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.2 Ensure That All BigQuery Tables Are Encrypted With Customer-Managed Encryption Key (CMEK) (Automated)

## Profile Applicability

- Level 2

## Description

BigQuery by default encrypts the data as rest by employing `Envelope Encryption` using Google managed cryptographic keys. The data is encrypted using the `data encryption keys` and data encryption keys themselves are further encrypted using `key encryption keys`. This is seamless and do not require any additional input from the user. However, if you want to have greater control, Customer-managed encryption keys (CMEK) can be used as encryption key management solution for BigQuery Data Sets. If CMEK is used, the CMEK is used to encrypt the data encryption keys instead of using google-managed encryption keys.

## Rationale

BigQuery by default encrypts the data as rest by employing `Envelope Encryption` using Google managed cryptographic keys. This is seamless and does not require any additional input from the user.

For greater control over the encryption, customer-managed encryption keys (CMEK) can be used as encryption key management solution for BigQuery tables. The CMEK is used to encrypt the data encryption keys instead of using google-managed encryption keys. BigQuery stores the table and CMEK association and the encryption/decryption is done automatically.

Applying the Default Customer-managed keys on BigQuery data sets ensures that all the new tables created in the future will be encrypted using CMEK but existing tables need to be updated to use CMEK individually.

> **Note:** Google does not store your keys on its servers and cannot access your protected data unless you provide the key. This also means that if you forget or lose your key, there is no way for Google to recover the key or to recover any data encrypted with the lost key.

## Impact

Using Customer-managed encryption keys (CMEK) will incur additional labor-hour investment to create, protect, and manage the keys.

## Audit

### From Google Cloud Console

1. Go to `Analytics`
2. Go to `BigQuery`
3. Under `SQL Workspace`, select the project
4. Select Data Set, select the table
5. Go to `Details` tab
6. Under `Table info`, verify `Customer-managed key` is present.
7. Repeat for each table in all data sets for all projects.

### From Google Cloud CLI

List all dataset names

```bash
bq ls
```

Use the following command to view the table details. Verify the `kmsKeyName` is present.

```bash
bq show <table_object>
```

## Remediation

### From Google Cloud CLI

Use the following command to copy the data. The source and the destination needs to be same in case copying to the original table.

```bash
bq cp --destination_kms_key <customer_managed_key> source_dataset.source_table destination_dataset.destination_table
```

## Default Value

Google Managed keys are used as `key encryption keys`.

## References

1. https://cloud.google.com/bigquery/docs/customer-managed-encryption

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.11 Encrypt Sensitive Data at Rest | | X | X |
| v7 | 14.8 Encrypt Sensitive Information at Rest | | | X |
