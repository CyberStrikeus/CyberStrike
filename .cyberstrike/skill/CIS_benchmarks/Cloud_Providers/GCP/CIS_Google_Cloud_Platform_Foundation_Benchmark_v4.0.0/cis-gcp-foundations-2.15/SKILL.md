---
name: cis-gcp-foundations-2.15
description: "Ensure 'Access Approval' is 'Enabled'"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, logging, monitoring, access-transparency, access-approval, iam]
cis_id: "2.15"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.15 Ensure 'Access Approval' is 'Enabled' (Automated)

## Profile Applicability

- Level 2

## Description

GCP Access Approval enables you to require your organizations' explicit approval whenever Google support try to access your projects. You can then select users within your organization who can approve these requests through giving them a security role in IAM. All access requests display which Google Employee requested them in an email or Pub/Sub message that you can choose to Approve. This adds an additional control and logging of who in your organization approved/denied these requests.

## Rationale

Controlling access to your information is one of the foundations of information security. Google Employees do have access to your organizations' projects for support reasons. With Access Approval, organizations can then be certain that their information is accessed by only approved Google Personnel.

## Impact

To use Access Approval your organization will need have enabled Access Transparency and have at one of the following support level: Enhanced or Premium. There will be subscription costs associated with these support levels, as well as increased storage costs for storing the logs. You will also not be able to turn the Access Transparency which Access Approval depends on, off yourself. To do so you will need to submit a service request to Google Cloud Support. There will also be additional overhead in managing user permissions. There may also be a potential delay in support times as Google Personnel will have to wait for their access to be approved.

## Audit

### From Google Cloud Console

Determine if Access Transparency is Enabled as it is a Dependency:

1. From the Google Cloud Home inside the project you wish to audit, click on the Navigation hamburger menu in the top left. Hover over the `IAM & Admin` Menu. Select `settings` in the middle of the column that opens.
2. The status should be 'Enabled' under the heading `Access Transparency`.

Determine if Access Approval is Enabled:

1. From the Google Cloud Home, within the project you wish to check, click on the Navigation hamburger menu in the top left. Hover over the `Security` Menu. Select `Access Approval` in the middle of the column that opens.
2. The status will be displayed here. If you see a screen saying you need to enroll in Access Approval, it is not enabled.

### From Google Cloud CLI

Determine if Access Approval is Enabled:

1. From within the project you wish to audit, run the following command:

```bash
gcloud access-approval settings get
```

2. The status will be displayed in the output.

IF Access Approval is not enabled you should get this output:

```
API [accessapproval.googleapis.com] not enabled on project [-----]. Would you like to enable and retry (this will take a few minutes)? (y/N)?
```

After entering `Y` if you get the following output, it means that `Access Transparency` is not enabled:

```
ERROR: (gcloud.access-approval.settings.get) FAILED_PRECONDITION: Precondition check failed.
```

## Remediation

### From Google Cloud Console

1. From the Google Cloud Home, within the project you wish to enable, click on the Navigation hamburger menu in the top left. Hover over the `Security` Menu. Select `Access Approval` in the middle of the column that opens.
2. The status will be displayed here. On this screen, there is an option to click `Enroll`. If it is greyed out and you see an error bar at the top of the screen that says `Access Transparency is not enabled` please view the corresponding reference within this section to enable it.
3. In the second screen click `Enroll`.

Grant an IAM Group or User the role with permissions to Add Users to be Access Approval message Recipients:

1. From the Google Cloud Home, within the project you wish to enable, click on the Navigation hamburger menu in the top left. Hover over the `IAM and Admin`. Select `IAM` in the middle of the column that opens.
2. Click the blue button the says `+ ADD` at the top of the screen.
3. In the `principals` field, select a user or group by typing in their associated email address.
4. Click on the role field to expand it. In the filter field enter `Access Approval Approver` and select it.
5. Click `save`.

Add a Group or User as an Approver for Access Approval Requests:

1. As a user with the `Access Approval Approver` permission, within the project where you wish to add an email address to which request will be sent, click on the Navigation hamburger menu in the top left. Hover over the `Security` Menu. Select `Access Approval` in the middle of the column that opens.
2. Click `Manage Settings`.
3. Under `Set up approval notifications`, enter the email address associated with a Google Cloud User or Group you wish to send Access Approval requests to. All future access approvals will be sent as emails to this address.

### From Google Cloud CLI

1. To update all services in an entire project, run the following command from an account that has permissions as an 'Approver for Access Approval Requests':

```bash
gcloud access-approval settings update --project=<project name> --enrolled_services=all --notification_emails='<email recipient for access approval requests>@<domain name>'
```

## Default Value

By default Access Approval and its dependency of Access Transparency are not enabled.

## References

1. https://cloud.google.com/cloud-provider-access-management/access-approval/docs
2. https://cloud.google.com/cloud-provider-access-management/access-approval/docs/overview
3. https://cloud.google.com/cloud-provider-access-management/access-approval/docs/quickstart-custom-key
4. https://cloud.google.com/cloud-provider-access-management/access-approval/docs/supported-services
5. https://cloud.google.com/cloud-provider-access-management/access-approval/docs/view-historical-requests

## Additional Information

The recipients of Access Requests will also need to be logged into a Google Cloud account associated with an email address in this list. To approve requests they can click approve within the email. Or they can view requests at the Access Approval page within the Security submenu.

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |
