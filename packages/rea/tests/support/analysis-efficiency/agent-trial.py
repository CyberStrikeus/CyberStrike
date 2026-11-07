"""Evaluate one real Codex CLI task with an isolated REA MCP registration."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time

from codex_context import capture_tool_context


def file_digest(path):
    digest = hashlib.sha256()
    with path.open('rb') as data:
        for chunk in iter(lambda: data.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def runtime_fingerprint(root):
    files = []
    for name in ['dist', 'bridge']:
        for path in sorted((root / name).rglob('*')):
            if path.is_symlink():
                raise ValueError('Runtime fingerprint does not follow symlinks')
            if path.is_file():
                files.append({'path': path.relative_to(root).as_posix(), 'sha256': file_digest(path)})
    files.sort(key=lambda row: row['path'])
    text = json.dumps(files, separators=(',', ':'), ensure_ascii=False)
    return files, hashlib.sha256(text.encode()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['direct', 'client-code'], default='direct')
    parser.add_argument('--runtime-root', type=Path, required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--prompt', type=Path, required=True)
    parser.add_argument('--artifact-path', help='Replace {{artifact_path}} in a question template')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--model', default='gpt-5.6-terra')
    parser.add_argument('--reasoning', default='high')
    parser.add_argument('--timeout', type=int, default=900)
    parser.add_argument('--codex', default='/usr/bin/codex')
    parser.add_argument('--providers', type=Path)
    parser.add_argument('--enabled-tools', type=Path)
    parser.add_argument('--authority', choices=['static', 'browser'], default='static')
    parser.add_argument('--capture-tool-context', action='store_true',
                        help='Retain owned tool/usage items; excludes account/ambient state')
    parser.add_argument('--guide-enabled-tools', action='store_true',
                        help='Opt-in exact-name discovery guidance for selected REA tools')
    args = parser.parse_args()
    if args.guide_enabled_tools and args.enabled_tools is None:
        parser.error('--guide-enabled-tools requires --enabled-tools')
    enabled_tools = None
    if args.enabled_tools:
        enabled_tools = json.loads(args.enabled_tools.read_text())
        if not isinstance(enabled_tools, list) or not all(isinstance(name, str) and name for name in enabled_tools) or len(enabled_tools) != len(set(enabled_tools)):
            raise ValueError('enabled-tools must be a unique list of exact tool names')
    if args.guide_enabled_tools and not enabled_tools:
        parser.error('--guide-enabled-tools requires a nonempty selected tool list')
    def terminate(signum, _frame):
        # The outer resource scope terminates descendants together. Ensure the
        # runner's copied credentials are also removed on a resource abort.
        raise SystemExit(128 + signum)
    signal.signal(signal.SIGTERM, terminate)
    if not args.runtime_root.is_absolute() or not args.output.is_absolute():
        raise ValueError('Runtime and output paths must be absolute')
    repository = args.runtime_root
    driver_repository = Path(__file__).resolve().parents[3]
    experiment = Path(__file__).resolve().parent
    node = shutil.which('node')
    expected_node = (repository / '.nvmrc').read_text().strip().removeprefix('v')
    if subprocess.check_output([node, '--version'], text=True).strip() != 'v' + expected_node:
        raise SystemExit('Use runtime-pinned Node ' + expected_node + ' on PATH')
    provider_env = {'REA_LOG_LEVEL': 'silent', 'NODE_OPTIONS': '--max-old-space-size=512'}
    if args.providers:
        declared = json.loads(args.providers.read_text())
        if not isinstance(declared, dict) or not all(
            isinstance(value, str) for value in declared.values()
        ):
            raise ValueError('--providers must contain an object of explicit string settings')
        provider_env.update(declared)
    provider_policy_text = (experiment / 'provider-environment.json').read_text()
    provider_policy = json.loads(provider_policy_text)
    undeclared = sorted(key for key in os.environ if (
        any(key.startswith(prefix) for prefix in provider_policy['namespace_prefixes'])
        or key in provider_policy['additional_keys']
    ) and key not in provider_env)
    if undeclared:
        raise ValueError('Declare inherited provider settings explicitly in --providers: '
                         + ', '.join(undeclared) + '. Values are not logged.')
    source_auth_home = (Path(os.environ['CODEX_HOME']) if 'CODEX_HOME' in os.environ
                        else Path.home() / '.codex')
    source_auth = source_auth_home / 'auth.json'
    args.output.mkdir(parents=True, exist_ok=False, mode=0o700)
    runtime_files, runtime_digest = runtime_fingerprint(repository)
    (args.output / 'runtime-files.json').write_text(json.dumps(runtime_files))
    profile = Path(tempfile.mkdtemp(prefix='profile-', dir=args.output))
    trial_codex_home = profile / 'codex'
    account = profile / 'account'
    workspace = profile / 'workspace'
    for directory in [trial_codex_home, account, workspace]:
        directory.mkdir(mode=0o700)
    auth = trial_codex_home / 'auth.json'
    started = time.monotonic()
    timeout = False
    exit_code = None
    environment = dict(os.environ)
    environment.update({
        'CODEX_HOME': str(trial_codex_home), 'HOME': str(account),
        'XDG_CONFIG_HOME': str(account / '.config'),
        'XDG_CACHE_HOME': str(account / '.cache'),
        'XDG_DATA_HOME': str(account / '.local/share'),
        'NODE_OPTIONS': '--max-old-space-size=512',
    })
    target_digest = file_digest(Path(args.artifact_path)) if args.artifact_path else None
    command_args = [str(repository / 'scripts/rea.mjs'), 'mcp']
    instruction = (
        'Use the registered REA MCP server for this investigation. Static analysis '
        'only: do not execute target code, fetch URLs, launch a GUI, or modify targets. '
        'Preserve observations, derivations, inferences, limitations, and real Evidence IDs. '
        'An Evidence value has evidence_id, normalized_result and limitations; '
        'non-Evidence session values have result. '
        'The analyzed target digest is Evidence.subject.digest.sha256. '
        'normalized_result.engine.artifact_sha256 identifies the analysis engine '
        'artifact and must never be substituted for the target digest. '
        'Prefer summary/focused views where appropriate. Do not invent successful facts '
        'after a tool error. No other agents. Stop once the requested facts are supported.'
    )
    if args.authority == 'browser':
        instruction = (
            'Use the registered REA tools for the explicitly selected public browser scenario. '
            'Launching the selected headless browser with a fresh empty profile and observing '
            'the supplied public URL is authorized. Keep all actions within that scenario. '
            'No injected code, credentials, unrelated targets, shell/file tools or other agents. '
            'Preserve real Evidence IDs, observation completeness, failed captures and limitations. '
            'Do not infer original source or global behavior from one observed session.'
        )
    if args.mode == 'client-code':
        instruction += (
            ' Use the client JavaScript executor to compose registered MCP calls when '
            'possible and select the requested normalized_result fields before returning '
            'intermediate output to model context. Keep real Evidence IDs and limitations.'
        )
    if args.guide_enabled_tools:
        instruction += (
            ' Configured REA tool function names for this trial: '
            + json.dumps(['mcp__rea__' + name for name in enabled_tools])
            + '. For discovery select only these exact names from ALL_TOOLS and '
            'return only their metadata. Preserve the original analyst question, '
            'dependency order and source Evidence.'
        )
    quote = json.dumps
    config = '\n'.join([
        'approval_policy = "never"', 'sandbox_mode = "read-only"',
        'web_search = "disabled"', 'model = ' + quote(args.model),
        'model_reasoning_effort = ' + quote(args.reasoning),
        'developer_instructions = ' + quote(instruction),
        '[features]', 'multi_agent = false', 'shell_snapshot = false',
        'shell_tool = false', 'unified_exec = false',
        'code_mode = ' + ('true' if args.mode == 'client-code' else 'false'),
        'code_mode_only = ' + ('true' if args.mode == 'client-code' else 'false'),
        '[history]', 'persistence = "none"',
        '[mcp_servers.rea]', 'command = ' + quote(node),
        'args = ' + quote(command_args), 'startup_timeout_sec = 60',
        'tool_timeout_sec = 600',
        *([] if enabled_tools is None else ['enabled_tools = ' + quote(enabled_tools)]),
        '[mcp_servers.rea.env]',
        *[key + ' = ' + quote(value) for key, value in provider_env.items()],
    ]) + '\n'
    # MCP read-only hints cover normal static tools. Explicitly authorize only
    # the session-opening primitive needed by the requested native tasks.
    config += '[mcp_servers.rea.tools.open_binary]\napproval_mode = "approve"\n'
    for tool in ['analyze_javascript_application', 'inspect_analysis_view',
                 'inspect_android_package', 'search_android_classes',
                 'inspect_android_class', 'inspect_android_method',
                 'inspect_firmware_regions', 'inspect_managed_artifact',
                 'inspect_sqlite_database', 'inspect_pcap_capture',
                 'inspect_web_network_capture',
                 'inspect_packet_capture', 'inspect_packet_fields',
                 'decode_signal_recording', 'inspect_signal_decoders',
                 'inspect_managed_members', 'inspect_managed_native_boundaries',
                 'inspect_artifact', 'inspect_wasm_artifact',
                 'compare_functions', 'build_call_path', 'compare_artifacts',
                 'compare_process_captures', 'find_changed_behavior',
                 'compare_managed_members', 'project_managed_application_graph',
                 'compare_wasm_interfaces', 'project_apple_application_graph',
                 'project_android_application_graph', 'project_harmony_application_graph',
                 'trace_application_feature', 'trace_javascript_semantics',
                 'compare_application_versions', 'compare_javascript_export_shapes',
                 'reconcile_javascript_runtime',
                 'inspect_evm_interface', 'get_evidence_bundle', 'export_evidence_bundle',
                 'import_evidence_bundle', 'list_unknowns', 'verify_unknown_resolution',
                 'capture_browser_scenario',
                 'resolve_containing_procedure', 'analyze_function', 'close_binary']:
        config += '[mcp_servers.rea.tools.' + tool + ']\napproval_mode = "approve"\n'
    try:
        if source_auth.exists():
            shutil.copyfile(source_auth, auth)
            auth.chmod(0o600)
        (trial_codex_home / 'config.toml').write_text(config)
        (trial_codex_home / 'config.toml').chmod(0o600)
        prompt = args.prompt.read_text()
        template_digest = hashlib.sha256(prompt.encode()).hexdigest()
        if '{{artifact_path}}' in prompt:
            if not args.artifact_path or not os.path.isabs(args.artifact_path):
                raise ValueError('A question template requires an absolute --artifact-path')
            prompt = prompt.replace('{{artifact_path}}', args.artifact_path)
        elif args.artifact_path:
            raise ValueError('--artifact-path requires the literal template marker')
        (args.output / 'prompt.txt').write_text(prompt)
        (args.output / 'trial-settings.json').write_text(json.dumps({
            'mode': args.mode, 'model': args.model, 'reasoning': args.reasoning,
            'capture_tool_context': args.capture_tool_context,
            'guide_enabled_tools': args.guide_enabled_tools,
            'driver_commit': subprocess.check_output(
                ['git', 'rev-parse', 'HEAD'], cwd=driver_repository, text=True).strip(),
            'runtime_revision': args.revision,
            'runtime_root': str(repository),
            'selected_artifact_path': args.artifact_path,
            'selected_artifact_sha256_before': target_digest,
            'enabled_tools': enabled_tools,
            'authority': args.authority,
            'runtime_files_sha256': runtime_digest,
            'runtime_dispatcher_sha256': file_digest(repository / 'scripts/rea.mjs'),
            'package_lock_sha256': file_digest(repository / 'package-lock.json'),
            'experiment_sources_sha256': {
                name: hashlib.sha256((experiment / name).read_bytes()).hexdigest()
                for name in ['agent-trial.py', 'codex_context.py', 'provider-environment.json']
            },
            'developer_instructions': instruction,
            'developer_instructions_sha256': hashlib.sha256(instruction.encode()).hexdigest(),
            'prompt_sha256': hashlib.sha256(prompt.encode()).hexdigest(),
            'question_template_sha256': template_digest,
            'provider_settings_sha256': hashlib.sha256(
                json.dumps(provider_env, sort_keys=True).encode()).hexdigest(),
            'provider_search_path_sha256': hashlib.sha256(
                provider_env.get('PATH', os.environ.get('PATH', '')).encode()).hexdigest(),
            'provider_environment_policy_sha256': hashlib.sha256(
                provider_policy_text.encode()).hexdigest(),
            'features': {'shell_tool': False, 'unified_exec': False,
                         'multi_agent': False, 'code_mode': args.mode == 'client-code',
                         'code_mode_only': args.mode == 'client-code'},
        }, indent=2) + '\n')
        invocation = [args.codex, '--no-daemon', 'exec', '--strict-config',
                      *([] if args.capture_tool_context else ['--ephemeral']),
                      '--skip-git-repo-check', '--ignore-rules', '--json',
                      '--color', 'never', '-C', str(workspace),
                      '--output-last-message', str(args.output.resolve() / 'answer.txt'), '-']
        with (args.output / 'events.jsonl').open('w') as events, (args.output / 'stderr.log').open('w') as errors:
            child = subprocess.Popen(invocation, env=environment, cwd=workspace,
                                     stdin=subprocess.PIPE, stdout=events, stderr=errors, text=True)
            child.stdin.write(prompt)
            child.stdin.close()
            try:
                exit_code = child.wait(timeout=args.timeout)
            except subprocess.TimeoutExpired:
                timeout = True
                child.terminate()
                try:
                    exit_code = child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    child.kill()
                    exit_code = child.wait()
        usage = []
        tools = []
        event_types = {}
        with (args.output / 'events.jsonl').open() as event_file:
            for line in event_file:
                if not line.strip():
                    continue
                event = json.loads(line)
                kind = event.get('type', 'unknown')
                event_types[kind] = event_types.get(kind, 0) + 1
                if 'usage' in event:
                    usage.append(event['usage'])
                item = event.get('item', {})
                if item.get('type') == 'mcp_tool_call' and kind == 'item.completed':
                    tools.append({
                        **{k: item.get(k) for k in ['server', 'tool', 'arguments', 'status', 'error']},
                        'codex_event_result_json_utf8_bytes': len(json.dumps(
                            item.get('result'), separators=(',', ':'), ensure_ascii=False
                        ).encode()),
                    })
        final_target_digest = file_digest(Path(args.artifact_path)) if args.artifact_path else None
        summary = {
            'mode': args.mode, 'requested_model': args.model, 'reasoning': args.reasoning,
            'runtime_revision': args.revision,
            'capture_tool_context_requested': args.capture_tool_context,
            'selected_artifact_sha256_before': target_digest,
            'selected_artifact_sha256_after': final_target_digest,
            'selected_artifact_bytes_unchanged': target_digest == final_target_digest if target_digest else None,
            'model_identity_scope': 'requested alias; resolved server-side model identity is not inferred',
            'codex_version': subprocess.check_output([args.codex, '--version'], text=True).strip(),
            'exit_code': exit_code, 'timeout': timeout,
            'wall_seconds': round(time.monotonic() - started, 3),
            'usage': usage, 'completed_mcp_calls': tools, 'event_types': event_types,
            'factual_correctness': 'not_assessed',
            'scope': 'real_cli_trial_requires_transcript_and_fact_review',
        }
        (args.output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
        print(json.dumps(summary))
    finally:
        try:
            if args.capture_tool_context:
                capture_tool_context(trial_codex_home, args.output)
        finally:
            # Capture failure must never prevent copied-credential cleanup.
            shutil.rmtree(profile)
            (args.output / 'cleanup.json').write_text(json.dumps({'profile_removed': not profile.exists()}) + '\n')
    raise SystemExit(124 if timeout else exit_code)


if __name__ == '__main__':
    main()
