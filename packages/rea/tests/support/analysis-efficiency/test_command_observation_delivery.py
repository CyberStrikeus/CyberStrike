"""A truncated summary must never qualify as a completed investigation."""
from copy import deepcopy
import unittest
from command_observation_delivery import verify_command_delivery


class CommandDelivery(unittest.TestCase):
    def test_truncation_is_accepted_only_for_complete_default_baseline(self):
        truncated = {'_invalid_json_payload': '{truncated'}
        self.assertFalse(verify_command_delivery(truncated, {}, 'complete', 0))
        for mode, budget in [
            ('summary', 0), ('summary', 30000), ('complete', 30000),
        ]:
            with self.subTest(mode=mode, budget=budget):
                with self.assertRaises(AssertionError):
                    verify_command_delivery(truncated, {}, mode, budget)

    def test_valid_complete_answer_can_complete_under_either_budget(self):
        parent = {'evidence_id': 'parent'}
        for budget in [0, 30000]:
            self.assertTrue(
                verify_command_delivery(parent, parent, 'complete', budget)
            )
        with self.assertRaises(AssertionError):
            verify_command_delivery({'error': 'failed command'}, parent, 'complete', 0)

    def test_summary_must_preserve_every_record_and_accurate_stream_counts(self):
        report = {
            'command': 'disassemble /r entry', 'mi': '7^done',
            'records': ['~"🧪\\n"', '=async', 'unknown', '7^done'],
            'console': '🧪', 'target': '', 'log': '',
            'completion_status': 'complete', 'output_truncated': False,
        }
        parent = {
            'evidence_id': 'parent',
            'parameters': {'command': report['command']},
            'provider': {'id': 'gdb'}, 'analysis_profile': None,
            'normalized_result': report,
        }
        facts = {
            key: value for key, value in report.items()
            if key not in ('console', 'target', 'log')
        }
        selected = {
            'evidence_id': 'derived', 'raw_result': None, 'subject': None,
            'normalized_result': {
                'parent_evidence_id': 'parent', 'artifact': None,
                'source_analysis_profile_digest': None,
                'source_parameters': parent['parameters'],
                'source_provider': parent['provider'],
                'summary': {
                    **facts,
                    'available_counts': {
                        'records': 4, 'console_utf16_units': 2,
                        'target_utf16_units': 0, 'log_utf16_units': 0,
                    },
                },
            },
        }
        self.assertTrue(verify_command_delivery(selected, parent, 'summary', 0))
        for damage in ['records', 'counts', 'parameters', 'profile']:
            bad = deepcopy(selected)
            result = bad['normalized_result']
            if damage == 'records':
                result['summary']['records'].pop(1)
            elif damage == 'counts':
                result['summary']['available_counts']['console_utf16_units'] = 1
            elif damage == 'profile':
                result['source_analysis_profile_digest'] = 'wrong'
            else:
                result['source_parameters'] = {}
            with self.subTest(damage=damage):
                with self.assertRaises(AssertionError):
                    verify_command_delivery(bad, parent, 'summary', 0)
        parent['analysis_profile'] = {'digest': 'recorded-profile'}
        selected['normalized_result']['source_analysis_profile_digest'] = 'recorded-profile'
        self.assertTrue(verify_command_delivery(selected, parent, 'summary', 0))


if __name__ == '__main__':
    unittest.main()
