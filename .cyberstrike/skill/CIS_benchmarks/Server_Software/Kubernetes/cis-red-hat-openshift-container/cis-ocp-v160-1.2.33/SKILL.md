---
name: cis-ocp-v160-1.2.33
description: "Ensure unsupported configuration overrides are not used (Manual)"
category: cis-openshift
version: "1.6.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server, unsupported-config-overrides]
cis_id: "1.2.33"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.6.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.6.0 - Control 1.2.33

## Profile Applicability

- **Level:** 1

## Description

OpenShift supported an option called `unsupportedConfigOverrides` that allowed users to opt into unsupported behavior. This option is no longer supported by OpenShift and should not be used.

## Rationale

Users should stop using deprecated and unmaintained features in favor of supported features.

## Impact

None. The feature is set to `null` by default and isn't used by default.

## Audit Procedure

Make sure the `unsupportedConfigOverrides` in your deployment returns `null` using the following command:

```bash
oc get kubeapiserver/cluster -o jsonpath='{.spec.unsupportedConfigOverrides}'
```

The output should return `null`. Any other return value is a finding and you should migrate away from that particular configuration.

## Remediation

None.

## Default Value

By default, OpenShift sets this value to `null` and doesn't support overriding configuration with unsupported features.

## References

1. https://access.redhat.com/solutions/5170671

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 2.2 Ensure Authorized Software is Currently Supported | x    | x    | x    |
| v7               | 2.2 Ensure Software is Supported by Vendor            | x    | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1083, T1222                | TA0005, TA0007 | M1022       |

## Profile

**Level 1** (Manual)
