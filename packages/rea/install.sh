#!/bin/bash
{
# Truncation guard: this brace group opens on line 2 and closes on the last
# line, so bash must read the entire file before it runs any command. On the
# `curl ... | bash` path, a download cut off anywhere before the final `}` is
# an unterminated compound command, which bash reports as a syntax error at
# EOF without running anything. Without the guard, a cut right after `set`
# would run the bare builtin and print every shell variable, and a cut right
# after `main` would run the installer without the caller's flags.
set -euo pipefail

PACKAGE="rea-agents"
REPOSITORY="morluto/rea"
numeric_identifier='(0|[1-9][0-9]*)'
prerelease_identifier="(${numeric_identifier}|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)"
build_identifier='[0-9A-Za-z-]+'
version_pattern="${numeric_identifier}\\.${numeric_identifier}\\.${numeric_identifier}(-${prerelease_identifier}(\\.${prerelease_identifier})*)?(\\+${build_identifier}(\\.${build_identifier})*)?"
version="${REA_VERSION:-}"
version_requested=false
dry_run=false
start_setup=true
verbose=false

fail() {
  printf 'REA installation failed: %s\n' "$1" >&2
  exit 1
}

# Bash can return status 0 while parsing an incomplete [[ condition. Keep that
# grammar in a constant quoted expression so truncated downloads fail while
# parsing the outer brace group. eval parses only this literal; the arguments
# are expanded as data by the conditional, not interpolated into shell code.
matches() {
  eval '[[ "$1" =~ $2 ]]'
}

# Resolve the current host's Node.js tarball label pair; a label we cannot map
# is kept verbatim so the operator can still read it. Falls back on the raw
# `uname` outputs rather than inventing a label the Node.js release index does
# not publish, so a mismatch is obvious instead of silently wrong.
node_host_labels() {
  case "$(uname -m)" in
    arm64|aarch64) node_arch_label="arm64" ;;
    x86_64|amd64) node_arch_label="x64" ;;
    *) node_arch_label="$(uname -m)" ;;
  esac
  case "$(uname -s)" in
    Darwin) node_os_label="darwin" ;;
    Linux) node_os_label="linux" ;;
    *) node_os_label="$(uname -s | tr '[:upper:]' '[:lower:]')" ;;
  esac
}

# Exit with actionable remediation when the active Node.js is unsupported.
# The engine floor stays in sync with package.json#engines.node — change both.
fail_node_version() {
  local observed="$1"
  node_host_labels
  printf 'REA installation failed: Node.js %s is unsupported.\n\n' "$observed" >&2
  printf 'REA requires Node.js 22.x (>=22.23.4), 24.x (>=24.22.1), or 26.12.1+. Install one via:\n' >&2
  printf '  nvm:  nvm install 24 && nvm use 24      (https://github.com/nvm-sh/nvm)\n' >&2
  printf '  fnm:  fnm install 24 && fnm use 24      (https://github.com/Schniz/fnm)\n' >&2
  printf '  Direct download for %s/%s:\n' "$node_os_label" "$node_arch_label" >&2
  printf '    https://nodejs.org/dist/latest-v24.x/  (grab the %s-%s tarball)\n' "$node_os_label" "$node_arch_label" >&2
  printf 'Then rerun this installer.\n' >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: install.sh [--version VERSION] [--dry-run] [--no-setup] [--no-prompt] [--verbose]

Installs the REA CLI, then starts `rea setup` interactively to configure Hopper
and agents when a terminal is available. Pass --no-setup (or --no-prompt) to
skip setup and run `rea setup` later.
EOF
}

