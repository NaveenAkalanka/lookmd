/**
 * Server entrypoint. Loads config (BASE + bind), builds the app, and listens.
 *
 *   node src/index.ts --base /path/to/notes [--port 4317] [--host 127.0.0.1]
 *   LOOKMD_BASE=/path/to/notes node src/index.ts
 */

import { loadConfig } from './config.ts';
import { buildApp } from './app.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = buildApp(config);
  await app.listen({ host: config.host, port: config.port });
  // eslint-disable-next-line no-console
  console.log(
    `lookmd server listening on http://${config.host}:${config.port}\n` +
      `  BASE: ${config.base}\n` +
      `  write endpoints: ${config.allowWrite ? 'enabled' : 'disabled'}`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('failed to start lookmd server:', err);
  process.exit(1);
});
