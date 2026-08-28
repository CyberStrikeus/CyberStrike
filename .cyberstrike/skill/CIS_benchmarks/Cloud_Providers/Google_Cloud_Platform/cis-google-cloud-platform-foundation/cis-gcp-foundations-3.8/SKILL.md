---
name: cis-gcp-foundations-3.8
description: "Ensure That VPC Flow Logs Is Enabled for Every Subnet in a VPC Network"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, networking, vpc, flow-logs]
cis_id: "3.8"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.8 Ensure that VPC Flow Logs is Enabled for Every Subnet in a VPC Network (Automated)

## Profile Applicability

- Level 2

## Description

Flow Logs is a feature that enables users to capture information about the IP traffic going to and from network interfaces in the organization's VPC Subnets. Once a flow log is created, the user can view and retrieve its data in Stackdriver Logging. It is recommended that Flow Logs be enabled for every business-critical VPC subnet.

## Rationale

VPC networks and subnetworks not reserved for internal HTTP(S) load balancing provide logically isolated and secure network partitions where GCP resources can be launched. When Flow Logs are enabled for a subnet, VMs within that subnet start reporting on all Transmission Control Protocol (TCP) and User Datagram Protocol (UDP) flows. Each VM samples the TCP and UDP flows it sees, inbound and outbound, whether the flow is to or from another VM, a host in the on-premises datacenter, a Google service, or a host on the Internet. If two GCP VMs are communicating, and both are in subnets that have VPC Flow Logs enabled, both VMs report the flows.

Flow Logs supports the following use cases:

- Network monitoring
- Understanding network usage and optimizing network traffic expenses
- Network forensics
- Real-time security analysis

Flow Logs provide visibility into network traffic for each VM inside the subnet and can be used to detect anomalous traffic or provide insight during security workflows.

The Flow Logs must be configured such that all network traffic is logged, the interval of logging is granular to provide detailed information on the connections, no logs are filtered, and metadata to facilitate investigations are included.

Note: Subnets reserved for use by internal HTTP(S) load balancers do not support VPC flow logs.

## Impact

Standard pricing for Stackdriver Logging, BigQuery, or Cloud Pub/Sub applies. VPC Flow Logs generation will be charged starting in GA as described in reference: https://cloud.google.com/vpc/

## Audit

### From Google Cloud Console

1. Go to the VPC network GCP Console visiting https://console.cloud.google.com/networking/networks/list
2. From the list of network subnets, make sure for each subnet:
   - `Flow Logs` is set to `On`
   - `Aggregation Interval` is set to `5 sec`
   - `Include metadata` checkbox is checked
   - `Sample rate` is set to `100%`

Note: It is not possible to determine if a Log filter has been defined from the console.

### From Google Cloud CLI

```bash
gcloud compute networks subnets list --format json | \
  jq -r
'(["Subnet","Purpose","Flow_Logs","Aggregation_Interval","Flow_Sampling","Metadata","Logs_Filtered"] | (., map(length*"-"))),
        (.[] |
            [
                .name,
                .purpose,
                (if has("enableFlowLogs") and .enableFlowLogs == true then "Enabled" else "Disabled" end),
                (if has("logConfig") then .logConfig.aggregationInterval else "N/A" end),
                (if has("logConfig") then .logConfig.flowSampling else "N/A" end),
                (if has("logConfig") then .logConfig.metadata else "N/A" end),
                (if has("logConfig") then (.logConfig | has("filterExpr")) else "N/A" end)
            ]
        ) |
        @tsv' | \
  column -t
```

The output of the above command will list:

- each subnet
- the subnet's purpose
- a `Enabled` or `Disabled` value if `Flow Logs` are enabled
- the value for `Aggregation Interval` or `N/A` if disabled, the value for `Flow Sampling` or `N/A` if disabled
- the value for `Metadata` or `N/A` if disabled
- 'true' or 'false' if a Logging Filter is configured or 'N/A' if disabled.

If the subnet's purpose is `PRIVATE` then `Flow Logs` should be `Enabled`.
If `Flow Logs` is enabled then:

- `Aggregation_Interval` should be `INTERVAL_5_SEC`
- `Flow_Sampling` should be 1
- `Metadata` should be `INCLUDE_ALL_METADATA`
- `Logs_Filtered` should be `false`.

## Remediation

### From Google Cloud Console

1. Go to the VPC network GCP Console visiting https://console.cloud.google.com/networking/networks/list
2. Click the name of a subnet, The `Subnet details` page displays.
3. Click the `EDIT` button.
4. Set `Flow Logs` to `On`.
5. Expand the `Configure Logs` section.
6. Set `Aggregation Interval` to `5 SEC`.
7. Check the box beside `Include metadata`.
8. Set `Sample rate` to `100`.
9. Click Save.

Note: It is not possible to configure a Log filter from the console.

### From Google Cloud CLI

To enable VPC Flow Logs for a network subnet, run the following command:

```bash
gcloud compute networks subnets update [SUBNET_NAME] --region [REGION] --enable-flow-logs --logging-aggregation-interval=interval-5-sec --logging-flow-sampling=1 --logging-metadata=include-all
```

## Default Value

By default, Flow Logs is set to Off when a new VPC network subnet is created.

## References

1. https://cloud.google.com/vpc/docs/using-flow-logs#enabling_vpc_flow_logging
2. https://cloud.google.com/vpc/

## CIS Controls

| Controls Version | Control                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 8.2 Collect Audit Logs                                        | x    | x    | x    |
| v8               | 13.6 Collect Network Traffic Flow Logs                        |      | x    | x    |
| v7               | 6.2 Activate audit logging                                    | x    | x    | x    |
| v7               | 12.8 Deploy NetFlow Collection on Networking Boundary Devices |      | x    | x    |
