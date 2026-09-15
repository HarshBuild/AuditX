from merge import merge_results
from rules import evaluate

per = [
    {'index': 0, 'image_id': 'image_1', 'text': 'Nanak Besan Mix', 'language': 'und', 'confidence': 0.99,
     'fields': {'commodity_name': 'Nanak Besan Mix', 'net_quantity': '250 g', 'mrp': 'Rs 64.00'},
     'field_confidence': {'commodity_name': 'high', 'net_quantity': 'high', 'mrp': 'medium'},
     'field_evidence': {'commodity_name': {'text': 'Nanak Besan Mix', 'confidence': 0.99, 'bbox': [1, 2, 3, 4]}},
     'regions': [{'text': 'Nanak Besan Mix'}]},
    {'index': 1, 'image_id': 'image_2', 'text': 'Nanak Besan Mix 500G', 'language': 'und', 'confidence': 0.95,
     'fields': {'commodity_name': 'Nanak Besan Mix', 'net_quantity': '500 g', 'mrp': 'Rs 64.00'},
     'field_confidence': {'commodity_name': 'medium', 'net_quantity': 'medium'},
     'field_evidence': {'commodity_name': {'text': 'Nanak Besan Mix', 'confidence': 0.95, 'bbox': [9, 8, 7, 6]}},
     'regions': [{'text': 'Nanak Besan Mix 500G'}]},
]
m = merge_results(per)
assert m['fields']['commodity_name'] == 'Nanak Besan Mix', m['fields']
assert m['sources']['commodity_name'] == 1, m['sources']
assert m['fields']['mrp'] == 'Rs 64.00'
assert {c['field'] for c in m['conflicts']} == {'net_quantity'}, m['conflicts']
assert 'net_quantity' in m['field_confidence'], m['field_confidence']
assert m['field_evidence']['commodity_name']['bbox'] == [1, 2, 3, 4], m['field_evidence']
print('merge: OK  conflicts =', m['conflicts'])

fields = {}
for k in ('commodity_name', 'net_quantity', 'manufacturer', 'packer', 'importer', 'address',
          'mfg_date', 'mrp', 'best_before', 'country_of_origin'):
    fields[k] = {'value': 'X', 'confidence': 'high', 'source': 1}
rules, res = evaluate(fields, 'edible')
print('edible: score', res['score'], 'verdict', res['verdict'], 'rules', len(rules))
assert res['counts']['failed'] == 0, res['counts']
assert res['counts']['passed'] + res['counts']['review'] == len(rules), res['counts']
r_non, res_non = evaluate(fields, 'non_edible')
excess = set(r['rule_id'] for r in r_non) - set(r['rule_id'] for r in rules)
assert not excess, excess
print('non_edible: score', res_non['score'], 'verdict', res_non['verdict'], 'rules', len(r_non))
print('OK')