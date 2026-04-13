---
name: cis-gcp-foundations-7.4
description: "Ensure all data in BigQuery has been classified"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, bigquery, encryption, cmek]
cis_id: "7.4"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.4 Ensure all data in BigQuery has been classified (Manual)

## Profile Applicability

- Level 2

## Description

BigQuery tables can contain sensitive data that for security purposes should be discovered, monitored, classified, and protected. Google Cloud's Sensitive Data Protection tools can automatically provide data classification of all BigQuery data across an organization.

## Rationale

Using a cloud service or 3rd party software to continuously monitor and automate the process of data discovery and classification for BigQuery tables is an important part of protecting the data.

Sensitive Data Protection is a fully managed data protection and data privacy platform that uses machine learning and pattern matching to discover and classify sensitive data in Google Cloud.

## Impact

There is a cost associated with using Sensitive Data Protection. There is also typically a cost associated with 3rd party tools that perform similar processes and protection.

## Audit

1. Go to Cloud DLP by visiting https://console.cloud.google.com/dlp/landing/dataProfiles/configurations.
2. Verify there is a discovery scan configuration either for the organization or project.

## Remediation

Enable profiling:

1. Go to Cloud DLP by visiting https://console.cloud.google.com/dlp/landing/dataProfiles/configurations.
2. Click "Create Configuration"
3. For projects follow https://cloud.google.com/dlp/docs/profile-project. For organizations or folders follow https://cloud.google.com/dlp/docs/profile-org-folder

Review findings:

- Columns or tables with high data risk have evidence of sensitive information without additional protections. To lower the data risk score, consider doing the following:
  - For columns containing sensitive data, apply a BigQuery policy tag to restrict access to accounts with specific access rights.
  - De-identify the raw sensitive data using de-identification techniques like masking and tokenization.

Incorporate findings into your security and governance operations:

- Enable sending findings into your security and posture services. You can publish data profiles to Security Command Center and Chronicle.
- Automate remediation or enable alerting of new or changed data risk with Pub/Sub.

## References

1. https://cloud.google.com/dlp/docs/data-profiles
2. https://cloud.google.com/dlp/docs/analyze-data-profiles
3. https://cloud.google.com/dlp/docs/data-profiles-remediation
4. https://cloud.google.com/dlp/docs/send-profiles-to-scc
5. https://cloud.google.com/dlp/docs/profile-org-folder#chronicle
6. https://cloud.google.com/dlp/docs/profile-org-folder#publish-pubsub

## CIS Controls

| Controls Version | Control                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.1 Establish and Maintain a Data Management Process    | X    | X    | X    |
| v8               | 3.7 Establish and Maintain a Data Classification Scheme |      | X    | X    |
| v7               | 5.1 Establish Secure Configurations                     | X    | X    | X    |
