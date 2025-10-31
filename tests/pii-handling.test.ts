import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPIIHandlers } from '../src/pii_handling/index.js';
import { getOrCreatePlaceholder } from '../src/pii_handling/handle_placeholder.js';
import { detectAndReplacePII } from '../src/pii_handling/regex-detector.js';
import type { EncodingMap, RecordData } from '../src/pii_handling/types.js';

// Mock the PII field map
vi.mock('../src/utils/index.js', () => ({
  basePath: '/mock/path',
  loadJSON: vi.fn(() => ({
    email: { placeholder: 'EMAIL_{ind}@GMAIL.COM' },
    name: { placeholder: 'NAME_{ind}' },
    phone: { placeholder: 'PHONE_{ind}' },
    emails: { placeholder: 'EMAIL_{ind}@GMAIL.COM', multi: true },
  })),
  splitValues: vi.fn((value: string) => value.split(', ').map((v) => v.trim())),
}));

describe('PII Handling', () => {
  describe('createPIIHandlers', () => {
    it('should return active handlers when PII processing is enabled', () => {
      const handlers = createPIIHandlers(true);

      expect(handlers.encodePII).toBeDefined();
      expect(handlers.decodePII).toBeDefined();
      expect(typeof handlers.encodePII).toBe('function');
      expect(typeof handlers.decodePII).toBe('function');
    });

    it('should return no-op handlers when PII processing is disabled', () => {
      const handlers = createPIIHandlers(false);

      const testRecords = [{ email: 'test@example.com', name: 'John Doe' }];
      const result = handlers.encodePII(testRecords);

      expect(result.processedBatch).toEqual(testRecords);
      expect(result.encodingMap).toEqual({});

      const testResults = { person: { email: 'test@example.com' } };
      expect(handlers.decodePII(testResults, {})).toEqual(testResults);
    });
  });

  describe('PII Encoding', () => {
    let handlers: ReturnType<typeof createPIIHandlers>;

    beforeEach(() => {
      handlers = createPIIHandlers(true);
    });

    it('should encode explicit PII fields using field map', () => {
      const records: RecordData[] = [
        { email: 'john@example.com', name: 'John Doe' },
        { email: 'jane@example.com', name: 'Jane Smith' },
      ];

      const result = handlers.encodePII(records);

      expect(result.processedBatch[0].email).toBe('EMAIL_1@GMAIL.COM');
      expect(result.processedBatch[0].name).toBe('NAME_1');
      expect(result.processedBatch[1].email).toBe('EMAIL_2@GMAIL.COM');
      expect(result.processedBatch[1].name).toBe('NAME_2');

      expect(result.encodingMap).toHaveProperty('EMAIL_1@GMAIL.COM', 'john@example.com');
      expect(result.encodingMap).toHaveProperty('NAME_1', 'John Doe');
    });

    it('should handle multi-value fields correctly', () => {
      const records: RecordData[] = [{ emails: 'john@example.com, jane@example.com' }];

      const result = handlers.encodePII(records);

      expect(result.processedBatch[0].emails).toBe('EMAIL_1@GMAIL.COM, EMAIL_2@GMAIL.COM');
      expect(result.encodingMap).toHaveProperty('EMAIL_1@GMAIL.COM', 'john@example.com');
      expect(result.encodingMap).toHaveProperty('EMAIL_2@GMAIL.COM', 'jane@example.com');
    });

    it('should maintain consistency for identical values', () => {
      const records: RecordData[] = [
        { email: 'john@example.com', name: 'John Doe' },
        { email: 'john@example.com', name: 'John Doe' },
      ];

      const result = handlers.encodePII(records);

      // Same values should get same placeholders
      expect(result.processedBatch[0].email).toBe(result.processedBatch[1].email);
      expect(result.processedBatch[0].name).toBe(result.processedBatch[1].name);
    });

    it('should detect PII in free text fields', () => {
      const records: RecordData[] = [
        {
          description: 'Contact John at john@example.com or call (555) 123-4567',
          unmappedField: 'Email me at jane@test.com',
        },
      ];

      const result = handlers.encodePII(records);

      expect(result.processedBatch[0].description).toContain('EMAIL_');
      expect(result.processedBatch[0].description).toContain('PHONE_');
      expect(result.processedBatch[0].unmappedField).toContain('EMAIL_');
    });

    it('should skip empty or non-string values', () => {
      const records: RecordData[] = [
        {
          email: '',
          name: null as any,
          age: 25 as any,
          active: true as any,
        },
      ];

      const result = handlers.encodePII(records);

      expect(result.processedBatch[0]).toEqual({
        email: '',
        name: null,
        age: 25,
        active: true,
      });
    });
  });

  describe('PII Decoding', () => {
    let handlers: ReturnType<typeof createPIIHandlers>;

    beforeEach(() => {
      handlers = createPIIHandlers(true);
    });

    it('should decode placeholders back to original values', () => {
      const records: RecordData[] = [{ email: 'john@example.com', name: 'John Doe' }];

      const { processedBatch, encodingMap } = handlers.encodePII(records);

      const encodedResult = {
        person: {
          email: processedBatch[0].email,
          name: processedBatch[0].name,
          greeting: `Hello ${processedBatch[0].name}!`,
        },
      };

      const decoded = handlers.decodePII(encodedResult, encodingMap) as any;

      expect(decoded.person.email).toBe('john@example.com');
      expect(decoded.person.name).toBe('John Doe');
      expect(decoded.person.greeting).toBe('Hello John Doe!');
    });

    it('should handle nested objects and arrays', () => {
      const encodingMap: EncodingMap = {
        'EMAIL_1@GMAIL.COM': 'john@example.com',
        NAME_1: 'John Doe',
      };

      const encodedResult = {
        people: [
          { email: 'EMAIL_1@GMAIL.COM', name: 'NAME_1' },
          { contacts: { primary: 'EMAIL_1@GMAIL.COM' } },
        ],
      };

      const decoded = handlers.decodePII(encodedResult, encodingMap) as any;

      expect(decoded.people[0].email).toBe('john@example.com');
      expect(decoded.people[0].name).toBe('John Doe');
      expect(decoded.people[1].contacts.primary).toBe('john@example.com');
    });

    it('should handle deep recursion with depth limit', () => {
      const encodingMap: EncodingMap = {
        'EMAIL_1@GMAIL.COM': 'john@example.com',
      };

      // Create deeply nested object
      let deepObject: any = { value: 'EMAIL_1@GMAIL.COM' };
      for (let i = 0; i < 150; i++) {
        deepObject = { nested: deepObject };
      }

      const decoded = handlers.decodePII(deepObject, encodingMap);

      // Should not crash and should have stopped at depth limit
      expect(decoded).toBeDefined();
    });

    it('should return original data when no encoding map provided', () => {
      const originalData = {
        person: { email: 'john@example.com', name: 'John Doe' },
      };

      const decoded = handlers.decodePII(originalData, {});

      expect(decoded).toEqual(originalData);
    });

    it('should handle placeholders with different lengths correctly', () => {
      const encodingMap: EncodingMap = {
        'EMAIL_1@GMAIL.COM': 'john@example.com',
        'EMAIL_10@GMAIL.COM': 'jane@example.com',
      };

      const encodedResult = {
        text: 'Contact EMAIL_1@GMAIL.COM or EMAIL_10@GMAIL.COM',
      };

      const decoded = handlers.decodePII(encodedResult, encodingMap);

      expect(decoded.text).toBe('Contact john@example.com or jane@example.com');
    });
  });

  describe('getOrCreatePlaceholder', () => {
    it('should reuse existing placeholder for same value', () => {
      const counters: Record<string, number> = {};
      const encodingMap: EncodingMap = {
        'EMAIL_1@GMAIL.COM': 'john@example.com',
      };

      const placeholder = getOrCreatePlaceholder(
        'john@example.com',
        'EMAIL_{ind}@GMAIL.COM',
        counters,
        encodingMap
      );

      expect(placeholder).toBe('EMAIL_1@GMAIL.COM');
      expect(counters['EMAIL_{ind}@GMAIL.COM']).toBeUndefined();
    });

    it('should create new placeholder for new value', () => {
      const counters: Record<string, number> = {};
      const encodingMap: EncodingMap = {};

      const placeholder = getOrCreatePlaceholder(
        'john@example.com',
        'EMAIL_{ind}@GMAIL.COM',
        counters,
        encodingMap
      );

      expect(placeholder).toBe('EMAIL_1@GMAIL.COM');
      expect(counters['EMAIL_{ind}@GMAIL.COM']).toBe(1);
      expect(encodingMap).toHaveProperty('EMAIL_1@GMAIL.COM', 'john@example.com');
    });
  });

  describe('detectAndReplacePII', () => {
    it('should detect and replace emails in free text', () => {
      const counters: Record<string, number> = {};
      const encodingMap: EncodingMap = {};

      const result = detectAndReplacePII(
        'Contact me at john@example.com for details',
        counters,
        encodingMap
      );

      expect(result).toContain('EMAIL_1@GMAIL.COM');
      expect(encodingMap).toHaveProperty('EMAIL_1@GMAIL.COM', 'john@example.com');
    });

    it('should detect and replace phone numbers in free text', () => {
      const counters: Record<string, number> = {};
      const encodingMap: EncodingMap = {};

      const result = detectAndReplacePII('Call me at (555) 123-4567', counters, encodingMap);

      expect(result).toContain('PHONE_1');
      expect(encodingMap).toHaveProperty('PHONE_1', '(555) 123-4567');
    });

    it('should maintain consistency across multiple calls', () => {
      const counters: Record<string, number> = {};
      const encodingMap: EncodingMap = {};

      const result1 = detectAndReplacePII('Email john@example.com', counters, encodingMap);

      const result2 = detectAndReplacePII('Also contact john@example.com', counters, encodingMap);

      expect(result1).toContain('EMAIL_1');
      expect(result2).toContain('EMAIL_1');
      expect(Object.keys(encodingMap).length).toBe(1);
    });
  });
});
