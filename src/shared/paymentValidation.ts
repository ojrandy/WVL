// Field validators for payment account details (update.md §4). Shared by the browser and the server.
// Each returns the normalised value to store, or the admin-facing message from CONTENT.md §6.7.
// Crypto addresses are checked by format per coin and network, not by checksum.

import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

export type ValidationResult = { ok: true; value: string } | { ok: false; error: string };

const ok = (value: string): ValidationResult => ({ ok: true, value });
const fail = (error: string): ValidationResult => ({ ok: false, error });

// Control characters (line breaks, tabs, NUL…) never belong in a single-line account field.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function validateText(input: string, maxLength = 120): ValidationResult {
  const value = input.trim().replace(/\s+/g, ' ');
  if (CONTROL_CHARS.test(input.trim())) return fail('Remove line breaks and special characters.');
  if (value.length > maxLength) return fail(`Keep it under ${maxLength} characters.`);
  return ok(value);
}

export function validateEmail(input: string): ValidationResult {
  const value = input.trim();
  if (value.length > 254 || !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value) || !/\.[^\s@.]{2,}$/.test(value)) {
    return fail('Enter a valid email address.');
  }
  return ok(value);
}

/** An https:// URL. With `hosts`, the host must be one of them or a subdomain of one. */
export function validateHttpsUrl(input: string, hosts?: readonly string[]): ValidationResult {
  const value = input.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail('Enter a full link starting with https://.');
  }
  if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password || value.length > 500) {
    return fail('Enter a full link starting with https://.');
  }
  if (hosts && hosts.length) {
    const host = url.hostname.toLowerCase();
    if (!hosts.some((h) => host === h || host.endsWith(`.${h}`))) return fail(`Use a ${hosts[0]} link.`);
  }
  return ok(url.href);
}

/** A phone number, stored in international format. `region: 'US'` accepts US numbers only. */
export function validatePhone(input: string, region?: 'US'): ValidationResult {
  const value = input.trim();
  if (!/^\+?[\d\s().-]{6,24}$/.test(value)) {
    return fail(region === 'US' ? 'Enter a US phone number.' : 'Enter a valid phone number with its country code, e.g. +1 212 555 0100.');
  }
  // Without a leading "+", a number is read as a US number (the form hint asks for the country code).
  const parsed = parsePhoneNumberFromString(value, 'US');
  if (region === 'US') {
    if (!parsed || parsed.countryCallingCode !== '1' || !parsed.isPossible()) return fail('Enter a US phone number.');
  } else if (!parsed || !parsed.isPossible()) {
    return fail('Enter a valid phone number with its country code, e.g. +1 212 555 0100.');
  }
  return ok(parsed.formatInternational());
}

/** IBAN with the ISO 13616 mod-97 check. Stored without spaces, upper case. */
export function validateIban(input: string): ValidationResult {
  const value = input.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value)) return fail('Check the IBAN: it doesn\'t pass the bank check.');
  const rearranged = value.slice(4) + value.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const digits = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1 ? ok(value) : fail('Check the IBAN: it doesn\'t pass the bank check.');
}

/** IBAN shown in groups of four, the way banks print it. */
export function formatIban(iban: string): string {
  return iban.replace(/(.{4})(?=.)/g, '$1 ');
}

/** UK sort code, stored as NN-NN-NN. */
export function validateSortCode(input: string): ValidationResult {
  const digits = input.replace(/[\s-]/g, '');
  if (!/^\d{6}$/.test(digits)) return fail('Enter the sort code as 6 digits, e.g. 12-34-56.');
  return ok(`${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`);
}

/** US ABA routing number: 9 digits with the 3-7-1 checksum. */
export function validateRoutingNumber(input: string): ValidationResult {
  const value = input.replace(/[\s-]/g, '');
  if (!/^\d{9}$/.test(value)) return fail('Enter a valid 9-digit US routing number.');
  const d = [...value].map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0 ? ok(value) : fail('Enter a valid 9-digit US routing number.');
}

