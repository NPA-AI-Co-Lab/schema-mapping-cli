import { describe, it, expect } from 'vitest';
import { nativeModuleHint } from '../src/database/connection.js';

describe('nativeModuleHint (#10)', () => {
  it.each([
    'Could not locate the bindings file. Tried: ...',
    'The module was compiled against a different Node.js version using NODE_MODULE_VERSION 127.',
    'Module did not self-register: better_sqlite3.node',
    'invalid ELF header',
  ])('explains a native-module load failure: %s', (message) => {
    const hint = nativeModuleHint(message);
    expect(hint).toContain(process.version);
    expect(hint).toContain('Node.js 22 or newer');
    expect(hint).toContain('npm ci');
  });

  it('adds nothing to other database errors', () => {
    expect(nativeModuleHint('SQLITE_CANTOPEN: unable to open database file')).toBe('');
    expect(nativeModuleHint('Database schema validation failed')).toBe('');
  });
});
