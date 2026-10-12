'use strict';

const COUNTRY_MAP = {
  'albania': 'AL', 'andorra': 'AD', 'algeria': 'DZ',
  'austria': 'AT', 'österreich': 'AT',
  'belarus': 'BY',
  'belgium': 'BE', 'belgique': 'BE', 'belgië': 'BE',
  'bosnia': 'BA', 'bulgaria': 'BG',
  'canada': 'CA', 'croatia': 'HR', 'hrvatska': 'HR',
  'czech republic': 'CZ', 'czechia': 'CZ', 'česká republika': 'CZ', 'česko': 'CZ',
  'denmark': 'DK', 'danmark': 'DK',
  'estonia': 'EE', 'eesti': 'EE',
  'finland': 'FI', 'suomi': 'FI',
  'france': 'FR',
  'germany': 'DE', 'deutschland': 'DE',
  'greece': 'GR',
  'hungary': 'HU', 'magyarország': 'HU',
  'iceland': 'IS', 'ireland': 'IE', 'israel': 'IL',
  'italy': 'IT', 'italia': 'IT',
  'latvia': 'LV', 'liechtenstein': 'LI',
  'lithuania': 'LT', 'lietuva': 'LT',
  'luxembourg': 'LU', 'malta': 'MT',
  'moldova': 'MD', 'monaco': 'MC', 'montenegro': 'ME',
  'netherlands': 'NL', 'the netherlands': 'NL', 'nederland': 'NL', 'holland': 'NL',
  'north macedonia': 'MK', 'norway': 'NO', 'norge': 'NO',
  'poland': 'PL', 'polska': 'PL',
  'portugal': 'PT', 'romania': 'RO', 'românia': 'RO',
  'san marino': 'SM', 'serbia': 'RS',
  'slovakia': 'SK', 'slovensko': 'SK',
  'slovenia': 'SI', 'slovenija': 'SI',
  'spain': 'ES', 'españa': 'ES',
  'sweden': 'SE', 'sverige': 'SE',
  'switzerland': 'CH', 'schweiz': 'CH', 'suisse': 'CH',
  'turkey': 'TR', 'türkiye': 'TR',
  'ukraine': 'UA',
  'united kingdom': 'GB', 'england': 'GB', 'great britain': 'GB',
  'united states': 'US', 'usa': 'US', 'u.s.a.': 'US',
  'australia': 'AU', 'japan': 'JP', 'china': 'CN', 'thailand': 'TH',
  'reunion': 'RE', 'réunion': 'RE', 'la reunion': 'RE',
  'guadeloupe': 'GP', 'martinique': 'MQ', 'mayotte': 'YT',
  'french guiana': 'GF', 'guyane': 'GF',
  'new caledonia': 'NC', 'french polynesia': 'PF',
  'wallis and futuna': 'WF', 'wallis and futuna islands': 'WF',
  'saint pierre and miquelon': 'PM',
  'saint barthelemy': 'BL', 'saint barthélemy': 'BL',
  'saint martin': 'MF',
};

const VALID_COUNTRY_CODES = new Set([
  'AD', 'AL', 'AT', 'AU', 'BA', 'BE', 'BG', 'BY', 'CA', 'CH', 'CN', 'CZ',
  'DE', 'DK', 'DZ', 'EE', 'ES', 'FI', 'FR', 'GB', 'GR', 'HR', 'HU', 'IE',
  'IL', 'IS', 'IT', 'JP', 'LI', 'LT', 'LU', 'LV', 'MC', 'MD', 'ME', 'MK',
  'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'SE', 'SI', 'SK', 'SM', 'TR',
  'UA', 'US', 'TH',
  'BL', 'GF', 'GP', 'MF', 'MQ', 'NC', 'PF', 'PM', 'RE', 'WF', 'YT',
]);

// Scans from the bottom of the address up — country is always near the end,
// before or after the phone number, so bottom-up finds it before any state abbreviation.
function detectCountryCode(address) {
  if (!address) return null;
  const lines = address.split('\n').map((l) => l.trim()).filter(Boolean).reverse();
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (COUNTRY_MAP[lower]) return COUNTRY_MAP[lower];
    const afterComma = lower.split(',').pop().trim();
    if (afterComma && COUNTRY_MAP[afterComma]) return COUNTRY_MAP[afterComma];
    if (/^[a-z]{2}$/.test(lower) && VALID_COUNTRY_CODES.has(lower.toUpperCase())) return lower.toUpperCase();
  }
  return null;
}

module.exports = { detectCountryCode };
