import pkg from 'pg';
const { Pool } = pkg;
import { newDb } from 'pg-mem';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Local persistence path for pg-mem mode
const JOURNAL_PATH = path.join(process.cwd(), 'helios_journal.log');

let pool: any;
let isRealPostgres = false;

/**
 * Initialize the database connection. 
 * Attempts to connect to real PostgreSQL if config is present, 
 * otherwise falls back to pg-mem.
 */
async function initializeDB() {
  const envUrl = process.env.DATABASE_URL;
  const envHost = process.env.PGHOST;
  
  if (envUrl || envHost) {
    try {
      console.log('[DB] Tentative de connexion au PostgreSQL réel...');
      // Small timeout for the check to avoid hanging
      const tempPool = new Pool({
        connectionString: envUrl,
        connectionTimeoutMillis: 5000,
      });
      
      // Test the connection
      await tempPool.query('SELECT 1');
      console.log('[DB] Connexion PostgreSQL Réel établie avec succès.');
      
      pool = tempPool;
      isRealPostgres = true;
      return;
    } catch (err: any) {
      console.error(`[DB] Échec de connexion PostgreSQL Réel: ${err.message}`);
      console.log('[DB] Basculement en mode En-Mémoire (pg-mem) par sécurité.');
    }
  }

  // Fallback to pg-mem
  console.log('[DB] Initialisation du mode En-Mémoire (pg-mem).');
  const memDb = newDb();
  
  // Register gen_random_uuid for pg-mem compatibility
  memDb.public.registerFunction({
    name: 'gen_random_uuid',
    returns: (memDb as any).getType('uuid'),
    implementation: () => crypto.randomUUID(),
  });

  const pgAdapter = memDb.adapters.createPg();
  pool = new pgAdapter.Pool();
  isRealPostgres = false;
}

// Global initialization state
let initialized = false;

interface JournalEntry {
  text: string;
  params: any[];
}

/**
 * Persist a query to the journal (Only for pg-mem fallback)
 */
function appendToJournal(text: string, params: any[]) {
  if (isRealPostgres) return; 
  try {
    const entry: JournalEntry = { text, params };
    fs.appendFileSync(JOURNAL_PATH, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('[DB] Erreur de journalisation:', err);
  }
}

/**
 * Replay the journal to restore state (Only for pg-mem fallback)
 */
async function loadData() {
  if (isRealPostgres) return;
  try {
    if (fs.existsSync(JOURNAL_PATH)) {
      console.log('[DB] Restauration du journal PostgreSQL en-mémoire...');
      const content = fs.readFileSync(JOURNAL_PATH, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim() !== '');
      
      let count = 0;
      for (const line of lines) {
        try {
          const entry: JournalEntry = JSON.parse(line);
          await pool.query(entry.text, entry.params);
          count++;
        } catch (e: any) {
          console.warn(`[DB] Ligne de journal corrompue ignorée: ${e.message}`);
        }
      }
      console.log(`[DB] ${count} opérations rejouées avec succès.`);
    }
  } catch (err) {
    console.error('[DB] Erreur critique de chargement du journal:', err);
  }
}

/**
 * Public Initialization
 */
export async function initPersistence() {
  if (!initialized) {
    await initializeDB();
    initialized = true;
  }
  await loadData();
}

/**
 * Execute a query with simulation of RLS context if needed
 */
export async function queryHelios(text: string, params: any[] = [], userContext: { id: string, role: string }) {
  // RLS logic could be added here for Real PG
  return query(text, params);
}

/**
 * Standard query for PostgreSQL tasks.
 * Ensures the DB is initialized before executing.
 */
export async function query(text: string, params: any[] = []) {
  if (!initialized) {
    await initializeDB();
    initialized = true;
  }

  try {
    const result = await pool.query(text, params);
    
    if (!isRealPostgres) {
      const isWrite = /insert|update|delete/i.test(text);
      if (isWrite) {
        appendToJournal(text, params);
      }
    }

    return result;
  } catch (err: any) {
    console.error(`[PostgreSQL Engine Error]`, err.message);
    console.error(`SQL: ${text}`);
    throw err;
  }
}

export default {
  get pool() { return pool; },
  get isRealPostgres() { return isRealPostgres; }
};
