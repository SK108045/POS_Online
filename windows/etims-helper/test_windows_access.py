"""Privilege preflight and startup repair guards; no elevated actions in tests."""
import os
from contextlib import closing
import sqlite3
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

import windows_access


class AccessTests(unittest.TestCase):
    def test_higher_integrity_client_is_rejected_before_ui(self):
        levels=[dict(session=1,integrity=0x2000,elevated=False),
                dict(session=1,integrity=0x3000,elevated=True)]
        with patch('windows_access.process_access',side_effect=levels):
            with self.assertRaisesRegex(ValueError,'Repair eTIMS Helper Access'):
                windows_access.require_ui_access(123)

    def test_matching_administrator_or_normal_levels_are_allowed(self):
        for integrity in (0x2000,0x3000):
            level=dict(session=1,integrity=integrity,elevated=integrity==0x3000)
            with patch('windows_access.process_access',return_value=level):
                windows_access.require_ui_access(123)

    def test_different_windows_sessions_are_rejected(self):
        with patch('windows_access.process_access',side_effect=[
            dict(session=1,integrity=0x3000),dict(session=2,integrity=0x2000)]):
            with self.assertRaisesRegex(ValueError,'same signed-in'):
                windows_access.require_ui_access(123)

    @unittest.skipUnless(os.name=='nt','Windows token metadata')
    def test_current_process_access_is_readable(self):
        access=windows_access.process_access(os.getpid())
        self.assertIsInstance(access['integrity'],int)
        self.assertIsInstance(access['session'],int)
        self.assertEqual(access['elevated'],windows_access.is_elevated())

    def test_repair_refuses_running_jobs_and_automation_lock(self):
        import repair_access
        with tempfile.TemporaryDirectory() as folder:
            home=Path(folder)
            with closing(sqlite3.connect(home/'companion.sqlite3')) as db:
                with db:
                    db.execute('CREATE TABLE jobs (state TEXT)')
                    db.execute("INSERT INTO jobs VALUES ('entering_invoice')")
            with patch('repair_access.HOME',home):
                with self.assertRaisesRegex(ValueError,'invoice is running'):repair_access.ensure_idle()
                with closing(sqlite3.connect(home/'companion.sqlite3')) as db:
                    with db:db.execute("UPDATE jobs SET state='review_required'")
                repair_access.ensure_idle()
                (home/'active-run.lock').write_text('fixture')
                with self.assertRaisesRegex(ValueError,'recovery lock'):repair_access.ensure_idle()

    def test_repair_requires_offline_guard_before_startup_changes(self):
        import repair_access
        with patch('repair_access.settings',return_value={'helper_exe':str(Path(__import__('sys').executable).resolve())}),patch('offline.require_offline',side_effect=ValueError('Offline guard missing')),patch('repair_access.install') as install:
            with self.assertRaisesRegex(ValueError,'Offline guard'):repair_access.repair()
            install.assert_not_called()


if __name__=='__main__':unittest.main()
