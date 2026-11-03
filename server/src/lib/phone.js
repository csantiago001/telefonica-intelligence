// Análisis de números basado en metadatos públicos de planes de numeración (libphonenumber, Google/UIT).
import { parsePhoneNumberFromString, validatePhoneNumberLength, getCountries, getCountryCallingCode } from 'libphonenumber-js/max';
import { createRequire } from 'node:module';
const metadata = createRequire(import.meta.url)('libphonenumber-js/package.json');

const regionNames = new Intl.DisplayNames(['es'], { type: 'region' });
export const countryName = (cc) => {
  try { return cc ? regionNames.of(cc) : null; } catch { return cc; }
};

export const LIBPHONE_SOURCE = {
  name: 'libphonenumber (metadatos de planes de numeración, Google / UIT-T E.164)',
  url: 'https://github.com/google/libphonenumber',
  version: metadata.version ?? null, // versión de la librería y sus metadatos,
};

const TYPE_LABELS = {
  MOBILE: 'Móvil',
  FIXED_LINE: 'Fijo',
  FIXED_LINE_OR_MOBILE: 'Fijo o móvil (no distinguible por numeración)',
  TOLL_FREE: 'Línea gratuita',
  PREMIUM_RATE: 'Tarificación adicional (premium)',
  SHARED_COST: 'Costo compartido',
  VOIP: 'Voz sobre IP',
  PERSONAL_NUMBER: 'Número personal',
  PAGER: 'Buscapersonas',
  UAN: 'Número de acceso universal (empresarial)',
  VOICEMAIL: 'Buzón de voz',
};

// Plan Nacional de Numeración de Colombia (CRC, Res. 5826 de 2019 y modificatorias):
// indicativos 60X para telefonía fija desde 2021.
const CO_FIXED = {
  '601': 'Bogotá D.C. y Cundinamarca',
  '602': 'Cauca, Nariño y Valle del Cauca',
  '604': 'Antioquia, Córdoba y Chocó',
  '605': 'Atlántico, Bolívar, Cesar, La Guajira, Magdalena, Sucre y San Andrés',
  '606': 'Caldas, Quindío y Risaralda',
  '607': 'Arauca, Norte de Santander y Santander',
  '608': 'Amazonas, Boyacá, Casanare, Caquetá, Guaviare, Guainía, Huila, Meta, Putumayo, Tolima, Vaupés y Vichada',
};

export const REGULATORS = {
  CO: { name: 'Comisión de Regulación de Comunicaciones (CRC)', url: 'https://www.crcom.gov.co' },
  ES: { name: 'Comisión Nacional de los Mercados y la Competencia (CNMC)', url: 'https://www.cnmc.es' },
  AR: { name: 'Ente Nacional de Comunicaciones (ENACOM)', url: 'https://www.enacom.gob.ar' },
  PE: { name: 'OSIPTEL', url: 'https://www.osiptel.gob.pe' },
  CL: { name: 'Subsecretaría de Telecomunicaciones (SUBTEL)', url: 'https://www.subtel.gob.cl' },
  EC: { name: 'ARCOTEL', url: 'https://www.arcotel.gob.ec' },
  BR: { name: 'ANATEL', url: 'https://www.gov.br/anatel' },
  US: { name: 'Federal Communications Commission (FCC)', url: 'https://www.fcc.gov' },
};
const ITU_NNP = 'https://www.itu.int/en/ITU-T/inr/nnp/Pages/default.aspx';

const LENGTH_MSG = {
  TOO_SHORT: 'Demasiado corto para el plan de numeración',
  TOO_LONG: 'Demasiado largo para el plan de numeración',
  INVALID_LENGTH: 'Longitud no válida para el plan de numeración',
  INVALID_COUNTRY: 'No se pudo determinar el país (falta prefijo internacional o país predeterminado)',
  NOT_A_NUMBER: 'La entrada no es un número telefónico',
};

export function normalizeInput(input) {
  let s = String(input || '').trim();
  s = s.replace(/^00/, '+').replace(/[^\d+]/g, '');
  if (s.indexOf('+') > 0) s = s.replace(/\+/g, '');
  return s;
}

