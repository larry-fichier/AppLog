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

export async function transact<T>(fn: (q: (text: string, params?: any[]) => Promise<any>) => Promise<T>): Promise<T> {
  if (!pool) await connectDB();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn((text, params) => client.query(text, params));
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
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
    )`,
    // ── Journal global d'audit : trace TOUTES les actions du système ──
    // (connexions, gestion des utilisateurs, config, équipements, mouvements…)
    // Visible uniquement par les rôles admin / chef_service_administratif / csph.
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      action     VARCHAR(60) NOT NULL,
      user_id    UUID REFERENCES users(id),
      user_name  VARCHAR(255),
      role       VARCHAR(50),
      details    JSONB,
      ip         VARCHAR(64),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    // ── Déclarations de stock COM Zone : appliquées directement si la quantité
    //    déclarée correspond à l'existant, sinon en attente d'approbation
    //    (chef_bureau OU chef_service_administratif) avant d'affecter equipment_details.
    `CREATE TABLE IF NOT EXISTS stock_declarations (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id       UUID NOT NULL REFERENCES equipment(id),
      zone_id            UUID REFERENCES zones(id),
      declared_by        UUID NOT NULL REFERENCES users(id),
      declared_by_name   VARCHAR(255),
      previous_quantity  INTEGER NOT NULL,
      declared_quantity  INTEGER NOT NULL,
      unite              VARCHAR(50),
      status             VARCHAR(20) NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','approved','rejected')),
      decided_by         UUID REFERENCES users(id),
      decided_by_name    VARCHAR(255),
      decision_note      TEXT,
      decided_at         TIMESTAMP,
      note               TEXT,
      created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    // ── Demandes de ravitaillement : ouvertes quand le stock d'une zone
    //    atteint seuil_alerte, closes quand le comzone confirme réception.
    `CREATE TABLE IF NOT EXISTS resupply_requests (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id        UUID NOT NULL REFERENCES equipment(id),
      zone_id             UUID REFERENCES zones(id),
      triggered_by        UUID REFERENCES users(id),
      quantity_at_trigger INTEGER NOT NULL,
      seuil_alerte        INTEGER NOT NULL,
      unite               VARCHAR(50),
      status              VARCHAR(20) NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','fulfilled','confirmed')),
      fulfilled_by        UUID REFERENCES users(id),
      fulfilled_by_name   VARCHAR(255),
      fulfilled_at        TIMESTAMP,
      fulfilled_quantity  INTEGER,
      fulfillment_note    TEXT,
      confirmed_by        UUID REFERENCES users(id),
      confirmed_by_name   VARCHAR(255),
      confirmed_at        TIMESTAMP,
      confirmed_quantity  INTEGER,
      created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  for (const sql of tables) {
    await query(sql);
  }

  try {
    await query(`CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs (action)`);
    await query(`CREATE INDEX IF NOT EXISTS stock_declarations_status_idx ON stock_declarations (status, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS resupply_requests_status_idx ON resupply_requests (status, zone_id)`);
  } catch (e) {}

  // ── Migration : ajouter performed_by_name si absente (bases existantes) ──
  if (isRealPostgres) {
    try {
      await query(`ALTER TABLE movements ADD COLUMN IF NOT EXISTS performed_by_name VARCHAR(255)`);
      console.log('[DB] Migration: colonne performed_by_name ajoutée à movements.');
    } catch (e) {}

    // ── Migration : approbation des mouvements COM Zone (transferts) ──
    // Par défaut 'approved' pour que les mouvements existants et ceux des autres
    // rôles restent effectifs immédiatement — seuls les transferts créés par
    // com_zone partent en 'pending'.
    try {
      await query(`ALTER TABLE movements ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'approved'`);
      await query(`ALTER TABLE movements ADD COLUMN IF NOT EXISTS decided_by UUID REFERENCES users(id)`);
      await query(`ALTER TABLE movements ADD COLUMN IF NOT EXISTS decided_by_name VARCHAR(255)`);
      await query(`ALTER TABLE movements ADD COLUMN IF NOT EXISTS decision_note TEXT`);
      await query(`ALTER TABLE movements ADD COLUMN IF NOT EXISTS decided_at TIMESTAMP`);
      console.log('[DB] Migration: colonnes status/decided_* ajoutées à movements.');
    } catch (e) {}

    // ── Migration : rattacher un utilisateur COM ZONE à sa zone ──
    try {
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS zone_id UUID REFERENCES zones(id)`);
      console.log('[DB] Migration: colonne zone_id ajoutée à users.');
    } catch (e) {}

    // ── Migration : nouveaux rôles Module 2 (chef_bureau, chef_ram, com_zone).
    //    users.role est un enum Postgres (user_role) sur cette base — sans effet
    //    si la colonne est un simple VARCHAR (le type n'existe alors pas).
    for (const roleValue of ['chef_bureau', 'chef_ram', 'com_zone']) {
      try {
        await query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS '${roleValue}'`);
        console.log(`[DB] Migration: valeur '${roleValue}' ajoutée à l'enum user_role.`);
      } catch (e) {}
    }

    // ── Migration : matériel déclassé / véhicule réformé.
    //    equipment.status est lui aussi un enum Postgres (equipment_status),
    //    même remarque que ci-dessus pour user_role.
    for (const statusValue of ['declasse', 'reforme']) {
      try {
        await query(`ALTER TYPE equipment_status ADD VALUE IF NOT EXISTS '${statusValue}'`);
        console.log(`[DB] Migration: valeur '${statusValue}' ajoutée à l'enum equipment_status.`);
      } catch (e) {}
    }

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

    // ── Migration : empêcher les doublons de nom d'utilisateur parmi les
    //    comptes actifs (aucune contrainte n'existait avant — deux comptes
    //    pouvaient partager le même username, l'un des deux étant alors
    //    inaccessible ou ambigu à la connexion). Les comptes désactivés
    //    (deleted_at renseigné) peuvent réutiliser un username, comme pour
    //    zones/stations ci-dessus.
    try {
      await query(`
        CREATE UNIQUE INDEX IF NOT EXISTS users_active_username_unique
        ON users (LOWER(username))
        WHERE deleted_at IS NULL
      `);
      console.log('[DB] Migration: index unique users.username (comptes actifs) créé.');
    } catch (e) {}

    // ── Migration : empêcher les doublons de libellé de catégorie parmi les
    //    catégories actives (seul le code était unique — deux catégories avec
    //    des codes différents mais le même libellé pouvaient coexister, comme
    //    ça a été le cas pour "Matériel d'exploitation").
    try {
      await query(`
        CREATE UNIQUE INDEX IF NOT EXISTS categories_active_label_unique
        ON categories (LOWER(label))
        WHERE is_active = true
      `);
      console.log('[DB] Migration: index unique categories.label (catégories actives) créé.');
    } catch (e) {}

    // ── Migration : les articles catalogue "Matériel d'exploitation" étaient
    //    repérés par zone_id NULL. Ils sont maintenant rattachés à une vraie
    //    zone (SERVICE_ADMINISTRATIF / station MAGASIN), comme tout le reste
    //    du parc — cohérent avec le fait que tout équipement neuf est d'abord
    //    acquis par la logistique avant déploiement en zone.
    try {
      const { rows: [svcZone] } = await query(`SELECT id FROM zones WHERE name = 'SERVICE_ADMINISTRATIF' LIMIT 1`);
      if (svcZone) {
        const { rows: [magasin] } = await query(
          `SELECT id FROM stations WHERE zone_id = $1 AND name = 'MAGASIN' LIMIT 1`, [svcZone.id]
        );
        const { rowCount } = await query(
          `UPDATE equipment e SET zone_id = $1, station_id = $2
           FROM categories c
           WHERE e.category_id = c.id AND c.label ILIKE '%exploitation%' AND e.zone_id IS NULL AND e.deleted_at IS NULL`,
          [svcZone.id, magasin?.id || null]
        );
        if (rowCount && rowCount > 0) {
          console.log(`[DB] Migration: ${rowCount} article(s) catalogue Matériel d'exploitation rattaché(s) à SERVICE_ADMINISTRATIF/MAGASIN.`);
        }
      }
    } catch (e) {}

    // ── Récupération : réactiver les stations inactives dont la zone est active.
    //    Signe d'un save interrompu (sans transaction) : zones OK, stations partiellement désactivées.
    try {
      const { rowCount } = await query(`
        UPDATE stations SET is_active = true
        WHERE is_active = false
          AND zone_id IN (SELECT id FROM zones WHERE is_active = true)
      `);
      if (rowCount && rowCount > 0) {
        console.log(`[DB] Récupération : ${rowCount} station(s) réactivée(s) suite à un save interrompu.`);
      }
    } catch (e) {}

    // ── Même récupération pour les zones (toutes inactives = save interrompu total) ──
    try {
      const { rows: [{ total, active }] } = await query(`
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE is_active = true) AS active
        FROM zones
      `);
      if (parseInt(total) > 0 && parseInt(active) === 0) {
        await query(`UPDATE zones SET is_active = true`);
        console.log('[DB] Récupération : toutes les zones ont été réactivées (save interrompu détecté).');
      }
    } catch (e) {}
  }

  console.log('[DB] Schéma prêt.');
}

export { isRealPostgres };