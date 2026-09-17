/**
 * State resolution for the regulator heatmap — real data only.
 *
 * Precedence (fixed, never ambiguous):
 *   1. Explicit scan-time selection (`scan_state`) — the user said so.
 *   2. Auto-detect from manufacturer / address / location text:
 *      state name → major city → pincode prefix.
 *   3. "Unknown" — honestly shown, never fabricated.
 */

export interface StateInfo {
  /** Canonical English name (stored + matched). */
  en: string
  /** Hindi display name. */
  hi: string
}

export const STATES: StateInfo[] = [
  { en: 'Andhra Pradesh', hi: 'आंध्र प्रदेश' },
  { en: 'Arunachal Pradesh', hi: 'अरुणाचल प्रदेश' },
  { en: 'Assam', hi: 'असम' },
  { en: 'Bihar', hi: 'बिहार' },
  { en: 'Chhattisgarh', hi: 'छत्तीसगढ़' },
  { en: 'Delhi', hi: 'दिल्ली' },
  { en: 'Goa', hi: 'गोवा' },
  { en: 'Gujarat', hi: 'गुजरात' },
  { en: 'Haryana', hi: 'हरियाणा' },
  { en: 'Himachal Pradesh', hi: 'हिमाचल प्रदेश' },
  { en: 'Jammu and Kashmir', hi: 'जम्मू और कश्मीर' },
  { en: 'Jharkhand', hi: 'झारखंड' },
  { en: 'Karnataka', hi: 'कर्नाटक' },
  { en: 'Kerala', hi: 'केरल' },
  { en: 'Ladakh', hi: 'लद्दाख' },
  { en: 'Madhya Pradesh', hi: 'मध्य प्रदेश' },
  { en: 'Maharashtra', hi: 'महाराष्ट्र' },
  { en: 'Manipur', hi: 'मणिपुर' },
  { en: 'Meghalaya', hi: 'मेघालय' },
  { en: 'Mizoram', hi: 'मिजोरम' },
  { en: 'Nagaland', hi: 'नागालैंड' },
  { en: 'Odisha', hi: 'ओडिशा' },
  { en: 'Puducherry', hi: 'पुडुचेरी' },
  { en: 'Punjab', hi: 'पंजाब' },
  { en: 'Rajasthan', hi: 'राजस्थान' },
  { en: 'Sikkim', hi: 'सिक्किम' },
  { en: 'Tamil Nadu', hi: 'तमिलनाडु' },
  { en: 'Telangana', hi: 'तेलंगाना' },
  { en: 'Tripura', hi: 'त्रिपुरा' },
  { en: 'Uttar Pradesh', hi: 'उत्तर प्रदेश' },
  { en: 'Uttarakhand', hi: 'उत्तराखंड' },
  { en: 'West Bengal', hi: 'पश्चिम बंगाल' },
  { en: 'Andaman and Nicobar Islands', hi: 'अंडमान और निकोबार' },
  { en: 'Chandigarh', hi: 'चंडीगढ़' },
  { en: 'Dadra and Nagar Haveli and Daman and Diu', hi: 'दादरा और नगर हवेली एवं दमन और दीव' },
  { en: 'Lakshadweep', hi: 'लक्षद्वीप' },
]

const STATE_NAMES = new Set(STATES.map((s) => s.en.toLowerCase()))

