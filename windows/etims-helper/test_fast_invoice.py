"""Unit tests for the fast programmatic eTIMS invoice issuance engine."""
import json
import unittest
from pathlib import Path
from contracts import validate, digest
from fast_invoice import find_generator_exe, sale_to_request, issue_programmatic
from settings import settings


class FastInvoiceTests(unittest.TestCase):
    def test_generator_exe_exists(self):
        exe = find_generator_exe()
        self.assertTrue(exe.is_file(), f"Generator executable not found at {exe}")

    def test_sale_to_request_mapping(self):
        sale = {
            'version': 2,
            'currency': 'KES',
            'shop_id': 'fixture_shop',
            'sale_id': 1234,
            'receipt_no': 'REC-999',
            'customer': {
                'pin': 'A002257602W',
                'name': 'Test Zack',
                'phone': '0712345678',
                'email': 'zack@example.com'
            },
            'payment_method': 'cash',
            'subtotal_cents': 260000,
            'total_cents': 260000,
            'tax_cents': 0,
            'discount': {'amount_cents': 0},
            'items': [
                {
                    'product_key': 'prod-1',
                    'item_code': 'KE-2OUXNOX-0000001',
                    'name': 'Book 1',
                    'quantity': 1,
                    'unit_price_cents': 130000,
                    'line_total_cents': 130000
                },
                {
                    'product_key': 'prod-2',
                    'name': 'Book 2',
                    'quantity': 1,
                    'unit_price_cents': 130000,
                    'line_total_cents': 130000
                }
            ]
        }
        mappings = {'prod-2': 'KE-2OUXNOX-0000002'}
        req = sale_to_request(sale, mappings)

        self.assertEqual(req['BuyerPin'], 'A002257602W')
        self.assertEqual(req['BuyerName'], 'Test Zack')
        self.assertEqual(req['PaymentCode'], '01')
        self.assertEqual(len(req['Items']), 2)
        self.assertEqual(req['Items'][0]['ItemCode'], 'KE-2OUXNOX-0000001')
        self.assertEqual(req['Items'][1]['ItemCode'], 'KE-2OUXNOX-0000002')
        self.assertEqual(req['Items'][0]['UnitPrice'], 1300.0)
        self.assertEqual(req['Items'][0]['Quantity'], 1.0)
        self.assertEqual(req['PosSaleDigest'], digest(sale))

    def test_end_to_end_programmatic_issuance(self):
        config = settings()
        sale = {
            'version': 2,
            'currency': 'KES',
            'shop_id': 'fixture_shop',
            'sale_id': 501,
            'receipt_no': 'REC-501',
            'customer': {
                'pin': 'A002257602W',
                'name': 'Zack'
            },
            'payment_method': 'mpesa',
            'subtotal_cents': 130000,
            'total_cents': 130000,
            'tax_cents': 0,
            'discount': {'amount_cents': 0},
            'items': [
                {
                    'product_key': 'prod-book',
                    'item_code': 'KE-2OUXNOX-0000001',
                    'name': 'Book',
                    'quantity': 1,
                    'unit_price_cents': 130000,
                    'line_total_cents': 130000
                }
            ]
        }
        validate(sale)
        key = digest([sale['shop_id'], sale['sale_id'], sale['receipt_no']])

        checkpoints = []
        def on_checkpoint(stage):
            checkpoints.append(stage)

        raw = issue_programmatic(sale, config, key, checkpoint=on_checkpoint)

        self.assertIn('preparing', checkpoints)
        self.assertIn('issuing', checkpoints)
        self.assertIn('complete', checkpoints)

        self.assertTrue(raw['local_invoice_id'] > 0)
        self.assertTrue(raw['cu_invoice_number'].startswith(config.get('taxpayer_pin')[:3]) or 'KRACU' in raw['cu_invoice_number'])
        self.assertEqual(len(raw['receipt_signature']), 16)
        self.assertTrue(raw['qr_code']['payload'].startswith('https://etims.kra.go.ke/'))
        self.assertTrue(Path(raw['qr_code']['image']).is_file())
        self.assertLess(raw['execution_ms'], 2000, "Issuance must complete in under 2 seconds")


if __name__ == '__main__':
    unittest.main()
