/**
 * Normalize ASN number format
 * Handles variations like ASN-5, ASN-05, ASN-005, ASN-0005, ASN-00005, etc.
 * Converts to standard format: ASN-XXXX (4 digits) to match backend standardization
 * Examples: ASN-5 -> ASN-0005, ASN-45 -> ASN-0045, ASN-1 -> ASN-0001, ASN-123 -> ASN-0123
 *
 * Note: Backend uses 4-digit format (ASN-0001, ASN-0002, ASN-0005) to match desktop application
 */
export const normalizeASN = (asn: string | null | undefined): string => {
  if (!asn) return asn || "";

  const trimmed = asn.trim().toUpperCase();

  // Extract number part
  const match = trimmed.match(/ASN-?(\d+)/i);
  if (!match) return trimmed;

  const numberPart = match[1];
  // Parse the number to remove leading zeros, then pad to 4 digits
  // This ensures ASN-00005 becomes ASN-0005 (4 digits, not 5)
  const number = parseInt(numberPart, 10);
  const paddedNumber = number.toString().padStart(4, "0");

  return `ASN-${paddedNumber}`;
};

/**
 * Check if two ASN numbers are the same (normalized)
 */
export const isSameASN = (asn1: string, asn2: string): boolean => {
  return normalizeASN(asn1) === normalizeASN(asn2);
};

/**
 * Generate alternative ASN formats to try if the normalized format fails
 * Returns an array of ASN formats to try, starting with the normalized one
 */
export const getASNFormatVariations = (
  asn: string | null | undefined
): string[] => {
  if (!asn) return [];

  const normalized = normalizeASN(asn);
  const variations: string[] = [normalized];

  // Extract number part
  const match = normalized.match(/ASN-(\d+)/i);
  if (!match) return variations;

  const numberPart = match[1];
  const number = parseInt(numberPart, 10);

  // Try different padding formats (backward compatibility during transition)
  // Normalized format is now 4-digit (ASN-0005), but try variations for backward compatibility
  // ASN-0005 -> ASN-00005 (5 digits), ASN-005 (3 digits), ASN-05 (2 digits), ASN-5 (1 digit)
  if (numberPart.length === 4) {
    // Already in 4-digit format, try other formats
    variations.push(`ASN-${numberPart.padStart(5, "0")}`); // ASN-0005 -> ASN-00005 (5 digits - old format)
    variations.push(`ASN-${numberPart.substring(1)}`); // ASN-0005 -> ASN-005 (3 digits)
    variations.push(`ASN-${numberPart.substring(2)}`); // ASN-05 (2 digits)
    variations.push(`ASN-${number}`); // ASN-5 (no padding)
  } else if (numberPart.length === 5) {
    // 5-digit format (old format), try 4-digit and shorter
    variations.push(`ASN-${numberPart.substring(1)}`); // ASN-00005 -> ASN-0005 (4 digits)
    variations.push(`ASN-${numberPart.substring(2)}`); // ASN-005 (3 digits)
    variations.push(`ASN-${numberPart.substring(3)}`); // ASN-05 (2 digits)
    variations.push(`ASN-${number}`); // ASN-5 (no padding)
  } else if (numberPart.length === 3) {
    // 3-digit format, try shorter
    variations.push(`ASN-${numberPart.substring(1)}`); // ASN-005 -> ASN-05 (2 digits)
    variations.push(`ASN-${number}`); // ASN-5 (no padding)
  } else if (numberPart.length === 2) {
    variations.push(`ASN-${number}`); // ASN-5 (no padding)
  } else if (numberPart.length === 1) {
    // Already shortest format
  }

  // Remove duplicates
  return Array.from(new Set(variations));
};