main() {
  while (($# > 0)); do
    case "$1" in
      --version)
        (($# >= 2)) || fail "--version requires a value."
        version="$2"
        version_requested=true
        shift 2
        ;;
      --dry-run)
        dry_run=true
        shift
        ;;
      --no-setup|--no-prompt)
        start_setup=false
        shift
        ;;
      --verbose)
        verbose=true
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *) fail "unknown option: $1" ;;
    esac
  done

  if [ "$verbose" = true ]; then
    set -x
  fi

  platform="$(uname -s)"
  [ "$platform" = "Darwin" ] || [ "$platform" = "Linux" ] || fail "REA supports macOS and selected 64-bit Linux distributions."
  command -v curl >/dev/null 2>&1 || fail "curl is required. Install curl, then rerun this installer."
  command -v node >/dev/null 2>&1 || fail "Node.js 22.x (>=22.23.4), 24.x (>=24.22.1), or 26.12.1+ is required; install it from https://nodejs.org and retry."
  command -v npm >/dev/null 2>&1 || fail "npm is required; install it with Node.js and retry."

  node_version="$(node -p 'process.versions.node' 2>/dev/null || true)"
  IFS=. read -r node_major node_minor _node_patch <<<"$node_version"
  matches "$node_major" '^[0-9]+$' && matches "$node_minor" '^[0-9]+$' || fail "the active Node.js version could not be read. Check that node works and is on PATH, then retry."
  node_patch="${_node_patch%%+*}"
  if ! matches "$_node_patch" '^[0-9]+(\+[0-9A-Za-z.-]+)?$' ||
    ! ((node_major == 22 && (node_minor > 23 || node_minor == 23 && node_patch >= 4) ||
      node_major == 24 && (node_minor > 22 || node_minor == 22 && node_patch >= 1) ||
      node_major == 26 && (node_minor > 12 || node_minor == 12 && node_patch >= 1) ||
      node_major > 26)); then
    fail_node_version "$node_version"
  fi

  if [ "$version_requested" = true ] || [ -n "$version" ]; then
    matches "$version" "^${version_pattern}$" || fail "version must be an exact semantic version."
  else
    release_json="$(curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$REPOSITORY/releases/latest")" || fail "the latest REA release could not be resolved. Check network access or pass --version VERSION, then retry."
    tag="$(printf '%s' "$release_json" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const v=JSON.parse(s).tag_name;if(typeof v!=="string")process.exit(1);process.stdout.write(v)})' 2>/dev/null)" || fail "the release response was invalid. Retry later or pass --version VERSION."
    matches "$tag" "^rea-agents-(${version_pattern})$" || fail "the latest release tag was invalid. Retry later or pass --version VERSION."
    version="${BASH_REMATCH[1]}"
  fi

  # npm's exact-version resolver cleans build metadata from the requested version,
  # so it may install the base release and make the post-install identity check fail.
  if matches "$version" '\+'; then
    fail "npm cannot install an exact version with build metadata. Pass a version without build metadata, then retry."
  fi

  install_args=(install --global)
  if [ "$platform" = "Linux" ]; then
    install_args+=(--prefix "$HOME/.local")
    install_bin="$HOME/.local/bin/rea"
  else
    npm_prefix="$(npm prefix --global)" || fail "the npm global prefix could not be read. Repair the npm configuration, then retry."
    install_bin="$npm_prefix/bin/rea"
  fi
  install_args+=("$PACKAGE@$version")

  printf 'REA install plan\n'
  printf '  Version: %s\n' "$version"
  printf '  Runtime: Node.js %s\n' "$node_version"
  printf '  Command:'
  printf ' %q' npm "${install_args[@]}"
  printf '\n'
  printf '  Binary:  %s\n' "$install_bin"
  printf '  Setup:   %s\n' "$([ "$start_setup" = true ] && printf 'start when a terminal is available' || printf 'skipped')"

  if [ "$dry_run" = true ]; then
    printf 'Dry run complete; no changes made.\n'
    exit 0
  fi

  printf 'Installing %s@%s...\n' "$PACKAGE" "$version"
  npm "${install_args[@]}" || fail "npm could not install REA. Check registry access and npm permissions, then retry."
  [ -x "$install_bin" ] || fail "npm completed without installing the rea command. Check the npm global bin directory and PATH, then retry."
  installed_version="$("$install_bin" --version 2>/dev/null | tr -d '[:space:]')" || fail "the installed REA version could not be read. Reinstall the requested version, then retry."
  [ -n "$installed_version" ] || fail "the installed REA version could not be read. Reinstall the requested version, then retry."
  [ "$installed_version" = "$version" ] || fail "installed version $installed_version does not match $version. Reinstall the requested version, then retry."

  printf 'REA %s is installed.\n' "$version"
  if [ "$start_setup" = true ] && [ -r /dev/tty ] && [ -w /dev/tty ] && [ -t 1 ] && [ -t 2 ]; then
    printf 'Starting REA setup...\n'
    "$install_bin" setup </dev/tty >/dev/tty
  else
    printf 'Run %s setup to configure Hopper and agents.\n' "$install_bin"
  fi
}

main "$@"
exit $?
}
