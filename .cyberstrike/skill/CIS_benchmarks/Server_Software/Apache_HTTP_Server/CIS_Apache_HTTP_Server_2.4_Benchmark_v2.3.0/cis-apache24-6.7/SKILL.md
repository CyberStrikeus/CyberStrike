---
name: cis-apache24-6.7
description: "Ensure the OWASP ModSecurity Core Rule Set Is Installed and Enabled"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, logging, monitoring, maintenance, modsecurity]
cis_id: "6.7"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the OWASP ModSecurity Core Rule Set Is Installed and Enabled (Manual)

## Profile Applicability

Level 2

## Description

The OWASP ModSecurity Core Rules Set (CRS) is a set of open source web application defensive rules for the ModSecurity web application firewall (WAF). The OWASP ModSecurity CRS provides baseline protections in the following attack/threat categories:

- HTTP Protection - detecting violations of the HTTP protocol and a locally defined usage policy.
- Real-time Blacklist Lookups - utilizes 3rd Party IP Reputation
- HTTP Denial of Service Protections - defense against HTTP Flooding and Slow HTTP DoS Attacks.
- Common Web Attacks Protection - detecting common web application security attack.
- Automation Detection - detecting bots, crawlers, scanners and other surface malicious activity.
- Integration with AV Scanning for File Uploads - detects malicious files uploaded through the web application.
- Tracking Sensitive Data - tracks credit card usage and blocks leakages.
- Trojan Protection - detecting access to trojan horses.
- Identification of Application Defects - alerts on application misconfigurations.
- Error Detection and Hiding - disguising error messages sent by the server.

**Note:** Like other application security/application firewall systems, ModSecurity requires a significant commitment of staff resources for initial tuning of the rules and handling alerts. In some cases, this may require additional time working with application developers/maintainers to modify applications based on analysis of the results of tuning and monitoring logs. After setup, an ongoing commitment of staff is required for monitoring logs and ongoing tuning, especially after upgrades/patches. Without this commitment to tuning and monitoring, installing ModSecurity may NOT be effective and may provide a false sense of security.

## Rationale

Installing, configuring and enabling of the OWASP ModSecurity Core Rule Set (CRS), provides additional baseline security defense, and provides a good starting point to customize the monitoring and blocking of common web application attacks.

## Audit Procedure

For the **OWASP ModSecurity CRS version 2.2.9**, perform the following to audit the configuration.

In the 2.2.9 release, the OWASP ModSecurity CRS contains 15 base_rule configuration files, each with rule sets. The CRS also contains 14 optional rule sets, and 17 experimental rule sets. Since it is expected that customization and testing will be necessary to implement the CRS, it is not expected that any site will implement all CRS configuration files / rule sets. Therefore, for the purpose of auditing, the OWASP ModSecurity CRS will be considered implemented if 200 or more of the security rules (SecRule) are active in the CRS configuration files. The default 2.2.9 installation contains 227 security rules. Perform the following to determine if 2.2.9 OWASP ModSecurity CRS is enabled:

- Set RULE_DIR environment variable to the directory where the active rules are included from the modsecurity configuration file. An example is shown below.
  ```
  RULE_DIR=$APACHE_PREFIX/modsecurity.d/activated_rules/
  ```

- Use the following command to count the security rules in all of the active CRS configuration files.
  ```
  find $APACHE_PREFIX/modsecurity.d/activated_rules/ -name 'modsecurity_crs_*.conf' | xargs grep '^SecRule ' | wc -l
  ```

- If the number of active rules is 200 or greater, then OWASP ModSecurity CRS is considered active and the audit passed.

For the **OWASP ModSecurity CRS version 3.0**, perform the following to audit the configuration.

