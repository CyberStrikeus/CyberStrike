---
name: cis-gcp-foundations-1.14
description: "Ensure API Keys Are Restricted to Only APIs That Application Needs Access"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, iam, api-keys]
cis_id: "1.14"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.14 Ensure API Keys Are Restricted to Only APIs That Application Needs Access (Automated)

## Profile Applicability

- Level 2

## Description

API Keys should only be used for services in cases where other authentication methods are unavailable. API keys are always at risk because they can be viewed publicly, such as from within a browser, or they can be accessed on a device where the key resides. It is recommended to restrict API keys to use (call) only APIs required by an application.

## Rationale

Security risks involved in using API-Keys are below:

- API keys are simple encrypted strings
- API keys do not identify the user or the application making the API request
- API keys are typically accessible to clients, making it easy to discover and steal an API key

In light of these potential risks, Google recommends using the standard authentication flow instead of API-Keys. However, there are limited cases where API keys are more appropriate. For example, if there is a mobile application that needs to use the Google Cloud Translation API, but doesn't otherwise need a backend server, API keys are the simplest way to authenticate to that API.

In order to reduce attack surfaces by providing `least privileges`, API-Keys can be restricted to use (call) only APIs required by an application.

## Impact

Setting `API restrictions` may break existing application functioning, if not done carefully.

## Audit Procedure

### From Google Cloud Console

1. Go to `APIs & Services\Credentials` using https://console.cloud.google.com/apis/credentials
2. In the section `API Keys`, Click the `API Key Name`. The API Key properties display on a new page.
3. For every API Key, ensure the section `Key restrictions` parameter `API restrictions` is not set to `None`.

Or,

Ensure `API restrictions` is not set to `Google Cloud APIs`. Note: `Google Cloud APIs` represents the API collection of all cloud services/APIs offered by Google cloud.

### From Google Cloud CLI

1. List all API Keys:

```bash
gcloud services api-keys list
```

Each key should have a line that says `restrictions:` followed by varying parameters and NOT have a line saying `- service: cloudapis.googleapis.com` as shown here:

```yaml
restrictions:
  apiTargets:
  - service: cloudapis.googleapis.com
```

## Expected Result

All API keys should have `API restrictions` configured to only the specific APIs required by the application. No key should be unrestricted or set to `Google Cloud APIs`.

## Remediation

### From Google Cloud Console

1. Go to `APIs & Services\Credentials` using https://console.cloud.google.com/apis/credentials
2. In the section `API Keys`, Click the `API Key Name`. The API Key properties display on a new page.
3. In the `Key restrictions` section go to `API restrictions`.
4. Click the `Select API` drop-down to choose an API.
5. Click `Save`.
6. Repeat steps 2,3,4,5 for every unrestricted API key.

Note: Do not set `API restrictions` to `Google Cloud APIs`, as this option allows access to all services offered by Google cloud.

### From Google Cloud CLI

1. List all API keys:

```bash
gcloud services api-keys list
```

2. Note the `UID` of the key to add restrictions to.

3. Run the update command with the appropriate API target service or flags file with API target services and methods to add the required restrictions.

Command with appropriate API target service:

```bash
gcloud services api-keys update <UID> --api-target=service=<service>
```

Command with flags file:

```bash
gcloud services api-keys update <UID> --flags-file=<flags_file>.yaml
```

Content of flags file:

```yaml
- --api-target:
    service: "foo.service.com"
- --api-target:
    service: "bar.service.com"
    methods:
    - "foomethod"
    - "barmethod"
```

Note: Flags can be found by running:

```bash
gcloud services api-keys update --help
```

Note: Services can be found by running:

```bash
gcloud services list
```

or in this documentation: https://cloud.google.com/sdk/gcloud/reference/services/api-keys/update

## Default Value

By default, `API restrictions` are set to `None`.

## References

1. https://cloud.google.com/docs/authentication/api-keys
2. https://cloud.google.com/apis/docs/overview

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 16.10 Apply Secure Design Principles in Application Architectures | | x | x |
| v7 | 0.0 Explicitly Not Mapped | | | |
