// Test end-to-end de dependency-doctor.
import path from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const packageDir = path.resolve(import.meta.dirname, '..');
const tmpDir = path.join(packageDir, 'test', 'tmp');
rmSync(tmpDir, { recursive: true, force: true });
const home = path.join(tmpDir, 'dsh-home');
const project = path.join(tmpDir, 'proj');
mkdirSync(path.join(home, 'dependency-doctor'), { recursive: true });
mkdirSync(path.join(project, 'node_modules', 'left'), { recursive: true });
mkdirSync(path.join(project, 'node_modules', 'extra'), { recursive: true });
mkdirSync(path.join(project, 'node_modules', '@scope', 'pkg'), { recursive: true });
writeFileSync(path.join(home, 'dependency-doctor', 'config.json'), JSON.stringify({ allowedPaths: [project] }), 'utf8');
writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'dep-demo', version: '1.0.0', dependencies: { left: '^1.2.0', missing: '^2.0.0' } }), 'utf8');
writeFileSync(path.join(project, 'node_modules', 'left', 'package.json'), JSON.stringify({ name: 'left', version: '1.2.5' }), 'utf8');
writeFileSync(path.join(project, 'node_modules', 'extra', 'package.json'), JSON.stringify({ name: 'extra', version: '0.1.0' }), 'utf8');
writeFileSync(path.join(project, 'node_modules', '@scope', 'pkg', 'package.json'), JSON.stringify({ name: '@scope/pkg', version: '3.0.0' }), 'utf8');

function makeClient() {
  const entry = process.env.DEPDOCTOR_SERVER ? path.resolve(process.env.DEPDOCTOR_SERVER) : path.join(packageDir, 'server.mjs');
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows', PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME || process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP, DSH_HOME: home }, stderr: 'pipe' });
  transport.stderr?.on('data', (c) => process.stderr.write(`[server] ${c}`));
  const client = new Client({ name: 'depdoctor-test', version: '1.0.0' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } });
  return client.connect(transport).then(() => ({ client, transport }));
}
const textOf = (r) => (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

const { client, transport } = await makeClient();
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
console.log('--- status ---'); console.log(textOf(await client.callTool({ name: 'status', arguments: {} })));
const scan = textOf(await client.callTool({ name: 'scan', arguments: { path: project } }));
console.log('--- scan ---'); console.log(scan);
console.log('declaradas 2 instaladas 3:', scan.includes('Declaradas: 2') && scan.includes('instaladas: 3'));
console.log('missing error:', /❌ \[missing\]/.test(scan));
console.log('left compatible:', !scan.includes('[left]'));
console.log('extra info:', /ℹ️ \[extra\]/.test(scan));
console.log('scoped instalado:', scan.includes('@scope/pkg'));
const outside = await client.callTool({ name: 'scan', arguments: { path: 'C:\\Windows' } });
console.log('ruta fuera isError:', outside.isError === true);
const noPkg = await client.callTool({ name: 'scan', arguments: { path: home } });
console.log('sin package isError:', noPkg.isError === true);
await client.close(); try { await transport.close?.(); } catch {}
console.log('OK');
