"""Display/map regressions. No live fiscal jobs or customer display changes."""
import ast
import json
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch
from PIL import Image
from display import require_display, machine_check
from ui_map import UI_MAP, point, payment_points

ROOT=Path(__file__).parent

class LayoutMapTests(unittest.TestCase):
    def test_every_reference_has_its_exact_unscaled_region_and_navigation_point(self):
        self.assertEqual({p.stem for p in (ROOT/'profiles').glob('*.png')},set(UI_MAP['screens']))
        for name,profile in UI_MAP['screens'].items():
            with Image.open(ROOT/'profiles'/(name+'.png')) as image:
                self.assertEqual(image.size,tuple(profile['region'][2:]),name)
            for target in profile['points'].values():
                self.assertTrue(0<=target[0]<1384 and 0<=target[1]<786,name)
            if 'navigation' in profile:
                n=profile['navigation'];x,y=n['point'];left,top,w,h=n['region']
                self.assertTrue(left<=x<left+w and top<=y<top+h,name)
                self.assertEqual(UI_MAP['screens'][n['profile']]['region'],n['region'])

    def test_critical_observed_points_and_payment_choices_remain_unchanged(self):
        self.assertEqual(point('registration','save'),(1194,89))
        self.assertEqual(point('detail','approve'),(70,179))
        self.assertEqual(point('print','print_a4'),(390,198))
        self.assertEqual(payment_points,{'01':(84,307),'02':(236,307),'03':(390,307),'04':(540,379),'05':(236,379),'06':(390,379),'07':(540,307)})

    def test_navigation_workflow_has_no_literal_click_or_field_coordinates(self):
        for filename in ('client.py','workflow.py','engine.py'):
            for node in ast.walk(ast.parse((ROOT/filename).read_text(encoding='utf-8'))):
                if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and node.func.attr in ('click','text','expect','action','value'):
                    index=2 if node.func.attr=='action' else 1
                    if len(node.args)>index+1:
                        self.assertFalse(isinstance(node.args[index],ast.Constant) and isinstance(node.args[index+1],ast.Constant),filename)

    def test_display_preflight_is_read_only_and_rejects_unsupported_settings(self):
        with patch('workflow.ps',return_value=json.dumps({'ready':False,'problem':'Unsupported display settings'})) as execute:
            with self.assertRaisesRegex(ValueError,'Unsupported display'):require_display(123)
            execute.assert_called_once_with('tools/display-state.ps1','-TargetProcessId','123')
        with patch('workflow.ps',return_value=json.dumps({'ready':True,'geometry':{'Scale':125}})):
            self.assertTrue(require_display(123)['ready'])
        with patch('workflow.ps') as execute:
            self.assertTrue(require_display(123,{'ready':True})['ready'])
            execute.assert_not_called() # Normal checkout reuses its existing state read.

    def test_machine_check_does_not_use_database_identity_or_start_native_application(self):
        with patch('display.settings',return_value={'installation_dir':'missing-fixture'}),patch('workflow.ps',return_value=json.dumps({'read_only':True,'ready':False,'displays':[]})) as execute:
            report=machine_check()
        self.assertFalse(report['build_matches']);self.assertTrue(report['read_only'])
        self.assertEqual(execute.call_args.args[0],'tools/machine-check.ps1')
        self.assertNotIn('database',json.dumps(report))

    def test_failure_diagnostics_are_read_only_never_replay_the_action(self):
        from workflow import Ui
        with patch('workflow.ps') as execute:
            Ui(123).diagnose({'reference':str(ROOT/'profiles/sales.png'),'regions':[UI_MAP['screens']['sales']['region']]})
        self.assertEqual(execute.call_count,1)
        self.assertEqual(execute.call_args.args[0],'ui-step.ps1')

    def test_unsupported_monitor_stops_engine_before_product_planning_or_navigation(self):
        from engine import Engine
        from test_companion import sale, CONFIG
        engine=Engine.__new__(Engine);engine.store=None
        native={'registered_devices':[{'TIN':CONFIG['taxpayer_pin'],'BHF_ID':CONFIG['branch_id']}],'process_ids':[123]}
        with patch('engine.require_identity',return_value={**CONFIG,'installation_dir':'fixture'}),patch('engine.require_offline'),patch('engine.Path') as path,\
             patch('engine.hashlib.sha256') as sha,patch('engine.workflow.read_state',return_value=native),patch('engine.require_ui_access'),\
             patch('display.require_display',side_effect=ValueError('Unsupported display settings')),patch('engine.plan') as plan,patch('engine.Client') as client:
            sha.return_value.hexdigest.return_value=UI_MAP['client_sha256']
            with self.assertRaisesRegex(ValueError,'Unsupported display'):engine.prepare(sale())
            plan.assert_not_called();client.assert_not_called()

@unittest.skipUnless(os.name=='nt','Actual Windows geometry/UIA fixture')
class WindowsDisplayTests(unittest.TestCase):
    def test_physical_bounds_guards_matrix_and_real_current_display(self):
        result=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',str(ROOT/'test-display-geometry.ps1')],
                              capture_output=True,timeout=60,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        self.assertEqual(result.returncode,0,result.stderr.decode(errors='replace'))
        report=json.loads(result.stdout.decode('utf-8-sig'))
        self.assertTrue(report['passed']);self.assertTrue(report['actual_uia_win32_bounds_equal'])
        self.assertTrue(report['actual_fixture_move_detected']);self.assertFalse(report['real_etims_input'])
        self.assertEqual(len(report['synthetic_matrix']),12)

if __name__=='__main__':unittest.main()
