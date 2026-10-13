"""Readiness, print retry ownership and original QR preservation regressions."""
import hashlib
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

import fitz
from PIL import Image
import pdf_invoice
import workflow
from timing import Timings, record_run, span, mark


class PerformanceSafety(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory(prefix='etims-performance-test-')
        self.addCleanup(folder.cleanup)
        self.home = Path(folder.name)

    def test_delayed_field_value_is_observed_without_reentering_input(self):
        ui = workflow.Ui(123)
        with patch.object(ui, 'action') as action, patch.object(ui, 'value', side_effect=['', 'still painting', 'EXPECTED']) as read, patch('workflow.time.sleep'):
            ui.text('registration', 1, 2, 'EXPECTED')
            action.assert_called_once_with('registration', 'Text', 1, 2, 'EXPECTED')
            self.assertEqual(read.call_count, 3)

    def test_wrong_field_eventually_fails_without_click_or_text_retry(self):
        ui = workflow.Ui(123)
        with patch.object(ui, 'value', return_value='999'), patch.object(ui, 'action') as action, patch('workflow.time.monotonic', side_effect=[0, 4]):
            with self.assertRaisesRegex(ValueError, 'does not match'):
                ui.expect('registration', 1, 2, '20', numeric=True)
            action.assert_not_called()

    def test_only_preinput_file_dialog_discovery_is_retryable(self):
        ui = Mock(pid=123)
        ui.send.side_effect = [RuntimeError('ui-step.ps1 failed (file dialog not ready)'), 'ok']
        with patch('workflow.time.sleep'):
            workflow.choose_print_path(ui, self.home/'new.pdf')
        self.assertEqual(ui.send.call_count, 2)
        for message in ('Windows worker timed out', 'File path was not accepted', 'Open action failed', 'Ambiguous file dialog'):
            ui.reset_mock(); ui.send.side_effect = RuntimeError(message)
            with self.assertRaisesRegex(RuntimeError, message):
                workflow.choose_print_path(ui, self.home/'new.pdf')
            ui.send.assert_called_once()

    def test_print_output_created_after_dispatch_cannot_trigger_another_save(self):
        path = self.home/'already-written.pdf'
        path.write_bytes(b'%PDF')
        ui = Mock(pid=123)
        ui.send.side_effect = RuntimeError('ui-step.ps1 failed (file dialog not ready)')
        with self.assertRaises(RuntimeError):
            workflow.choose_print_path(ui, path)
        ui.send.assert_called_once()

    def test_partial_print_output_is_waited_for_without_printing_again(self):
        path = self.home/'printed.pdf'
        with fitz.open() as document:
            document.new_page().insert_text((20, 30), 'Fixture only')
            complete = document.tobytes()
        path.write_bytes(complete[:100])
        def finish():
            time.sleep(.12)
            path.write_bytes(complete)
        thread = threading.Thread(target=finish)
        thread.start()
        try:
            workflow.wait_pdf(path, seconds=2)
        finally:
            thread.join()
        self.assertEqual(path.read_bytes(), complete)

    def test_invalid_pdf_with_eof_cannot_be_accepted(self):
        path = self.home/'invalid.pdf'
        path.write_bytes(b'garbage\n%%EOF')
        with patch('workflow.time.monotonic', side_effect=[0, 2]):
            with self.assertRaisesRegex(RuntimeError, 'did not become complete'):
                workflow.wait_pdf(path, seconds=1)

    def test_original_embedded_qr_is_preserved_and_page_render_is_lazy(self):
        image = self.home/'square.png'
        Image.new('RGB', (90, 90), 'white').save(image)
        path = self.home/'invoice.pdf'
        with fitz.open() as document:
            document.new_page().insert_image(fitz.Rect(0, 0, 90, 90), filename=str(image))
            document.save(path)
        output = self.home/'assets'; output.mkdir()
        with fitz.open(path) as document:
            original = document.extract_image(document[0].get_images()[0][0])['image']
        with patch('pdf_invoice.decode_qr', return_value={'text':'https://itax.kra.go.ke/verify?Data=FIXTURE'}) as decode, patch.object(fitz.Page, 'get_pixmap', side_effect=AssertionError('Unnecessary full-page rendering')):
            result = pdf_invoice.find_original_qr(path, output)
        decode.assert_called_once()
        self.assertEqual(result['source'], 'original_embedded_image')
        self.assertEqual(Path(result['image']).read_bytes(), original)
        self.assertEqual(result['sha256'], hashlib.sha256(original).hexdigest())

    def test_thorough_qr_fallback_remains_available(self):
        path = self.home/'vector.pdf'
        with fitz.open() as document:
            document.new_page(width=150, height=150)
            document.save(path)
        output = self.home/'vector-assets'; output.mkdir()
        def decode(image, thorough=False):
            return {'text':'https://kra.go.ke/verify?Data=FIXTURE'} if thorough else None
        with patch('pdf_invoice.decode_qr', side_effect=decode) as decoder:
            result = pdf_invoice.find_original_qr(path, output)
        self.assertEqual(decoder.call_count, 2)
        self.assertEqual(result['source'], 'original_page_render')

    def test_foreign_qr_is_never_returned_as_a_kra_verification_code(self):
        path = self.home/'foreign.pdf'
        with fitz.open() as document:
            document.new_page(width=100, height=100)
            document.save(path)
        output = self.home/'foreign-assets'; output.mkdir()
        with patch('pdf_invoice.decode_qr', return_value={'text':'https://kra.go.ke.example.com/fake'}):
            self.assertIsNone(pdf_invoice.find_original_qr(path, output))

    def test_timing_output_has_only_fixed_labels_and_durations(self):
        path = self.home/'timings.json'
        with record_run(path) as recorder:
            with span('pdf_extract'):
                mark('issued')
                recorder.script('ui-step.ps1', .25)
            with self.assertRaises(ValueError):
                recorder.mark('PRIVATE-BUYER-OR-TOKEN')
            with self.assertRaises(ValueError):
                recorder.script('PRIVATE-BUYER-OR-TOKEN', 1)
            with self.assertRaises(ValueError):
                with recorder.span('PRIVATE-BUYER-OR-TOKEN'):
                    pass
        raw = path.read_text()
        self.assertNotIn('PRIVATE', raw)
        report = json.loads(raw)
        self.assertTrue(report['phases'][0]['ok'])
        self.assertEqual(report['scripts']['ui-step.ps1']['calls'], 1)

    def test_failed_phase_records_no_exception_contents(self):
        path = self.home/'failure-timing.json'
        with self.assertRaises(RuntimeError):
            with record_run(path):
                with span('print_dialog'):
                    raise RuntimeError('PRIVATE-CREDENTIAL')
        self.assertNotIn('PRIVATE', path.read_text())
        self.assertFalse(json.loads(path.read_text())['phases'][0]['ok'])

    def test_invoice_polling_uses_small_fresh_read_not_whole_product_catalog(self):
        with patch('workflow.require_identity', return_value=dict(taxpayer_pin='A123456789B',branch_id='01',installation_dir='fixture',database_path='fixture.db')), patch('workflow.ps', return_value='{}') as ps:
            workflow.read_state('fixture', 5)
            self.assertEqual(ps.call_args.args[-2:], ('-Scope', 'Invoice'))
            workflow.read_state('fixture')
            self.assertEqual(ps.call_args.args[-2:], ('-Scope', 'Full'))


if __name__ == '__main__':
    unittest.main()
