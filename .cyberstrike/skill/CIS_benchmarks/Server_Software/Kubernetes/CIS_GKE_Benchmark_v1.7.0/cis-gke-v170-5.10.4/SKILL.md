---
name: cis-gke-v170-5.10.4
description: "Ensure use of Binary Authorization (Automated)"
category: cis-gke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, cluster-config, binary-authorization, supply-chain, image-signing]
cis_id: "5.10.4"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.7.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.10.4 Ensure use of Binary Authorization (Automated)

## Profile Applicability

- Level 2

## Description

Binary Authorization helps to protect supply-chain security by only allowing images with verifiable cryptographically signed metadata into the cluster.

## Rationale

Binary Authorization provides software supply-chain security for images that are deployed to GKE from Google Container Registry (GCR) or another container image registry.

Binary Authorization requires images to be signed by trusted authorities during the development process. These signatures are then validated at deployment time. By enforcing validation, tighter control over the container environment can be gained by ensuring only verified images are integrated into the build-and-release process.

## Impact

Care must be taken when defining policy in order to prevent inadvertent denial of container image deployments. Depending on policy, attestations for existing container images running within the cluster may need to be created before those images are redeployed or pulled as part of the pod churn.

To prevent key system images from being denied deployment, consider the use of global policy evaluation mode, which uses a global policy provided by Google and exempts a list of Google-provided system images from further policy evaluation.

## Audit

**Using Google Cloud Console:**

To check that Binary Authorization is enabled for the GKE cluster:

1. Go to the Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list
2. Select the cluster for which Binary Authorization is disabled.
3. Under the details pane, within the Security section, ensure that 'Binary Authorization' is set to 'Enabled'.

Then, assess the contents of the policy:

4. Go to Binary Authorization by visiting: https://console.cloud.google.com/security/binary-authorization
5. Ensure a policy is defined and the project default rule is not configured to 'Allow all images'.

**Using Command Line:**

To check that Binary Authorization is enabled for the GKE cluster:

```bash
gcloud container clusters describe <cluster_name> --zone <compute_zone> --format json | jq .binaryAuthorization
```

The above command output will be the following if Binary Authorization is enabled:

```json
{
  "enabled": true
}
```

Then, assess the contents of the policy:

```bash
gcloud container binauthz policy export > current-policy.yaml
```

Ensure that the current policy is not configured to allow all images (`evaluationMode: ALWAYS_ALLOW`):

```yaml
cat current-policy.yaml
---
defaultAdmissionRule:
  evaluationMode: ALWAYS_ALLOW
```

## Remediation

**Using Google Cloud Console:**

1. Go to Binary Authorization by visiting: https://console.cloud.google.com/security/binary-authorization.
2. Enable the Binary Authorization API (if disabled).
3. Create an appropriate policy for use with the cluster. See https://cloud.google.com/binary-authorization/docs/policy-yaml-reference for guidance.
4. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
5. Select the cluster for which Binary Authorization is disabled.
6. Under the details pane, within the Security section, click on the pencil icon named `Edit Binary Authorization`.
7. Check the box next to `Enable Binary Authorization`.
8. Choose `Enforce` policy and provide a directory for the policy to be used.
9. Click `SAVE CHANGES`.

**Using Command Line:**

Update the cluster to enable Binary Authorization:

```bash
gcloud container cluster update <cluster_name> --zone <compute_zone> --binauthz-evaluation-mode=<evaluation_mode>
```

Example:

```bash
gcloud container clusters update $CLUSTER_NAME --zone $COMPUTE_ZONE --binauthz-evaluation-mode=PROJECT_SINGLETON_POLICY_ENFORCE
```

See https://cloud.google.com/sdk/gcloud/reference/container/clusters/update#--binauthz-evaluation-mode for more details around the evaluation modes available.

Create a Binary Authorization Policy using the Binary Authorization Policy Reference: https://cloud.google.com/binary-authorization/docs/policy-yaml-reference for guidance.

Import the policy file into Binary Authorization:

```bash
gcloud container binauthz policy import <yaml_policy>
```

## Default Value

By default, Binary Authorization is disabled.

## References

1. https://cloud.google.com/binary-authorization/docs/setting-up
2. https://cloud.google.com/sdk/gcloud/reference/container/clusters/update#--binauthz-evaluation-mode

## CIS Controls

| Controls Version | Control                           | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------- | ---- | ---- | ---- |
| v8               | 2.3 Address Unauthorized Software | x    | x    | x    |
| v7               | 5.2 Maintain Secure Images        |      | x    | x    |
