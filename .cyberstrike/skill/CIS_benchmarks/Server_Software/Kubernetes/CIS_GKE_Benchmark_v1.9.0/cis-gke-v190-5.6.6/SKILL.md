---
name: cis-gke-v190-5.6.6
description: "Consider firewalling GKE worker nodes (Manual)"
category: cis-gke
version: "1.9.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, networking, firewall, worker-nodes, ingress, egress]
cis_id: "5.6.6"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.9.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.6.6 Consider firewalling GKE worker nodes (Manual)

## Profile Applicability

- Level 2

## Description

Reduce the network attack surface of GKE nodes by using Firewalls to restrict ingress and egress traffic.

## Rationale

Utilizing stringent ingress and egress firewall rules minimizes the ports and services exposed to an network-based attacker, whilst also restricting egress routes within or out of the cluster in the event that a compromised component attempts to form an outbound connection.

## Impact

All instances targeted by a firewall rule, either using a tag or a service account will be affected. Ensure there are no adverse effects on other instances using the target tag or service account before implementing the firewall rule.

## Audit

**Using Google Cloud Console:**

1. Go to Compute Engine by visiting: https://console.cloud.google.com/compute/instances.
2. For each instance within your cluster, use the 'more actions' menu (3 vertical dots) and select to 'View network details'.
3. If there are multiple network interfaces attached to the instance, select the network interface to view in the 'Network interface' details section and see all the rules that apply to the network interface, within the 'Firewall rules' tab. Make sure the firewall rules are appropriate for your environment.

**Using Command Line:**

For the instance being evaluated, obtain its Service account and tags:

```bash
gcloud compute instances describe <instance_name> --zone <compute_zone> --format json | jq '{tags: .tags.items[], serviceaccount:.serviceAccounts[].email, network: .networkInterfaces[].network}'
```

This will return:

```json
{
  "tags": "<tag>",
  "serviceaccount": "<service_account>"
  "network": "https://www.googleapis.com/compute/v1/projects/<project_id>/global/networks/<network>"
}
```

Then, observe the firewall rules applied to the instance by using the following command, replacing `<tag>` and `<service_account>` as appropriate:

```bash
gcloud compute firewall-rules list \
  --format="table(
              name,
              network,
              direction,
              priority,
              sourceRanges.list():label=SRC_RANGES,
              destinationRanges.list():label=DEST_RANGES,
              allowed[].map().firewall_rule().list():label=ALLOW,
              denied[].map().firewall_rule().list():label=DENY,
              sourceTags.list():label=SRC_TAGS,
              sourceServiceAccounts.list():label=SRC_SVC_ACCT,
              targetTags.list():label=TARGET_TAGS,
              targetServiceAccounts.list():label=TARGET_SVC_ACCT,
              disabled
            )" \
  --filter="targetTags.list():<tag> OR targetServiceAccounts.list():<service_account>"
```

Firewall rules may also be applied to a network without specifically targeting Tags or Service Accounts. These can be observed using the following, replacing `<network>` as appropriate:

```bash
gcloud compute firewall-rules list \
  --format="table(
              name,
              network,
              direction,
              priority,
              sourceRanges.list():label=SRC_RANGES,
              destinationRanges.list():label=DEST_RANGES,
              allowed[].map().firewall_rule().list():label=ALLOW,
              denied[].map().firewall_rule().list():label=DENY,
              sourceTags.list():label=SRC_TAGS,
              sourceServiceAccounts.list():label=SRC_SVC_ACCT,
              targetTags.list():label=TARGET_TAGS,
              targetServiceAccounts.list():label=TARGET_SVC_ACCT,
              disabled
            )" \
  --filter="network.list():<network> AND -targetTags.list():* AND -targetServiceAccounts.list():*"
```

## Remediation

**Using Google Cloud Console:**

1. Go to Firewall Rules by visiting: https://console.cloud.google.com/networking/firewalls/list
2. Click CREATE FIREWALL RULE.
3. Configure the firewall rule as required. Ensure the firewall targets the nodes correctly, either selecting the nodes using tags (under Targets, select Specified target tags, and set Target tags to `<tag>`), or using the Service account associated with node (under Targets, select Specified service account, set Service account scope as appropriate, and Target service account to `<service_account>`).
4. Click `CREATE`.

**Using Command Line:**

Use the following command to generate firewall rules, setting the variables as appropriate:

```bash
gcloud compute firewall-rules create <firewall_rule_name> --network <network> --priority <priority> --direction <direction> --action <action> --target-tags <tag> --target-service-accounts <service_account> --source-ranges <source_cidr_range> --source-tags <source_tags> --source-service-accounts <source_service_account> --destination-ranges <destination_cidr_range> --rules <rules>
```

## Default Value

Every VPC network has two implied firewall rules. These rules exist, but are not shown in the Cloud Console:

- The implied allow egress rule: An egress rule whose action is `allow`, destination is `0.0.0.0/0`, and priority is the lowest possible (`65535`) lets any instance send traffic to any destination, except for traffic blocked by GCP. Outbound access may be restricted by a higher priority firewall rule. Internet access is allowed if no other firewall rules deny outbound traffic and if the instance has an external IP address or uses a NAT instance.
- The implied deny ingress rule: An ingress rule whose action is `deny`, source is `0.0.0.0/0`, and priority is the lowest possible (`65535`) protects all instances by blocking incoming traffic to them. Incoming access may be allowed by a higher priority rule. Note that the default network includes some additional rules that override this one, allowing certain types of incoming traffic.

The implied rules cannot be removed, but they have the lowest possible priorities.

## References

1. https://cloud.google.com/kubernetes-engine/docs/concepts/cluster-architecture
2. https://cloud.google.com/vpc/docs/using-firewalls

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.4 Implement and Manage a Firewall on Servers | x | x | x |
| v7 | 9.5 Implement Application Firewalls | | | x |
