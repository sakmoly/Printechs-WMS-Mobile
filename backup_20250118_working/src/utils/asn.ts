/**
 * Normalize ASN number format
 * Handles variations like ASN-0045, ASN-00045, ASN-45, etc.
 * Converts to standard format: ASN-XXXXX (5 digits)
 */
export const normalizeASN = (asn: string | null | undefined): string => {
  if (!asn) return asn || '';
  
  const trimmed = asn.trim().toUpperCase();
  
  // Extract number part
  const match = trimmed.match(/ASN-?(\d+)/i);
  if (!match) return trimmed;
  
  const numberPart = match[1];
  // Pad to 5 digits (ASN-00045 format)
  const paddedNumber = numberPart.padStart(5, '0');
  
  return `ASN-${paddedNumber}`;
};

/**
 * Check if two ASN numbers are the same (normalized)
 */
export const isSameASN = (asn1: string, asn2: string): boolean => {
  return normalizeASN(asn1) === normalizeASN(asn2);
};

