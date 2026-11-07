"""Reject incomplete status delivery and incorrect retained-source claims."""
from copy import deepcopy
import unittest
from frida_status_delivery import verify_frida_delivery


class FridaDelivery(unittest.TestCase):
    def fixture(self):
        session = {'session_id': 'selected', 'pid': 12}
        payloads = [{'kind': 'module', 'pid': 12, 'total': 1001}, {'kind': 'exports', 'offset': 0, 'items': [None] * 1001}, {'kind': 'complete', 'total': 1001}]
        facts = {**session, 'state': 'running', 'messages_truncated': False, 'messages': [{'type': 'send', 'payload': p} for p in payloads]}
        parent = {'evidence_id': 'ev_parent', 'operation': 'frida_session_status', 'authority': 'external-service', 'environment': None, 'raw_result': None, 'subject': None, 'parameters': {'session_id': 'selected'}, 'provider': {'id': 'frida'}, 'normalized_result': facts}
        summary = {'evidence_id': 'ev_summary', 'subject': None, 'raw_result': None, 'authority': 'external-service', 'normalized_result': {
            'parent_evidence_id': 'ev_parent', 'parent_digest': 'parent', 'parent_operation': 'frida_session_status', 'artifact': None,
            'source_parameters': parent['parameters'], 'source_provider': parent['provider'], 'unknowns': ['historical snapshot'], 'limitations': ['parent retained'],
            'summary': {**{k: v for k, v in facts.items() if k != 'messages'}, 'messages_retained': 3}}}
        return session, parent, summary

    def test_truncated_summary_never_qualifies(self):
        truncated = {'_invalid_json_payload': 'truncated'}
        self.assertIsNone(verify_frida_delivery(truncated, {}, 'complete', 0, {}))
        for mode, budget in [('summary', 0), ('summary', 300000), ('complete', 300000)]:
            with self.subTest(mode=mode, budget=budget), self.assertRaises(AssertionError):
                verify_frida_delivery(truncated, {}, mode, budget, {})

    def test_complete_and_summary_require_correct_facts_and_source(self):
        session, parent, summary = self.fixture()
        for mode, delivered in [('complete', parent), ('summary', summary)]:
            self.assertEqual(verify_frida_delivery(delivered, {'records': [parent, summary]}, mode, 300000, session)['exports'], 1001)
        for field in ['messages_retained', 'state', 'messages', 'source_parameters', 'parent_digest', 'source_provider']:
            broken = deepcopy(summary)
            target = broken['normalized_result']['summary'] if field in ['messages_retained', 'state', 'messages'] else broken['normalized_result']
            target[field] = 'incorrect'
            with self.subTest(field=field), self.assertRaises(AssertionError):
                verify_frida_delivery(broken, {'records': [parent, broken]}, 'summary', 0, session)

    def test_missing_native_chunk_and_wrong_session_fail(self):
        session, parent, _ = self.fixture()
        broken = deepcopy(parent)
        broken['normalized_result']['messages'][1]['payload']['items'].pop()
        with self.assertRaises(AssertionError):
            verify_frida_delivery(broken, {'records': [broken]}, 'complete', 300000, session)
        with self.assertRaises(AssertionError):
            verify_frida_delivery(parent, {'records': [parent]}, 'complete', 300000, {**session, 'session_id': 'other'})


if __name__ == '__main__':
    unittest.main()
