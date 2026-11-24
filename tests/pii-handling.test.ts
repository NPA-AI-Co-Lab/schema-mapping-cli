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
    userid: { placeholder: 'ID_{ind}' },
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

// Issue #7: in rules mode the record handed to encodePII is the rule-mapped one (nested), not
// the flat CSV row, and a top-level-only encoder left every value in it unmasked.
describe('PII Encoding of nested (rule-mapped) records', () => {
  let handlers: ReturnType<typeof createPIIHandlers>;

  beforeEach(() => {
    handlers = createPIIHandlers(true);
  });

  it('masks field-map keys inside nested objects', () => {
    const records = [{ person: { email: 'john@example.com', name: 'John Doe', country: 'US' } }];

    const { processedBatch, encodingMap } = handlers.encodePII(records);

    expect(processedBatch[0].person).toEqual({
      email: 'EMAIL_1@GMAIL.COM',
      name: 'NAME_1',
      country: 'US',
    });
    expect(encodingMap).toEqual({ 'EMAIL_1@GMAIL.COM': 'john@example.com', NAME_1: 'John Doe' });
  });

  it('masks every item of an array stored under a field-map key', () => {
    const records = [{ person: { emails: ['a@example.com', 'b@example.org'] } }];

    const { processedBatch, encodingMap } = handlers.encodePII(records);

    expect(processedBatch[0].person.emails).toEqual(['EMAIL_1@GMAIL.COM', 'EMAIL_2@GMAIL.COM']);
    expect(Object.values(encodingMap).sort()).toEqual(['a@example.com', 'b@example.org']);
  });

  it('masks the value of a { value, present } required-field wrapper by the wrapped key', () => {
    const records = [{ person: { name: { value: 'John Doe', present: true } } }];

    const { processedBatch } = handlers.encodePII(records);

    expect(processedBatch[0].person.name).toEqual({ value: 'NAME_1', present: true });
  });

  it('treats an object with fields besides value/present as an ordinary object, not a wrapper', () => {
    const records = [
      { person: { value: 'public', present: true, email: 'secret@example.com', note: 'x@y.org' } },
    ];

    const { processedBatch } = handlers.encodePII(records);

    expect(processedBatch[0].person).toEqual({
      value: 'public',
      present: true,
      email: 'EMAIL_1@GMAIL.COM',
      note: 'EMAIL_2@GMAIL.COM',
    });
    expect(JSON.stringify(processedBatch)).not.toMatch(/secret@example\.com|x@y\.org/);
  });

  it('regex-scans nested free text, including strings inside arrays of objects', () => {
    const records = [
      {
        object: {
          title: 'Write to np@aboba.com',
          responses: [{ question: 'Contact?', answer: 'call 555-123-4567' }],
        },
      },
    ];

    const { processedBatch } = handlers.encodePII(records);
    const serialized = JSON.stringify(processedBatch);

    expect(serialized).not.toContain('np@aboba.com');
    expect(serialized).not.toContain('555-123-4567');
    expect(processedBatch[0].object.title).toBe('Write to EMAIL_1@GMAIL.COM');
    expect(processedBatch[0].object.responses[0].answer).toBe('call PHONE_1');
  });

  it('masks a number stored under a field-map key and leaves other non-strings alone', () => {
    const records = [{ person: { phone: 5551234567, score: 4, active: true, note: null } }];

    const { processedBatch, encodingMap } = handlers.encodePII(records);

    expect(processedBatch[0].person).toEqual({
      phone: 'PHONE_1',
      score: 4,
      active: true,
      note: null,
    });
    expect(encodingMap).toEqual({ PHONE_1: '5551234567' });
  });

  it('does not mutate the input record', () => {
    const record = { person: { email: 'john@example.com', emails: ['a@example.com'] } };
    const snapshot = JSON.parse(JSON.stringify(record));

    handlers.encodePII([record]);

    expect(record).toEqual(snapshot);
  });

  it('round-trips a nested record through decodePII', () => {
    const record = {
      person: {
        name: { value: 'John Doe', present: true },
        email: 'john@example.com',
        emails: ['a@example.com'],
      },
      object: { title: 'Write to np@aboba.com' },
    };

    const { processedBatch, encodingMap } = handlers.encodePII([record]);

    expect(handlers.decodePII(processedBatch[0], encodingMap)).toEqual(record);
  });
});

describe('PII Encoding: values masked once are masked everywhere in the batch', () => {
  let handlers: ReturnType<typeof createPIIHandlers>;

  beforeEach(() => {
    handlers = createPIIHandlers(true);
  });

  it('masks a user ID copied into a reference field with the same placeholder', () => {
    const records = [
      {
        person: { userID: { value: 'u002', present: true } },
        action: { person: { value: 'u002', present: true }, referrer: 'newswebsite.org/home' },
      },
    ];

    const { processedBatch } = handlers.encodePII(records);

    expect(processedBatch[0].person.userID.value).toBe('ID_1');
    expect(processedBatch[0].action.person).toEqual({ value: 'ID_1', present: true });
    expect(processedBatch[0].action.referrer).toBe('newswebsite.org/home');
    expect(JSON.stringify(processedBatch)).not.toContain('u002');
  });

  it('masks names mentioned in free text, including names from other records of the batch', () => {
    const records = [
      { person: { name: 'Jane' }, comment: 'Jane asked about Brown, then left.' },
      { person: { name: 'Brown' }, comment: 'No comment' },
    ];

    const { processedBatch } = handlers.encodePII(records);

    expect(processedBatch[0].comment).toBe('NAME_1 asked about NAME_2, then left.');
    expect(processedBatch[1].comment).toBe('No comment');
  });

  it('only masks whole words, so a name inside another word is left alone', () => {
    const records = [{ person: { name: 'Ann' }, comment: 'Announcement for Ann and Anna' }];

    const { processedBatch } = handlers.encodePII(records);

    expect(processedBatch[0].comment).toBe('Announcement for NAME_1 and Anna');
  });

  it('masks a short value only where it is the whole string', () => {
    const records = [{ person: { userID: 'u1' }, ref: 'u1', comment: 'u1 is a short id' }];

    const { processedBatch } = handlers.encodePII(records);

    expect(processedBatch[0].ref).toBe('ID_1');
    expect(processedBatch[0].comment).toBe('u1 is a short id');
  });

  it('never re-masks a placeholder, even when a known value occurs inside it', () => {
    const records = [{ person: { name: 'NAME' }, comment: 'np@aboba.com wrote to NAME' }];

    const { processedBatch, encodingMap } = handlers.encodePII(records);

    expect(processedBatch[0].person.name).toBe('NAME_1');
    expect(processedBatch[0].comment).toBe('EMAIL_1@GMAIL.COM wrote to NAME_1');
    expect(handlers.decodePII(processedBatch[0], encodingMap)).toEqual(records[0]);
  });

  it('round-trips records with masked references and free-text mentions', () => {
    const records = [
      {
        person: { userID: 'u002', name: 'Jane Doe' },
        action: { person: 'u002' },
        comment: 'Jane Doe (u002) replied',
      },
    ];

    const { processedBatch, encodingMap } = handlers.encodePII(records);

    expect(JSON.stringify(processedBatch)).not.toMatch(/u002|Jane Doe/);
    expect(handlers.decodePII(processedBatch[0], encodingMap)).toEqual(records[0]);
  });
});
