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
      setupMemoryDB();
    }
  } else {
    setupMemoryDB();
  }
}

function setupMemoryDB() {
  console.log('[DB] Mode de secours : Base de données En-Mémoire activée.');
  const memDb = newDb();
  
  // Register engine functions
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
  
  // Extensions (uniquement PG réel)
  if (isRealPostgres) {
    try { await query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'); } catch (e) {}
  }

  // Schéma exact de l'utilisateur (UUID)
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username VARCHAR(128) UNIQUE,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT,
      display_name VARCHAR(255),
      role VARCHAR(50) DEFAULT 'agent_logistique',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code VARCHAR(50) UNIQUE NOT NULL,
      label VARCHAR(100) NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS zones (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(150) UNIQUE NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      zone_id UUID REFERENCES zones(id),
      name VARCHAR(150) NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(zone_id, name)
    );

    CREATE TABLE IF NOT EXISTS category_fields (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      category_id UUID REFERENCES categories(id),
      label VARCHAR(100) NOT NULL,
      type VARCHAR(50) DEFAULT 'text',
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS equipment (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(200) NOT NULL,
      category_id UUID REFERENCES categories(id),
      status VARCHAR(50) DEFAULT 'fonctionnel',
      zone_id UUID REFERENCES zones(id),
      station_id UUID REFERENCES stations(id),
      service_id UUID REFERENCES zones(id),
      bureau_id UUID REFERENCES stations(id),
      created_by UUID REFERENCES users(id),
      description TEXT,
      serial_number VARCHAR(100),
      purchase_date DATE,
      qr_code_data TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS equipment_details (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID REFERENCES equipment(id),
      field_key VARCHAR(100) NOT NULL,
      field_value TEXT
    );

    CREATE TABLE IF NOT EXISTS movements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID REFERENCES equipment(id),
      type VARCHAR(50) NOT NULL,
      performed_by UUID REFERENCES users(id),
      note TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('[DB] Schéma prêt.');
}

export { isRealPostgres };
