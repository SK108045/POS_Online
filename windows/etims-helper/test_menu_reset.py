"""User-authorized UI takeover, without creating/saving any fiscal records."""
import unittest
from unittest.mock import patch, call
from client import Client


class MenuResetTests(unittest.TestCase):
    def reset(self, screens, files=None):
        with patch.object(Client, 'detect', side_effect=screens), \
                patch.object(Client, 'file_state', side_effect=files, return_value={'file_dialog': None}), \
                patch.object(Client, 'action') as action, \
                patch('client.require_offline') as offline, patch('client.ps') as execute:
            Client(123).reset_menu()
        return action, offline, execute

    def test_unsaved_manual_sale_is_closed_without_save_or_approval(self):
        action, _, execute = self.reset(['registration', 'close-confirm', 'sales', 'menu'])
        self.assertEqual(action.call_args_list, [call('registration', 'Close', 1314, 89),
            call('close-confirm', 'Click', 705, 530), call('sales', 'Close', 1314, 89)])
        execute.assert_not_called()

    def test_pending_approval_and_new_record_confirmations_are_declined(self):
        for screen in ('approve-confirm', 'new-confirm', 'stock-confirm', 'customer-confirm', 'new-customer'):
            action, _, _ = self.reset([screen, 'menu'])
            action.assert_called_once_with(screen, 'Click', 885, 530)

    def test_saved_acknowledgement_does_not_block_next_sale(self):
        action, _, _ = self.reset(['saved', 'sales', 'menu'])
        self.assertEqual(action.call_args_list, [call('saved', 'Click', 885, 530),
                                                call('sales', 'Close', 1314, 89)])

    def test_native_open_or_save_dialog_is_cancelled_once_before_navigation(self):
        for title in ('Open', 'Save Print Output As'):
            action, offline, execute = self.reset(['detail', 'sales', 'menu'],
                [{'file_dialog': title}] + [{'file_dialog': None}] * 3)
            offline.assert_called_once()
            execute.assert_called_once_with('tools/cancel-file-dialog.ps1', '-TargetProcessId', '123', '-DialogTitle', title)
            self.assertEqual(action.call_args_list, [call('detail', 'Close', 1314, 89), call('sales', 'Close', 1314, 89)])

    def test_popup_takeover_cancels_selection_before_closing_manual_sale(self):
        for popup in ('item-popup','customer-popup'):
            action, _, _ = self.reset([popup, 'registration', 'close-confirm', 'sales', 'menu'])
            self.assertEqual(action.call_args_list[0],call(popup,'Close',1194,89))
            self.assertNotIn(call(popup,'Close',1314,89),action.call_args_list)

    def test_canvas_navigation_requires_both_page_and_correct_button_reference(self):
        for screen,point,profile in [('item-popup',1194,'toolbar-cancel'),('customer-popup',1194,'toolbar-cancel'),
                                     ('customer',1314,'toolbar-back'),('detail',1314,'toolbar-close')]:
            with patch.object(Client,'send') as send:
                Client(123).close_page(screen)
                instruction=send.call_args.args[0]
                self.assertEqual(instruction['x'],point)
                self.assertTrue(instruction['navigation_reference'].endswith(profile+'.png'))
                self.assertTrue(instruction['reference'].endswith(screen+'.png'))
        with patch.object(Client,'send') as send:
            with self.assertRaisesRegex(ValueError,'Unverified'):Client(123).action('item-popup','Close',1314,89)
            send.assert_not_called()

    def test_file_cancellation_requires_existing_offline_rules(self):
        with patch.object(Client, 'file_state', return_value={'file_dialog': 'Open'}), \
                patch('client.require_offline', side_effect=ValueError('Blocking missing')), \
                patch('client.ps') as execute, patch.object(Client, 'action') as action:
            with self.assertRaisesRegex(ValueError, 'Blocking missing'): Client(123).reset_menu()
            execute.assert_not_called(); action.assert_not_called()

    def test_unknown_page_is_never_clicked(self):
        with patch.object(Client, 'detect', return_value='unknown'), \
                patch.object(Client, 'file_state', return_value={'file_dialog': None}), \
                patch.object(Client, 'action') as action:
            with self.assertRaisesRegex(ValueError, 'Unrecognized'): Client(123).reset_menu()
            action.assert_not_called()

    def test_repeated_known_page_stops_at_bounded_limit(self):
        with patch.object(Client, 'detect', return_value='sales'), \
                patch.object(Client, 'file_state', return_value={'file_dialog': None}), \
                patch.object(Client, 'action') as action:
            with self.assertRaisesRegex(RuntimeError, 'no sale was submitted'): Client(123).reset_menu()
            self.assertEqual(action.call_count, 18)


if __name__ == '__main__': unittest.main()
