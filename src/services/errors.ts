// Distinct error types so callers (UI toasts in Plan 3) can branch on cause.
export class SvgImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SvgImportError';
  }
}

export class AudioImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioImportError';
  }
}

export class MissingAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingAssetError';
  }
}

export class SavigLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SavigLoadError';
  }
}

export class UnsupportedVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedVersionError';
  }
}
