---
name: cis-gcp-foundations-4.6
description: "Ensure That IP Forwarding Is Not Enabled on Instances"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, compute, virtual-machines, service-accounts]
cis_id: "4.6"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.6 Ensure That IP Forwarding Is Not Enabled on Instances (Automated)

## Profile Applicability

- Level 1

## Description

Compute Engine instance cannot forward a packet unless the source IP address of the packet matches the IP address of the instance. Similarly, GCP won't deliver a packet whose destination IP address is different than the IP address of the instance receiving the packet. However, both capabilities are required if you want to use instances to help route packets.

Forwarding of data packets should be disabled to prevent data loss or information disclosure.

## Rationale

Compute Engine instance cannot forward a packet unless the source IP address of the packet matches the IP address of the instance. Similarly, GCP won't deliver a packet whose destination IP address is different than the IP address of the instance receiving the packet. However, both capabilities are required if you want to use instances to help route packets. To enable this source and destination IP check, disable the `canIpForward` field, which allows an instance to send and receive packets with non-matching destination or source IPs.

## Audit

### From Google Cloud Console

1. Go to the `VM Instances` page by visiting: https://console.cloud.google.com/compute/instances.
2. For every instance, click on its name to go to the `VM instance details` page.
3. Under the `Network interfaces` section, ensure that `IP forwarding` is set to `Off` for every network interface.

### From Google Cloud CLI

1. List all instances:

```
gcloud compute instances list --format='table(name,canIpForward)'
```

2. Ensure that `CAN_IP_FORWARD` column in the output of above command does not contain `True` for any VM instance.

## Exception

Instances created by GKE should be excluded because they need to have IP forwarding enabled and cannot be changed. Instances created by GKE have names that start with "gke-".

## Remediation

You only edit the `canIpForward` setting at instance creation or using CLI.

### From Google Cloud CLI

1. Use the instances export command to export the existing instance properties:

```
gcloud compute instances export <INSTANCE_NAME> \
    --project <PROJECT_ID> \
    --zone <ZONE> \
    --destination=<FILE_PATH>
```

Note: Replace the following:
- INSTANCE_NAME the name for the instance that you want to export.
- PROJECT_ID: the project ID for this request.
- ZONE: the zone for this instance.
- FILE_PATH: the output path where you want to save the instance configuration file on your local workstation.

2. Use a text editor to modify this file. Replace `canIpForward: true` with `canIpForward: false`.

3. Run this command to import the file you just modified:

```
gcloud compute instances update-from-file INSTANCE_NAME \
    --project PROJECT_ID \
    --zone ZONE \
    --source=FILE_PATH \
    --most-disruptive-allowed-action=REFRESH
```

If the update request is valid and the required resources are available, the instance update process begins. You can monitor the status of this operation by viewing the audit logs. This update requires only a REFRESH not a full restart.

## Default Value

By default, instances are not configured to allow IP forwarding.

## References

1. https://cloud.google.com/vpc/docs/using-routes#canipforward
2. https://cloud.google.com/compute/docs/instances/update-instance-properties

## Additional Information

You can only set the `canIpForward` field at instance creation time or using CLI.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.4 Implement and Manage a Firewall on Servers | X | X | X |
| v8 | 4.5 Implement and Manage a Firewall on End-User Devices | X | X | X |
| v7 | 11.1 Maintain Standard Security Configurations for Network Devices | | X | X |
| v7 | 11.2 Document Traffic Configuration Rules | | X | X |
