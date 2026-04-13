---
name: cis-gcp-foundations-2.13
description: "Ensure Cloud Asset Inventory Is Enabled"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, logging, monitoring, asset-inventory, compliance]
cis_id: "2.13"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.13 Ensure Cloud Asset Inventory Is Enabled (Automated)

## Profile Applicability

- Level 1

## Description

GCP Cloud Asset Inventory is a service that provides a historical view of GCP resources and IAM policies through a time-series database. The information recorded includes metadata on Google Cloud resources, metadata on policies set on Google Cloud projects or resources, and runtime information gathered within a Google Cloud resource.

Cloud Asset Inventory Service (CAIS) API enablement is not required for operation of the service, but rather enables the mechanism for searching/exporting CAIS asset data directly.

## Rationale

The GCP resources and IAM policies captured by GCP Cloud Asset Inventory enables security analysis, resource change tracking, and compliance auditing.

It is recommended GCP Cloud Asset Inventory be enabled for all GCP projects.

## Audit

### From Google Cloud Console

Ensure that the Cloud Asset API is enabled:

1. Go to `API & Services/Library` by visiting https://console.cloud.google.com/apis/library
2. Search for `Cloud Asset API` and select the result for Cloud Asset API
3. Ensure that `API Enabled` is displayed.

### From Google Cloud CLI

Ensure that the Cloud Asset API is enabled:

1. Query enabled services:

```bash
gcloud services list --enabled --filter=name:cloudasset.googleapis.com
```

If the API is listed, then it is enabled. If the response is `Listed 0 items` the API is not enabled.

## Remediation

### From Google Cloud Console

Enable the Cloud Asset API:

1. Go to `API & Services/Library` by visiting https://console.cloud.google.com/apis/library
2. Search for `Cloud Asset API` and select the result for Cloud Asset API
3. Click the `ENABLE` button.

### From Google Cloud CLI

Enable the Cloud Asset API:

1. Enable the Cloud Asset API through the services interface:

```bash
gcloud services enable cloudasset.googleapis.com
```

## Default Value

The Cloud Asset Inventory API is disabled by default in each project.

## References

1. https://cloud.google.com/asset-inventory/docs

## Additional Information

- Cloud Asset Inventory only keeps a five-week history of Google Cloud asset metadata. If a longer history is desired, automation to export the history to Cloud Storage or BigQuery should be evaluated.
- Users need not enable CAI API if they don't have any plans to export.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 1.1 Establish and Maintain Detailed Enterprise Asset Inventory | x | x | x |
| v8 | 6.6 Establish and Maintain an Inventory of Authentication and Authorization Systems | | x | x |
| v7 | 1.4 Maintain Detailed Asset Inventory | x | x | x |
| v7 | 11.2 Document Traffic Configuration Rules | | x | x |
| v7 | 16.1 Maintain an Inventory of Authentication Systems | | x | x |
