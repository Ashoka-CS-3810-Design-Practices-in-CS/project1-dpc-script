import type { ExportService } from '@/app/contracts';
import { fail } from '@/model/result';

/** Stub (AB-06): every call fails. Real implementation: AB-09. */
export function createExportService(): ExportService {
  return {
    check: () => fail('Not available yet.'),
    estimateBytes: () => 0,
    export: async () => fail('Not available yet.'),
  };
}
