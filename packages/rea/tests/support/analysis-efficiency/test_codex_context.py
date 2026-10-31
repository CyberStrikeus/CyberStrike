"""Distinct capture/cleanup failures; simulated CLI is not real-model evidence."""

import importlib.util
import copy
import io
import json
import os
import runpy
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from codex_context import capture_tool_context, selected_event


class ManagedCoverageTests(unittest.TestCase):
    def test_verifies_extra_counts_and_preserves_unknown_fields(self):
        review = runpy.run_path(str(Path(__file__).with_name('review-model.py')))
        project = review['scope_with_verified_counts']
        expected = {'state': 'partial', 'issues': ['unreturned rows remain unknown']}
        original = {**expected, 'module_ref_count': 0, 'pinvoke_import_count': 2}
        scope, checks = project(original, expected, {'module_ref_count': 0, 'pinvoke_import_count': 2})
        self.assertEqual(scope, expected)
        self.assertEqual(checks, {'module_ref_count': True, 'pinvoke_import_count': True})
        self.assertEqual(original['pinvoke_import_count'], 2)
        for count in [3, '2', True]:
            scope, checks = project({**expected, 'pinvoke_import_count': count}, expected, {'pinvoke_import_count': 2})
            self.assertFalse(checks['pinvoke_import_count'])
        _, checks = project({**expected, 'module_ref_count': False}, {**expected, 'module_ref_count': 0}, {'module_ref_count': 0})
        self.assertFalse(checks['module_ref_count'])
        scope, _ = project({**expected, 'unsupported_claim': True}, expected, {})
        self.assertNotEqual(scope, expected)
        scope, _ = project({'state': 'partial', 'module_ref_count': 0}, expected, {'module_ref_count': 0})
        self.assertNotEqual(scope, expected)
        ambiguous = review['named_scope']({'native_boundaries': expected, 'native_boundary_declarations': {'state': 'complete'}}, ['native_boundaries', 'native_boundary_declarations'])
        scope, _ = project(ambiguous, expected, {'module_ref_count': 0})
        self.assertNotEqual(scope, expected)


class PcapCoverageTests(unittest.TestCase):
    def test_explicit_labels_preserve_original_nulls_and_source_scope(self):
        canonical = runpy.run_path(str(Path(__file__).with_name('review-model.py')))['pcap_observation_fields']
        original = {'outer_limitations': [], 'normalized_kind': 'pcap',
                    'normalized_coverage': {'examined': 2, 'total': 23, 'next_offset': 2, 'exhausted': False},
                    'normalized_source_coverage': 'partial', 'normalized_parent_evidence_id': None}
        result = canonical(original)
        self.assertEqual(result['limitations'], [])
        self.assertEqual(result['source_coverage'], 'partial')
        self.assertEqual(result['coverage']['total'], 23)
        self.assertIsNone(result['parent_evidence_id'])
        self.assertIn('outer_limitations', original)
        self.assertNotIn('parent_evidence_id', canonical({}))

    def test_conflicting_duplicates_and_json_type_substitutions_stay_failures(self):
        canonical = runpy.run_path(str(Path(__file__).with_name('review-model.py')))['pcap_observation_fields']
        for wrong in ['partial', None]:
            result = canonical({'normalized_source_coverage': 'complete', 'source_coverage': wrong})
            self.assertIn('conflicting_fields', result)
            self.assertEqual(result['normalized_source_coverage'], 'complete')
            self.assertEqual(result['source_coverage'], wrong)
        result = canonical({'normalized_coverage': {'examined': 1}, 'coverage': {'examined': True}})
        self.assertIn('conflicting_fields', result)
        self.assertEqual(canonical({'outer_limitations': [], 'limitations': []}), {'limitations': []})

    def test_unsupported_claims_are_retained_for_exact_producer_checking(self):
        canonical = runpy.run_path(str(Path(__file__).with_name('review-model.py')))['pcap_observation_fields']
        original = {'normalized_kind': 'pcap', 'unrecorded_traffic_absent': True}
        self.assertIn('unrecorded_traffic_absent', canonical(original))
        self.assertIsNone(canonical(None))


