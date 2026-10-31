"""Acceptance of the captured GDB answer, separate from native execution success."""


def verify_command_delivery(delivered, parent, mode, budget):
    assert mode in ('complete', 'summary')
    if '_invalid_json_payload' in delivered:
        assert mode == 'complete' and budget == 0, (
            'Incomplete delivery is allowed only for the '
            'complete/default-budget baseline'
        )
        return False
    if mode == 'complete':
        assert delivered == parent
        return True

    selected = delivered['normalized_result']
    assert selected['parent_evidence_id'] == parent['evidence_id']
    assert selected['artifact'] is None
    profile = parent['analysis_profile']
    expected_profile = None if profile is None else profile['digest']
    assert selected['source_analysis_profile_digest'] == expected_profile
    assert selected['source_parameters'] == parent['parameters']
    assert selected['source_provider'] == parent['provider']
    assert delivered['raw_result'] is None and delivered['subject'] is None
    expected = {
        key: value for key, value in parent['normalized_result'].items()
        if key not in ('console', 'target', 'log')
    }
    actual = {
        key: value for key, value in selected['summary'].items()
        if key != 'available_counts'
    }
    assert actual == expected
    counts = {'records': len(expected['records'])}
    for name in ('console', 'target', 'log'):
        text = parent['normalized_result'][name]
        counts[name + '_utf16_units'] = len(text.encode('utf-16-le')) // 2
    assert selected['summary']['available_counts'] == counts
    return True
