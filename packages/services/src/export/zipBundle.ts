import { strToU8, zipSync } from 'fflate';
import type { ExportFiles } from './buildBundle';

export function zipBundle(files: ExportFiles): Uint8Array {
  return zipSync({
    'index.html': strToU8(files['index.html']),
    'savig-runtime.js': strToU8(files['savig-runtime.js']),
  });
}
