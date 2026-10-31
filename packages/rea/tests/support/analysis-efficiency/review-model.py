"""Check selected model facts against public producer observations, not exit status."""

import argparse
import hashlib
import json
from pathlib import Path
import re


def read(path):
    return json.loads(path.read_text())


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for entry in value:
            yield from strings(entry)
    elif isinstance(value, dict):
        for entry in value.values():
            yield from strings(entry)


def evidence_ids(value):
    return {s for s in strings(value) if re.fullmatch(r'ev_[a-f0-9]{64}', s)}


def decode(result):
    value = result.get('structured_content', result.get('structuredContent'))
    if value is not None:
        return value
    for entry in result.get('content', []):
        if entry.get('type') == 'text':
            try:
                return json.loads(entry['text'])
            except json.JSONDecodeError:
                pass
    return None


def named_scope(value, names):
    """Accept explicit equivalent scope labels; contradictory duplicates stay a failure."""
    if not isinstance(value, dict):
        return None
    selected = {name: value[name] for name in names if name in value}
    values = list(selected.values())
    if not values:
        return None
    if all(entry == values[0] for entry in values):
        return values[0]
    return {'conflicting_reported_scopes': selected}


def scope_with_verified_counts(value, expected_scope, returned_counts):
    """Validate explicit extra row counts; never erase unknown or conflicting facts."""
    if not isinstance(value, dict):
        return value, {}
    scope = dict(value)
    checks = {}
    for name, expected in returned_counts.items():
        if name in scope:
            reported = scope[name]
            checks[name] = type(reported) is int and reported == expected
            if name not in expected_scope:
                del scope[name]
    return scope, checks


def pcap_observation_fields(value):
    """Equivalent explicit labels are accepted; conflicting duplicates remain failures."""
    if not isinstance(value, dict):
        return value
    result = dict(value)
    for label, canonical in {
        'outer_limitations': 'limitations', 'normalized_kind': 'kind',
        'normalized_view': 'view', 'normalized_parent_evidence_id': 'parent_evidence_id',
        'normalized_coverage': 'coverage', 'normalized_unknowns': 'unknowns',
        'normalized_source_coverage': 'source_coverage',
    }.items():
        if label not in result:
            continue
        if canonical in result and json.dumps(result[label], sort_keys=True) != json.dumps(result[canonical], sort_keys=True):
            return {**result, 'conflicting_fields': [label, canonical]}
        result[canonical] = result.pop(label)
    return result


