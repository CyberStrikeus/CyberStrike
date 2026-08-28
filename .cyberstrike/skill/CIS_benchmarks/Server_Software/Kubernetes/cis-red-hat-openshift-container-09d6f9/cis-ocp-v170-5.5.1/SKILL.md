---
name: cis-ocp-v170-5.5.1
description: "Configure Image Provenance using image controller config (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, policies, admission-control]
cis_id: "5.5.1"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 5.5.1

## Profile Applicability

- **Level:** 2

## Description

Configure Image Provenance for your deployment.

## Rationale

Kubernetes supports plugging in provenance rules to accept or reject the images in your deployments. You could configure such rules to ensure that only approved images are deployed in the cluster.

You can control which images can be imported, tagged, and run in a cluster using the image controller. For additional information on the image controller, see Image configuration resources.

## Impact

You need to regularly maintain your provenance configuration based on container image updates.

## Audit Procedure

Review the image controller parameters in your cluster and verify that image provenance is configured as appropriate.

Run the following command to return all registry sources:

```bash
oc get image.config.openshift.io/cluster -o json | jq .spec.registrySources
```

If nothing is returned, this is a finding and you should refer to the OpenShift image guide for configuring trusted registries.

## Remediation

Follow the OpenShift documentation: Image configuration resources.

## Default Value

By default, image provenance is not set.

## References

1. https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/#imagepolicywebhook
2. https://github.com/kubernetes/community/blob/master/contributors/design-proposals/image-provenance.md
3. https://hub.docker.com/r/dnurmi/anchore-toolbox/
4. https://github.com/kubernetes/kubernetes/issues/22888

## CIS Controls

| Controls Version | Control                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.1 Establish and Maintain a Secure Configuration Process | \*   | \*   | \*   |
| v7               | 5.4 Deploy System Configuration Management Tools          |      | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations  |
| --------------------------- | -------------- | ------------ |
| T1133, T1195                | TA0001, TA0003 | M1016, M1042 |

## Profile

**Level 2** (Manual)
