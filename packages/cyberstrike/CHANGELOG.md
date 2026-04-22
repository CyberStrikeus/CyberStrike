# Changelog

All notable changes to CyberStrike will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.10] - 2026-04-22

### Added

#### 🎯 Skills System (7,300+ Security Skills)

- **MITRE ATT&CK Integration**: 691 enterprise techniques with Atomic Red Team tests
  - 332 techniques now include 2,000+ copy-paste ready test commands
  - Coverage: Credential Access, Defense Evasion, Discovery, Execution, Persistence, etc.
  - Example: T1558.003 Kerberoasting (7 Atomic tests), T1003.001 LSASS Memory (5 tests)
- **CIS Benchmarks**: 1,500+ hardening and compliance checks
  - **Cloud Providers**: AWS, Azure, GCP, Google Workspace
  - **Server Software**: Apache HTTP Server 2.2/2.4, Apache Cassandra 3.11/4.0/4.1/5.0, Apache Tomcat 7/8/9/10
  - **Container/Orchestration**: Docker v1.6/1.7/1.8, Kubernetes
  - **Operating Systems**: Ubuntu 18.04 LTS, Ubuntu 20.04 LTS
- **OWASP WSTG**: 125 web application security testing skills
  - API Testing, Authentication, Authorization, Business Logic, Client-Side, Configuration, Cryptography, Input Validation, Session Management
- **NIST**: Security controls and frameworks
- **Lazy Loading**: Skills loaded on-demand, zero context pollution

#### 🔍 Skill Search & Discovery

- Relevance-based scoring algorithm
  - Exact match: +100, Name starts with: +50, Tag exact: +40, etc.
- Pagination with "top 50 of 1,000" feedback
- Search by: keyword, tech_stack, CWE ID, category, tags
- 7,633 skills indexed in-memory

#### 🤖 Cloud Security Agent

- CIS skill recommendations integration
- Automated compliance checks

### Changed

- Reorganized CIS benchmark directories to match new taxonomy (Cloud_Providers/, Server_Software/)
- Built-in skills now distributed via npm package

### Removed

- `knowledge/` directory (migrated to `.cyberstrike/skill/WEB/OWASP_WSTG_4.2/`)

### Technical Details

- **Skill Sources**: Red Canary Atomic Red Team, MITRE ATT&CK (STIX 2.1), OWASP WSTG 4.2, NIST, CIS Benchmarks
- **Data Reuse Strategy**: Leveraged authoritative open-source datasets (Atomic Red Team YAML, STIX JSON, CIS PDFs)
- **ROI**: 7,300 skills generated in ~2 weeks vs. estimated 6 months manual work

## [1.1.9] - 2026-03-XX

### Initial Release

- Base CyberStrike platform
- AI-powered offensive security agent
- 15+ AI provider support
- Web UI and CLI interfaces

---

**Full Changelog**: https://github.com/CyberStrikeus/CyberStrike/compare/v1.1.9...v1.1.10
