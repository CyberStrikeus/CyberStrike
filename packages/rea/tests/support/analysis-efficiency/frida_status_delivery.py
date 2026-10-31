"""Accept only complete client delivery of the selected Frida status question."""


def verify_frida_delivery(delivered, bundle, mode, budget, session):
    if '_invalid_json_payload' in delivered:
        assert mode == 'complete' and budget == 0, 'A truncated summary never completes the task'
        return None
    value = delivered['normalized_result']
    parent = next(e for e in bundle['records'] if e['evidence_id'] == value['parent_evidence_id']) if mode == 'summary' else delivered
    assert parent in bundle['records'] and parent['operation'] == 'frida_session_status'
    assert parent['authority'] == 'external-service' and parent['environment'] is None
    assert parent['raw_result'] is None and parent['subject'] is None
    assert parent['parameters'] == {'session_id': session['session_id']}
    facts = parent['normalized_result']
    assert facts['state'] == 'running' and not facts['messages_truncated']
    assert facts['session_id'] == session['session_id'] and facts['pid'] == session['pid']
    payloads = [m['payload'] for m in facts['messages'] if m.get('type') == 'send']
    header = next(p for p in payloads if p['kind'] == 'module')
    complete = next(p for p in payloads if p['kind'] == 'complete')
    count = 0
    for chunk in [p for p in payloads if p['kind'] == 'exports']:
        assert chunk['offset'] == count
        count += len(chunk['items'])
    assert count == header['total'] == complete['total'] and count > 1000
    assert facts['pid'] == header['pid']
    if mode == 'summary':
        assert delivered in bundle['records']
        assert delivered['subject'] is None and delivered['raw_result'] is None
        assert delivered['authority'] == parent['authority']
        assert value['parent_operation'] == parent['operation']
        assert value['source_parameters'] == parent['parameters'] and value['source_provider'] == parent['provider']
        assert value['parent_digest'] == parent['evidence_id'][3:] and value['artifact'] is None
        assert value['summary'] == {**{k: v for k, v in facts.items() if k != 'messages'}, 'messages_retained': len(facts['messages'])}
        assert value['unknowns'] and value['limitations']
    return {'state': facts['state'], 'messages_retained': len(facts['messages']),
            'messages_truncated': facts['messages_truncated'], 'exports': count,
            'parent_evidence_id': parent['evidence_id']}
