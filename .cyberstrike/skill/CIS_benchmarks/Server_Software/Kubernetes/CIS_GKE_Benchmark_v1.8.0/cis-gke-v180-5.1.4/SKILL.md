---
name: cis-gke-v180-5.1.4
description: "Ensure only trusted container images are used (Manual)"
category: cis-gke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, image-registry, image-scanning, artifact-registry, vulnerability-scanning]
cis_id: "5.1.4"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.8.0"
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

## Impact

All container images to be deployed to the cluster must be hosted within an approved container image registry. If public registries are not on the allowlist, a process for bringing commonly used container images into an approved private registry and keeping them up to date will be required.

## Audit

Using Google Cloud Console: To check that Binary Authorization is enabled for the GKE cluster:

1. Go to the Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list
2. Select the cluster for which Binary Authorization is disabled.
3. Under the details pane, within the Security section, ensure that 'Binary Authorization' is set to 'Enabled'. Then, assess the contents of the policy:
4. Go to Binary Authorization by visiting: https://console.cloud.google.com/security/binary-authorization
5. Ensure a policy is defined and the project default rule is not configured to 'Allow all images'.

Using Command Line:
Check that Binary Authorization is enabled for the GKE cluster, first define 2 variables for Cluster Name and Zone, and then run the command below:

```
gcloud container clusters describe $CLUSTER_NAME --zone $COMPUTE_ZONE --format json | jq .binaryAuthorization
```

This will return one of 2 possible responses if Binary Authorization is enabled:

```json
{
  "evaluationMode": "PROJECT_SINGLETON_POLICY_ENFORCE"
}
```

OR

```json
{
  "evaluationMode": "PROJECT_SINGLETON_POLICY_AUDIT_AND_WARN"
}
```

Then, assess the contents of the policy:

```
gcloud container binauthz policy export > current-policy.yaml
```

Ensure the current policy is not configured to allow all images (`evaluationMode: ALWAYS_ALLOW`):

```
cat current-policy.yaml
...
defaultAdmissionRule:
  evaluationMode: ALWAYS_ALLOW
```

## Remediation

Using Google Cloud Console

1. Go to Binary Authorization by visiting: https://console.cloud.google.com/security/binary-authorization.
2. Enable the Binary Authorization API (if disabled).
3. Create an appropriate policy for use with the cluster. See https://cloud.google.com/binary-authorization/docs/policy-yaml-reference for guidance.
4. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
5. Select the cluster for which Binary Authorization is disabled.
6. Under the details pane, within the Security section, click on the pencil icon named `Edit Binary Authorization`.
7. Check the box next to `Enable Binary Authorization`.
8. Choose `Enforce` policy and provide a directory for the policy to be used.
9. Click `SAVE CHANGES`.

Using Command Line:
Update the cluster to enable Binary Authorization:

```
gcloud container cluster update <cluster_name> --zone <compute_zone> --binauthz-evaluation-mode=<evaluation_mode>

Example:
gcloud container clusters update $CLUSTER_NAME --zone $COMPUTE_ZONE --binauthz-evaluation-mode=PROJECT_SINGLETON_POLICY_ENFORCE
```

See: https://cloud.google.com/sdk/gcloud/reference/container/clusters/update#--binauthz-evaluation-mode for more details around the evaluation modes available.

Create a Binary Authorization Policy using the Binary Authorization Policy Reference: https://cloud.google.com/binary-authorization/docs/policy-yaml-reference for guidance.

Import the policy file into Binary Authorization:

```
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
