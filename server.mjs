#!/usr/bin/env node
// dsh-plugin-dependency-doctor — audita dependencias locales de Node.
// Tools: status, scan.

import path from 'node:path';
import os from 'node:os';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const VERSION = '0.1.0';
const DSH_HOME = (() => {
  const v = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  return v || path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.dsh');
})();
const CONFIG_FILE = path.join(DSH_HOME, 'dependency-doctor', 'config.json');
const CACHE_DIR = path.join(DSH_HOME, 'cache', 'dependency-doctor');
const log = (m) => process.stderr.write(`[depdoctor] ${m}\n`);

function loadConfig() { try { if (existsSync(CONFIG_FILE)) return { allowedPaths: [], ...(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) || {}) }; } catch { /* defaults */ } return { allowedPaths: [] }; }
function allowedRoots() { const configured = loadConfig().allowedPaths; return (Array.isArray(configured) && configured.length ? configured : [process.env.USERPROFILE || process.env.HOME || os.homedir()]).map((item) => path.resolve(item)); }
function isAllowed(target) { const resolved = path.resolve(target); return allowedRoots().some((root) => resolved === root || resolved.startsWith(root + path.sep)); }
function readJson(file) { try { return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } }
function versionOf(range) { const match = String(range || '').match(/(\d+)\.(\d+)\.(\d+)/); return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), raw: match[0] } : null; }
function satisfiesDeclared(declared, installed) {
  const wanted = versionOf(declared);
  const actual = versionOf(installed);
  if (!wanted || !actual) return true;
  if (/^\^/.test(declared)) return actual.major === wanted.major && (actual.minor > wanted.minor || (actual.minor === wanted.minor && actual.patch >= wanted.patch));
  if (/^~/.test(declared)) return actual.major === wanted.major && actual.minor === wanted.minor && actual.patch >= wanted.patch;
  if (/^[<>]=?/.test(declared) || /\|\|/.test(declared) || /\s/.test(declared)) return true;
  return actual.raw === wanted.raw;
}
function scan(rootInner) {
  const root = path.resolve(rootInner);
  if (!existsSync(root)) throw new Error(`la ruta no existe: ${root}`);
  if (!statSync(root).isDirectory()) throw new Error(`no es un directorio: ${root}`);
  if (!isAllowed(root)) throw new Error(`ruta no permitida: ${root} (revisa allowedPaths)`);
  const packageFile = path.join(root, 'package.json');
  if (!existsSync(packageFile)) throw new Error(`sin package.json en ${root}`);
  const pkg = readJson(packageFile);
  if (!pkg) throw new Error('package.json inválido');
  const declared = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const nodeModules = path.join(root, 'node_modules');
  const installed = new Map();
  if (existsSync(nodeModules)) {
    for (const entry of (() => { try { return readdirSync(nodeModules, { withFileTypes: true }); } catch { return []; } })()) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (entry.name.startsWith('@')) {
        const scopeDir = path.join(nodeModules, entry.name);
        for (const sub of (() => { try { return readdirSync(scopeDir, { withFileTypes: true }); } catch { return []; } })()) {
          if (!sub.isDirectory()) continue;
          const manifest = readJson(path.join(scopeDir, sub.name, 'package.json'));
          if (manifest) installed.set(`${entry.name}/${sub.name}`, manifest.version || null);
        }
        continue;
      }
      const manifest = readJson(path.join(nodeModules, entry.name, 'package.json'));
      if (manifest) installed.set(entry.name, manifest.version || null);
    }
  }
  const issues = [];
  for (const [name, range] of Object.entries(declared)) {
    if (!installed.has(name)) { issues.push({ severity: 'error', package: name, message: `declarada (${range}) pero no instalada en node_modules` }); continue; }
    const version = installed.get(name);
    if (version && !satisfiesDeclared(range, version)) issues.push({ severity: 'warn', package: name, message: `instalada ${version} no coincide con "${range}"` });
  }
  for (const name of installed.keys()) if (!declared[name] && !pkg.optionalDependencies?.[name] && !pkg.peerDependencies?.[name]) issues.push({ severity: 'info', package: name, message: 'instalada pero no declarada (extranea o transitiva hoisted)' });
  const lockfiles = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].filter((name) => existsSync(path.join(root, name)));
  const scripts = Object.entries(pkg.scripts || {}).filter(([name]) => /^(pre|post)?install$/.test(name));
  return { root, packageName: pkg.name || null, declared: Object.keys(declared).length, installed: installed.size, issues, lockfiles, installScripts: scripts.map(([name]) => name) };
}
function textResult(text) { return { content: [{ type: 'text', text }] }; }

function buildInstructions() {
  return [
    'Dependency Doctor: audita dependencias Node locales (sin red).',
    '',
    'Herramientas: status, scan.',
    '',
    'Reglas:',
    '- Solo lectura: compara package.json con node_modules instalado.',
    '- Reporta faltantes, versiones que no coinciden y extraneas (con matices de hoisting).',
    '- No consulta el registro npm; no inventes métricas de seguridad.',
    '- Respeta allowedPaths.',
  ].join('\n');
}

function buildServer() {
  const server = new McpServer({ name: 'dsh-plugin-dependency-doctor', version: VERSION }, { capabilities: { tools: {} }, instructions: buildInstructions() });
  server.registerTool(
    'status',
    { title: 'Estado', description: 'Rutas permitidas y modo.', inputSchema: z.object({}) },
    async () => textResult([`Rutas permitidas: ${allowedRoots().join(', ')}`, 'Modo: solo lectura (sin red)'].join('\n')),
  );
  server.registerTool(
    'scan',
    { title: 'Auditar dependencias', description: 'Compara declaradas vs instaladas y reporta problemas.', inputSchema: z.object({ path: z.string().min(2) }) },
    async (args) => {
      const result = scan(args.path);
      const errors = result.issues.filter((issue) => issue.severity === 'error').length;
      return textResult([
        `Proyecto: ${result.packageName || path.basename(result.root)}`,
        `Declaradas: ${result.declared} · instaladas: ${result.installed} · lockfiles: ${result.lockfiles.join(', ') || '(ninguno)'}`,
        result.installScripts.length ? `Scripts install: ${result.installScripts.join(', ')}` : '',
        '',
        `Hallazgos: ${result.issues.length} (errores: ${errors})`,
        ...(result.issues.length ? result.issues.map((issue) => `${issue.severity === 'error' ? '❌' : issue.severity === 'warn' ? '⚠️' : 'ℹ️'} [${issue.package}] ${issue.message}`) : ['✅ Dependencias consistentes.']),
      ].filter((line) => line !== undefined).join('\n'));
    },
  );
  return server;
}

try { mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignora */ }
log('dependency-doctor listo');
serveStdio(buildServer, { onerror: (e) => log(`serveStdio: ${e.message}`) });
process.on('uncaughtException', (e) => log(`excepción: ${e.message}`));
process.on('unhandledRejection', (e) => log(`rechazo: ${e && e.message ? e.message : String(e)}`));
