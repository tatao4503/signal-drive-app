import { createSignalServer } from './server.mjs';

const rawPort = process.env.PORT || '3217';
if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65_535) throw new Error('Invalid PORT.');
const host = process.env.SIGNAL_HOST || '127.0.0.1';
if (!['127.0.0.1', '::1'].includes(host) && !process.env.SIGNAL_PUBLIC_ORIGIN) {
  throw new Error('Non-loopback binding requires SIGNAL_PUBLIC_ORIGIN and a trusted HTTPS reverse proxy.');
}
const server = await createSignalServer({
  apiKey: process.env.TDATA_API_KEY || '',
  targetsFile: process.env.SIGNAL_TARGETS_FILE || undefined,
  publicOrigin: process.env.SIGNAL_PUBLIC_ORIGIN || undefined,
});
server.listen(Number(rawPort), host, () => {
  console.log(`SIGNAL Drive local MVP: http://${host === '::1' ? '[::1]' : host}:${rawPort}`);
});
server.on('error', () => { console.error('SIGNAL Drive server could not start. Check the local port and configuration.'); process.exitCode = 1; });
for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => server.close(() => process.exit(0)));
