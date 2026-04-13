---
name: cis-gcp-foundations-4.9
description: "Ensure That Compute Instances Do Not Have Public IP Addresses"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, compute, virtual-machines, service-accounts]
cis_id: "4.9"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.9 Ensure That Compute Instances Do Not Have Public IP Addresses (Automated)

## Profile Applicability

- Level 2

## Description

Compute instances should not be configured to have external IP addresses.

## Rationale

To reduce your attack surface, Compute instances should not have public IP addresses. Instead, instances should be configured behind load balancers, to minimize the instance's exposure to the internet.

## Impact

Removing the external IP address from your Compute instance may cause some applications to stop working.

## Audit

### From Google Cloud Console

1. Go to the `VM instances` page by visiting: https://console.cloud.google.com/compute/instances.
2. For every VM, ensure that there is no `External IP` configured.

### From Google Cloud CLI

```
gcloud compute instances list --format=json
```

1. The output should not contain an `accessConfigs` section under `networkInterfaces`. Note that the `natIP` value is present only for instances that are running or for instances that are stopped but have a static IP address. For instances that are stopped and are configured to have an ephemeral public IP address, the `natIP` field will not be present. Example output:

```yaml
networkInterfaces:
- accessConfigs:
  - kind: compute#accessConfig
    name: External NAT
    networkTier: STANDARD
    type: ONE_TO_ONE_NAT
```

## Exception

Instances created by GKE should be excluded because some of them have external IP addresses and cannot be changed by editing the instance settings. Instances created by GKE should be excluded. These instances have names that start with "gke-" and are labeled "goog-gke-node".

## Remediation

### From Google Cloud Console

1. Go to the `VM instances` page by visiting: https://console.cloud.google.com/compute/instances.
2. Click on the instance name to go the the `Instance detail page`.
3. Click `Edit`.
4. For each Network interface, ensure that `External IP` is set to `None`.
5. Click `Done` and then click `Save`.

### From Google Cloud CLI

1. Describe the instance properties:

```
gcloud compute instances describe <INSTANCE_NAME> --zone=<ZONE>
```

2. Identify the access config name that contains the external IP address. This access config appears in the following format:

```yaml
networkInterfaces:
- accessConfigs:
  - kind: compute#accessConfig
    name: External NAT
    natIP: 130.211.181.55
    type: ONE_TO_ONE_NAT
```

3. Delete the access config:

```
gcloud compute instances delete-access-config <INSTANCE_NAME> --zone=<ZONE> --access-config-name <ACCESS_CONFIG_NAME>
```

In the above example, the `ACCESS_CONFIG_NAME` is `External NAT`. The name of your access config might be different.

## Prevention

You can configure the `Define allowed external IPs for VM instances` Organization Policy to prevent VMs from being configured with public IP addresses. Learn more at: https://console.cloud.google.com/orgpolicies/compute-vmExternalIpAccess.

## Default Value

By default, Compute instances have a public IP address.

## References

1. https://cloud.google.com/load-balancing/docs/backend-service#backends_and_external_ip_addresses
2. https://cloud.google.com/compute/docs/instances/connecting-advanced#sshbetweeninstances
3. https://cloud.google.com/compute/docs/instances/connecting-to-instance
4. https://cloud.google.com/compute/docs/ip-addresses/reserve-static-external-ip-address#unassign_ip
5. https://cloud.google.com/resource-manager/docs/organization-policy/org-policy-constraints

## Additional Information

You can connect to Linux VMs that do not have public IP addresses by using Identity-Aware Proxy for TCP forwarding. Learn more at https://cloud.google.com/compute/docs/instances/connecting-advanced#sshbetweeninstances.

For Windows VMs, see https://cloud.google.com/compute/docs/instances/connecting-to-instance.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | X | X | X |
| v7 | 14.6 Protect Information through Access Control Lists | X | X | X |