/** City/alias → canonical state (lowercase match). */
const CITY_TO_STATE: Record<string, string> = {
  bengaluru: 'Karnataka', bangalore: 'Karnataka', mysuru: 'Karnataka', mysore: 'Karnataka', hubli: 'Karnataka',
  mumbai: 'Maharashtra', bombay: 'Maharashtra', pune: 'Maharashtra', poona: 'Maharashtra', nagpur: 'Maharashtra', nashik: 'Maharashtra', thane: 'Maharashtra',
  delhi: 'Delhi', 'new delhi': 'Delhi', noida: 'Uttar Pradesh', gurgaon: 'Haryana', gurugram: 'Haryana', faridabad: 'Haryana',
  chennai: 'Tamil Nadu', madras: 'Tamil Nadu', coimbatore: 'Tamil Nadu', madurai: 'Tamil Nadu',
  hyderabad: 'Telangana', secunderabad: 'Telangana',
  kolkata: 'West Bengal', calcutta: 'West Bengal', howrah: 'West Bengal',
  ahmedabad: 'Gujarat', surat: 'Gujarat', vadodara: 'Gujarat', baroda: 'Gujarat', rajkot: 'Gujarat',
  jaipur: 'Rajasthan', jodhpur: 'Rajasthan', udaipur: 'Rajasthan', kota: 'Rajasthan',
  lucknow: 'Uttar Pradesh', kanpur: 'Uttar Pradesh', agra: 'Uttar Pradesh', varanasi: 'Uttar Pradesh', ghaziabad: 'Uttar Pradesh', meerut: 'Uttar Pradesh',
  patna: 'Bihar', gaya: 'Bihar',
  bhopal: 'Madhya Pradesh', indore: 'Madhya Pradesh', gwalior: 'Madhya Pradesh',
  chandigarh: 'Chandigarh', ludhiana: 'Punjab', amritsar: 'Punjab', jalandhar: 'Punjab',
  kochi: 'Kerala', cochin: 'Kerala', thiruvananthapuram: 'Kerala', trivandrum: 'Kerala', kozhikode: 'Kerala',
  bhubaneswar: 'Odisha', cuttack: 'Odisha',
  guwahati: 'Assam',
  dehradun: 'Uttarakhand',
  shimla: 'Himachal Pradesh',
  ranchi: 'Jharkhand', jamshedpur: 'Jharkhand',
  raipur: 'Chhattisgarh',
  panaji: 'Goa', panjim: 'Goa',
  gangtok: 'Sikkim',
  imphal: 'Manipur',
  shillong: 'Meghalaya',
  aizawl: 'Mizoram',
  kohima: 'Nagaland',
  agartala: 'Tripura',
  srinagar: 'Jammu and Kashmir', jammu: 'Jammu and Kashmir',
  leh: 'Ladakh',
  puducherry: 'Puducherry', pondicherry: 'Puducherry',
  portblair: 'Andaman and Nicobar Islands', 'port blair': 'Andaman and Nicobar Islands',
  kavaratti: 'Lakshadweep',
  silvassa: 'Dadra and Nagar Haveli and Daman and Diu', daman: 'Dadra and Nagar Haveli and Daman and Diu', diu: 'Dadra and Nagar Haveli and Daman and Diu',
}

