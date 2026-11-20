// Plugin API for community modules.
//
// A plugin is one ES module whose default export is `definePlugin({...})`. It can bring:
//   - migrations: SQL run once each, tracked per plugin; tables must be named `p_<plugin>_*`
//   - routes:     mounted at /api/v2/plugins/<plugin>/..., behind the app's normal sign-in
//   - tools:      MCP tools registered as `<plugin>_<tool>`, so chat can use them
// Plugins load from MOSAIC_PLUGINS_DIR at startup (one file or one folder with index.* per plugin).
// The prefix check and the namespacing keep plugins from stepping on core tables and names.
// It is not a sandbox: a plugin runs with the server's rights, so install only code you trust.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { z } from 'zod';
import { cfg } from '../config.ts';
import { getDb } from '../db.ts';
import { AppError } from '../errors.ts';

export const PLUGIN_API_VERSION = 1;
const NAME_RE = /^[a-z][a-z0-9_]{1,30}$/;
const TOOL_RE = /^[a-z][a-z0-9_]{0,40}$/;

export type PluginContext = {
  /** The app database. Use `table()` names for anything you create. */
  db: DatabaseSync;
  /** `table('books')` → `p_reading_books`. */
  table: (name: string) => string;
  /** Plugin-scoped key/value settings, stored in the app database. */
  settings: { get: (key: string) => string | null; set: (key: string, value: string) => void };
  log: (...args: unknown[]) => void;
};

export type PluginMigration = { version: number; sql: string };

export type PluginTool<S extends z.ZodRawShape = z.ZodRawShape> = {
  description: string;
  /** Zod shape, or a function that receives the server's zod (so plugins need no zod of their own). */
  input: S | ((zod: typeof z) => S);
  run: (args: z.infer<z.ZodObject<S>>, ctx: PluginContext) => unknown;
};

export type MosaicPlugin = {
  name: string;
  version: string;
  description?: string;
  /** Plugin API version this plugin was written for. */
  api?: number;
  migrations?: PluginMigration[];
  routes?: (app: Hono, ctx: PluginContext) => void;
  tools?: Record<string, PluginTool>;
};

/** Identity function that gives plugin authors type checking. */
export const definePlugin = <P extends MosaicPlugin>(p: P): P => p;
/** Helper so each tool's `run` gets typed args from its own `input`. */
export const defineTool = <S extends z.ZodRawShape>(t: PluginTool<S>): PluginTool => t as unknown as PluginTool;

export type LoadedPlugin = { plugin: MosaicPlugin; ctx: PluginContext; app: Hono; source: string };

const loaded = new Map<string, LoadedPlugin>();
const failures: { source: string; error: string }[] = [];

export const loadedPlugins = () => [...loaded.values()];
export const pluginFailures = () => [...failures];

const ensureMeta = (db: DatabaseSync) => {
  db.exec(`CREATE TABLE IF NOT EXISTS plugin_migrations (
    plugin TEXT NOT NULL, version INTEGER NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (plugin, version));
  CREATE TABLE IF NOT EXISTS plugin_settings (
    plugin TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (plugin, key));`);
};

/** Every table/index a migration creates, alters or drops must carry the plugin prefix. */
export const checkMigrationSql = (name: string, sql: string) => {
  const prefix = `p_${name}_`;
  const re = /\b(?:create|alter|drop)\s+(?:unique\s+)?(?:temp(?:orary)?\s+)?(?:virtual\s+)?(table|index|view|trigger)\s+(?:if\s+(?:not\s+)?exists\s+)?["`[]?([A-Za-z0-9_]+)/gi;
  for (const m of sql.matchAll(re)) {
    if (!m[2].toLowerCase().startsWith(prefix)) {
      throw new Error(`plugin ${name}: ${m[1].toLowerCase()} "${m[2]}" must be named ${prefix}*`);
    }
  }
  if (/\battach\s+database\b|\bpragma\b/i.test(sql)) throw new Error(`plugin ${name}: ATTACH and PRAGMA are not allowed in migrations`);
};

const validate = (p: unknown, source: string): MosaicPlugin => {
  const v = p as MosaicPlugin;
  if (!v || typeof v !== 'object') throw new Error(`${source}: default export is not a plugin (use definePlugin)`);
  if (typeof v.name !== 'string' || !NAME_RE.test(v.name)) throw new Error(`${source}: name must match ${NAME_RE}`);
  if (typeof v.version !== 'string' || !v.version) throw new Error(`plugin ${v.name}: version is required`);
  if (v.api !== undefined && v.api !== PLUGIN_API_VERSION) throw new Error(`plugin ${v.name}: written for API ${v.api}, this server speaks ${PLUGIN_API_VERSION}`);
  const versions = new Set<number>();
  for (const m of v.migrations ?? []) {
    if (!Number.isInteger(m.version) || m.version < 1) throw new Error(`plugin ${v.name}: migration versions are positive integers`);
    if (versions.has(m.version)) throw new Error(`plugin ${v.name}: duplicate migration ${m.version}`);
    versions.add(m.version);
    checkMigrationSql(v.name, m.sql);
  }
  for (const [t, def] of Object.entries(v.tools ?? {})) {
    if (!TOOL_RE.test(t)) throw new Error(`plugin ${v.name}: tool name "${t}" must match ${TOOL_RE}`);
    if (typeof def?.run !== 'function' || typeof def.description !== 'string') throw new Error(`plugin ${v.name}: tool ${t} needs description and run`);
  }
  return v;
};

const contextFor = (plugin: MosaicPlugin, db: DatabaseSync): PluginContext => ({
  db,
  table: (n: string) => {
    if (!/^[a-z][a-z0-9_]*$/.test(n)) throw new Error(`bad table name ${n}`);
    return `p_${plugin.name}_${n}`;
  },
  settings: {
    get: (key) => (db.prepare('SELECT value FROM plugin_settings WHERE plugin = ? AND key = ?').get(plugin.name, key) as { value: string } | undefined)?.value ?? null,
    set: (key, value) => {
      db.prepare('INSERT INTO plugin_settings (plugin, key, value) VALUES (?, ?, ?) ON CONFLICT (plugin, key) DO UPDATE SET value = excluded.value').run(plugin.name, key, value);
    },
  },
  log: (...a) => console.error(`[plugin ${plugin.name}]`, ...a),
});

/** Applies pending migrations for one plugin, each in its own transaction. Returns versions applied. */
export const migratePlugin = (plugin: MosaicPlugin, db: DatabaseSync = getDb()) => {
  ensureMeta(db);
  const done = new Set(
    (db.prepare('SELECT version FROM plugin_migrations WHERE plugin = ?').all(plugin.name) as { version: number }[]).map((r) => r.version),
  );
  const applied: number[] = [];
  for (const m of [...(plugin.migrations ?? [])].sort((a, b) => a.version - b.version)) {
    if (done.has(m.version)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO plugin_migrations (plugin, version) VALUES (?, ?)').run(plugin.name, m.version);
      db.exec('COMMIT');
      applied.push(m.version);
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`plugin ${plugin.name} migration ${m.version} failed: ${(e as Error).message}`);
    }
  }
  return applied;
};

