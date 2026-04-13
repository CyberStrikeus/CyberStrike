---
name: cis-gcp-foundations-1.16
description: "Ensure Essential Contacts is Configured for Organization"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, iam, contacts]
cis_id: "1.16"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.16 Ensure Essential Contacts is Configured for Organization (Automated)

## Profile Applicability

- Level 1

## Description

It is recommended that Essential Contacts is configured to designate email addresses for Google Cloud services to notify of important technical or security information.

## Rationale

Many Google Cloud services, such as Cloud Billing, send out notifications to share important information with Google Cloud users. By default, these notifications are sent to members with certain Identity and Access Management (IAM) roles. With Essential Contacts, you can customize who receives notifications by providing your own list of contacts.

## Impact

There is no charge for Essential Contacts except for the 'Technical Incidents' category that is only available to premium support customers.

## Audit Procedure

### From Google Cloud Console

1. Go to `Essential Contacts` by visiting https://console.cloud.google.com/iam-admin/essential-contacts
2. Make sure the organization appears in the resource selector at the top of the page. The resource selector tells you what project, folder, or organization you are currently managing contacts for.
3. Ensure that appropriate email addresses are configured for each of the following notification categories:
   - `Legal`
   - `Security`
   - `Suspension`
   - `Technical`

Alternatively, appropriate email addresses can be configured for the `All` notification category to receive all possible important notifications.

### From Google Cloud CLI

1. To list all configured organization Essential Contacts run a command:

```bash
gcloud essential-contacts list --organization=<ORGANIZATION_ID>
```

2. Ensure at least one appropriate email address is configured for each of the following notification categories:
   - `LEGAL`
   - `SECURITY`
   - `SUSPENSION`
   - `TECHNICAL`

Alternatively, appropriate email addresses can be configured for the `ALL` notification category to receive all possible important notifications.

## Expected Result

At least one contact should be configured for each of the following notification categories: `LEGAL`, `SECURITY`, `SUSPENSION`, and `TECHNICAL` (or the `ALL` category should be configured).

## Remediation

### From Google Cloud Console

1. Go to `Essential Contacts` by visiting https://console.cloud.google.com/iam-admin/essential-contacts
2. Make sure the organization appears in the resource selector at the top of the page. The resource selector tells you what project, folder, or organization you are currently managing contacts for.
3. Click `+Add contact`.
4. In the `Email` and `Confirm Email` fields, enter the email address of the contact.
5. From the `Notification categories` drop-down menu, select the notification categories that you want the contact to receive communications for.
6. Click `Save`.

### From Google Cloud CLI

1. To add an organization Essential Contacts run a command:

```bash
gcloud essential-contacts create --email="<EMAIL>" \
  --notification-categories="<NOTIFICATION_CATEGORIES>" \
  --organization=<ORGANIZATION_ID>
```

## Default Value

By default, there are no Essential Contacts configured.

In the absence of an Essential Contact, the following IAM roles are used to identify users to notify for the following categories:

- Legal: `roles/billing.admin`
- Security: `roles/resourcemanager.organizationAdmin`
- Suspension: `roles/owner`
- Technical: `roles/owner`
- Technical Incidents: `roles/owner`

## References

1. https://cloud.google.com/resource-manager/docs/managing-notification-contacts

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 17.2 Establish and Maintain Contact Information for Reporting Security Incidents | x | x | x |
| v7 | 19.5 Maintain Contact Information For Reporting Security Incidents | x | x | x |
