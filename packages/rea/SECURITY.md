# Security Policy

## Supported versions

Security fixes are provided for the latest published version of REA. Upgrade to the latest release before reporting a problem that may already have been resolved.

## Reporting a vulnerability

Do not disclose vulnerabilities, proof-of-concept exploits, credentials,
private binaries, Hopper documents, or private Ghidra projects in a public
issue.

Use **Report a vulnerability** in the repository's **Security** tab as the preferred way to submit the report privately. If GitHub private reporting is unavailable to you, email [morluto@outlook.com](mailto:morluto@outlook.com). Do not open a public issue to request a private contact channel.

Include the affected REA version, operating system/distribution, selected
provider and version, impact, reproduction conditions, and any suggested
mitigation in the private report. Remove credentials, proprietary binaries,
Hopper documents, Ghidra project contents, socket capability tokens, and
unrelated local paths from logs or examples.

The maintainer will acknowledge the report, assess its scope, and coordinate
remediation and disclosure timing with the reporter. Please allow time for
provider-dependent behavior to be reproduced safely.

## Security boundary

REA authenticates its Hopper and Ghidra bridges with per-session random
capability tokens. POSIX uses current-user Unix sockets; Windows Ghidra uses
authenticated loopback TCP with a private NTFS runtime whose DACL admits only
the current user and SYSTEM. See [Windows Ghidra P0](docs/windows-ghidra-p0.md#private-runtime-transport-and-lifecycle).
Tokens are transferred through private session descriptors rather than process
arguments or environment variables.
This is not a sandbox and does not protect against malicious processes already
running as the same operating-system user. Opening an untrusted binary
delegates parsing and analysis to the selected local provider with that user's
permissions.

Ghidra sessions use a packaged Java `HeadlessScript`, an isolated temporary
project, and private home, cache, and runtime directories. REA imports only the
requested target, bounds startup and protocol messages, requests bounded CPU
and heap settings, and deletes the temporary project when the session closes.
These controls limit accidental persistence and resource use; they do not make
Ghidra a sandbox. REA does not open or modify user-owned Ghidra projects.

`GHIDRA_INSTALL_DIR` and optional `JAVA_HOME` identify user-managed
installations. Setup can add those values to detected client configuration only
after showing its plan and receiving approval. REA does not download, install,
upgrade, or modify Ghidra or Java.

On Linux, REA accepts release metadata only from Hopper's HTTPS endpoint, restricts package URLs to Hopper's public download origin, bounds the package size, and compares the downloaded bytes with Hopper's published checksum before requesting installation. The published SHA-1 value is a corruption check, not a modern package signature; HTTPS origin validation remains part of the trust boundary. Dependency installation is delegated without shell evaluation to `apt-get`, `dnf`, or `pacman`, directly as root or through `pkexec`. REA never invokes `sudo`.