/** Registers an already-imported plugin. Used by the loader and by tests. */
export const registerPlugin = (raw: unknown, source = 'inline'): LoadedPlugin => {
  const plugin = validate(raw, source);
  if (loaded.has(plugin.name)) throw new Error(`plugin ${plugin.name} is loaded twice (${loaded.get(plugin.name)!.source}, ${source})`);
  const db = getDb();
  migratePlugin(plugin, db);
  const ctx = contextFor(plugin, db);
  const app = new Hono();
  plugin.routes?.(app, ctx);
  const entry = { plugin, ctx, app, source };
  loaded.set(plugin.name, entry);
  return entry;
};

export const unloadPlugins = () => { loaded.clear(); failures.length = 0; };

const entryOf = (dir: string, f: string) => {
  const full = join(dir, f);
  if (statSync(full).isDirectory()) {
    for (const idx of ['index.js', 'index.mjs', 'index.ts']) if (existsSync(join(full, idx))) return join(full, idx);
    return null;
  }
  return /\.(m?js|ts)$/.test(f) && !/\.(test|d)\.(m?js|ts)$/.test(f) ? full : null;
};

/**
 * Imports every plugin in MOSAIC_PLUGINS_DIR (or `dir`). A broken plugin is reported and skipped;
 * it never stops the server. Safe to call more than once: already-loaded names are skipped.
 */
export const loadPlugins = async (dir = cfg('MOSAIC_PLUGINS_DIR')) => {
  if (!dir || !existsSync(dir)) return loadedPlugins();
  for (const f of readdirSync(dir).sort()) {
    const entry = entryOf(dir, f);
    if (!entry) continue;
    try {
      const mod = await import(pathToFileURL(resolve(entry)).href);
      const p = mod.default ?? mod.plugin;
      if (p && loaded.has(p.name) && loaded.get(p.name)!.source === entry) continue;
      registerPlugin(p, entry);
    } catch (e) {
      const error = (e as Error)?.message ?? String(e);
      failures.push({ source: entry, error });
      console.error(`plugin load failed: ${entry}: ${error}`);
    }
  }
  return loadedPlugins();
};

/** Public description of the loaded plugins (GET /api/v2/plugins, `cli plugins`). */
export const describePlugins = () => ({
  api: PLUGIN_API_VERSION,
  plugins: loadedPlugins().map(({ plugin }) => ({
    name: plugin.name,
    version: plugin.version,
    description: plugin.description ?? '',
    tools: Object.keys(plugin.tools ?? {}).map((t) => `${plugin.name}_${t}`),
    routes: `/api/v2/plugins/${plugin.name}`,
    migrations: (plugin.migrations ?? []).length,
  })),
  failed: pluginFailures(),
});

/** Router for /api/v2/plugins: the index plus each plugin's own sub-app. */
export const pluginsRouter = () => {
  const r = new Hono();
  r.get('/', (c) => c.json(describePlugins()));
  r.all('/:name/*', (c) => {
    const p = loaded.get(c.req.param('name'));
    if (!p) throw new AppError('not_found', `No plugin named ${c.req.param('name')}`);
    const url = new URL(c.req.url);
    url.pathname = url.pathname.replace(/^.*?\/plugins\/[^/]+/, '') || '/';
    return p.app.fetch(new Request(url, c.req.raw));
  });
  r.all('/:name', (c) => c.redirect(`${c.req.path}/`, 308));
  return r;
};

/** Every plugin tool as (fullName, description, shape, handler), for the MCP server to register. */
export const pluginTools = () =>
  loadedPlugins().flatMap(({ plugin, ctx }) =>
    Object.entries(plugin.tools ?? {}).map(([t, def]) => ({
      name: `${plugin.name}_${t}`,
      description: `[${plugin.name}] ${def.description}`,
      shape: (typeof def.input === 'function' ? def.input(z) : def.input) as z.ZodRawShape,
      run: (a: unknown) => def.run(a as never, ctx),
    })),
  );
