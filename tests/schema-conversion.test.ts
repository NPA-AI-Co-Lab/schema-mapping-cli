import { describe, it, expect, vi } from 'vitest';
import {
  preprocessRequiredFields,
  batchCleanupRequiredFields,
} from '../src/jsonld/required-fields.js';

// Mock external dependencies
vi.mock('../src/utils/index.js', async () => {
  const actual = await vi.importActual('../src/utils/index.js');
  return {
    ...actual,
    loadJSON: vi.fn(),
    fixZodFromJsonSchema: vi.fn((originalSchema, zodSchema) => zodSchema),
  };
});

describe('Schema Conversion', () => {
  describe('preprocessRequiredFields', () => {
    it('should wrap required fields with presence tracking', () => {
      const schema = {
        '@context': { '@vocab': 'https://schema.org' },
        entities: {
          Person: {
            '@type': 'object',
            properties: {
              name: { type: 'string', required: true },
              email: { type: 'string', required: true },
              age: { type: 'number', required: false },
            },
          },
        },
      } as any;

      const result = preprocessRequiredFields(schema);

      // Required fields should be wrapped
      expect(result.entities.Person.properties.name.type).toBe('object');
      expect(result.entities.Person.properties.name.properties).toHaveProperty('value');
      expect(result.entities.Person.properties.name.properties).toHaveProperty('present');
      expect(result.entities.Person.properties.name.properties?.present.type).toBe('boolean');

      expect(result.entities.Person.properties.email.type).toBe('object');
      expect(result.entities.Person.properties.email.properties).toHaveProperty('value');
      expect(result.entities.Person.properties.email.properties).toHaveProperty('present');

      // Non-required fields should not be wrapped
      expect(result.entities.Person.properties.age.type).toBe('number');
      expect(result.entities.Person.properties.age).not.toHaveProperty('properties');
    });

    it('should preserve original property definitions in wrapped value', () => {
      const schema = {
        '@context': { '@vocab': 'https://schema.org' },
        entities: {
          Person: {
            '@type': 'object',
            properties: {
              name: {
                type: 'string',
                required: true,
                description: 'Person full name',
              },
            },
          },
        },
      } as any;

      const result = preprocessRequiredFields(schema);

      const wrappedField = result.entities.Person.properties.name;
      expect(wrappedField.properties?.value.type).toBe('string');
      expect(wrappedField.properties?.value.description).toBe('Person full name');
      expect(wrappedField.properties?.value.required).toBeUndefined(); // Should be removed
    });

    it('should not modify non-required fields', () => {
      const schema = {
        '@context': { '@vocab': 'https://schema.org' },
        entities: {
          Person: {
            '@type': 'object',
            properties: {
              name: { type: 'string' }, // No required property
              email: { type: 'string', required: false },
              age: { type: 'number' },
            },
          },
        },
      } as any;

      const result = preprocessRequiredFields(schema);

      expect(result.entities.Person.properties.name.type).toBe('string');
      expect(result.entities.Person.properties.email.type).toBe('string');
      expect(result.entities.Person.properties.age.type).toBe('number');

      // Should not have wrapper properties
      expect(result.entities.Person.properties.name).not.toHaveProperty('properties');
      expect(result.entities.Person.properties.email).not.toHaveProperty('properties');
      expect(result.entities.Person.properties.age).not.toHaveProperty('properties');
    });
  });

  describe('batchCleanupRequiredFields', () => {
    const originalSchema = {
      '@context': { '@vocab': 'https://schema.org' },
      entities: {
        Person: {
          '@type': 'object',
          properties: {
            name: { type: 'string', required: true },
            email: { type: 'string', required: true },
            age: { type: 'number' },
          },
        },
      },
    } as any;

    it('should unwrap required fields and set missing ones to null', () => {
      const results = [
        {
          '@context': 'https://schema.org',
          Person: [
            {
              name: { value: 'John Doe', present: true },
              email: { value: null, present: false }, // Missing email
              age: 30,
            },
            {
              name: { value: 'Jane Smith', present: true },
              email: { value: 'jane@example.com', present: true },
              age: 25,
            },
          ],
        },
      ];

      const cleaned = batchCleanupRequiredFields(results, originalSchema);

      expect((cleaned[0].Person as any)[0].name).toBe('John Doe');
      expect((cleaned[0].Person as any)[0].email).toBeNull(); // Should be null when not present
      expect((cleaned[0].Person as any)[0].age).toBe(30);

      expect((cleaned[0].Person as any)[1].name).toBe('Jane Smith');
      expect((cleaned[0].Person as any)[1].email).toBe('jane@example.com');
      expect((cleaned[0].Person as any)[1].age).toBe(25);
    });

    it('should preserve @context', () => {
      const results = [
        {
          '@context': 'https://schema.org',
          Person: {
            name: { value: 'John Doe', present: true },
            email: { value: 'john@example.com', present: true },
          },
        },
      ];

      const cleaned = batchCleanupRequiredFields(results, originalSchema);

      expect(cleaned[0]['@context']).toBe('https://schema.org');
      expect((cleaned[0].Person as any).name).toBe('John Doe');
      expect((cleaned[0].Person as any).email).toBe('john@example.com');
    });

    it('should handle array entities correctly', () => {
      const results = [
        {
          '@context': 'https://schema.org',
          Person: [
            {
              name: { value: 'John Doe', present: true },
              email: { value: 'john@example.com', present: true },
            },
          ],
        },
      ];

      const cleaned = batchCleanupRequiredFields(results, originalSchema);

      expect(Array.isArray(cleaned[0].Person)).toBe(true);
      expect((cleaned[0].Person as any)[0].name).toBe('John Doe');
      expect((cleaned[0].Person as any)[0].email).toBe('john@example.com');
    });

    it('should handle cleanup with missing entities', () => {
      const results = [
        {
          '@context': 'https://schema.org',
          // Person entity is missing
        },
      ];

      const cleaned = batchCleanupRequiredFields(results, originalSchema);
      expect(cleaned[0]).toEqual({ '@context': 'https://schema.org' });
    });
  });
});