/** SWIFT / BIC: bank (4 letters), country (2 letters), location (2), optional branch (3). */
export function validateSwift(input: string): ValidationResult {
  const value = input.replace(/\s/g, '').toUpperCase();
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(value)
    ? ok(value)
    : fail('Enter a valid SWIFT / BIC code (8 or 11 characters).');
}

/** Cash App $Cashtag: 1–20 letters, digits or underscores with at least one letter. Stored with the "$". */
export function validateCashtag(input: string): ValidationResult {
  const tag = input.trim().replace(/^\$/, '');
  return /^(?=.*[A-Za-z])[A-Za-z0-9_]{1,20}$/.test(tag) ? ok(`$${tag}`) : fail('Enter a $Cashtag, e.g. $name.');
}

/** @username (Venmo, Wisetag, Revtag): 2–30 letters, digits, ".", "_" or "-". Stored with the "@". */
export function validateHandle(input: string): ValidationResult {
  const handle = input.trim().replace(/^@/, '');
  return /^[A-Za-z0-9][A-Za-z0-9._-]{1,29}$/.test(handle) ? ok(`@${handle}`) : fail('Enter a username, e.g. @name.');
}

/** Account number as digits only (spaces and dashes removed), `min`–`max` long. */
export function validateAccountNumber(input: string, min: number, max: number): ValidationResult {
  const value = input.replace(/[\s-]/g, '');
  if (/^\d+$/.test(value) && value.length >= min && value.length <= max) return ok(value);
  return fail(min === max ? `Enter ${min} digits.` : `Enter ${min} to ${max} digits.`);
}

export type CryptoCoin = 'BTC' | 'ETH' | 'USDT';

const BASE58 = '[1-9A-HJ-NP-Za-km-z]';
const BECH32 = '[02-9ac-hj-np-z]';
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CRYPTO_FORMATS: Record<string, RegExp[]> = {
  // Legacy (1…), P2SH (3…), SegWit (bc1q…, 42 or 62 chars) and Taproot (bc1p…, 62 chars).
  'BTC:bitcoin': [
    new RegExp(`^[13]${BASE58}{25,34}$`),
    new RegExp(`^bc1q(${BECH32}{38}|${BECH32}{58})$`),
    new RegExp(`^bc1p${BECH32}{58}$`),
  ],
  // Lightning address (name@domain), LNURL or a BOLT 11 invoice.
  'BTC:lightning': [
    /^[a-z0-9._-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/,
    new RegExp(`^lnurl${BECH32}+$`),
    new RegExp(`^lnbc[0-9]*[munp]?1${BECH32}+$`),
  ],
  'ETH:ethereum': [EVM_ADDRESS],
  'ETH:arbitrum': [EVM_ADDRESS],
  'ETH:optimism': [EVM_ADDRESS],
  'ETH:base': [EVM_ADDRESS],
  'USDT:TRC20': [new RegExp(`^T${BASE58}{33}$`)],
  'USDT:ERC20': [EVM_ADDRESS],
  'USDT:BEP20': [EVM_ADDRESS],
  'USDT:POLYGON': [EVM_ADDRESS],
  'USDT:SOLANA': [new RegExp(`^${BASE58}{32,44}$`)],
};

/** A wallet address for the coin on the given network. `networkLabel` is used in the message. */
export function validateCryptoAddress(coin: CryptoCoin, network: string, input: string, networkLabel = network): ValidationResult {
  let value = input.trim();
  // Bech32 strings (bc1…, lnurl…, lnbc…) may be written in upper case (QR codes); stored in lower case.
  if (coin === 'BTC' && /^(bc1|lnurl|lnbc)/i.test(value) && value === value.toUpperCase()) value = value.toLowerCase();
  if (coin === 'BTC' && network === 'lightning' && value.includes('@')) value = value.toLowerCase();
  const formats = CRYPTO_FORMATS[`${coin}:${network}`];
  if (formats && value.length <= 2000 && formats.some((re) => re.test(value))) return ok(value);
  return fail(`Enter a valid ${coin} address for ${networkLabel}.`);
}
