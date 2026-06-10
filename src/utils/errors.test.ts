import { ImportError, getErrorMessage } from '@/src/utils/errors';

describe('getErrorMessage', () => {
  it('returns the message from an Error instance', () => {
    expect(getErrorMessage(new Error('Boom'), 'Fallback')).toBe('Boom');
  });

  it('returns fallback for unknown values', () => {
    expect(getErrorMessage('oops', 'Fallback')).toBe('Fallback');
    expect(getErrorMessage(null, 'Fallback')).toBe('Fallback');
  });
});

describe('ImportError', () => {
  it('is an Error with a stable name and user-facing message', () => {
    const error = new ImportError('Bad file.');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ImportError);
    expect(error.name).toBe('ImportError');
    expect(getErrorMessage(error, 'Fallback')).toBe('Bad file.');
  });
});
