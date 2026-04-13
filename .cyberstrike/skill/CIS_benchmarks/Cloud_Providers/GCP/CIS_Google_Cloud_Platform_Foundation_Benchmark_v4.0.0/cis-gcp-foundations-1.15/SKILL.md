---
name: cis-gcp-foundations-1.15
description: "Ensure API Keys Are Rotated Every 90 Days"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, iam, api-keys]
cis_id: "1.15"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.15 Ensure API Keys Are Rotated Every 90 Days (Automated)

## Profile Applicability

- Level 2

## Description

API Keys should only be used for services in cases where other authentication methods are unavailable. If they are in use it is recommended to rotate API keys every 90 days.

## Rationale

Security risks involved in using API-Keys are listed below:

- API keys are simple encrypted strings
- API keys do not identify the user or the application making the API request
- API keys are typically accessible to clients, making it easy to discover and steal an API key

Because of these potential risks, Google recommends using the standard authentication flow instead of API Keys. However, there are limited cases where API keys are more appropriate. For example, if there is a mobile application that needs to use the Google Cloud Translation API, but doesn't otherwise need a backend server, API keys are the simplest way to authenticate to that API.

Once a key is stolen, it has no expiration, meaning it may be used indefinitely unless the project owner revokes or regenerates the key. Rotating API keys will reduce the window of opportunity for an access key that is associated with a compromised or terminated account to be used.

API keys should be rotated to ensure that data cannot be accessed with an old key that might have been lost, cracked, or stolen.

## Impact

`Regenerating Key` may break existing client connectivity as the client will try to connect with older API keys they have stored on devices.

## Audit Procedure

### From Google Cloud Console

1. Go to `APIs & Services\Credentials` using https://console.cloud.google.com/apis/credentials
2. In the section `API Keys`, for every key ensure the `creation date` is less than 90 days.

### From Google Cloud CLI

To list keys, use the command:

```bash
gcloud services api-keys list
```

Ensure the date in `createTime` is within 90 days.

## Expected Result

All API keys should have a `createTime` within the last 90 days, indicating they have been rotated.

## Remediation

### From Google Cloud Console

1. Go to `APIs & Services\Credentials` using https://console.cloud.google.com/apis/credentials
2. In the section `API Keys`, Click the `API Key Name`. The API Key properties display on a new page.
3. Click `REGENERATE KEY` to rotate API key.
4. Click `Save`.
5. Repeat steps 2,3,4 for every API key that has not been rotated in the last 90 days.

Note: Do not set `HTTP referrers` to wild-cards (_ or _.[TLD] or .[TLD]/) allowing access to any/wide HTTP referrer(s). Do not set `IP addresses` and referrer to `any host (0.0.0.0 or 0.0.0.0/0 or ::0)`.

### From Google Cloud CLI

There is not currently a way to regenerate an API key using gcloud commands. To 'regenerate' a key you will need to create a new one, duplicate the restrictions from the key being rotated, and delete the old key.

1. List existing keys:

```bash
gcloud services api-keys list
```

2. Note the `UID` and restrictions of the key to regenerate.

3. Run this command to create a new API key. `<key_name>` is the display name of the new key:

```bash
gcloud services api-keys create --display-name="<key_name>"
```

Note the `UID` of the newly created key.

4. Run the update command to add required restrictions:

Note - the restriction may vary for each key. Refer to this documentation for the appropriate flags: https://cloud.google.com/sdk/gcloud/reference/services/api-keys/update

```bash
gcloud services api-keys update <UID of new key>
```

5. Delete the old key:

```bash
gcloud services api-keys delete <UID of old key>
```

## Default Value

API keys do not have an automatic rotation mechanism.

## Additional Information

There is no option to automatically regenerate (rotate) API keys periodically.

## References

1. https://developers.google.com/maps/api-security-best-practices#regenerate-apikey
2. https://cloud.google.com/sdk/gcloud/reference/services/api-keys/update

## CIS Controls

| Controls Version | Control                                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 16.10 Apply Secure Design Principles in Application Architectures |      | x    | x    |
| v7               | 0.0 Explicitly Not Mapped                                         |      |      |      |
