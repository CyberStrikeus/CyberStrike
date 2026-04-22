# CIS Apache Cassandra 4.0 Benchmark v1.1.0

This directory contains **20 SKILL.md files** covering all controls from the CIS Apache Cassandra 4.0 Benchmark v1.1.0 (released 08-29-2024).

## Directory Structure

Each control is in its own directory following the naming convention: `cis-cassandra40-v110-{control_id}/SKILL.md`

## Controls by Section

### Section 1: Installation and Updates (6 controls)

- **1.1** - Ensure a separate user and group exist for Cassandra (Manual)
- **1.2** - Ensure the latest version of Java is installed (Automated)
- **1.3** - Ensure the latest version of Python is installed (Automated)
- **1.4** - Ensure latest version of Cassandra is installed (Automated)
- **1.5** - Ensure the Cassandra service is run as a non-root user (Automated)
- **1.6** - Ensure clocks are synchronized on all nodes (Manual)

### Section 2: Authentication and Authorization (2 controls)

- **2.1** - Ensure that authentication is enabled for Cassandra databases (Automated)
- **2.2** - Ensure that authorization is enabled for Cassandra databases (Automated)

### Section 3: Access Control / Password Policies (8 controls)

- **3.1** - Ensure the cassandra and superuser roles are separate (Automated)
- **3.2** - Ensure that the default password is changed for the cassandra role (Automated)
- **3.3** - Ensure there are no unnecessary roles or excessive privileges (Manual)
- **3.4** - Ensure that Cassandra is run using a non-privileged, dedicated service account (Automated)
- **3.5** - Ensure that Cassandra only listens for network connections on authorized interfaces (Manual)
- **3.6** - Ensure that Data Center Authorizations is activated (Manual)
- **3.7** - Review User-Defined Roles (Manual)
- **3.8** - Review Superuser/Admin Roles (Manual)

### Section 4: Auditing and Logging (2 controls)

- **4.1** - Ensure that logging is enabled (Automated)
- **4.2** - Ensure that auditing is enabled (Manual)

### Section 5: Encryption (2 controls)

- **5.1** - Inter-node Encryption (Automated)
- **5.2** - Client Encryption (Automated)

## Profile Breakdown

- **Level 1 - Cassandra on Linux:** All 20 controls
- **Automated:** 12 controls
- **Manual:** 8 controls

## Tags Used

### By Section

- **Section 1:** installation, updates, java, python, users, groups, ntp, time-sync
- **Section 2:** authentication, authorization, access-control
- **Section 3:** access-control, roles, privileges, passwords, default-credentials, least-privilege, service-account, network, interfaces, datacenter, superuser, admin, review
- **Section 4:** auditing, logging
- **Section 5:** encryption, tls, ssl, internode, client

## CIS Controls Mapping

All controls are mapped to relevant CIS Controls v7 and v8 Implementation Groups (IG1, IG2, IG3).

## File Format

Each SKILL.md file contains:

- YAML frontmatter with metadata (name, description, category, version, tags, CIS ID, etc.)
- Profile Applicability
- Description
- Rationale
- Audit procedures (with commands)
- Remediation steps (with commands)
- Default Value
- References
- CIS Controls mapping
- Profile level (Level 1/2 | Automated/Manual)

## Usage

These skills can be used with the CyberStrike platform to perform automated security assessments of Apache Cassandra 4.0 installations against CIS Benchmark requirements.

## Author

cyberstrike-official

## Version

1.1.0 (aligned with CIS Apache Cassandra 4.0 Benchmark v1.1.0 - 08-29-2024)
