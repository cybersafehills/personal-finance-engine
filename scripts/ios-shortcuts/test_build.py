"""Regression checks for the published iPhone pairing/capture protocol."""
import unittest
from build import connect, capture, unified, uid

class ShortcutReleaseTests(unittest.TestCase):
    def test_connect_uses_input_not_clipboard(self):
        actions = connect()['WFWorkflowActions']
        self.assertNotIn('getclipboard', str(actions))
        self.assertIn("'Type': 'ExtensionInput'", str(actions[0]))
        request = next(a for a in actions if a['WFWorkflowActionIdentifier'].endswith('downloadurl'))
        self.assertIn(uid('pair-input'), str(request))

    def test_secret_has_six_independent_random_outputs(self):
        actions = connect()['WFWorkflowActions']
        secret = next(a for a in actions if a['WFWorkflowActionParameters']['UUID'] == uid('device-secret'))
        refs = secret['WFWorkflowActionParameters']['WFTextActionText']['Value']['attachmentsByRange'].values()
        self.assertEqual(6, len({r['OutputUUID'] for r in refs}))

    def test_save_only_in_success_branch(self):
        actions = connect()['WFWorkflowActions']
        position = {a['WFWorkflowActionParameters']['UUID']: i for i, a in enumerate(actions)}
        self.assertLess(position[uid('pair-success-if')], position[uid('save-config')])
        self.assertLess(position[uid('save-config')], position[uid('pair-success-else')])
        self.assertNotIn('save-config', str(capture()))

    def test_condition_inputs_use_apples_variable_wrapper(self):
        for workflow in (connect(), capture()):
            for action in workflow['WFWorkflowActions']:
                p = action['WFWorkflowActionParameters']
                if action['WFWorkflowActionIdentifier'].endswith('conditional') and p['WFControlFlowMode'] == 0:
                    self.assertEqual(100, p['WFCondition'])
                    self.assertEqual('Variable', p['WFInput']['Type'])
                    self.assertEqual('WFTextTokenAttachment', p['WFInput']['Variable']['WFSerializationType'])

    def test_background_capture_has_no_picker_and_no_payment_test(self):
        actions = capture()['WFWorkflowActions']
        file = next(a for a in actions if a['WFWorkflowActionIdentifier'].endswith('documentpicker.open'))
        self.assertIs(False, file['WFWorkflowActionParameters']['WFShowFilePicker'])
        request = next(a for a in actions if a['WFWorkflowActionParameters']['UUID'] == uid('test-request'))
        self.assertIn("'string': 'test'", str(request))
        self.assertNotIn("'string': 'message'", str(request))

class UnifiedShortcutTests(unittest.TestCase):
    def test_all_output_references_resolve(self):
        workflow = unified()
        ids = {a['WFWorkflowActionParameters']['UUID'] for a in workflow['WFWorkflowActions']}
        def check(value):
            if isinstance(value, dict):
                if 'OutputUUID' in value: self.assertIn(value['OutputUUID'], ids)
                for v in value.values(): check(v)
            elif isinstance(value, list):
                for v in value: check(v)
        check(workflow)

    def test_pairing_requires_explicit_confirmation_before_network(self):
        actions = unified()['WFWorkflowActions']
        self.assertEqual(8, actions[1]['WFWorkflowActionParameters']['WFCondition'])
        self.assertEqual('olp_', actions[1]['WFWorkflowActionParameters']['WFConditionalActionString'])
        alert = actions[2]
        self.assertTrue(alert['WFWorkflowActionIdentifier'].endswith('alert'))
        self.assertTrue(alert['WFWorkflowActionParameters']['WFAlertActionCancelButtonShown'])
        capture_start = next(i for i,a in enumerate(actions) if a['WFWorkflowActionParameters']['UUID']==uid('has-token-else'))
        self.assertNotIn('is.workflow.actions.alert', str(actions[capture_start:]))

    def test_missing_configuration_is_handled_without_a_picker(self):
        file = next(a for a in unified()['WFWorkflowActions'] if a['WFWorkflowActionIdentifier'].endswith('documentpicker.open'))
        self.assertFalse(file['WFWorkflowActionParameters']['WFShowFilePicker'])
        self.assertFalse(file['WFWorkflowActionParameters']['WFFileErrorIfNotFound'])

if __name__ == '__main__': unittest.main()