class PcapGraderWorkflowTests(unittest.TestCase):
    """Synthetic receipts test the grader boundary, not Wireshark or real models."""

    def fixture(self):
        parent, summary_id, page_id = ['ev_' + value * 64 for value in ['a', 'b', 'c']]
        capture = {'target': {'path': '/fixture/http.pcapng', 'sha256': 'd' * 64},
                   'capture_start': None, 'coverage': 'complete',
                   'retained_counts': {'http_request_uris': 3}}
        prefix = ['http://example.test/one', 'http://example.test/two']
        coverage = {'status': 'page', 'examined': 2, 'total': 3, 'next_offset': 2, 'exhausted': False}
        subject = {'digest': {'sha256': capture['target']['sha256']}, 'local_path': capture['target']['path']}
        summary = {'evidence_id': summary_id, 'operation': 'inspect_analysis_view',
                   'subject': copy.deepcopy(subject), 'evidence_links': [parent],
                   'limitations': ['source', 'view'],
                   'normalized_result': {'kind': 'summary', 'view': {'kind': 'summary'},
                       'parent_operation': 'inspect_pcap_capture', 'parent_evidence_id': parent,
                       'summary': capture, 'artifact': copy.deepcopy(capture['target']),
                       'coverage': {'status': 'complete-within-view', 'examined': 1, 'total': 1, 'next_offset': None, 'exhausted': True},
                       'limitations': ['source', 'view'], 'unknowns': ['unrecorded traffic']}}
        page = {'evidence_id': page_id, 'operation': 'inspect_analysis_view',
                'subject': copy.deepcopy(subject), 'evidence_links': [parent],
                'limitations': ['source', 'view'],
                'normalized_result': {'kind': 'pcap',
                    'view': {'kind': 'pcap', 'facet': 'http-uris', 'offset': 0, 'limit': 2},
                    'parent_operation': 'inspect_pcap_capture', 'parent_evidence_id': parent,
                    'page': {'facet': 'http-uris', 'items': prefix}, 'coverage': coverage,
                    'source_coverage': 'complete', 'artifact': capture['target'],
                    'limitations': ['source', 'view'], 'unknowns': ['unrecorded traffic']}}
        for record in [summary, page]:
            record['normalized_result']['parent_digest'] = parent[3:]
            record['parameters'] = {'parent_evidence_id': parent, 'view': copy.deepcopy(record['normalized_result']['view'])}
        observations = [self.observation(value) for value in [summary, page]]
        reference = {'artifact_sha256': 'd' * 64, 'capture': capture,
                     'http_request_uris_first2': prefix, 'delivery_observations': observations}
        answer = copy.deepcopy({**reference, 'http_request_uris_first2': {
            'items': prefix, 'coverage': coverage, 'source_coverage': 'complete'},
            'evidence_ids': [summary_id, page_id]})
        return answer, [summary, page], copy.deepcopy(reference)

    def observation(self, record):
        value = record['normalized_result']
        return {'evidence_id': record['evidence_id'], 'limitations': record['limitations'],
                'kind': value['kind'], 'view': value['view'],
                'parent_evidence_id': value['parent_evidence_id'], 'coverage': value['coverage'],
                'unknowns': value['unknowns'], 'normalized_limitations': value['limitations']}

    def grade(self, answer, records, reference, producer_tools=None, producer_arguments=None, extra_events=None, producer_results=None):
        review = runpy.run_path(str(Path(__file__).with_name('review-model.py')))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory);trial = root / 'trial';trial.mkdir()
            for name, value in [('summary.json', {'completed_mcp_calls': []}),
                                ('trial-settings.json', {}), ('cleanup.json', {'profile_removed': True})]:
                (trial / name).write_text(json.dumps(value))
            (trial / 'answer.txt').write_text(json.dumps(answer))
            events = []
            for index, value in enumerate(records):
                tool = producer_tools[index] if producer_tools is not None else \
                    ('inspect_analysis_view' if value['normalized_result'].get('kind') == 'pcap' else 'inspect_pcap_capture')
                arguments = {'path': reference['capture']['target']['path']}
                if tool == 'inspect_analysis_view':
                    normalized = value.get('normalized_result')
                    parent = normalized.get('parent_evidence_id') if isinstance(normalized, dict) else None
                    arguments = {'source': {'kind': 'retained-evidence', 'evidence_id': parent},
                                 'view': reference['delivery_observations'][-1].get('view')}
                elif len(reference['delivery_observations']) == 2:
                    arguments['detail'] = 'summary'
                if producer_arguments is not None:
                    arguments = producer_arguments[index]
                events.append({'type': 'item.completed', 'item': {'type': 'mcp_tool_call',
                               'tool': tool, 'arguments': arguments, 'status': 'completed',
                               'result': {'structuredContent': value} if producer_results is None else producer_results[index]}})
            events.extend(extra_events or [])
            (trial / 'events.jsonl').write_text(''.join(json.dumps(value) + '\n' for value in events))
            source = root / 'reference';source.mkdir();(source / 'answer.json').write_text(json.dumps(reference))
            resource = root / 'resource.log'
            resource.write_text(json.dumps({'resource_scope': 'simulated-grader-only', 'abort': None,
                                           'resource_counters_verified': False, 'resource_events_final': None}) + '\n')
            output = root / 'review.json'
            argv = ['review-model.py', '--domain', 'pcap', '--trial', str(trial), '--reference', str(source),
                    '--resource-log', str(resource), '--output', str(output)]
            with patch.object(sys, 'argv', argv), patch('sys.stdout', io.StringIO()), self.assertRaises(SystemExit) as stopped:
                review['main']()
            self.assertEqual(stopped.exception.code, 1)  # Unknown resource counters stay false.
            return json.loads(output.read_text())

    def test_complete_grader_accepts_supported_receipts_and_equivalent_labels(self):
        answer, records, reference = self.fixture()
        self.assertTrue(self.grade(answer, records, reference)['all_factual_checks_pass'])
        for observation in answer['delivery_observations']:
            observation['outer_limitations'] = observation.pop('limitations')
            observation['normalized_coverage'] = observation.pop('coverage')
        self.assertTrue(self.grade(answer, records, reference)['all_factual_checks_pass'])

    def test_complete_grader_rejects_missing_nulls_bad_scope_and_malformed_identity(self):
        mutations = [lambda x: x['capture'].pop('capture_start'),
                     lambda x: x['http_request_uris_first2']['coverage'].__setitem__('exhausted', True),
                     lambda x: x['delivery_observations'][-1].__setitem__('evidence_id', {'unexpected': 'value'}),
                     lambda x: x['delivery_observations'][-1].__setitem__('unrecorded_traffic_absent', True)]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                answer, records, reference = self.fixture();mutate(answer)
                self.assertFalse(self.grade(answer, records, reference)['all_factual_checks_pass'])

    def test_faithful_wrong_receipts_do_not_support_the_reported_uri_prefix(self):
        for wrong in ['facet', 'range', 'parent']:
            with self.subTest(wrong=wrong):
                answer, records, reference = self.fixture()
                page = copy.deepcopy(records[-1]);page['evidence_id'] = 'ev_' + 'e' * 64
                value = page['normalized_result']
                if wrong == 'facet':
                    value['view']['facet'] = 'endpoints'
                    value['page'] = {'facet': 'endpoints', 'items': [{'address': '127.0.0.1'}]}
                elif wrong == 'range':
                    value['view']['offset'] = 1
                    value['page']['items'] = ['http://example.test/two', 'http://example.test/three']
                else:
                    value['parent_evidence_id'] = 'ev_' + 'f' * 64
                records.append(page)
                answer['delivery_observations'][-1] = self.observation(page)
                answer['evidence_ids'][-1] = page['evidence_id']
                report = self.grade(answer, records, reference)
                self.assertTrue(report['factual_checks']['pcap_original_delivery_observations'])
                self.assertFalse(report['factual_checks']['pcap_cited_source_supports_uri_prefix'])
                self.assertFalse(report['all_factual_checks_pass'])

    def test_complete_receipt_metadata_counts_and_diagnostics_support_reported_capture(self):
        answer, records, reference = self.fixture()
        capture = reference['capture']
        capture.update({'packet_count': 3, 'client': {'name': 'fixture', 'version': '1'},
                        'retained_counts': {key: 0 for key in ['endpoints', 'dns_queries', 'tls_sni_values',
                                            'protocol_distribution', 'http_request_uris', 'unattributed_dns_addresses']},
                        'diagnostics_code_units': {'tshark': 0, 'capinfos': 2}})
        capture['retained_counts']['http_request_uris'] = 3
        source = {key: value for key, value in capture.items() if key not in ['retained_counts', 'diagnostics_code_units']}
        source.update({key: [] for key in capture['retained_counts']})
        source['http_request_uris'] = reference['http_request_uris_first2'] + ['http://example.test/three']
        source['diagnostics'] = {'tshark_stderr': '', 'capinfos_stderr': '\U0001f4a5'}
        receipt = {'evidence_id': 'ev_' + 'a' * 64, 'operation': 'inspect_pcap_capture',
                   'parameters': {'path': source['target']['path']},
                   'subject': copy.deepcopy(records[0]['subject']), 'evidence_links': [],
                   'limitations': ['source'], 'normalized_result': source}
        reference['delivery_observations'] = [{'evidence_id': receipt['evidence_id'],
                                              'limitations': receipt['limitations'], 'coverage': source['coverage']}]
        answer = copy.deepcopy({**reference, 'evidence_ids': [receipt['evidence_id']]})
        self.assertTrue(self.grade(answer, [receipt], reference)['all_factual_checks_pass'])
        for parameters in [None, {}, {'path': '/fixture/other.pcapng'}]:
            changed = copy.deepcopy(receipt);changed['parameters'] = parameters
            report = self.grade(answer, [changed], reference)
            self.assertFalse(report['factual_checks']['pcap_cited_parameters'])
            self.assertFalse(report['all_factual_checks_pass'])
        self.assertFalse(self.grade(answer, [receipt], reference,
                                   producer_arguments=[{'path': '/fixture/other.pcapng'}])['all_factual_checks_pass'])
        self.assertFalse(self.grade(answer, [receipt], reference, ['inspect_analysis_view'])['all_factual_checks_pass'])
        wrong_operation = copy.deepcopy(receipt);wrong_operation['operation'] = 'inspect_analysis_view'
        self.assertFalse(self.grade(answer, [wrong_operation], reference)['all_factual_checks_pass'])
        for subject in [None, {'digest': {'sha256': 'e' * 64}, 'local_path': source['target']['path']}]:
            changed = copy.deepcopy(receipt);changed['subject'] = subject
            report = self.grade(answer, [changed], reference)
            self.assertTrue(report['factual_checks']['pcap_cited_capture'])
            self.assertFalse(report['factual_checks']['pcap_cited_subjects_match_artifact'])
            self.assertFalse(report['all_factual_checks_pass'])
        mutations = [lambda x: x.__setitem__('packet_count', 4),
                     lambda x: x['client'].__setitem__('version', '2'),
                     lambda x: x.__setitem__('capture_start', 'changed'),
                     lambda x: x.__setitem__('coverage', 'partial'),
                     lambda x: x['endpoints'].append({'address': '127.0.0.1'}),
                     lambda x: x['diagnostics'].__setitem__('capinfos_stderr', '')]
        for mutate in mutations:
            changed = copy.deepcopy(receipt);mutate(changed['normalized_result'])
            report = self.grade(answer, [changed], reference)
            self.assertTrue(report['factual_checks']['capture'])
            self.assertFalse(report['factual_checks']['pcap_cited_capture'])
            self.assertFalse(report['all_factual_checks_pass'])
        receipt['normalized_result'].pop('diagnostics')
        reference['capture']['diagnostics_code_units'] = None
        answer['capture']['diagnostics_code_units'] = None
        self.assertTrue(self.grade(answer, [receipt], reference)['all_factual_checks_pass'])

    def test_cited_receipt_subjects_must_identify_the_reference_capture(self):
        for index in [0, 1]:
            for subject in [None, [], 'artifact', {}, {'digest': None},
                            {'digest': {'sha256': 'e' * 64}, 'local_path': '/fixture/http.pcapng'},
                            {'digest': {'sha256': 'd' * 64}, 'local_path': '/fixture/other.pcapng'}]:
                with self.subTest(index=index, subject=subject):
                    answer, records, reference = self.fixture()
                    records[index]['subject'] = subject
                    report = self.grade(answer, records, reference)
                    self.assertTrue(report['factual_checks']['pcap_original_delivery_observations'])
                    self.assertFalse(report['factual_checks']['pcap_cited_subjects_match_artifact'])
                    self.assertFalse(report['all_factual_checks_pass'])
            answer, records, reference = self.fixture();records[index].pop('subject')
            self.assertFalse(self.grade(answer, records, reference)['all_factual_checks_pass'])

    def test_faithful_inconsistent_page_coverage_does_not_support_the_prefix(self):
        for field, wrong in [('status', 'complete-within-view'), ('next_offset', None), ('exhausted', True)]:
            with self.subTest(field=field):
                answer, records, reference = self.fixture()
                records[-1]['normalized_result']['coverage'][field] = wrong
                answer['delivery_observations'][-1] = self.observation(records[-1])
                answer['http_request_uris_first2']['coverage'][field] = wrong
                report = self.grade(answer, records, reference)
                self.assertTrue(report['factual_checks']['pcap_original_delivery_observations'])
                self.assertTrue(report['factual_checks']['pcap_prefix_coverage_observed'])
                self.assertFalse(report['factual_checks']['pcap_cited_source_supports_uri_prefix'])
                self.assertFalse(report['all_factual_checks_pass'])

    def test_cited_coverage_preserves_exact_json_scalar_types(self):
        for field, wrong in [('exhausted', 0), ('examined', 2.0), ('total', 3.0), ('next_offset', 2.0)]:
            with self.subTest(field=field):
                answer, records, reference = self.fixture()
                records[-1]['normalized_result']['coverage'][field] = wrong
                answer['delivery_observations'][-1] = self.observation(records[-1])
                answer['http_request_uris_first2']['coverage'][field] = wrong
                report = self.grade(answer, records, reference)
                self.assertTrue(report['factual_checks']['pcap_original_delivery_observations'])
                self.assertTrue(report['factual_checks']['pcap_prefix_coverage_observed'])
                self.assertFalse(report['all_factual_checks_pass'])

    def test_cited_views_preserve_exact_json_scalar_types(self):
        for field, wrong in [('offset', False), ('offset', 0.0), ('limit', 2.0), ('limit', True)]:
            with self.subTest(field=field, wrong=wrong):
                answer, records, reference = self.fixture()
                records[-1]['normalized_result']['view'][field] = wrong
                answer['delivery_observations'][-1] = self.observation(records[-1])
                report = self.grade(answer, records, reference)
                self.assertTrue(report['factual_checks']['pcap_original_delivery_observations'])
                self.assertFalse(report['factual_checks']['pcap_requested_views'])
                self.assertFalse(report['factual_checks']['pcap_cited_source_supports_uri_prefix'])
                self.assertFalse(report['all_factual_checks_pass'])

    def test_empty_delivery_observations_write_failed_facts(self):
        answer, records, reference = self.fixture()
        answer['delivery_observations'] = []
        answer['evidence_ids'] = []
        report = self.grade(answer, records, reference)
        self.assertFalse(report['factual_checks']['pcap_delivery_observations_nonempty'])
        self.assertFalse(report['factual_checks']['pcap_cited_call_arguments'])
        self.assertFalse(report['factual_checks']['pcap_cited_parameters'])
        self.assertFalse(report['all_factual_checks_pass'])

    def test_cited_view_parameters_and_call_arguments_bind_actual_requests(self):
        for index in [0, 1]:
            for parameters in [None, {}, {'parent_evidence_id': 'ev_' + 'f' * 64,
                                          'view': {'kind': 'summary'}}]:
                with self.subTest(index=index, parameters=parameters):
                    answer, records, reference = self.fixture()
                    records[index]['parameters'] = parameters
                    report = self.grade(answer, records, reference)
                    self.assertTrue(report['factual_checks']['pcap_original_delivery_observations'])
                    self.assertFalse(report['factual_checks']['pcap_cited_parameters'])
                    self.assertFalse(report['all_factual_checks_pass'])
        for wrong in [None, {}, {'source': {'kind': 'retained-evidence', 'evidence_id': 'ev_' + 'f' * 64},
                                'view': {'kind': 'pcap', 'facet': 'http-uris', 'offset': 0, 'limit': 2}},
                      {'source': {'kind': 'retained-evidence', 'evidence_id': 'ev_' + 'a' * 64},
                       'view': {'kind': 'pcap', 'facet': 'http-uris', 'offset': False, 'limit': 2}}]:
            with self.subTest(arguments=wrong):
                answer, records, reference = self.fixture()
                report = self.grade(answer, records, reference,
                                    producer_arguments=[{'path': reference['capture']['target']['path'], 'detail': 'summary'}, wrong])
                self.assertFalse(report['factual_checks']['pcap_cited_call_arguments'])
                self.assertFalse(report['all_factual_checks_pass'])

    def test_malformed_receipt_envelopes_write_failed_facts_instead_of_crashing(self):
        tools = ['inspect_pcap_capture', 'inspect_analysis_view']
        for index in [0, 1]:
            for field, wrong in [('normalized_result', None), ('normalized_result', []),
                                 ('normalized_result', 'capture'), ('limitations', None),
                                 ('limitations', {}), ('limitations', [None]),
                                 ('limitations', ['source', 1])]:
                with self.subTest(index=index, field=field, wrong=wrong):
                    answer, records, reference = self.fixture();records[index][field] = wrong
                    if field == 'limitations':
                        answer['delivery_observations'][index]['limitations'] = copy.deepcopy(wrong)
                    report = self.grade(answer, records, reference, tools)
                    self.assertTrue(report['factual_checks']['capture'])
                    self.assertFalse(report['all_factual_checks_pass'])
            for field in ['normalized_result', 'limitations']:
                with self.subTest(index=index, missing=field):
                    answer, records, reference = self.fixture();records[index].pop(field)
                    self.assertFalse(self.grade(answer, records, reference, tools)['all_factual_checks_pass'])
        for index, field in [(0, 'summary'), (1, 'page')]:
            for wrong in [None, [], 'view']:
                with self.subTest(index=index, nested=field, wrong=wrong):
                    answer, records, reference = self.fixture();records[index]['normalized_result'][field] = wrong
                    self.assertFalse(self.grade(answer, records, reference, tools)['all_factual_checks_pass'])

    def test_retained_parent_digest_must_match_its_declared_identity(self):
        for index in [0, 1]:
            for digest in [None, {}, [], True, 'digest', 'e' * 64]:
                with self.subTest(index=index, digest=digest):
                    answer, records, reference = self.fixture()
                    records[index]['normalized_result']['parent_digest'] = digest
                    report = self.grade(answer, records, reference)
                    self.assertTrue(report['factual_checks']['pcap_original_delivery_observations'])
                    self.assertFalse(report['all_factual_checks_pass'])
            answer, records, reference = self.fixture()
            records[index]['normalized_result'].pop('parent_digest')
            self.assertFalse(self.grade(answer, records, reference)['all_factual_checks_pass'])

    def test_summary_outer_artifact_must_identify_the_selected_capture(self):
        for wrong in [None, {}, [], 'artifact',
                      {'path': '/fixture/other.pcapng', 'sha256': 'd' * 64},
                      {'path': '/fixture/http.pcapng', 'sha256': 'e' * 64}]:
            with self.subTest(artifact=wrong):
                answer, records, reference = self.fixture()
                records[0]['normalized_result']['artifact'] = wrong
                report = self.grade(answer, records, reference)
                self.assertTrue(report['factual_checks']['pcap_original_delivery_observations'])
                self.assertFalse(report['all_factual_checks_pass'])
        answer, records, reference = self.fixture()
        records[0]['normalized_result'].pop('artifact')
        self.assertFalse(self.grade(answer, records, reference)['all_factual_checks_pass'])

    def test_faithful_summary_coverage_must_describe_the_single_complete_view(self):
        for field, wrong in [('status', 'page'), ('examined', 0), ('total', 2),
                             ('next_offset', 0), ('exhausted', False), ('examined', 1.0)]:
            with self.subTest(field=field, wrong=wrong):
                answer, records, reference = self.fixture()
                records[0]['normalized_result']['coverage'][field] = wrong
                answer['delivery_observations'][0] = self.observation(records[0])
                report = self.grade(answer, records, reference)
                self.assertTrue(report['factual_checks']['pcap_original_delivery_observations'])
                self.assertFalse(report['all_factual_checks_pass'])

    def test_present_normalized_provenance_requires_string_arrays(self):
        for index in [0, 1]:
            for field in ['limitations', 'unknowns']:
                for wrong in [None, {}, 'scope', [None], [1]]:
                    with self.subTest(index=index, field=field, wrong=wrong):
                        answer, records, reference = self.fixture()
                        records[index]['normalized_result'][field] = wrong
                        answer['delivery_observations'][index] = self.observation(records[index])
                        self.assertFalse(self.grade(answer, records, reference)['all_factual_checks_pass'])
                for empty in [True, False]:
                    answer, records, reference = self.fixture()
                    key = 'normalized_limitations' if field == 'limitations' else field
                    if empty:
                        records[index]['normalized_result'][field] = []
                        answer['delivery_observations'][index][key] = []
                    else:
                        records[index]['normalized_result'].pop(field)
                        answer['delivery_observations'][index].pop(key)
                    self.assertTrue(self.grade(answer, records, reference)['all_factual_checks_pass'])

    def test_missing_or_wrong_kind_does_not_hide_malformed_view_containers(self):
        for index, container in [(0, 'summary'), (1, 'page')]:
            for kind in [None, 'unexpected']:
                for wrong in [None, [], 'view']:
                    with self.subTest(index=index, kind=kind, container=container):
                        answer, records, reference = self.fixture()
                        if kind is None:
                            records[index]['normalized_result'].pop('kind')
                        else:
                            records[index]['normalized_result']['kind'] = kind
                        records[index]['normalized_result'][container] = wrong
                        report = self.grade(answer, records, reference,
                                            producer_tools=['inspect_pcap_capture', 'inspect_analysis_view'])
                        self.assertFalse(report['all_factual_checks_pass'])

    def test_retained_parents_require_declared_distinct_evidence_links(self):
        for index in [0, 1]:
            for links in [None, [], ['ev_' + 'f' * 64], {'parent': 'ev_' + 'a' * 64}]:
                with self.subTest(index=index, links=links):
                    answer, records, reference = self.fixture();records[index]['evidence_links'] = links
                    report = self.grade(answer, records, reference)
                    self.assertTrue(report['factual_checks']['pcap_original_delivery_observations'])
                    self.assertFalse(report['factual_checks']['pcap_cited_parents_linked'])
                    self.assertFalse(report['all_factual_checks_pass'])
            answer, records, reference = self.fixture();records[index].pop('evidence_links')
            self.assertFalse(self.grade(answer, records, reference)['all_factual_checks_pass'])
            answer, records, reference = self.fixture()
            parent = records[index]['evidence_id']
            for record in records:
                record['normalized_result']['parent_evidence_id'] = parent;record['evidence_links'] = [parent]
            answer['delivery_observations'] = [self.observation(record) for record in records]
            report = self.grade(answer, records, reference)
            self.assertFalse(report['factual_checks']['pcap_cited_parents_linked'])
            self.assertFalse(report['all_factual_checks_pass'])

    def test_cited_receipts_preserve_tool_and_delegated_operation_provenance(self):
        for tools in [['inspect_analysis_view', 'inspect_analysis_view'],
                      ['inspect_pcap_capture', 'inspect_pcap_capture'],
                      ['unrelated_tool', 'inspect_analysis_view']]:
            with self.subTest(tools=tools):
                answer, records, reference = self.fixture()
                report = self.grade(answer, records, reference, tools)
                self.assertTrue(report['factual_checks']['pcap_original_delivery_observations'])
                self.assertFalse(report['all_factual_checks_pass'])
        for index in [0, 1]:
            answer, records, reference = self.fixture();records[index]['operation'] = 'inspect_pcap_capture'
            self.assertFalse(self.grade(answer, records, reference)['all_factual_checks_pass'])

    def test_failed_reply_shapes_preserve_a_written_report_and_partial_facts(self):
        payloads = ['malformed', [1], None, False, 7, {'error': 'malformed'},
                    {'error': []}, {'error': None}]
        payloads += [{'error': {'code': 'resource_constraint', 'details': value}}
                     for value in [None, [], 'details']]
        payloads += [{'error': {'code': 'resource_constraint', 'details': {'reported_limits': value}}}
                     for value in [None, [], 'limits']]
        for payload in payloads:
            with self.subTest(payload=payload):
                answer, records, reference = self.fixture()
                result = {'structuredContent': payload}
                event = {'type': 'item.completed', 'item': {
                    'type': 'mcp_tool_call', 'tool': 'inspect_analysis_view', 'status': 'failed',
                    'arguments': {'view': {'kind': 'pcap', 'facet': 'endpoints'}}, 'result': result}}
                report = self.grade(answer, records, reference, extra_events=[event])
                self.assertTrue(report['all_factual_checks_pass'])
                self.assertFalse(report['all_workflow_checks_pass'])
                self.assertEqual(report['tool_errors'][-1]['response'], payload if payload is not None else result)
        answer, records, reference = self.fixture()
        partial_id = 'ev_' + 'e' * 64
        payload = {'error': {'code': 'resource_constraint', 'details': {
            'reported_limits': {'evidence_reference': {'evidence_id': partial_id}}}}}
        event = {'type': 'item.completed', 'item': {
            'type': 'mcp_tool_call', 'tool': 'inspect_analysis_view', 'status': 'failed',
            'arguments': {}, 'result': {'structuredContent': payload}}}
        answer['evidence_ids'].append(partial_id)
        report = self.grade(answer, records, reference, extra_events=[event])
        self.assertTrue(report['factual_checks']['reported_evidence_ids_observed_in_responses'])
        self.assertFalse(report['all_factual_checks_pass'])
        self.assertFalse(report['all_workflow_checks_pass'])

    def test_workflow_citation_count_must_match_the_planned_calls(self):
        for count, made_page_call in [(1, False), (1, True), (3, True)]:
            with self.subTest(count=count, made_page_call=made_page_call):
                answer, records, reference = self.fixture()
                if count == 1:
                    answer['delivery_observations'] = answer['delivery_observations'][:1]
                    answer['evidence_ids'] = answer['evidence_ids'][:1]
                else:
                    extra = copy.deepcopy(answer['delivery_observations'][-1])
                    extra['evidence_id'] = 'ev_' + 'e' * 64
                    answer['delivery_observations'].append(extra)
                    answer['evidence_ids'].append(extra['evidence_id'])
                report = self.grade(answer, records if made_page_call else records[:1], reference)
                self.assertFalse(report['all_factual_checks_pass'])
                self.assertFalse(report['all_workflow_checks_pass'])

    def test_unreadable_planned_reply_does_not_pass_workflow_acceptance(self):
        answer, records, reference = self.fixture()
        report = self.grade(answer, records, reference,
                            producer_results=[{'structuredContent': records[0]}, {}])
        self.assertFalse(report['all_factual_checks_pass'])
        self.assertFalse(report['all_workflow_checks_pass'])

    def test_extra_calls_are_not_an_equivalent_workflow_even_with_correct_facts(self):
        for status in ['completed', 'failed']:
            for with_receipt in [True, False]:
                with self.subTest(status=status, with_receipt=with_receipt):
                    answer, records, reference = self.fixture()
                    extra = copy.deepcopy(records[-1]);extra['evidence_id'] = 'ev_' + 'e' * 64
                    extra['normalized_result']['view']['facet'] = 'endpoints'
                    event = {'type': 'item.completed', 'item': {
                        'type': 'mcp_tool_call', 'tool': 'inspect_analysis_view', 'status': status,
                        'arguments': {'source': {'kind': 'retained-evidence', 'evidence_id': 'ev_' + 'a' * 64},
                                      'view': extra['normalized_result']['view']},
                        'result': {'structuredContent': extra} if with_receipt else {}}}
                    report = self.grade(answer, records, reference, extra_events=[event])
                    self.assertTrue(report['all_factual_checks_pass'])
                    self.assertFalse(report.get('all_workflow_checks_pass', True))
        answer, records, reference = self.fixture()
        report = self.grade(answer, records[::-1], reference)
        self.assertTrue(report['all_factual_checks_pass'])
        self.assertFalse(report.get('all_workflow_checks_pass', True))

    def test_repeated_identical_receipts_pass_but_conflicting_id_ownership_fails(self):
        answer, records, reference = self.fixture();duplicate = copy.deepcopy(records[0])
        report = self.grade(answer, [duplicate, *records], reference)
        self.assertTrue(report['all_factual_checks_pass'])
        self.assertFalse(report['all_workflow_checks_pass'])
        for duplicate_first in [True, False]:
            with self.subTest(duplicate_first=duplicate_first):
                items = [duplicate, *records] if duplicate_first else [*records, duplicate]
                tools = ['unrelated_tool', 'inspect_pcap_capture', 'inspect_analysis_view'] if duplicate_first else \
                        ['inspect_pcap_capture', 'inspect_analysis_view', 'unrelated_tool']
                self.assertFalse(self.grade(answer, items, reference, tools)['all_factual_checks_pass'])
        duplicate = copy.deepcopy(records[-1]);duplicate['normalized_result']['coverage']['exhausted'] = 0
        for items in [[*records, duplicate], [records[0], duplicate, records[-1]]]:
            self.assertFalse(self.grade(answer, items, reference)['all_factual_checks_pass'])

    def test_reported_ids_are_only_the_ordered_unique_response_receipts(self):
        answer, records, reference = self.fixture()
        original = answer['evidence_ids']
        parent = records[0]['normalized_result']['parent_evidence_id']
        for ids in [original + [parent], original + [original[-1]], original[::-1],
                    [parent, *original], [original], {'receipts': original},
                    [*original, {'extra': parent}], original + ['not-an-id']]:
            with self.subTest(ids=ids):
                changed = copy.deepcopy(answer);changed['evidence_ids'] = ids
                report = self.grade(changed, records, reference)
                self.assertFalse(report['factual_checks']['pcap_observations_have_reported_ids'])
                self.assertFalse(report['all_factual_checks_pass'])

    def test_prefix_coverage_must_come_from_the_cited_uri_receipt(self):
        answer, records, reference = self.fixture()
        extra = copy.deepcopy(records[-1]);extra['evidence_id'] = 'ev_' + 'e' * 64
        extra['normalized_result']['coverage']['next_offset'] = None
        extra['normalized_result']['coverage']['exhausted'] = True
        records.append(extra)
        answer['http_request_uris_first2']['coverage'] = extra['normalized_result']['coverage']
        report = self.grade(answer, records, reference)
        self.assertTrue(report['factual_checks']['pcap_original_delivery_observations'])
        self.assertTrue(report['factual_checks']['pcap_cited_source_supports_uri_prefix'])
        self.assertFalse(report['factual_checks']['pcap_prefix_coverage_observed'])
        self.assertFalse(report['all_factual_checks_pass'])


