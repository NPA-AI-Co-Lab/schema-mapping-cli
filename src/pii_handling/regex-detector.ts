/**
 * Regex-based PII detection for emails, phone numbers, and addresses
 */

import type { EncodingMap } from './types.js';
import { getOrCreatePlaceholder } from './handle_placeholder.js';

const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_REGEX =
  /(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b|(?:\+\d{1,3}[-.\s]?)?\(?[0-9]{1,4}\)?[-.\s]?[0-9]{1,4}[-.\s]?[0-9]{1,9}/g;
const ADDRESS_REGEX =
  /\b\d+\s+[A-Za-z0-9\s,.-]+\s+(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Lane|Ln\.?|Drive|Dr\.?|Court|Ct\.?|Place|Pl\.?|Boulevard|Blvd\.?|Way|Circle|Cir\.?|Highway|Hwy\.?|Parkway|Pkwy\.?)(?:\s|,|$)/gi;

/**
 * Validate if detected email is likely to be a real email address
 */
function isValidEmail(email: string): boolean {
  // Additional validation to reduce false positives
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return (
    local.length > 0 &&
    domain.includes('.') &&
    !domain.startsWith('.') &&
    !domain.endsWith('.') &&
    domain.length > 3
  );
}

/**
 * Validate if detected phone number is likely to be a real phone number
 */
function isValidPhone(phone: string): boolean {
  // Remove all non-digit characters and check length
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

/**
 * Validate if detected address is likely to be a real address
 */
function isValidAddress(address: string): boolean {
  // Basic validation - should have a number and at least one street type word
  return /\d/.test(address) && address.trim().length > 10;
}

/**
 * Detect and replace PII patterns in text using regex
 * Processes free text to find and replace specific PII instances
 */
export function detectAndReplacePII(
  value: string,
  counters: Record<string, number>,
  encodingMap: EncodingMap
): string {
  let processedValue = value;

  // Replace emails first (most specific)
  processedValue = processedValue.replace(EMAIL_REGEX, (match) => {
    if (isValidEmail(match)) {
      return getOrCreatePlaceholder(match, 'EMAIL_{ind}@GMAIL.COM', counters, encodingMap);
    }
    return match;
  });

  // Replace phone numbers
  processedValue = processedValue.replace(PHONE_REGEX, (match) => {
    if (isValidPhone(match)) {
      return getOrCreatePlaceholder(match, 'PHONE_{ind}', counters, encodingMap);
    }
    return match;
  });

  // Replace addresses last (least specific)
  processedValue = processedValue.replace(ADDRESS_REGEX, (match) => {
    if (isValidAddress(match)) {
      return getOrCreatePlaceholder(match.trim(), 'ADDRESS_{ind}', counters, encodingMap);
    }
    return match;
  });

  return processedValue;
}
