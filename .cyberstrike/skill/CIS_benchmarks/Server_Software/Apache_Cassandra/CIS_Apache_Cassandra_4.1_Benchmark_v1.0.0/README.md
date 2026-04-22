# CIS Apache Cassandra 4.1 Benchmark v1.0.0 - Security Skills

This directory contains 19 security control skills from the CIS Apache Cassandra 4.1 Benchmark v1.0.0.

## Controls Summary

### Section 1: Installation and Updates (5 controls)

- **1.1** - Ensure a separate user and group exist for Cassandra (Manual)
- **1.2** - Ensure the latest version of Java is installed (Automated)
- **1.3** - Ensure the latest version of Python is installed (Automated)
- **1.4** - Ensure latest version of Cassandra is installed (Automated)
- **1.5** - Ensure the Cassandra service is run as a non-root user (Automated)

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

## Profile Distribution

- **Level 1:** All 19 controls
- **Automated:** 11 controls
- **Manual:** 8 controls

## Usage with CyberStrike

Each control is implemented as a standalone skill that can be executed independently or as part of a comprehensive Cassandra security assessment workflow.

### Example Usage

```bash
# Run a specific control
cyberstrike run skill cis-cassandra41-1.1

# Run all Cassandra CIS controls
cyberstrike run skill cis-cassandra41-*

# Run only automated controls
cyberstrike run skill cis-cassandra41-1.2 cis-cassandra41-1.3 cis-cassandra41-1.4 cis-cassandra41-1.5 cis-cassandra41-2.1 cis-cassandra41-2.2 cis-cassandra41-3.1 cis-cassandra41-3.2 cis-cassandra41-3.4 cis-cassandra41-4.1 cis-cassandra41-5.1 cis-cassandra41-5.2
```

## Benchmark Information

- **Title:** CIS Apache Cassandra 4.1 Benchmark
- **Version:** 1.0.0
- **Release Date:** Not specified in PDF
- **Technology:** Apache Cassandra 4.1
- **Platform:** Linux

## Directory Structure

```
CIS_Apache_Cassandra_4.1_Benchmark_v1.0.0/
├── cis-cassandra41-1.1/
│   └── SKILL.md
├── cis-cassandra41-1.2/
│   └── SKILL.md
...
└── cis-cassandra41-5.2/
    └── SKILL.md
```

## Tags

Each skill includes relevant tags for easy filtering:

- `cis` - All CIS benchmark controls
- `cassandra` - Cassandra-specific controls
- `installation` - Installation and setup controls (Section 1)
- `authentication` - Authentication controls (Section 2)
- `authorization` - Authorization controls (Section 2)
- `access-control` - Access control controls (Section 3)
- `passwords` - Password policy controls (Section 3)
- `roles` - Role management controls (Section 3)
- `privileges` - Privilege management controls (Section 3)
- `auditing` - Auditing controls (Section 4)
- `logging` - Logging controls (Section 4)
- `encryption` - Encryption controls (Section 5)
- `tls` - TLS/SSL controls (Section 5)

## Author

- **cyberstrike-official**

## License

AGPL-3.0-only + Commercial Licensing (contact@cyberstrike.io)
