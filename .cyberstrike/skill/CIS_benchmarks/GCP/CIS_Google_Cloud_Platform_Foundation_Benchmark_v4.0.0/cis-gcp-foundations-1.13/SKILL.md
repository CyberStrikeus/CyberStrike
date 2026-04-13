---
name: cis-gcp-foundations-1.13
description: "Ensure API Keys Are Restricted To Use by Only Specified Hosts and Apps"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, iam, api-keys]
cis_id: "1.13"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.13 Ensure API Keys Are Restricted To Use by Only Specified Hosts and Apps (Manual)

## Profile Applicability

- Level 2

## Description

API Keys should only be used for services in cases where other authentication methods are unavailable. In this case, unrestricted keys are insecure because they can be viewed publicly, such as from within a browser, or they can be accessed on a device where the key resides. It is recommended to restrict API key usage to trusted hosts, HTTP referrers and apps. It is recommended to use the more secure standard authentication flow instead.

## Rationale

Security risks involved in using API-Keys appear below:

- API keys are simple encrypted strings
- API keys do not identify the user or the application making the API request
- API keys are typically accessible to clients, making it easy to discover and steal an API key

In light of these potential risks, Google recommends using the standard authentication flow instead of API keys. However, there are limited cases where API keys are more appropriate. For example, if there is a mobile application that needs to use the Google Cloud Translation API, but doesn't otherwise need a backend server, API keys are the simplest way to authenticate to that API.

In order to reduce attack vectors, API-Keys can be restricted only to trusted hosts, HTTP referrers and applications.

## Impact

Setting `Application Restrictions` may break existing application functioning, if not done carefully.

## Audit Procedure

### From Google Cloud Console

1. Go to `APIs & Services\Credentials` using https://console.cloud.google.com/apis/credentials
2. In the section `API Keys`, Click the `API Key Name`. The API Key properties display on a new page.
3. For every API Key, ensure the section `Key restrictions` parameter `Application restrictions` is not set to `None`.

Or,

1. Ensure `Application restrictions` is set to `HTTP referrers` and the referrer is not set to wild-cards `(* or *.[TLD] or *.[TLD]/*)` allowing access to any/wide HTTP referrer(s).

Or,

1. Ensure `Application restrictions` is set to `IP addresses` and referrer is not set to `any host (0.0.0.0 or 0.0.0.0/0 or ::0)`.

### From Google Cloud CLI

1. Run the following from within the project you wish to audit:

```bash
gcloud services api-keys list --filter="-restrictions:*" --format="table[box](displayName:label='Key With No Restrictions')"
```

## Expected Result

The command should return no results. All API keys should have application restrictions configured (not set to `None`).

## Remediation

### From Google Cloud Console — Leaving Keys in Place

1. Go to `APIs & Services\Credentials` using https://console.cloud.google.com/apis/credentials
2. In the section `API Keys`, Click the `API Key Name`. The API Key properties display on a new page.
3. In the `Key restrictions` section, set the application restrictions to any of `HTTP referrers, IP addresses, Android apps, iOS apps`.
4. Click `Save`.
5. Repeat steps 2,3,4 for every unrestricted API key.

Note: Do not set `HTTP referrers` to wild-cards (_ or _.[TLD] or .[TLD]/) allowing access to any/wide HTTP referrer(s). Do not set `IP addresses` and referrer to `any host (0.0.0.0 or 0.0.0.0/0 or ::0)`.

### From Google Cloud Console — Removing Keys

Another option is to remove the keys entirely.

1. Go to `APIs & Services\Credentials` using https://console.cloud.google.com/apis/credentials
2. In the section `API Keys`, select the checkbox next to each key you wish to remove.
3. Select `Delete` and confirm.

## Default Value

By default, `Application Restrictions` are set to `None`.

## References

1. https://cloud.google.com/docs/authentication/api-keys
2. https://cloud.google.com/sdk/gcloud/reference/services/api-keys/list
3. https://cloud.google.com/sdk/gcloud/reference/services/api-keys/update

## CIS Controls

| Controls Version | Control                                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 16.10 Apply Secure Design Principles in Application Architectures |      | x    | x    |
| v7               | 0.0 Explicitly Not Mapped                                         |      |      |      |
