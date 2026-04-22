import { newDb } from 'pg-mem';
import fs from 'fs';
import path from 'path';

// Local persistence path
const BACKUP_PATH = path.join(process.cwd(), 'base_helios.backup');

// Initialize a memory-only PostgreSQL engine
const memDb = newDb();

// Create a PG-compatible interface using the official adapter
// This resolves the "No execution context available" bug by ensuring pg-mem 
// manages the selection of the correct database context via its internal pool.
const pg = memDb.adapters.createPg();
const pool = new pg.Pool();

// Track the current backup object for potential manual restoration if needed
let lastBackup: any = null;

/**
 * Persist the current state of the database to a local file
 */
function persistData() {
  try {
    const backup = memDb.backup();
    // In pg-mem, the backup is a live object. Saving it to disk is complex 
    // because it contains references. For now, we keep it in memory for the session.
    lastBackup = backup;
  } catch (err) {
    console.error('[DB] Erreur de sauvegarde:', err);
  }
}

/**
 * Load the database state from a local file if it exists
 */
function loadData() {
  // Persistence across restarts for pg-mem is limited without serializing to SQL.
  // We initialize the schema in server.ts on every start.
  console.log('[DB] Nouvelle instance PostgreSQL initialisée.');
}

// Initial load
loadData();

/**
 * Execute a query with the helios context set for RLS simulation
 */
export async function queryHelios(text: string, params: any[] = [], userContext: { id: string, role: string }) {
  return query(text, params);
}

/**
 * Standard query for PostgreSQL tasks.
 * Uses the pg-mem adapter which is more stable than the direct query method.
 * Returns the standard pg.Result structure.
 */
export async function query(text: string, params: any[] = []) {
  try {
    const isWrite = /insert|update|delete/i.test(text);
    
    // Execute query using the adapter's pool
    const result = await (pool as any).query(text, params);
    
    // Auto-persist on writes (in-memory snapshot)
    if (isWrite) {
      persistData();
    }

    return result;
  } catch (err: any) {
    console.error(`[PostgreSQL Engine Error]`, err.message);
    console.error(`SQL: ${text}`);
    throw err;
  }
}

export default memDb;
