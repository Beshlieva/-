import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { loadAuth, saveAuth } from './authStorage';

describe('authStorage', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as any).window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
    };
  });

  it('accepts Supabase JWT access tokens', () => {
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signature';
    const session = {
      user: {
        userId: 'user-1',
        email: 'student@example.com',
        displayName: 'Student Example',
        age: 17,
        regionCode: '01',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
      accessToken: token,
    };

    saveAuth(session);

    assert.deepEqual(loadAuth(), session);
  });
});
