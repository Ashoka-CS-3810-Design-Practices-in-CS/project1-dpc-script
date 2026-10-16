import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Makes the audio fixtures if nobody has yet (CI already runs `npm run fixtures`). */
export default function globalSetup(): void {
  if (!existsSync('e2e/fixtures/generated')) execSync('npm run fixtures', { stdio: 'inherit' });
}