class ContextCaptureTests(unittest.TestCase):
    def test_filters_ambient_account_and_nested_usage_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            home = root / 'home'
            sessions = home / 'sessions'
            sessions.mkdir(parents=True)
            output = root / 'output'
            output.mkdir()
            events = [
                {'type': 'world_state', 'payload': {'state': {'env': 'ambient-marker'}}},
                {'type': 'session_meta', 'payload': {'creator_account_id': 'account-marker'}},
                {'type': 'response_item', 'payload': {
                    'type': 'custom_tool_call_output', 'call_id': 'original-call',
                    'output': 'caller-selected evidence and paths',
                    'internal_chat_message_metadata_passthrough': 'private-marker'}},
                {'type': 'token_usage_record', 'payload': {
                    'response_id': 'original-response', 'usage': {
                        'input_tokens': 12, 'cached_input_tokens': 4,
                        'environment': 'nested-ambient-marker'},
                    'transport_auth': 'auth-marker'}},
            ]
            (sessions / 'rollout.jsonl').write_text(''.join(json.dumps(x) + '\n' for x in events))
            (home / 'auth.json').write_text('copied-credential-marker')
            receipt = capture_tool_context(home, output)
            text = (output / 'codex-tool-context.jsonl').read_text()
            self.assertEqual(receipt['status'], 'captured')
            self.assertEqual(receipt['retained_events'], 2)
            for marker in ['ambient-marker', 'account-marker', 'private-marker',
                           'auth-marker', 'copied-credential-marker']:
                self.assertNotIn(marker, text)
            self.assertIn('caller-selected evidence and paths', text)
            self.assertIn('original-response', text)
            # Windows mode bits do not describe access control; this is a POSIX assertion.
            if os.name == 'posix':
                self.assertEqual((output / 'codex-tool-context.jsonl').stat().st_mode & 0o777, 0o600)

    def test_missing_rollouts_are_unknown_and_malformed_lines_remain_partial(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / 'missing'
            output.mkdir()
            self.assertEqual(capture_tool_context(root / 'home', output)['status'], 'unavailable')
            sessions = root / 'home' / 'sessions'
            sessions.mkdir(parents=True)
            (sessions / 'rollout.jsonl').write_text('not-json\n' + json.dumps({
                'type': 'event_msg', 'payload': {'type': 'token_count', 'info': None}}) + '\n')
            partial = root / 'partial'
            partial.mkdir()
            receipt = capture_tool_context(root / 'home', partial)
            self.assertEqual(receipt['status'], 'partial')
            self.assertEqual(receipt['errors'][0]['line'], 1)
            self.assertEqual(receipt['retained_events'], 1)
        with self.assertRaises(ValueError):
            selected_event({'type': 'token_usage_record', 'payload': {'usage': {'input_tokens': True}}})
        with self.assertRaises(ValueError):
            selected_event({'type': {'environment': 'unexpected'}, 'payload': {}})
        with self.assertRaises(ValueError):
            selected_event({'type': 'response_item', 'timestamp': {'environment': 'unexpected'}, 'payload': {}})
        unknown = selected_event({'type': 'event_msg', 'payload': {'type': 'token_count', 'info': {'model_context_window': None}}})
        self.assertIsNone(unknown['payload']['info']['model_context_window'])

    def test_capture_failure_still_removes_trial_credentials_and_profile(self):
        spec = importlib.util.spec_from_file_location('agent_trial', Path(__file__).with_name('agent-trial.py'))
        agent = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(agent)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            runtime = root / 'runtime'
            (runtime / 'scripts').mkdir(parents=True)
            (runtime / 'scripts' / 'rea.mjs').write_text('')
            (runtime / 'package-lock.json').write_text('{}')
            (runtime / '.nvmrc').write_text('24.22.1\n')
            auth_home = root / 'source-auth'
            auth_home.mkdir()
            (auth_home / 'auth.json').write_text('synthetic-credential')
            question = root / 'question.txt'
            question.write_text('Observe the declared fixture.')
            output = root / 'trial'
            child = Mock(stdin=io.StringIO())
            child.wait.return_value = 0
            arguments = ['agent-trial.py', '--runtime-root', str(runtime), '--revision', 'fixture',
                         '--prompt', str(question), '--output', str(output), '--capture-tool-context']
            with patch.dict(os.environ, {'CODEX_HOME': str(auth_home)}, clear=True), \
                    patch.object(sys, 'argv', arguments), \
                    patch.object(agent.shutil, 'which', return_value='/fixture/node'), \
                    patch.object(agent.subprocess, 'check_output', return_value='v24.22.1\n'), \
                    patch.object(agent.subprocess, 'Popen', return_value=child), \
                    patch.object(agent, 'capture_tool_context', side_effect=OSError('fixture capture failure')), \
                    patch.object(agent.Path, 'home', side_effect=AssertionError('Explicit CODEX_HOME must not resolve the default home')), \
                    patch('builtins.print'):
                with self.assertRaisesRegex(OSError, 'fixture capture failure'):
                    agent.main()
            self.assertFalse(list(output.glob('profile-*')))
            self.assertTrue(json.loads((output / 'cleanup.json').read_text())['profile_removed'])
            self.assertEqual((auth_home / 'auth.json').read_text(), 'synthetic-credential')

    def test_refuses_foreign_session_directory_and_symlink_records(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            home = root / 'home'
            home.mkdir()
            foreign = root / 'foreign'
            foreign.mkdir()
            (foreign / 'rollout.jsonl').write_text('private marker')
            (home / 'sessions').symlink_to(foreign, target_is_directory=True)
            output = root / 'directory-result'
            output.mkdir()
            receipt = capture_tool_context(home, output)
            self.assertEqual(receipt['status'], 'partial')
            self.assertEqual(receipt['retained_events'], 0)
            (home / 'sessions').unlink()
            (home / 'sessions').mkdir()
            (home / 'sessions' / 'linked.jsonl').symlink_to(foreign / 'rollout.jsonl')
            output = root / 'file-result'
            output.mkdir()
            receipt = capture_tool_context(home, output)
            self.assertEqual(receipt['status'], 'partial')
            self.assertEqual(receipt['errors'][0]['reason'], 'not_an_owned_regular_file')
            self.assertEqual((foreign / 'rollout.jsonl').read_text(), 'private marker')

    def test_guidance_requires_selected_tools_before_acquiring_a_profile(self):
        spec = importlib.util.spec_from_file_location('agent_trial', Path(__file__).with_name('agent-trial.py'))
        agent = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(agent)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / 'trial'
            arguments = ['agent-trial.py', '--runtime-root', str(root), '--revision', 'fixture',
                         '--prompt', str(root / 'question'), '--output', str(output), '--guide-enabled-tools']
            with patch.object(sys, 'argv', arguments), patch.object(sys, 'stderr', io.StringIO()):
                with self.assertRaises(SystemExit) as raised:
                    agent.main()
            self.assertEqual(raised.exception.code, 2)
            self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
