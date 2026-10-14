"""Single verified physical-pixel layout. No scaling or inferred coordinates."""
import json
from settings import ASSETS

UI_MAP=json.loads((ASSETS/'profiles/ui-map.json').read_text(encoding='utf-8'))
if UI_MAP.get('schema')!=1 or UI_MAP['layout']['coordinate_space']!='physical_window_frame':
    raise ValueError('Unsupported eTIMS UI map')

def point(screen,name):
    return tuple(UI_MAP['screens'][screen]['points'][name])

def region(screen):
    return UI_MAP['screens'][screen]['region']

payment_points={code:point('payment',code) for code in ('01','02','03','04','05','06','07')}