/** 3-digit pincode prefix → state (first-match wins, ordered specific-first). */
const PIN_TO_STATE: Array<[string, string]> = [
  ['110', 'Delhi'], ['111', 'Delhi'], ['112', 'Delhi'],
  ['400', 'Maharashtra'], ['401', 'Maharashtra'], ['402', 'Maharashtra'], ['403', 'Goa'], ['404', 'Maharashtra'],
  ['405', 'Maharashtra'], ['406', 'Maharashtra'], ['407', 'Maharashtra'], ['408', 'Maharashtra'], ['409', 'Maharashtra'],
  ['410', 'Maharashtra'], ['411', 'Maharashtra'], ['412', 'Maharashtra'], ['413', 'Maharashtra'], ['414', 'Maharashtra'],
  ['415', 'Maharashtra'], ['416', 'Maharashtra'], ['417', 'Maharashtra'], ['418', 'Maharashtra'], ['419', 'Maharashtra'],
  ['560', 'Karnataka'], ['561', 'Karnataka'], ['562', 'Karnataka'], ['563', 'Karnataka'], ['564', 'Karnataka'],
  ['565', 'Karnataka'], ['566', 'Karnataka'], ['567', 'Karnataka'], ['568', 'Karnataka'], ['569', 'Karnataka'],
  ['570', 'Karnataka'], ['571', 'Karnataka'], ['572', 'Karnataka'], ['573', 'Karnataka'], ['574', 'Karnataka'],
  ['575', 'Karnataka'], ['576', 'Karnataka'], ['577', 'Karnataka'], ['578', 'Karnataka'], ['579', 'Karnataka'],
  ['580', 'Karnataka'], ['581', 'Karnataka'], ['582', 'Karnataka'], ['583', 'Karnataka'], ['584', 'Karnataka'],
  ['585', 'Karnataka'], ['586', 'Karnataka'], ['587', 'Karnataka'], ['588', 'Karnataka'], ['589', 'Karnataka'],
  ['590', 'Karnataka'], ['591', 'Karnataka'],
  ['600', 'Tamil Nadu'], ['601', 'Tamil Nadu'], ['602', 'Tamil Nadu'], ['603', 'Tamil Nadu'], ['604', 'Tamil Nadu'],
  ['605', 'Puducherry'], ['606', 'Tamil Nadu'], ['607', 'Puducherry'], ['608', 'Tamil Nadu'], ['609', 'Puducherry'],
  ['610', 'Tamil Nadu'], ['611', 'Tamil Nadu'], ['612', 'Tamil Nadu'], ['613', 'Tamil Nadu'], ['614', 'Tamil Nadu'],
  ['615', 'Tamil Nadu'], ['616', 'Tamil Nadu'], ['617', 'Tamil Nadu'], ['618', 'Tamil Nadu'], ['619', 'Tamil Nadu'],
  ['620', 'Tamil Nadu'], ['621', 'Tamil Nadu'], ['622', 'Tamil Nadu'], ['623', 'Tamil Nadu'], ['624', 'Tamil Nadu'],
  ['625', 'Tamil Nadu'], ['626', 'Tamil Nadu'], ['627', 'Tamil Nadu'], ['628', 'Tamil Nadu'], ['629', 'Tamil Nadu'],
  ['630', 'Tamil Nadu'], ['631', 'Tamil Nadu'], ['632', 'Tamil Nadu'], ['633', 'Tamil Nadu'], ['634', 'Tamil Nadu'],
  ['635', 'Tamil Nadu'], ['636', 'Tamil Nadu'], ['637', 'Tamil Nadu'], ['638', 'Tamil Nadu'], ['639', 'Tamil Nadu'],
  ['500', 'Telangana'], ['501', 'Telangana'], ['502', 'Telangana'], ['503', 'Telangana'], ['504', 'Telangana'],
  ['505', 'Telangana'], ['506', 'Telangana'], ['507', 'Telangana'], ['508', 'Telangana'], ['509', 'Telangana'],
  ['700', 'West Bengal'], ['701', 'West Bengal'], ['702', 'West Bengal'], ['703', 'West Bengal'], ['704', 'West Bengal'],
  ['705', 'West Bengal'], ['706', 'West Bengal'], ['707', 'West Bengal'], ['708', 'West Bengal'], ['709', 'West Bengal'],
  ['710', 'West Bengal'], ['711', 'West Bengal'], ['712', 'West Bengal'], ['713', 'West Bengal'], ['714', 'West Bengal'],
  ['380', 'Gujarat'], ['381', 'Gujarat'], ['382', 'Gujarat'], ['383', 'Gujarat'], ['384', 'Gujarat'],
  ['385', 'Gujarat'], ['386', 'Gujarat'], ['387', 'Gujarat'], ['388', 'Gujarat'], ['389', 'Gujarat'],
  ['390', 'Gujarat'], ['391', 'Gujarat'], ['392', 'Gujarat'], ['393', 'Gujarat'], ['394', 'Gujarat'], ['395', 'Gujarat'],
  ['396', 'Dadra and Nagar Haveli and Daman and Diu'],
  ['302', 'Rajasthan'], ['303', 'Rajasthan'], ['304', 'Rajasthan'], ['305', 'Rajasthan'], ['306', 'Rajasthan'],
  ['307', 'Rajasthan'], ['308', 'Rajasthan'], ['309', 'Rajasthan'], ['310', 'Rajasthan'], ['311', 'Rajasthan'],
  ['312', 'Rajasthan'], ['313', 'Rajasthan'], ['314', 'Rajasthan'], ['315', 'Rajasthan'], ['316', 'Rajasthan'],
  ['320', 'Rajasthan'], ['321', 'Rajasthan'], ['322', 'Rajasthan'], ['323', 'Rajasthan'], ['324', 'Rajasthan'],
  ['325', 'Rajasthan'], ['326', 'Rajasthan'], ['327', 'Rajasthan'], ['328', 'Rajasthan'], ['329', 'Rajasthan'],
  ['330', 'Rajasthan'], ['331', 'Rajasthan'], ['332', 'Rajasthan'], ['333', 'Rajasthan'], ['334', 'Rajasthan'],
  ['160', 'Chandigarh'], ['140', 'Punjab'], ['141', 'Punjab'], ['142', 'Punjab'], ['143', 'Punjab'],
  ['144', 'Punjab'], ['145', 'Punjab'], ['146', 'Punjab'], ['147', 'Punjab'], ['148', 'Punjab'],
  ['151', 'Punjab'], ['152', 'Punjab'],
  ['120', 'Haryana'], ['121', 'Haryana'], ['122', 'Haryana'], ['123', 'Haryana'], ['124', 'Haryana'],
  ['125', 'Haryana'], ['126', 'Haryana'], ['127', 'Haryana'], ['128', 'Haryana'], ['129', 'Haryana'],
  ['130', 'Haryana'], ['131', 'Haryana'], ['132', 'Haryana'], ['133', 'Haryana'], ['134', 'Haryana'],
  ['135', 'Haryana'], ['136', 'Haryana'],
  ['201', 'Uttar Pradesh'], ['202', 'Uttar Pradesh'], ['203', 'Uttar Pradesh'], ['204', 'Uttar Pradesh'],
  ['205', 'Uttar Pradesh'], ['206', 'Uttar Pradesh'], ['207', 'Uttar Pradesh'], ['208', 'Uttar Pradesh'],
  ['209', 'Uttar Pradesh'], ['210', 'Uttar Pradesh'], ['211', 'Uttar Pradesh'], ['212', 'Uttar Pradesh'],
  ['213', 'Uttar Pradesh'], ['214', 'Uttar Pradesh'], ['215', 'Uttar Pradesh'], ['216', 'Uttar Pradesh'],
  ['220', 'Uttar Pradesh'], ['221', 'Uttar Pradesh'], ['222', 'Uttar Pradesh'], ['223', 'Uttar Pradesh'],
  ['224', 'Uttar Pradesh'], ['225', 'Uttar Pradesh'], ['226', 'Uttar Pradesh'], ['227', 'Uttar Pradesh'],
  ['228', 'Uttar Pradesh'], ['229', 'Uttar Pradesh'], ['230', 'Uttar Pradesh'], ['231', 'Uttar Pradesh'],
  ['240', 'Uttar Pradesh'], ['241', 'Uttar Pradesh'], ['242', 'Uttar Pradesh'], ['243', 'Uttar Pradesh'],
  ['244', 'Uttar Pradesh'], ['245', 'Uttarakhand'], ['246', 'Uttarakhand'], ['247', 'Uttar Pradesh'],
  ['248', 'Uttarakhand'], ['249', 'Uttarakhand'],
  ['250', 'Uttar Pradesh'], ['251', 'Uttar Pradesh'], ['252', 'Uttar Pradesh'], ['253', 'Uttar Pradesh'],
  ['261', 'Uttar Pradesh'], ['262', 'Uttarakhand'], ['263', 'Uttarakhand'], ['264', 'Uttarakhand'],
  ['271', 'Uttar Pradesh'], ['272', 'Uttar Pradesh'], ['273', 'Uttar Pradesh'], ['274', 'Uttar Pradesh'],
  ['275', 'Uttar Pradesh'], ['276', 'Uttar Pradesh'], ['277', 'Uttar Pradesh'], ['278', 'Uttar Pradesh'],
  ['280', 'Uttar Pradesh'], ['281', 'Uttar Pradesh'], ['282', 'Uttar Pradesh'], ['283', 'Uttar Pradesh'],
  ['284', 'Madhya Pradesh'], ['285', 'Uttar Pradesh'],
  ['301', 'Rajasthan'],
  ['440', 'Maharashtra'], ['441', 'Maharashtra'], ['442', 'Maharashtra'], ['443', 'Maharashtra'],
  ['444', 'Maharashtra'], ['445', 'Maharashtra'], ['446', 'Madhya Pradesh'], ['447', 'Madhya Pradesh'],
  ['450', 'Madhya Pradesh'], ['451', 'Madhya Pradesh'], ['452', 'Madhya Pradesh'], ['453', 'Madhya Pradesh'],
  ['454', 'Madhya Pradesh'], ['455', 'Madhya Pradesh'], ['456', 'Madhya Pradesh'], ['457', 'Madhya Pradesh'],
  ['458', 'Madhya Pradesh'], ['459', 'Madhya Pradesh'], ['460', 'Madhya Pradesh'], ['461', 'Madhya Pradesh'],
  ['462', 'Madhya Pradesh'], ['463', 'Madhya Pradesh'], ['464', 'Madhya Pradesh'], ['465', 'Madhya Pradesh'],
  ['466', 'Madhya Pradesh'], ['467', 'Madhya Pradesh'], ['468', 'Madhya Pradesh'], ['469', 'Madhya Pradesh'],
  ['470', 'Madhya Pradesh'], ['471', 'Madhya Pradesh'], ['472', 'Madhya Pradesh'], ['473', 'Madhya Pradesh'],
  ['474', 'Madhya Pradesh'], ['475', 'Madhya Pradesh'], ['476', 'Madhya Pradesh'], ['477', 'Madhya Pradesh'],
  ['478', 'Madhya Pradesh'], ['479', 'Madhya Pradesh'], ['480', 'Madhya Pradesh'], ['481', 'Madhya Pradesh'],
  ['482', 'Madhya Pradesh'], ['483', 'Madhya Pradesh'], ['484', 'Madhya Pradesh'], ['485', 'Madhya Pradesh'],
  ['486', 'Madhya Pradesh'], ['487', 'Madhya Pradesh'], ['488', 'Chhattisgarh'], ['489', 'Chhattisgarh'],
  ['490', 'Chhattisgarh'], ['491', 'Chhattisgarh'], ['492', 'Chhattisgarh'], ['493', 'Chhattisgarh'],
  ['494', 'Chhattisgarh'], ['495', 'Chhattisgarh'], ['496', 'Chhattisgarh'],
  ['680', 'Kerala'], ['681', 'Kerala'], ['682', 'Kerala'], ['683', 'Kerala'], ['684', 'Kerala'],
  ['685', 'Kerala'], ['686', 'Kerala'], ['687', 'Kerala'], ['688', 'Kerala'], ['689', 'Kerala'],
  ['690', 'Kerala'], ['691', 'Kerala'], ['692', 'Kerala'], ['693', 'Kerala'],
  ['670', 'Kerala'], ['671', 'Kerala'], ['672', 'Kerala'], ['673', 'Kerala'], ['674', 'Kerala'],
  ['675', 'Kerala'], ['676', 'Kerala'], ['677', 'Kerala'], ['678', 'Kerala'], ['679', 'Kerala'],
  ['750', 'Odisha'], ['751', 'Odisha'], ['752', 'Odisha'], ['753', 'Odisha'], ['754', 'Odisha'],
  ['755', 'Odisha'], ['756', 'Odisha'], ['757', 'Odisha'], ['758', 'Odisha'], ['759', 'Odisha'],
  ['760', 'Odisha'], ['761', 'Odisha'], ['762', 'Odisha'], ['763', 'Odisha'], ['764', 'Odisha'],
  ['765', 'Odisha'], ['766', 'Odisha'], ['767', 'Odisha'], ['768', 'Odisha'], ['769', 'Odisha'],
  ['781', 'Assam'], ['782', 'Assam'], ['783', 'Assam'], ['784', 'Assam'], ['785', 'Assam'], ['786', 'Assam'],
  ['800', 'Bihar'], ['801', 'Bihar'], ['802', 'Bihar'], ['803', 'Bihar'], ['804', 'Bihar'], ['805', 'Bihar'],
  ['811', 'Bihar'], ['812', 'Bihar'], ['813', 'Bihar'], ['814', 'Bihar'], ['815', 'Bihar'],
  ['821', 'Bihar'], ['822', 'Jharkhand'], ['823', 'Bihar'], ['824', 'Bihar'], ['825', 'Jharkhand'],
  ['826', 'Jharkhand'], ['827', 'Jharkhand'], ['828', 'Jharkhand'], ['829', 'Jharkhand'],
  ['830', 'Jharkhand'], ['831', 'Jharkhand'], ['832', 'Jharkhand'], ['833', 'Jharkhand'], ['834', 'Jharkhand'], ['835', 'Jharkhand'],
  ['695', 'Kerala'], ['696', 'Kerala'], ['697', 'Kerala'],
  ['190', 'Jammu and Kashmir'], ['191', 'Jammu and Kashmir'], ['192', 'Jammu and Kashmir'], ['193', 'Jammu and Kashmir'],
  ['194', 'Ladakh'],
  ['170', 'Himachal Pradesh'], ['171', 'Himachal Pradesh'], ['172', 'Himachal Pradesh'], ['173', 'Himachal Pradesh'],
  ['174', 'Himachal Pradesh'], ['175', 'Himachal Pradesh'], ['176', 'Himachal Pradesh'], ['177', 'Himachal Pradesh'],
  ['182', 'Jammu and Kashmir'], ['183', 'Jammu and Kashmir'], ['184', 'Jammu and Kashmir'], ['185', 'Jammu and Kashmir'],
  ['186', 'Jammu and Kashmir'],
  ['790', 'Arunachal Pradesh'], ['791', 'Assam'], ['792', 'Arunachal Pradesh'], ['793', 'Meghalaya'],
  ['794', 'Tripura'], ['795', 'Nagaland'], ['796', 'Mizoram'], ['797', 'Nagaland'], ['798', 'Nagaland'], ['799', 'Tripura'],
  ['744', 'Andaman and Nicobar Islands'],
]

