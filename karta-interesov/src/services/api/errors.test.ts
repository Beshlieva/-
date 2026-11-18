import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError } from '../../types';
import { describeError } from './errors';

describe('describeError', () => {
  it('returns the underlying message for plain Error instances', () => {
    const err = new Error('REGION_NOT_FOUND:ru');
    assert.equal(describeError(err), 'REGION_NOT_FOUND:ru');
  });

  it('keeps ApiError messages for API responses', () => {
    const err = new ApiError('INVALID_RESPONSE', 'Сервер вернул данные в неожиданном формате.');
    assert.equal(describeError(err), 'Сервер вернул данные в неожиданном формате.');
  });
});
