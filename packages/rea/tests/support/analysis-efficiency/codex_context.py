"""Retain owned Codex tool/usage observations without account or ambient state."""

import hashlib
import json
import os


def token_counts(value):
    if not isinstance(value, dict):
        raise ValueError('Expected a token-count object')
    result = {}
    for key in ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens',
                'output_tokens', 'reasoning_output_tokens', 'total_tokens']:
        if key in value:
            count = value[key]
            if not isinstance(count, int) or isinstance(count, bool) or count < 0:
                raise ValueError('Expected nonnegative integer token counts')
            result[key] = count
    return result


def selected_event(event):
    """Select observed items; these are not the exact submitted model request."""
    if not isinstance(event, dict) or not isinstance(event.get('payload'), dict):
        raise ValueError('Expected an event object with an object payload')
    if not isinstance(event.get('type'), str):
        raise ValueError('Expected an event type string')
    if event.get('timestamp') is not None and not isinstance(event['timestamp'], str):
        raise ValueError('Expected a timestamp string or omission')
    payload = event['payload']
    kind = event.get('type')
    if kind == 'response_item' and payload.get('type') in [
        'custom_tool_call', 'custom_tool_call_output',
        'function_call', 'function_call_output',
    ]:
        keys = ['type', 'call_id', 'name', 'input', 'arguments', 'output']
    elif kind == 'token_usage_record':
        keys = ['response_id', 'usage', 'turn_token_usage', 'thread_token_usage']
        payload = {key: token_counts(payload[key]) if key != 'response_id'
                   else payload[key] for key in keys if key in payload}
    elif kind == 'event_msg' and payload.get('type') == 'token_count':
        keys = ['type', 'info']
        info = payload.get('info')
        if info is not None:
            if not isinstance(info, dict):
                raise ValueError('Expected token-count info')
            selected_info = {key: token_counts(info[key]) for key in
                             ['total_token_usage', 'last_token_usage'] if key in info}
            window = info.get('model_context_window')
            if 'model_context_window' in info:
                if window is not None and (not isinstance(window, int) or isinstance(window, bool) or window <= 0):
                    raise ValueError('Expected a positive model context window')
                selected_info['model_context_window'] = window
            payload = {'type': 'token_count', 'info': selected_info}
        else:
            payload = {'type': 'token_count', 'info': None}
    else:
        return None
    return {
        'timestamp': event.get('timestamp'),
        'type': kind,
        'payload': {key: payload[key] for key in keys if key in payload},
    }


def capture_tool_context(codex_home, output):
    """Capture only an explicitly selected trial's rollouts; never its auth/config."""
    sessions = codex_home / 'sessions'
    blocked = sessions.is_symlink()
    sources = [] if blocked else sorted(sessions.rglob('*.jsonl'))
    target = output / 'codex-tool-context.jsonl'
    source_receipts = []
    errors = [{'source': 'sessions', 'reason': 'not_an_owned_directory'}] if blocked else []
    retained = 0
    with os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600),
                   'w', encoding='utf-8') as result:
        for source in sources:
            name = source.relative_to(codex_home).as_posix()
            if source.is_symlink() or not source.is_file():
                errors.append({'source': name, 'reason': 'not_an_owned_regular_file'})
                continue
            digest = hashlib.sha256()
            counts = {}
            with source.open('rb') as lines:
                for ordinal, line in enumerate(lines, 1):
                    digest.update(line)
                    try:
                        event = json.loads(line)
                        selected = selected_event(event)
                    except ValueError as error:
                        errors.append({'source': name, 'line': ordinal,
                                       'reason': type(error).__name__})
                        continue
                    kind = event.get('type')
                    counts[str(kind)] = counts.get(str(kind), 0) + 1
                    if selected is not None:
                        result.write(json.dumps(selected, ensure_ascii=False) + '\n')
                        retained += 1
            source_receipts.append({'source': name, 'sha256': digest.hexdigest(),
                                    'event_counts': counts})
    retained_digest = hashlib.sha256()
    with target.open('rb') as captured:
        for chunk in iter(lambda: captured.read(1024 * 1024), b''):
            retained_digest.update(chunk)
    receipt = {
        'status': 'partial' if errors else 'captured' if source_receipts else 'unavailable',
        'retained_file': target.name,
        'retained_sha256': retained_digest.hexdigest(),
        'retained_events': retained, 'sources': source_receipts, 'errors': errors,
        'scope': 'Owned client tool-call/reply and per-response usage items, not '
                 'the exact submitted model request. Session/account metadata, '
                 'world state, user/developer messages, encrypted reasoning and '
                 'internal passthrough are omitted. Authentication, configuration '
                 'and ambient environment are never copied by this capture.',
    }
    (output / 'context-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    return receipt