export interface ScanGeoInput {
  scan_state?: string | null
  manufacturer?: string | null
  location_name?: string | null
  contact_info?: string | null
  address?: string | null
}

/**
 * Resolve a scan's state. Explicit user selection always wins; otherwise
 * auto-detect from address text; "Unknown" when nothing matches (honest).
 */
export function resolveState(input: ScanGeoInput): string {
  const explicit = (input.scan_state ?? '').trim()
  if (explicit && STATE_NAMES.has(explicit.toLowerCase())) {
    const found = STATES.find((s) => s.en.toLowerCase() === explicit.toLowerCase())
    if (found) return found.en
  }
  const hay = [input.manufacturer, input.location_name, input.contact_info, input.address]
    .filter(Boolean)
    .join(' | ')
    .toLowerCase()
  if (!hay.trim()) return 'Unknown'

  // 1) Explicit state names ("Karnataka", "Tamil Nadu", ...).
  for (const s of STATES) {
    const needle = s.en.toLowerCase()
    if (hay.includes(needle)) return s.en
  }
  // 2) Major cities / aliases.
  for (const [city, state] of Object.entries(CITY_TO_STATE)) {
    if (hay.includes(city)) return state
  }
  // 3) 6-digit pincodes → prefix map.
  const pins = hay.match(/\b\d{6}\b/g) ?? []
  for (const pin of pins) {
    const prefix = pin.slice(0, 3)
    const hit = PIN_TO_STATE.find(([p]) => p === prefix)
    if (hit) return hit[1]
  }
  return 'Unknown'
}

/** Hindi display name for a resolved state (falls back to English). */
export function stateDisplayName(stateEn: string, lang: 'en' | 'hi'): string {
  if (lang !== 'hi') return stateEn
  return STATES.find((s) => s.en === stateEn)?.hi ?? stateEn
}