def pcap_complete_capture(value):
    """Project the selected metadata/counts from the cited complete receipt."""
    inventories = ['endpoints', 'dns_queries', 'tls_sni_values', 'protocol_distribution',
                   'http_request_uris', 'unattributed_dns_addresses']
    if not isinstance(value, dict) or not all(isinstance(value.get(key), list) for key in inventories):
        return None
    capture = {key: item for key, item in value.items() if key not in inventories + ['diagnostics']}
    capture['retained_counts'] = {key: len(value[key]) for key in inventories}
    diagnostics = value.get('diagnostics')
    if 'diagnostics' not in value:
        capture['diagnostics_code_units'] = None
    elif isinstance(diagnostics, dict) and all(isinstance(diagnostics.get(key + '_stderr'), str) for key in ['tshark', 'capinfos']):
        capture['diagnostics_code_units'] = {key: len(diagnostics[key + '_stderr'].encode('utf-16-le', errors='surrogatepass')) // 2
                                             for key in ['tshark', 'capinfos']}
    else:
        return None
    return capture


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--domain', choices=['wasm', 'evm', 'android', 'flutter-aot', 'sqlite', 'pcap', 'managed', 'managed-nonempty', 'firmware', 'inventory', 'javascript', 'native', 'browser'], required=True)
    parser.add_argument('--trial', type=Path, required=True)
    parser.add_argument('--reference', type=Path)
    parser.add_argument('--resource-log', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    summary = read(args.trial / 'summary.json')
    settings = read(args.trial / 'trial-settings.json')
    answer_text = (args.trial / 'answer.txt').read_text().strip()
    fenced = answer_text.startswith('```json\n') and answer_text.endswith('\n```')
    answer = json.loads(answer_text[8:-4] if fenced else answer_text)
    reference = read(args.reference / 'answer.json') if args.reference else None
    observed_ids = set()
    producer_results = {}
    pcap_calls = []
    pcap_attempts = []
    workflow_checks = {'pcap_exact_call_sequence': False} if args.domain == 'pcap' else {}
    tool_errors = []
    with (args.trial / 'events.jsonl').open() as event_lines:
        for line in event_lines:
            event = json.loads(line)
            item = event.get('item', {})
            if event.get('type') != 'item.completed' or item.get('type') != 'mcp_tool_call':
                continue
            result = item.get('result') or {}
            parsed = decode(result)
            if args.domain == 'pcap':
                pcap_attempts.append({'tool': item.get('tool'), 'arguments': item.get('arguments'),
                                      'status': item.get('status'),
                                      'evidence_id': parsed.get('evidence_id') if isinstance(parsed, dict) else None,
                                      'readable_evidence': isinstance(parsed, dict)
                                      and isinstance(parsed.get('normalized_result'), dict)
                                      and isinstance(parsed.get('evidence_id'), str)
                                      and re.fullmatch(r'ev_[a-f0-9]{64}', parsed['evidence_id']) is not None})
            if item['status'] == 'completed':
                # Only response text contributes observed IDs, never model arguments.
                for text in strings(result):
                    observed_ids.update(re.findall(r'ev_[a-f0-9]{64}', text))
                if parsed is not None:
                    if args.domain == 'pcap':
                        pcap_calls.append((item['tool'], item.get('arguments'), parsed))
                    else:
                        producer_results.setdefault(item['tool'], []).append(parsed)
            else:
                tool_errors.append({'tool': item['tool'], 'arguments': item['arguments'], 'response': parsed if parsed is not None else result})
                error = parsed.get('error') if isinstance(parsed, dict) else None
                if isinstance(error, dict) and error.get('code') == 'resource_constraint':
                    details = error.get('details')
                    limits = details.get('reported_limits') if isinstance(details, dict) else None
                    if isinstance(limits, dict):
                        observed_ids.update(evidence_ids(limits.get('evidence_reference')))
    reported_ids = evidence_ids(answer.get('evidence_ids'))
    checks = {
        'reported_evidence_ids_observed_in_responses': bool(reported_ids) and reported_ids <= observed_ids,
        'temporary_profile_removed': read(args.trial / 'cleanup.json')['profile_removed'],
    }
    if summary.get('selected_artifact_sha256_before') is not None:
        checks['selected_artifact_bytes_unchanged'] = summary['selected_artifact_bytes_unchanged']
    if reference is not None:
        checks['target_digest'] = answer.get('artifact_sha256') == reference['artifact_sha256']
    differences = {}

    def check(name, actual, expected):
        checks[name] = actual == expected
        if not checks[name]:
            differences[name] = {'answer': actual, 'producer': expected}

    domain = args.domain
    if domain == 'wasm':
        for key in ['validation', 'section_count', 'import_count', 'export_count', 'exports_first4', 'wat_sha256', 'wat_code_units', 'runtime_execution', 'network_fetch']:
            check(key, answer.get(key), reference[key])
        for key in ['release', 'source_commit']:
            check('wabt_' + key, answer.get('wabt_' + key), reference['tool_profile'][key])
    elif domain == 'evm':
        n = producer_results['inspect_evm_interface'][-1]['normalized_result']
        if n.get('kind') == 'summary':
            check('evm_summary.parent_operation', n.get('parent_operation'), 'inspect_evm_interface')
            checks['evm_summary.parent_reference_observed'] = n.get('parent_evidence_id') in observed_ids
            n = n['summary']
        for key, expected in {'artifact_bytes': n['artifact']['bytes'], 'bytecode_sha256': n['bytecode']['sha256'], 'bytecode_bytes': n['bytecode']['bytes'], 'functions': n['functions'], 'evidence_kind': n['evidence_kind'], 'discovery_completeness': n['discovery_completeness'], 'runtime_execution': n['runtime_execution'], 'bytecode_kind': n['bytecode']['kind'], 'hardfork': n['bytecode']['hardfork'], 'deployment_authenticity': n['bytecode']['deployment_authenticity']}.items():
            check(key, answer.get(key), expected)
        check('evm_original_limitations', answer.get('limitations'), n['limitations'])
    elif domain == 'sqlite':
        for key in ['artifact', 'wal', 'engine', 'database_encoding', 'schema', 'rows', 'producer_limitations', 'limitations']:
            # Missing is not SQL/JSON null; booleans are not numeric counters.
            check(key, (key in answer, json.dumps(answer.get(key), sort_keys=True)),
                  (True, json.dumps(reference[key], sort_keys=True)))
    elif domain == 'pcap':
        check('capture', ('capture' in answer, json.dumps(answer.get('capture'), sort_keys=True)),
              (True, json.dumps(reference['capture'], sort_keys=True)))
        prefix = answer.get('http_request_uris_first2')
        records = {}
        for tool, arguments, value in pcap_calls:
            if not isinstance(value, dict) or not isinstance(value.get('evidence_id'), str):
                continue
            identity = value['evidence_id']
            normalized = value.get('normalized_result')
            supported = (isinstance(normalized, dict) and isinstance(value.get('limitations'), list)
                         and all(isinstance(item, str) for item in value['limitations']))
            if supported:
                supported = all(key not in normalized or (isinstance(normalized[key], list)
                                and all(isinstance(item, str) for item in normalized[key]))
                                for key in ['limitations', 'unknowns'])
            if supported and ('summary' in normalized or normalized.get('kind') == 'summary'):
                supported = isinstance(normalized.get('summary'), dict)
            if supported and ('page' in normalized or normalized.get('kind') == 'pcap'):
                supported = isinstance(normalized.get('page'), dict)
            entry = (tool, arguments, value) if supported else None
            if identity not in records:
                records[identity] = entry
            elif json.dumps(records[identity], sort_keys=True) != json.dumps(entry, sort_keys=True):
                # An ID with conflicting producers or envelopes is ambiguous.
                records[identity] = None
        observations = answer.get('delivery_observations')
        canonical_observations = [pcap_observation_fields(value) for value in observations] if isinstance(observations, list) else observations
        if isinstance(prefix, dict):
            checks['pcap_prefix_fields_supported'] = set(prefix) <= {'items', 'coverage', 'source_coverage'} and 'items' in prefix
            if 'source_coverage' in prefix:
                check('pcap_prefix_source_coverage', prefix['source_coverage'], reference['capture']['coverage'])
            if 'coverage' in prefix:
                last = canonical_observations[-1] if isinstance(canonical_observations, list) and canonical_observations else None
                identity = last.get('evidence_id') if isinstance(last, dict) else None
                entry = records.get(identity) if isinstance(identity, str) else None
                record = entry[2] if entry is not None else None
                page = record['normalized_result'] if record is not None else {}
                checks['pcap_prefix_coverage_observed'] = (
                    page.get('kind') == 'pcap'
                    and page.get('page', {}).get('facet') == 'http-uris'
                    and json.dumps(page['page'].get('items'), sort_keys=True) == json.dumps(prefix.get('items'), sort_keys=True)
                    and 'coverage' in page
                    and json.dumps(prefix['coverage'], sort_keys=True) == json.dumps(page['coverage'], sort_keys=True)
                )
            prefix = prefix.get('items')
        check('http_request_uris_first2', ('http_request_uris_first2' in answer, json.dumps(prefix, sort_keys=True)),
              (True, json.dumps(reference['http_request_uris_first2'], sort_keys=True)))
        expected_observations = []
        if isinstance(canonical_observations, list):
            for observation in canonical_observations:
                identity = observation.get('evidence_id') if isinstance(observation, dict) else None
                entry = records.get(identity) if isinstance(identity, str) else None
                record = entry[2] if entry is not None else None
                if record is None:
                    expected_observations.append(None)
                    continue
                value = record['normalized_result']
                expected = {'evidence_id': record['evidence_id'], 'limitations': record['limitations']}
                for key in ['kind', 'view', 'parent_evidence_id', 'coverage', 'unknowns']:
                    if key in value:
                        expected[key] = value[key]
                if 'limitations' in value:
                    expected['normalized_limitations'] = value['limitations']
                if 'source_coverage' in observation and 'source_coverage' in value:
                    expected['source_coverage'] = value['source_coverage']
                expected_observations.append(expected)
        checks['pcap_delivery_observations_nonempty'] = isinstance(observations, list) and bool(observations)
        check('pcap_original_delivery_observations', json.dumps(canonical_observations, sort_keys=True),
              json.dumps(expected_observations, sort_keys=True))
        if isinstance(canonical_observations, list) and canonical_observations and all(isinstance(x, dict) for x in canonical_observations):
            check('pcap_requested_delivery_chain', [x.get('kind', 'complete') for x in canonical_observations],
                  [x.get('kind', 'complete') for x in reference['delivery_observations']])
            check('pcap_requested_views', json.dumps([x.get('view') for x in canonical_observations], sort_keys=True),
                  json.dumps([x.get('view') for x in reference['delivery_observations']], sort_keys=True))
            if len(reference['delivery_observations']) == 2:
                check('pcap_summary_coverage', json.dumps(canonical_observations[0].get('coverage'), sort_keys=True),
                      json.dumps({'status': 'complete-within-view', 'examined': 1, 'total': 1,
                                  'next_offset': None, 'exhausted': True}, sort_keys=True))
            identities = [x.get('evidence_id') for x in canonical_observations]
            checks['pcap_observations_have_reported_ids'] = (
                isinstance(answer.get('evidence_ids'), list)
                and answer['evidence_ids'] == identities
                and all(isinstance(value, str) and re.fullmatch(r'ev_[a-f0-9]{64}', value) for value in identities)
                and len(set(identities)) == len(identities)
            )
            entries = [records.get(identity) if isinstance(identity, str) else None for identity in identities]
            cited = [entry[2] if entry is not None else None for entry in entries]
            expected_tools = ['inspect_pcap_capture'] + (['inspect_analysis_view'] if len(reference['delivery_observations']) == 2 else [])
            check('pcap_cited_producer_tools', [entry[0] if entry is not None else None for entry in entries], expected_tools)
            # Summary delivery delegates to a retained view; its envelope operation
            # is inspect_analysis_view even though the requested tool is inspect_pcap_capture.
            expected_operations = ['inspect_pcap_capture'] if len(expected_tools) == 1 else ['inspect_analysis_view'] * 2
            check('pcap_cited_operations', [record.get('operation') if isinstance(record, dict) else None for record in cited], expected_operations)
            path = reference['capture']['target']['path']
            expected_arguments = [{'path': path}]
            expected_parameters = [{'path': path}]
            if len(expected_tools) == 2:
                parent = cited[0]['normalized_result'].get('parent_evidence_id') if isinstance(cited[0], dict) else None
                views = [observation.get('view') for observation in reference['delivery_observations']]
                expected_arguments = [{'path': path, 'detail': 'summary'},
                                      {'source': {'kind': 'retained-evidence', 'evidence_id': parent}, 'view': views[-1]}]
                expected_parameters = [{'parent_evidence_id': parent, 'view': view} for view in views]
            check('pcap_cited_call_arguments', json.dumps([entry[1] if entry is not None else None for entry in entries], sort_keys=True),
                  json.dumps(expected_arguments, sort_keys=True))
            workflow_checks['pcap_exact_call_sequence'] = (
                len(identities) == len(expected_tools)
                and json.dumps(pcap_attempts, sort_keys=True) == json.dumps([
                    {'tool': tool, 'arguments': arguments, 'status': 'completed',
                     'evidence_id': identity, 'readable_evidence': True}
                    for tool, arguments, identity in zip(expected_tools, expected_arguments, identities)
                ], sort_keys=True)
            )
            check('pcap_cited_parameters', json.dumps([record.get('parameters') if isinstance(record, dict) else None for record in cited], sort_keys=True),
                  json.dumps(expected_parameters, sort_keys=True))
            checks['pcap_cited_subjects_match_artifact'] = bool(cited) and all(
                isinstance(record, dict)
                and isinstance(record.get('subject'), dict)
                and isinstance(record['subject'].get('digest'), dict)
                and record['subject']['digest'].get('sha256') == reference['artifact_sha256']
                and record['subject'].get('local_path') == reference['capture']['target']['path']
                for record in cited
            )
            checks['pcap_cited_parents_linked'] = bool(cited) and all(isinstance(record, dict) for record in cited) and (
                len(cited) == 1 or (len(cited) == 2 and all(
                    isinstance(record['normalized_result'].get('parent_evidence_id'), str)
                    and re.fullmatch(r'ev_[a-f0-9]{64}', record['normalized_result']['parent_evidence_id'])
                    and record['normalized_result'].get('parent_digest') == record['normalized_result']['parent_evidence_id'][3:]
                    and record['normalized_result']['parent_evidence_id'] != record['evidence_id']
                    and isinstance(record.get('evidence_links'), list)
                    and record['normalized_result']['parent_evidence_id'] in record['evidence_links']
                    for record in cited
                ))
            )
            checks['pcap_cited_source_supports_uri_prefix'] = False
            checks['pcap_cited_capture'] = False
            if all(isinstance(record, dict) for record in cited):
                if len(cited) == 1:
                    source = cited[0]['normalized_result']
                    check('pcap_cited_capture', json.dumps(answer.get('capture'), sort_keys=True),
                          json.dumps(pcap_complete_capture(source), sort_keys=True))
                    checks['pcap_cited_source_supports_uri_prefix'] = (
                        source.get('target') == reference['capture']['target']
                        and isinstance(source.get('http_request_uris'), list)
                        and json.dumps(source['http_request_uris'][:2], sort_keys=True) == json.dumps(prefix, sort_keys=True)
                    )
                elif len(cited) == 2:
                    source, page = [record['normalized_result'] for record in cited]
                    capture = source.get('summary', {})
                    check('pcap_cited_capture', json.dumps(answer.get('capture'), sort_keys=True),
                          json.dumps(capture, sort_keys=True))
                    selected_page = page.get('page', {})
                    checks['pcap_cited_source_supports_uri_prefix'] = (
                        source.get('kind') == 'summary'
                        and source.get('parent_operation') == 'inspect_pcap_capture'
                        and capture == reference['capture']
                        and source.get('artifact') == {key: capture['target'][key] for key in ['path', 'sha256']}
                        and isinstance(source.get('parent_evidence_id'), str)
                        and page.get('parent_evidence_id') == source['parent_evidence_id']
                        and page.get('parent_operation') == 'inspect_pcap_capture'
                        and json.dumps(page.get('view'), sort_keys=True) == json.dumps({'kind': 'pcap', 'facet': 'http-uris', 'offset': 0, 'limit': 2}, sort_keys=True)
                        and selected_page.get('facet') == 'http-uris'
                        and json.dumps(selected_page.get('items'), sort_keys=True) == json.dumps(prefix, sort_keys=True)
                        and page.get('source_coverage') == capture.get('coverage')
                        and json.dumps(page.get('coverage'), sort_keys=True) == json.dumps(reference['delivery_observations'][-1].get('coverage'), sort_keys=True)
                        and page.get('artifact') == {key: capture['target'][key] for key in ['path', 'sha256']}
                    )
        else:
            checks['pcap_requested_delivery_chain'] = False
            if len(reference['delivery_observations']) == 2:
                checks['pcap_summary_coverage'] = False
            checks['pcap_observations_have_reported_ids'] = False
            checks['pcap_requested_views'] = False
            checks['pcap_cited_source_supports_uri_prefix'] = False
            checks['pcap_cited_capture'] = False
            checks['pcap_cited_subjects_match_artifact'] = False
            checks['pcap_cited_parents_linked'] = False
            checks['pcap_cited_producer_tools'] = False
            checks['pcap_cited_operations'] = False
            checks['pcap_cited_call_arguments'] = False
            checks['pcap_cited_parameters'] = False
    elif domain == 'flutter-aot':
        for key in ['target', 'abi', 'libapp', 'string_pool', 'coverage', 'limitations']:
            check(key, answer.get(key), reference[key])
    elif domain == 'android':
        for key in ['package_name', 'version_name', 'version_code', 'matches']:
            check(key, answer.get(key), reference[key])
        fields = ['reported_signature', 'overload_index', 'dex_descriptor']
        checks['onCreate_fields_present_including_explicit_null'] = all(all(k in row for k in fields) for row in answer.get('onCreate', []))
        check('all_onCreate_descriptors', [{k: row.get(k) for k in fields} for row in answer.get('onCreate', [])], [{k: row[k] for k in fields} for row in reference['onCreate']])
    elif domain == 'managed':
        n = reference['artifact']
        for group, fields in [('assembly', ['name', 'version']), ('module', ['name', 'mvid'])]:
            for field in fields:
                check(group + '.' + field, answer.get(group, {}).get(field), n[group][field])
        for key in ['classification', 'target_frameworks']:
            check(key, answer.get(key), n[key])
        for key in ['module_refs', 'pinvoke_imports']:
            check(key, answer.get('native_boundaries', {}).get(key), reference['boundaries'][key])
        check('artifact_coverage', named_scope(answer.get('coverage'), ['artifact', 'managed_artifact', 'managed_metadata']), n['coverage'])
        boundary_scope, counts = scope_with_verified_counts(
            named_scope(answer.get('coverage'), ['native_boundaries', 'native_boundary_declarations']),
            reference['boundaries']['coverage'],
            {'module_ref_count': len(reference['boundaries']['module_refs']),
             'pinvoke_import_count': len(reference['boundaries']['pinvoke_imports'])})
        check('native_boundaries_coverage', boundary_scope, reference['boundaries']['coverage'])
        checks.update({'native_coverage_' + name: valid for name, valid in counts.items()})
    elif domain == 'managed-nonempty':
        n = reference['boundaries']
        check('module_mvid', answer.get('module_mvid'), n['module']['mvid'])
        check('summary', {key: answer.get('summary', {}).get(key) for key in n['summary']}, n['summary'])
        check('all_original_module_refs', answer.get('module_refs'), n['module_refs'])
        check('first3_complete_pinvoke_records', answer.get('pinvoke_first3'), n['pinvoke_imports'][:3])
        check('coverage', answer.get('coverage'), n['coverage'])
    elif domain == 'firmware':
        source = producer_results['inspect_firmware_regions'][-1]
        n = source['normalized_result']
        result = answer['result']
        check('input_size', result.get('input_size'), n['input_size'])
        check('examined_coverage', result.get('coverage', result.get('examined_coverage')), n['coverage'])
        fields = ['provider_id', 'offset', 'reported_size', 'signature', 'description', 'reported_confidence', 'size_basis']
        check('all_original_region_records', [{k: row.get(k) for k in fields} for row in result.get('regions', [])], [{k: row[k] for k in fields} for row in n['regions']])
        engine = result.get('engine', result.get('provider_provenance', {}).get('engine', {}))
        for key in ['name', 'version']:
            check('engine.' + key, engine.get(key), n['engine'][key])
        check('engine_executable_digest', engine.get('executable_sha256', engine.get('artifact_sha256')), n['engine']['executable_sha256'])
    elif domain == 'inventory':
        for key in ['manifest', 'entry_kind_counts', 'integrity_contradictions']:
            check(key, answer.get(key), reference[key])
        original = producer_results['inspect_artifact'][-1]['normalized_result']
        if original.get('kind') == 'summary':
            branches = original['summary']['inspection']['unexplored_branches']
        else:
            branches = original['unexplored_branches']
        # Caller-selected integrity policy participates in atomic Evidence and
        # branch identity. Match those IDs to this original response, not a
        # reference invocation that may use a different policy.
        check('unexplored_branches_with_original_ids', answer.get('unexplored_branches'), branches)
        coverage = answer.get('coverage', {})
        check('inspection_coverage', coverage.get('inspection', coverage), reference['coverage'])
        paths = answer.get('requested_paths')
        if isinstance(paths, dict):
            paths = [row for value in paths.values() for row in (value if isinstance(value, list) else [value]) if row is not None]
        canonical = lambda row: json.dumps(row, sort_keys=True, separators=(',', ':'))
        check('original_selected_path_records', sorted(map(canonical, paths or [])), sorted(map(canonical, reference['requested_paths'])))
    elif domain == 'javascript':
        for key in ['input_path', 'source_selection', 'statistics', 'electron']:
            check(key, answer.get(key), reference[key])
        coverage = answer['coverage']
        expected = reference['coverage']
        for key in ['application_unknowns', 'semantic_unknowns']:
            check('coverage.' + key, coverage.get(key), expected[key])
        for layer in ['application', 'semantic']:
            for key, value in expected[layer].items():
                if key in ['limits', 'families']: continue
                check('coverage.' + layer + '.' + key, coverage[layer].get(key), value)
        # Budgets vary with parent heap and belong to this actual invocation.
        # Exact optional provenance remains a separate strict check; omissions
        # must not be hidden by accepting the coarse coverage summary.
        original = producer_results['analyze_javascript_application'][-1]['normalized_result']['summary']['coverage']
        check('full_coverage_provenance', coverage, original)
        # The question names types/digests, not literal answer property names.
        # Exact node IDs select the producer's main.js records. No source or
        # Evidence values are rewritten to accept these answer labels.
        select = lambda rows: sorted([{
            'node_id': row.get('node_id'),
            'kind': row.get('kind', row.get('type')),
            'identity': row.get('identity'),
            'hashes': row.get('hashes', row.get('digests')),
        } for row in rows], key=lambda row: row['node_id'])
        check('all_selected_module_identities', select(answer.get('modules', [])), select(reference['modules']))
    elif domain == 'native':
        for key in ['entry_address', 'caller_count', 'callee_count']:
            check(key, answer.get(key), reference[key])
        prefix = answer.get('pseudocode_prefix')
        if isinstance(prefix, dict) and prefix.get('unit') == 'utf16-code-units':
            text = prefix.get('text')
            if 'requested' in prefix:
                check('pseudocode_prefix.requested', prefix['requested'], 512)
            if 'returned' in prefix:
                check('pseudocode_prefix.returned', prefix['returned'], len(reference['pseudocode_prefix'].encode('utf-16-le')) // 2)
            prefix = text
        check('pseudocode_prefix', prefix, reference['pseudocode_prefix'])
        containing = answer.get('containing_procedure')
        expected_containing = reference['containing_procedure']['procedure']
        if isinstance(containing, str):
            # Compare the explicitly reported display to the known source;
            # never parse a display name into a canonical lookup identity.
            check('containing_procedure.display', containing,
                  expected_containing['name'] + ' @ ' + expected_containing['address'])
        else:
            containing = containing if isinstance(containing, dict) else {}
            nested = containing.get('procedure')
            nested = nested if isinstance(nested, dict) else {}
            for key in ['address', 'name']:
                check('containing_procedure.' + key, containing.get(key, nested.get(key)), expected_containing[key])
        procedure = answer.get('procedure')
        procedure = procedure if isinstance(procedure, dict) else {}
        expected = reference['procedure']
        for key in ['address', 'name', 'classification', 'signature', 'locals']:
            check('procedure.' + key, procedure.get(key), expected[key])
        body = procedure.get('body')
        body = body if isinstance(body, dict) else {}
        check('procedure.body_ranges', procedure.get('body_ranges', body.get('ranges', body.get('ranges_inclusive'))), expected['body']['ranges'])
        check('procedure.total_bytes', procedure.get('total_bytes', body.get('total_bytes')), expected['body']['total_bytes'])
        if 'load_image' in reference:
            sources = [source for source in producer_results.get('inspect_native_load_image', [])
                       if isinstance(source, dict)
                       and source.get('operation') == 'inspect_native_load_image'
                       and isinstance(source.get('evidence_id'), str)
                       and source.get('evidence_id') in reported_ids
                       and isinstance(source.get('normalized_result'), dict)]
            checks['load_image_source_observed_and_referenced'] = bool(sources)
            load = sources[-1]['normalized_result'] if sources else {}
            entry = load.get('entry')
            entry = entry if isinstance(entry, dict) else {}
            check('load_image.target_sha256', load.get('target_sha256'), reference['artifact_sha256'])
            check('load_image.source_status', load.get('status'), reference['load_image']['status'])
            check('load_image.source_entry', entry.get('linear_address'), reference['entry_address'])
            status = answer.get('load_image_status')
            check('load_image_status', status.get('status') if isinstance(status, dict) else status, load.get('status'))
            if isinstance(status, dict):
                for key in ['format', 'load_segment', 'header_bytes', 'module_bytes', 'overlay_bytes']:
                    if key in status:
                        check('load_image.' + key, status[key], load.get(key))
                if 'entry_linear_address' in status:
                    check('load_image.entry_linear_address', status['entry_linear_address'], entry.get('linear_address'))
        calls = summary['completed_mcp_calls']
        checks['default_analysis_not_disabled'] = all(not call['arguments'].get('skip_auto_analysis', False) for call in calls if call['tool'] == 'open_binary')
        checks['session_close_completed'] = any(call['tool'] == 'close_binary' and call['status'] == 'completed' for call in calls)
    elif domain == 'browser':
        source = producer_results['capture_browser_scenario'][-1]
        n = source['normalized_result']
        for key in ['browser', 'completeness']:
            check(key, answer.get(key), n[key])
        check('start_origin', answer.get('start_origin'), n['scenario']['start_origin'])
        step_count = answer.get('step_count')
        check('step_count', step_count.get('captured_steps') if isinstance(step_count, dict) else step_count, len(n['steps']))
        final = n['steps'][-1]
        expected_url = final['after_url'] if isinstance(answer.get('final_url'), dict) else final['after_url']['url']
        check('final_url', answer.get('final_url'), expected_url)
        for key in ['dom', 'accessibility']:
            expected = final['artifacts'][key]
            actual = answer.get(key, {})
            if expected['state'] == 'captured':
                actual = actual.get('value', actual)
                for field in ['sha256', 'bytes']:
                    check(key + '.' + field, actual.get(field), expected['value'][field])
            else:
                check(key + '.state', actual.get('state'), expected['state'])
        checks['owned_browser_terminated'] = n['browser']['cleanup'] == 'terminated-owned-process'
        events = n['events']['items']
        page_errors = [event for event in events if event['kind'] == 'page-error']
        if isinstance(answer.get('page_errors'), dict):
            check('page_error_count', answer['page_errors'].get('count'), len(page_errors))
        network = answer.get('network', {})
        if 'observed_transactions' in network:
            check('network_transaction_count', network['observed_transactions'], len({event['transaction_id'] for event in events if event.get('transaction_id') is not None}))
        if 'observed_response_statuses' in network:
            statuses = {}
            for event in events:
                if event['kind'] == 'response':
                    status = str(event['status'])
                    statuses[status] = statuses.get(status, 0) + 1
            check('network_response_statuses', network['observed_response_statuses'], statuses)
    factual_checks = dict(checks)
    checks.update(workflow_checks)
    scopes = [json.loads(line) for line in args.resource_log.read_text().splitlines() if line.startswith('{')]
    scope = next(value for value in reversed(scopes) if 'resource_scope' in value)
    checks['no_resource_abort'] = scope['abort'] is None
    events = scope.get('resource_events_final')
    checks['resource_counters_verified'] = scope.get('resource_counters_verified') is True
    checks['no_observed_oom_or_task_limit'] = (
        isinstance(events, dict)
        and all(events.get('memory.events', {}).get(k) == 0 for k in ['max', 'oom', 'oom_kill'])
        and events.get('pids.events', {}).get('max') == 0
    )
    checks['no_resource_limit_event'] = (
        checks['resource_counters_verified']
        and checks['no_observed_oom_or_task_limit']
        and events['memory.events'].get('high') == 0
    )
    report = {
        'review_source_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'domain': domain, 'checks': checks, 'all_selected_checks_pass': all(checks.values()),
        'factual_checks': factual_checks, 'all_factual_checks_pass': all(factual_checks.values()),
        **({'workflow_checks': workflow_checks, 'all_workflow_checks_pass': all(workflow_checks.values())}
           if domain == 'pcap' else {}),
        'differences': differences, 'tool_errors': tool_errors, 'summary': summary,
        'fingerprints': {key: value for key, value in settings.items() if 'sha256' in key or key in ['runtime_revision', 'enabled_tools', 'authority']},
        'answer_file_sha256': hashlib.sha256((args.trial / 'answer.txt').read_bytes()).hexdigest(),
        'answer_had_json_fence': fenced, 'reported_evidence_ids': sorted(reported_ids), 'resource': scope,
        'scope': 'Fixed selected-fact review against actual public producer observations. Equivalent explicitly named answer representations are accepted; unknowns/nulls remain checked. Limitations, unsupported claims and broader behavior still require transcript review. Token usage and failed calls are retained; zero exit status is not a factual grade.',
    }
    with args.output.open('x') as output:
        output.write(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({'domain': domain, 'passed': report['all_selected_checks_pass'], 'failed_checks': [key for key, value in checks.items() if not value]}))
    raise SystemExit(0 if report['all_selected_checks_pass'] else 1)


if __name__ == '__main__':
    main()
