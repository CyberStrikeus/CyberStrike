---
name: cis-gcp-foundations-1.12
description: "Ensure API Keys Only Exist for Active Services"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, iam, api-keys]
cis_id: "1.12"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.12 Ensure API Keys Only Exist for Active Services (Automated)

## Profile Applicability

- Level 2

## Description

API Keys should only be used for services in cases where other authentication methods are unavailable. Unused keys with their permissions in tact may still exist within a project. Keys are insecure because they can be viewed publicly, such as from within a browser, or they can be accessed on a device where the key resides. It is recommended to use standard authentication flow instead.

## Rationale

To avoid the security risk in using API keys, it is recommended to use standard authentication flow instead. Security risks involved in using API-Keys appear below:

- API keys are simple encrypted strings
- API keys do not identify the user or the application making the API request
- API keys are typically accessible to clients, making it easy to discover and steal an API key

## Impact

Deleting an API key will break dependent applications (if any).

## Audit Procedure

### From Google Cloud Console

1. From within the Project you wish to audit Go to `APIs & Services\Credentials`.
2. In the section `API Keys`, no API key should be listed.

### From Google Cloud CLI

1. Run the following from within the project you wish to audit:

```bash
gcloud services api-keys list --filter
```

2. There should be no keys listed at the project level.

## Expected Result

No API keys should be listed at the project level. If API keys exist, they should only be associated with actively used services.

## Remediation

### From Google Cloud Console

1. Go to `APIs & Services\Credentials` using https://console.cloud.google.com/apis/credentials
2. In the section `API Keys`, to delete API Keys: Click the `Delete Bin Icon` in front of every `API Key Name`.

### From Google Cloud CLI

1. Run the following from within the project you wish to audit:

```bash
gcloud services api-keys list --filter
```

2. Run the following command, providing the ID of the key or fully qualified identifier for the key for `<key_id>`:

```bash
gcloud services api-keys delete <key_id>
```

## Default Value

By default, API keys are not created for a project.

## Additional Information

Google recommends using the standard authentication flow instead of using API keys. However, there are limited cases where API keys are more appropriate. For example, if there is a mobile application that needs to use the Google Cloud Translation API, but doesn't otherwise need a backend server, API keys are the simplest way to authenticate to that API.

If a business requires API keys to be used, then the API keys should be secured properly.

## References

1. https://cloud.google.com/docs/authentication/api-keys
2. https://cloud.google.com/sdk/gcloud/reference/services/api-keys/list
3. https://cloud.google.com/docs/authentication
4. https://cloud.google.com/sdk/gcloud/reference/services/api-keys/delete

## CIS Controls

| Controls Version | Control                                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 16.10 Apply Secure Design Principles in Application Architectures |      | x    | x    |
| v7               | 16.8 Disable Any Unassociated Accounts                            | x    | x    | x    |
