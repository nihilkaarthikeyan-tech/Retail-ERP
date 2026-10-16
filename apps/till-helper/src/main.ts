// Copyright (c) 2026, Rademics. All rights reserved.
// Retail ERP Till Helper: start-up. Run with `node dist/main.js`.
//   --config <file>   use another settings file
//   --reset-token     forget the old pairing (every till page must pair again)
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfig } from './config.js';
import { loadPairing } from './pairing.js';
import { createHelperServer, listenLocal } from './server.js';
import { printerName, transportFor } from './transports.js';
import { VERSION } from './version.js';

const log = (message: string) => console.log(`${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}  ${message}`);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const programDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const configIndex = args.indexOf('--config');
  const configPath = configIndex >= 0 && args[configIndex + 1] ? resolve(args[configIndex + 1]!) : join(programDir, 'till-helper.config.json');
  const pairingPath = join(dirname(configPath), 'till-helper.pairing.json');

  const { config, created } = loadConfig(configPath);
  if (created) log(`Created settings file ${configPath} (no printer set up yet).`);
  const { pairing, createdToken } = loadPairing(pairingPath, args.includes('--reset-token'));
  const transport = transportFor(config.printer);

  const server = createHelperServer({ config, pairing, transport, log });
  const port = await listenLocal(server, config.port);

  console.log('');
  console.log(`  Retail ERP Till Helper ${VERSION}`);
  console.log(`  Listening on http://127.0.0.1:${port} (this computer only)`);
  console.log(`  Allowed ERP address: ${config.allowedOrigins.join(', ')}`);
  console.log(`  Printer: ${transport ? `${config.printer.kind} ${printerName(config.printer)}` : 'not set up (the till will print through the browser)'}`);
  console.log(`  Paper: ${config.paperWidth} mm   Cash drawer: ${config.drawer.enabled ? 'yes' : 'no'}`);
  console.log('');
  console.log(`  PAIRING CODE: ${pairing.pendingCode}`);
  console.log('  Type this code in the till screen to connect it. It works once;');
  console.log('  restart the helper to get a new one.');
  if (createdToken) console.log('  (A new pairing secret was made: every till page must pair again.)');
  console.log(`  The code and token are also saved in ${pairingPath}`);
  console.log('');

  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) console.error(`Settings problem: ${err.message}`);
  else if ((err as NodeJS.ErrnoException)?.code === 'EADDRINUSE') {
    console.error('The Till Helper port is already in use. Is the helper already running? Otherwise change "port" in the settings file.');
  } else console.error(err);
  process.exit(1);
});
