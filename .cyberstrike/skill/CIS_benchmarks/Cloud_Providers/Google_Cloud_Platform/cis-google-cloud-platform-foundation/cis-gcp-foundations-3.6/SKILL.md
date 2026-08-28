---
name: cis-gcp-foundations-3.6
description: "Ensure That SSH Access Is Restricted From the Internet"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, networking, firewall, ssh, vpc]
cis_id: "3.6"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.6 Ensure That SSH Access Is Restricted From the Internet (Automated)

## Profile Applicability

- Level 2

## Description

GCP `Firewall Rules` are specific to a `VPC Network`. Each rule either `allows` or `denies` traffic when its conditions are met. Its conditions allow the user to specify the type of traffic, such as ports and protocols, and the source or destination of the traffic, including IP addresses, subnets, and instances.

Firewall rules are defined at the VPC network level and are specific to the network in which they are defined. The rules themselves cannot be shared among networks. Firewall rules only support IPv4 traffic. When specifying a source for an ingress rule or a destination for an egress rule by address, only an `IPv4` address or `IPv4 block in CIDR` notation can be used. Generic `(0.0.0.0/0)` incoming traffic from the internet to VPC or VM instance using `SSH` on `Port 22` can be avoided.

## Rationale

GCP `Firewall Rules` within a `VPC Network` apply to outgoing (egress) traffic from instances and incoming (ingress) traffic to instances in the network. Egress and ingress traffic flows are controlled even if the traffic stays within the network (for example, instance-to-instance communication). For an instance to have outgoing Internet access, the network must have a valid Internet gateway route or custom route whose destination IP is specified. This route simply defines the path to the Internet, to avoid the most general `(0.0.0.0/0)` destination `IP Range` specified from the Internet through `SSH` with the default `Port 22`. Generic access from the Internet to a specific IP Range needs to be restricted.

## Impact

All Secure Shell (SSH) connections from outside of the network to the concerned VPC(s) will be blocked. There could be a business need where SSH access is required from outside of the network to access resources associated with the VPC. In that case, specific source IP(s) should be mentioned in firewall rules to white-list access to SSH port for the concerned VPC(s).

## Audit

### From Google Cloud Console

1. Go to `VPC network`.
2. Go to the `Firewall Rules`.
3. Ensure that `Port` is not equal to `22` and `Action` is not set to `Allow`.
4. Ensure `IP Ranges` is not equal to `0.0.0.0/0` under `Source filters`.

### From Google Cloud CLI

```bash
gcloud compute firewall-rules list --format=table'(name,direction,sourceRanges,allowed)'
```

Ensure that there is no rule matching the below criteria:

- `SOURCE_RANGES` is `0.0.0.0/0`
- AND `DIRECTION` is `INGRESS`
- AND IPProtocol is `tcp` or `ALL`
- AND `PORTS` is set to `22` or `range containing 22` or `Null (not set)`

**Note:**

- When ALL TCP ports are allowed in a rule, PORT does not have any value set (`NULL`)
- When ALL Protocols are allowed in a rule, PORT does not have any value set (`NULL`)

## Remediation

### From Google Cloud Console

1. Go to `VPC Network`.
2. Go to the `Firewall Rules`.
3. Click the `Firewall Rule` you want to modify.
4. Click `Edit`.
5. Modify `Source IP ranges` to specific `IP`.
6. Click `Save`.

### From Google Cloud CLI

1. Update the Firewall rule with the new `SOURCE_RANGE` from the below command:

```bash
gcloud compute firewall-rules update FirewallName --allow=[PROTOCOL[:PORT[-PORT]],...] --source-ranges=[CIDR_RANGE,...]
```

## References

1. https://cloud.google.com/vpc/docs/firewalls#blockedtraffic
2. https://cloud.google.com/blog/products/identity-security/cloud-iap-enables-context-aware-access-to-vms-via-ssh-and-rdp-without-bastion-hosts

## Additional Information

Currently, GCP VPC only supports IPV4; however, Google is already working on adding IPV6 support for VPC. In that case along with source IP range `0.0.0.0`, the rule should be checked for IPv6 equivalent `::/0` as well.

## CIS Controls

| Controls Version | Control                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 4.4 Implement and Manage a Firewall on Servers                     | x    | x    | x    |
| v8               | 4.5 Implement and Manage a Firewall on End-User Devices            | x    | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running |      | x    | x    |
| v7               | 12.4 Deny Communication over Unauthorized Ports                    | x    | x    | x    |