In the 3.0 release, the OWASP ModSecurity CRS contains 29 rule configuration files, each with rule sets. It is expected that customization and testing will be necessary to implement the CRS; it is not expected that any site will implement all CRS configuration files / rule sets. Therefore, for the purpose of auditing, the OWASP ModSecurity CRS v3.0 will be considered implemented if 325 or more of the security rules (SecRule) are active in the CRS configuration files. The default 3.0 installation contains 462 security rules. In addition to the rules, there are three additional values that have to be set. The Inbound and the Outbound Anomaly Threshold and the Paranoia Mode. The Anomaly Threshold values set a limit so that traffic is not blocked until the threshold is exceeded. Any traffic that triggers enough active rules so that the additive value of each rule exceeds the threshold value will be block. The suitable paranoia level has to be defined according the security level of the service in question. The default value of 1 should be applicable for any online service. The Paranoia Level 2 should be chosen for online services with a need for further hardening, (such as online services with a wide attack surface or online services with known security issues and concerns). Paranoia Level 3 and Level 4 cater services with even higher security requirements but have to be considered experimental.

Perform the following to determine if OWASP ModSecurity CRS 3.0 is enabled, and is configured to meet or exceed the expected values:

- Set RULE_DIR environment variable to the directory where the active rules are included from the modsecurity configuration file. An example is shown below.
  ```
  RULE_DIR=$APACHE_PREFIX/modsecurity.d/owasp-modsecurity-crs-3.0.0/
  ```

- Use the following command to count the security rules in all of the active CRS configuration files.
  ```
  find $RULE_DIR -name '*.conf' | xargs grep -v '^#\s*' | grep 'SecRule ' | wc -l
  ```

- If the number of active rules is 325 or greater then OWASP ModSecurity CRS 3.0 is considered active.

- The Inbound Anomaly Threshold must be less than or equal to 5, and can be checked with the following command.
  ```
  find $RULE_DIR -name '*.conf' | xargs egrep -v '^\s*#' | grep 'setvar:tx.inbound_anomaly_score_threshold'
  ```

- The Outbound Anomaly Threshold must be less than or equal to 4, and may be audited with the following command.
  ```
  find $RULE_DIR -name '*.conf' | xargs egrep -v '^\s*#' | grep 'setvar:tx.outbound_anomaly_score_threshold'
  ```

- The Paranoia Level must be greater than or equal to 1, and may be audited with the following command.
  ```
  find $RULE_DIR -name '*.conf' | xargs egrep -v '^\s*#' | grep 'setvar:tx.paranoia_level'
  ```

## Remediation

Install, configure and test the OWASP ModSecurity Core Rule Set:

1. Download the OWASP ModSecurity CRS from the project page https://www.owasp.org/index.php/Category:OWASP_ModSecurity_Core_Rule_Set_Project

2. Unbundled the archive and follow the instructions in the INSTALL file.

3. Depending on the CRS version used, the crs-setup.conf or the modsecurity_crs_10_setup.conf file will be required, and rules in the base_rules directory are intended as a baseline useful for most applications.

4. Test the application for correct functionality after installing the CRS. Check web server error logs and the modsec_audit.log file for blocked requests due to false positives.

5. It is also recommended to test the application response to malicious traffic such as an automated web application scanner to ensure the rules are active. The web server error log and modsec_audit.log files should show logs of the attacks and the servers response codes.

## Default Value

The OWASP ModSecurity CRS is NOT installed or enabled by default.

CRS v3.0 Default Values:

- inbound_anomaly_score_threshold = 5
- outbound_anomaly_score_threshold = 4
- paranoia_level = 1

## References

1. https://www.owasp.org/index.php/Category:OWASP_ModSecurity_Core_Rule_Set_Project
2. https://www.modsecurity.org/

## CIS Controls

**v8:**
- 4.4 Implement and Manage a Firewall on Servers
- 9.5 Implement Application Firewalls
- 18.10 Deploy Web Application Firewalls (WAFs)

**v7:**
- 18.10 Deploy Web Application Firewalls (WAFs)
