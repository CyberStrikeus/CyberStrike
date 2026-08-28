---
name: cis-aws-euc-5.7
description: "Ensure Operating system updates are applied to your base image every 30 days"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, appstream, patch-management, image-management]
cis_id: "5.7"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: [CWE-1357]
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Operating system updates are applied to your base image every 30 days (Manual)

## Profile Applicability

- Level 1

## Description

To ensure that your fleet instances have the latest Windows updates installed, we recommend that you install Windows updates on your image builder, create a new image, and then update your fleet with the new image once a month.

## Rationale

All fleet instances used in user streaming sessions have only the Windows and application updates that were installed on the underlying image when it was created. In addition, any updates made to Windows or to applications on the instance during the streaming session will not persist to future sessions by the same user or other users.

## Impact

None - this is a security best practice.

## Audit Procedure

Perform the following steps to review the Image date.

### Using AWS Console

1. Log in to the AppStream 2.0 console at `https://console.aws.amazon.com/appstream2`
2. In the left pane click on **Images**
3. Select the **Image Builder** tab
4. Select the link for the Image builder name you wish to view
5. In the **Image builder details** tab review the **Created at date** and the **AppStream agent version**

If the created at date is over 30 days old refer to the remediation below.

### Using AWS CLI

Not applicable - must be audited via Console.

## Expected Result

AppStream image builder is less than 30 days old.

## Remediation

### Using AWS Console

Perform the steps below to create an image and update it:

1. Log in to the AppStream 2.0 console at `https://console.aws.amazon.com/appstream2`
2. Click **Images** in the left pane, then Click the **Image Builder** tab, and Click **Launch Image Builder**
3. Choose a base image. The latest base images released by AWS is recommended and selected by default
4. Click **Next**
5. Configure **Image Builder**, by doing the following:
   - **Name:** Type a unique name identifier for the image builder
   - **Display name (optional):** Type a name to display for the image builder (maximum of 100 characters)
   - **Tags (optional):** Choose Add Tag, and type the key and value for the tag. To add more tags, repeat this step
   - **Instance Type:** Select the instance type for the image builder
   - **Network Access Points (Optional):** You can create a private link, which is an interface VPC endpoint (interface endpoint), in your virtual private cloud (VPC). To start creating the interface endpoint, select **Create PrivateLink**
   - After you create the interface endpoint, you can use it to keep streaming traffic within your VPC
   - **AppStream 2.0 Agent:** This section displays only if you are not using the latest version of the agent
   - If you are not using the latest AppStream 2.0 agent always select the option to launch your image builder with the latest agent
   - **IAM role (Advanced):** Use existing or create a new IAM role
6. Click **Next**
7. Configure Network, do the following:
   - Leave **Default Internet Access** unselected
   - For **VPC and Subnet 1**, choose a VPC and two subnets in different Availability Zones
   - For **Security group(s)**, choose up to five security groups to associate with this image builder
   - For **Active Directory Domain (Optional)**, expand this section to choose the Active Directory configuration and organizational unit in which to place your streaming instance computer objects. Ensure that the selected network access settings enable DNS resolvability and communication with your directory
   - **Choose Review** and confirm the details for the image builder
8. Click **Launch**
9. **Next Steps**

Install Operating system updates and install, configure and update your applications for streaming, and then create an image by creating a snapshot of the image builder instance.

### Using AWS CLI

Not applicable - must be configured via Console.

## Default Value

By default, Windows Operating systems are set to update automatically utilizing Windows update services. Linux operating systems do not update automatically by default.

## References

1. https://docs.aws.amazon.com/appstream2/latest/developerguide/tutorial-image-builder.html#tutorial-image-builder-install
2. https://docs.aws.amazon.com/appstream2/latest/developerguide/programmatically-create-image.html
3. https://docs.aws.amazon.com/appstream2/latest/developerguide/managing-image-builders.html

## CIS Controls

**v8:**

- 4.1 Establish and Maintain a Secure Configuration Process
  - Establish and maintain a secure configuration process for enterprise assets (end-user devices, including portable and mobile, non-computing/IoT devices, and servers) and software (operating systems and applications). Review and update documentation annually, or when significant enterprise changes occur that could impact this Safeguard.

**v7:**

- 5.1 Establish Secure Configurations
  - Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile

Level 1
