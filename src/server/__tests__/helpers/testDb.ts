import { newDb } from 'pg-mem';
import crypto from 'crypto';

export async function createTestQuery() {
  const memDb = newDb();

  // Fonctions PostgreSQL non implémentées nativement dans pg-mem
  const fns: Array<{ name: string; impl: (...a: any[]) => any; impure?: boolean }> = [
    { name: 'gen_random_uuid', impl: () => crypto.randomUUID(), impure: true },
    { name: 'trim',            impl: (s: string) => s?.trim() ?? '' },
    { name: 'btrim',           impl: (s: string) => s?.trim() ?? '' },
    { name: 'upper',           impl: (s: string) => s?.toUpperCase() ?? '' },
  ];
  for (const { name, impl, impure } of fns) {
    try {
      memDb.public.registerFunction({ name, implementation: impl, impure });
    } catch { /* déjà enregistrée */ }
  }

  const pgAdapter = memDb.adapters.createPg();
  const pool = new (pgAdapter as any).Pool();

  const query = (text: string, params?: any[]) => pool.query(text, params);

  // Schéma sans DEFAULT gen_random_uuid() — UUIDs fournis à l'INSERT
  const tables = [
    `CREATE TABLE IF NOT EXISTS zones (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(150) UNIQUE NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username VARCHAR(128) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE,
      password_hash TEXT,
      display_name VARCHAR(255),
      role VARCHAR(50) DEFAULT 'agent_logistique',
      zone_id UUID REFERENCES zones(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      deleted_at TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code VARCHAR(50) UNIQUE NOT NULL,
      label VARCHAR(100) NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS stations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      zone_id UUID REFERENCES zones(id),
      name VARCHAR(150) NOT NULL,
      is_active BOOLEAN DEFAULT true,
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
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      deleted_at TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS equipment_details (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID REFERENCES equipment(id),
      field_key VARCHAR(100) NOT NULL,
      field_value TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS movements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID NOT NULL REFERENCES equipment(id),
      type VARCHAR(50) NOT NULL,
      performed_by UUID NOT NULL REFERENCES users(id),
      performed_by_name VARCHAR(255),
      from_zone_id UUID REFERENCES zones(id),
      from_station_id UUID REFERENCES stations(id),
      to_zone_id UUID REFERENCES zones(id),
      to_station_id UUID REFERENCES stations(id),
      previous_status VARCHAR(50),
      new_status VARCHAR(50),
      date_deploiement DATE,
      date_retour_prevue DATE,
      note TEXT,
      reference VARCHAR(100),
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS stock_declarations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID NOT NULL REFERENCES equipment(id),
      zone_id UUID REFERENCES zones(id),
      declared_by UUID NOT NULL REFERENCES users(id),
      declared_by_name VARCHAR(255),
      previous_quantity INTEGER NOT NULL,
      declared_quantity INTEGER NOT NULL,
      unite VARCHAR(50),
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      decided_by UUID REFERENCES users(id),
      decided_by_name VARCHAR(255),
      decision_note TEXT,
      decided_at TIMESTAMP,
      note TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS resupply_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      equipment_id UUID NOT NULL REFERENCES equipment(id),
      zone_id UUID REFERENCES zones(id),
      triggered_by UUID REFERENCES users(id),
      quantity_at_trigger INTEGER NOT NULL,
      seuil_alerte INTEGER NOT NULL,
      unite VARCHAR(50),
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      fulfilled_by UUID REFERENCES users(id),
      fulfilled_by_name VARCHAR(255),
      fulfilled_at TIMESTAMP,
      fulfilled_quantity INTEGER,
      fulfillment_note TEXT,
      confirmed_by UUID REFERENCES users(id),
      confirmed_by_name VARCHAR(255),
      confirmed_at TIMESTAMP,
      confirmed_quantity INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
  ];

  for (const sql of tables) {
    await query(sql);
  }

  return query;
}

export async function seedTestData(query: Function) {
  const bcrypt = await import('bcryptjs');

  const adminId       = crypto.randomUUID();
  const agentId       = crypto.randomUUID();
  const categoryId    = crypto.randomUUID();
  const zoneId        = crypto.randomUUID();
  const zoneBId       = crypto.randomUUID();
  const comZoneId     = crypto.randomUUID();
  const comZoneBId    = crypto.randomUUID();
  const chefBureauId  = crypto.randomUUID();
  const csaId         = crypto.randomUUID();
  const chefRamId     = crypto.randomUUID();
  const stockCategoryId = crypto.randomUUID();
  const stockEquipmentId = crypto.randomUUID();

  await query(
    `INSERT INTO users (id, username, email, password_hash, display_name, role)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [adminId, 'admin', 'admin@test.com', await bcrypt.hash('AdminTest@2025', 10), 'Super Admin', 'admin']
  );

  await query(
    `INSERT INTO users (id, username, password_hash, display_name, role)
     VALUES ($1, $2, $3, $4, $5)`,
    [agentId, 'agent1', await bcrypt.hash('Agent@2025', 10), 'Agent Test', 'agent_logistique']
  );

  await query(
    `INSERT INTO categories (id, code, label) VALUES ($1, $2, $3)`,
    [categoryId, 'informatique', 'Informatique']
  );

  await query(
    `INSERT INTO zones (id, name) VALUES ($1, $2)`,
    [zoneId, 'Zone Nord']
  );

  await query(
    `INSERT INTO zones (id, name) VALUES ($1, $2)`,
    [zoneBId, 'Zone Sud']
  );

  await query(
    `INSERT INTO users (id, username, password_hash, display_name, role, zone_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [comZoneId, 'comzone1', await bcrypt.hash('ComZone@2025', 10), 'Com Zone Nord', 'com_zone', zoneId]
  );

  await query(
    `INSERT INTO users (id, username, password_hash, display_name, role, zone_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [comZoneBId, 'comzone2', await bcrypt.hash('ComZone@2025', 10), 'Com Zone Sud', 'com_zone', zoneBId]
  );

  await query(
    `INSERT INTO users (id, username, password_hash, display_name, role)
     VALUES ($1, $2, $3, $4, $5)`,
    [chefBureauId, 'chefbureau1', await bcrypt.hash('ChefBureau@2025', 10), 'Chef Bureau Test', 'chef_bureau']
  );

  await query(
    `INSERT INTO users (id, username, password_hash, display_name, role)
     VALUES ($1, $2, $3, $4, $5)`,
    [csaId, 'csa1', await bcrypt.hash('Csa@2025', 10), 'CSA Test', 'chef_service_administratif']
  );

  await query(
    `INSERT INTO users (id, username, password_hash, display_name, role)
     VALUES ($1, $2, $3, $4, $5)`,
    [chefRamId, 'chefram1', await bcrypt.hash('ChefRam@2025', 10), 'Chef RAM Test', 'chef_ram']
  );

  await query(
    `INSERT INTO categories (id, code, label) VALUES ($1, $2, $3)`,
    [stockCategoryId, 'materiel_exploitation', "Matériel d'exploitation"]
  );

  await query(
    `INSERT INTO equipment (id, name, category_id, zone_id, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [stockEquipmentId, 'Stock Plot Nord', stockCategoryId, zoneId, adminId]
  );

  await query(
    `INSERT INTO equipment_details (equipment_id, field_key, field_value) VALUES ($1, 'quantite_stock', $2)`,
    [stockEquipmentId, '20']
  );
  await query(
    `INSERT INTO equipment_details (equipment_id, field_key, field_value) VALUES ($1, 'seuil_alerte', $2)`,
    [stockEquipmentId, '5']
  );
  await query(
    `INSERT INTO equipment_details (equipment_id, field_key, field_value) VALUES ($1, 'unite', $2)`,
    [stockEquipmentId, 'unité(s)']
  );

  return {
    adminId, agentId, categoryId, zoneId,
    zoneBId, comZoneId, comZoneBId, chefBureauId, csaId, chefRamId,
    stockCategoryId, stockEquipmentId,
  };
}
