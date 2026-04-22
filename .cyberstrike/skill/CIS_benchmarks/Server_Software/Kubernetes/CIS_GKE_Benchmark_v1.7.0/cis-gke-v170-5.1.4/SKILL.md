---
name: cis-gke-v170-5.1.4
description: "Ensure only trusted container images are used (Manual)"
category: cis-gke
version: "1.7.0"
author: cyberstrike-official
tags:
  [
    cis,
    gke,
    kubernetes,
    gcp,
    image-registry,
    image-scanning,
    artifact-registry,
    vulnerability-scanning,
    binary-authorization,
  ]
cis_id: "5.1.4"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.7.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.4 Ensure only trusted container images are used (Manual)

## Profile Applicability

- Level 2

## Description

Use Binary Authorization to allowlist (whitelist) only approved container registries.

## Rationale

Allowing unrestricted access to external container registries provides the opportunity for malicious or unapproved containers to be deployed into the cluster. Ensuring only trusted container images are used reduces this risk.

Also see recommendation 5.10.4.

## Impact

All container images to be deployed to the cluster must be hosted within an approved container image registry. If public registries are not on the allowlist, a process for bringing commonly used container images into an approved private registry and keeping them up to date will be required.

## Audit

**Using Google Cloud Console:**
Check that Binary Authorization is enabled for the GKE cluster:

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list
2. Click on the cluster and on the Details pane, ensure that Binary Authorization is set to 'Enabled'.

Then assess the contents of the policy:

1. Go to Binary Authorization by visiting: https://console.cloud.google.com/security/binary-authorization
2. Ensure the project default rule is not set to 'Allow all images' under Policy deployment rules.
3. Review the list of 'Images exempt from policy' for unauthorized container registries.

**Using Command Line:**
Check that Binary Authorization is enabled for the GKE cluster:

```bash
gcloud container clusters describe <cluster_name> --zone <compute_zone> --format json | jq .binaryAuthorization
```

This will return the following if Binary Authorization is enabled:

```json
{
  "enabled": true
}
```

Then assess the contents of the policy:

```bash
gcloud container binauthz policy export > current-policy.yaml
```

Ensure that the current policy is not configured to allow all images (`evaluationMode: ALWAYS_ALLOW`).
Review the list of `admissionWhitelistPatterns` for unauthorized container registries.

```yaml
cat current-policy.yaml
admissionWhitelistPatterns:
...
defaultAdmissionRule:
  evaluationMode: ALWAYS_ALLOW
```

## Remediation

**Using Google Cloud Console:**

1. Go to Binary Authorization by visiting: https://console.cloud.google.com/security/binary-authorization
2. Enable Binary Authorization API (if disabled).
3. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
4. Select Kubernetes cluster for which Binary Authorization is disabled.
5. Within the `Details` pane, under the `Security` heading, click on the pencil icon called `Edit binary authorization`.
6. Ensure that `Enable Binary Authorization` is checked.
7. Click `SAVE CHANGES`.
8. Return to the Binary Authorization by visiting: https://console.cloud.google.com/security/binary-authorization.
9. Set an appropriate policy for the cluster and enter the approved container registries under Image paths.

**Using Command Line:**
Update the cluster to enable Binary Authorization:

```bash
gcloud container cluster update <cluster_name> --enable-binauthz
```

Create a Binary Authorization Policy using the Binary Authorization Policy Reference: https://cloud.google.com/binary-authorization/docs/policy-yaml-reference for guidance.
Import the policy file into Binary Authorization:

```bash
gcloud container binauthz policy import <yaml_policy>
```

## Default Value

By default, Binary Authorization is disabled along with container registry allowlisting.

## References

1. https://cloud.google.com/binary-authorization/docs/policy-yaml-reference
2. https://cloud.google.com/binary-authorization/docs/setting-up

## CIS Controls

| Controls Version | Control                           | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------- | ---- | ---- | ---- |
| v8               | 2.5 Allowlist Authorized Software |      | x    | x    |
| v7               | 5.2 Maintain Secure Images        |      | x    | x    |
| v7               | 5.3 Securely Store Master Images  |      | x    | x    |
