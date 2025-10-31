/**
 * Find existing placeholder for a value, or create a new one
 */
export function getOrCreatePlaceholder(
  value: string,
  placeholderTemplate: string,
  counters: Record<string, number>,
  encodingMap: EncodingMap
): string {
  for (const [placeholder, encodedValue] of Object.entries(encodingMap)) {
    if (encodedValue === value) {
      return placeholder;
    }
  }

  // Create new placeholder for this value
  counters[placeholderTemplate] = (counters[placeholderTemplate] ?? 0) + 1;
  const newPlaceholder = placeholderTemplate.replace(
    '{ind}',
    String(counters[placeholderTemplate])
  );
  encodingMap[newPlaceholder] = value;
  return newPlaceholder;
}