/** Devuelve un análisis con cada dato etiquetado por fuente y nivel de confirmación. */
export function analyzePhone(input, defaultCountry = 'CO') {
  const cleaned = normalizeInput(input);
  const dc = getCountries().includes(defaultCountry) ? defaultCountry : undefined;
  const fields = [];
  const add = (key, label, value, status, source = 'libphonenumber', note) => fields.push({ key, label, value, status, source, note });
  const warnings = [];

  if (!cleaned || cleaned.replace(/\D/g, '').length < 3) {
    return { input, cleaned, valid: false, possible: false, classification: 'invalido', summary: 'Entrada vacía o sin dígitos suficientes.', fields, warnings, source: LIBPHONE_SOURCE };
  }

  const pn = parsePhoneNumberFromString(cleaned, dc);
  const lengthCheck = validatePhoneNumberLength(cleaned, dc);
  if (!pn) {
    add('length', 'Validación de longitud', LENGTH_MSG[lengthCheck] || 'No interpretable', 'confirmado');
    return {
      input, cleaned, valid: false, possible: false, classification: 'invalido',
      summary: 'No es posible interpretar el número con el plan de numeración disponible.', fields, warnings, source: LIBPHONE_SOURCE,
    };
  }

  const valid = pn.isValid();
  const possible = pn.isPossible();
  const type = pn.getType();
  const country = pn.country || null;
  const sharing = pn.getPossibleCountries?.() || [];
  const digits = pn.nationalNumber.length;

  add('e164', 'Formato normalizado E.164', pn.number, 'confirmado');
  add('international', 'Formato internacional', pn.formatInternational(), 'confirmado');
  add('national', 'Formato nacional', pn.formatNational(), 'confirmado');
  add('calling_code', 'Código internacional (prefijo)', `+${pn.countryCallingCode}`, 'confirmado');
  if (country) {
    add('country', 'País / territorio', `${countryName(country)} (${country})`, valid ? 'confirmado' : 'probable',
      'libphonenumber', sharing.length > 1 ? `El prefijo +${pn.countryCallingCode} es compartido por ${sharing.length} territorios; se determinó por los dígitos iniciales.` : undefined);
  } else {
    add('country', 'País / territorio', sharing.length ? sharing.map((c) => `${countryName(c)} (${c})`).join(', ') : 'Sin determinar', 'no_verificado',
      'libphonenumber', 'El número no coincide con un rango asignado; se listan territorios posibles del prefijo.');
  }
  add('length', 'Validación de longitud', lengthCheck ? LENGTH_MSG[lengthCheck] : `Correcta (${digits} dígitos nacionales)`, 'confirmado');
  add('validity', 'Validez en el plan de numeración', valid ? 'Pertenece a un rango asignado' : possible ? 'Longitud posible pero rango no asignado' : 'No válido', 'confirmado');
  add('type', 'Tipo de línea (según rango)', type ? TYPE_LABELS[type] || type : 'No determinado', type ? 'probable' : 'no_verificado', 'libphonenumber',
    'El tipo se deduce del rango numérico asignado; la portabilidad o reasignaciones pueden modificarlo.');

  // Región: solo cuando una fuente pública lo permite.
  let region = null;
  if (country === 'CO' && (type === 'FIXED_LINE' || type === 'FIXED_LINE_OR_MOBILE')) {
    const pfx = pn.nationalNumber.slice(0, 3);
    if (CO_FIXED[pfx]) region = { value: `${CO_FIXED[pfx]} (indicativo ${pfx})`, source: 'Plan Nacional de Numeración — CRC Colombia' };
  }
  if (region) add('region', 'Región', region.value, 'confirmado', region.source);
  else add('region', 'Región', 'No disponible', 'no_disponible', '—', type === 'MOBILE' ? 'Los números móviles no tienen región geográfica asociada.' : 'No hay una fuente pública cargada que asocie este rango con una región.');

  const reg = REGULATORS[country];
  add('operator', 'Operador', 'No determinado', 'no_disponible', '—',
    'No se infiere el operador a partir del prefijo: con la portabilidad numérica ese dato no es verificable. Verifíquelo en la fuente oficial del regulador o con un proveedor autorizado.');

  if (type === 'PREMIUM_RATE') warnings.push('Número de tarificación adicional: las llamadas pueden tener costo elevado.');
  if (type === 'VOIP') warnings.push('Número VoIP: puede no estar vinculado a una ubicación o titular físico.');
  if (!valid && possible) warnings.push('La longitud es posible, pero el rango no figura como asignado en los metadatos.');

  const classification = valid ? 'valido' : possible ? 'posible' : 'invalido';
  const summary = valid
    ? `Número válido de ${countryName(country) || 'país no determinado'}${type ? ` — ${TYPE_LABELS[type] || type}` : ''}.`
    : possible
      ? 'Número con longitud posible pero no asignado en el plan de numeración.'
      : 'Número no válido según el plan de numeración.';

  return {
    input, cleaned, valid, possible, classification, summary,
    e164: pn.number, country, countryName: countryName(country), callingCode: `+${pn.countryCallingCode}`, type,
    fields, warnings,
    uri: pn.getURI(),
    verification: { regulator: reg || null, ituNumberingPlans: ITU_NNP },
    source: LIBPHONE_SOURCE,
  };
}

export function countryList() {
  return getCountries()
    .map((c) => ({ code: c, name: countryName(c), callingCode: `+${getCountryCallingCode(c)}` }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export const RELIABILITY_LABELS = { confirmado: 'Confirmado', probable: 'Probable', no_verificado: 'No verificado', no_disponible: 'No disponible' };
