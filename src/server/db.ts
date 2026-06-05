import pkg from 'pg';
const { Pool } = pkg;
import { newDb } from 'pg-mem';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

let pool: any;
let isRealPostgres = false;

export async function connectDB() {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString) {
    try {
      pool = new Pool({
        connectionString,
        ssl: connectionString.includes('supabase') || connectionString.includes('render') || connectionString.includes('google')
             ? { rejectUnauthorized: false }
             : false
      });
      await pool.query('SELECT 1');
      isRealPostgres = true;
      console.log('[DB] Connecté à PostgreSQL Réel.');
    } catch (err) {
      console.error('[DB] Échec de connexion PostgreSQL:', (err as Error).message);
      throw err;
    }
  } else {
    throw new Error('[DB] DATABASE_URL manquant');
  }
}

function setupMemoryDB() {
  console.log('[DB] Mode de secours : Base de données En-Mémoire activée.');
  const memDb = newDb();
  
  memDb.public.registerFunction({
    name: 'gen_random_uuid',
    returns: (memDb as any).getType('uuid'),
    implementation: () => crypto.randomUUID(),
  });

  const pgAdapter = memDb.adapters.createPg();
  pool = new pgAdapter.Pool();
  isRealPostgres = false;
}

export async function query(text: string, params?: any[]) {
  if (!pool) await connectDB();
  return pool.query(text, params);
}

export async function initSchema() {
  console.log('[DB] Initialisation du schéma...');
  
  if (isRealPostgres) {
    try { await query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'); } catch (e) {}

    // ── Migration : rendre email nullable si ce n'est pas encore fait ────────
    try {
      await query(`ALTER TABLE users ALTER COLUMN email DROP NOT NULL`);
      console.log('[DB] Migration: colonne email rendue nullable.');
    } catch (e) {
      // Colonne déjà nullable ou table inexistante — on ignore
    }
  }

  const tables = [
    // email est maintenant NULL par défaut (identifiant = username)
    `CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username VARCHAR(128) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE,
      password_hash TEXT,
      display_name VARCHAR(255),
      role VARCHAR(50) DEFAULT 'agent_logistique',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code VARCHAR(50) UNIQUE NOT NULL,
      label VARCHAR(100) NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS zones (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(150) UNIQUE NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS stations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      zone_id UUID REFERENCES zones(id),
      name VARCHAR(150) NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(zone_id, name)
    )`,
    `CREATE TABLE IF NOT EXISTS category_fields (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      category_id UUID REFERENCES categories(id),
      label VARCHAR(100) NOT NULL,
      type VARCHAR(50) DEFAULT 'text',
      sort_order INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS equipment (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(200) NOT NULL,
      category_id UUID NOT NULL REFERENCES categories(id),
      status VARCHAR(50) DEFAULT 'fonctionnel' NOT NULL,
      zone_id UUID REFERENCES zones(id),
      station_id UUID REFERENCES stations(id),
      service_id UUID REFERENCES zones(id),
      bureau_id UUID REFERENCES stations(id),
      created_by UUID NOT NULL REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS equipment_details (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID REFERENCES equipment(id),
      field_key VARCHAR(100) NOT NULL,
      field_value TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS movements (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID NOT NULL REFERENCES equipment(id),
      type         VARCHAR(50) NOT NULL
                   CHECK (type IN ('entree','sortie','transfert','retour','ajustement','deploiement')),
      performed_by      UUID NOT NULL REFERENCES users(id),
      performed_by_name VARCHAR(255),
      from_zone_id    UUID REFERENCES zones(id),
      from_station_id UUID REFERENCES stations(id),
      to_zone_id    UUID REFERENCES zones(id),
      to_station_id UUID REFERENCES stations(id),
      previous_status VARCHAR(50),
      new_status      VARCHAR(50),
      date_deploiement    DATE,
      date_retour_prevue  DATE,
      note       TEXT,
      reference  VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  for (const sql of tables) {
    await query(sql);
  }

  // ── Migration : ajouter performed_by_name si absente (bases existantes) ──
  if (isRealPostgres) {
    try {
      await query(`ALTER TABLE movements ADD COLUMN IF NOT EXISTS performed_by_name VARCHAR(255)`);
      console.log('[DB] Migration: colonne performed_by_name ajoutée à movements.');
    } catch (e) {}

    // ── Migration : remplacer UNIQUE(name) sur zones par un index partiel
    //    (seules les zones actives doivent avoir un nom unique,
    //     les zones soft-deletées peuvent réutiliser un nom existant)
    try {
      // Supprimer l'ancienne contrainte UNIQUE absolue si elle existe
      await query(`
        ALTER TABLE zones DROP CONSTRAINT IF EXISTS zones_name_key
      `);
      // Créer un index unique partiel sur les zones actives uniquement
      await query(`
        CREATE UNIQUE INDEX IF NOT EXISTS zones_active_name_unique
        ON zones (name)
        WHERE is_active = true
      `);
      console.log('[DB] Migration: contrainte UNIQUE zones.name remplacée par index partiel.');
    } catch (e) {
      // Déjà fait ou non applicable — ignoré
    }

    // ── Migration : même chose pour stations (name unique par zone active) ──
    try {
      await query(`ALTER TABLE stations DROP CONSTRAINT IF EXISTS stations_zone_id_name_key`);
      await query(`
        CREATE UNIQUE INDEX IF NOT EXISTS stations_active_zone_name_unique
        ON stations (zone_id, name)
        WHERE is_active = true
      `);
      console.log('[DB] Migration: contrainte UNIQUE stations (zone_id, name) remplacée par index partiel.');
    } catch (e) {}
  }

  console.log('[DB] Schéma prêt.');
}

export { isRealPostgres };