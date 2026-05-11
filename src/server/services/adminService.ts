import { query } from '../db.ts';
import bcrypt from 'bcryptjs';

export class AdminService {

  static async getFullConfig() {
    try {
      const [categories, zones, stations, fields] = await Promise.all([
        query("SELECT * FROM categories ORDER BY label"),
        query("SELECT * FROM zones ORDER BY name"),
        query("SELECT * FROM stations ORDER BY name"),
        query("SELECT * FROM category_fields ORDER BY sort_order"),
      ]);
      return {
        categories: categories.rows ?? [],
        zones:      zones.rows      ?? [],
        stations:   stations.rows   ?? [],
        fields:     fields.rows     ?? [],
      };
    } catch (err) {
      console.warn("[AdminService] Tables manquantes, retour des listes vides.");
      return { categories: [], zones: [], stations: [], fields: [] };
    }
  }

  static async saveConfig(data: { categories: any[]; zones: any[]; stations: any[] }) {
    const { categories, zones, stations } = data;

    // ── Zones ─────────────────────────────────────────────
    const zoneIds = zones.map((z: any) => z.id).filter(Boolean);
    if (zoneIds.length > 0) {
      await query("UPDATE zones SET is_active = false WHERE id != ANY($1)", [zoneIds]);
    }
    for (const zone of zones) {
      if (!zone.id) continue;
      await query(`
        INSERT INTO zones (id, name, is_active)
        VALUES ($1, $2, true)
        ON CONFLICT (id) DO UPDATE SET name = $2, is_active = true
      `, [zone.id, zone.label || zone.name || "Sans Nom"]);
    }

    // ── Stations ──────────────────────────────────────────
    const stationIds = stations.map((s: any) => s.id).filter(Boolean);
    if (stationIds.length > 0) {
      await query("UPDATE stations SET is_active = false WHERE id != ANY($1)", [stationIds]);
    }
    for (const station of stations) {
      if (!station.id) continue;
      const targetZoneId = station.zoneId || (zoneIds.length > 0 ? zoneIds[0] : null);
      if (!targetZoneId) continue;
      await query(`
        INSERT INTO stations (id, zone_id, name, is_active)
        VALUES ($1, $2, $3, true)
        ON CONFLICT (id) DO UPDATE SET name = $3, zone_id = $2, is_active = true
      `, [station.id, targetZoneId, station.label || station.name || "Sans Nom"]);
    }

    // ── Catégories ────────────────────────────────────────
    const catIds = categories.map((c: any) => c.id).filter(Boolean);
    if (catIds.length > 0) {
      await query("UPDATE categories SET is_active = false WHERE id != ANY($1)", [catIds]);
    }
    for (const cat of categories) {
      if (!cat.id) continue;
      const code = cat.code
        || cat.label?.toLowerCase().replace(/\s+/g, '_')
        || cat.id.substring(0, 8);
      await query(`
        INSERT INTO categories (id, code, label, is_active)
        VALUES ($1, $2, $3, true)
        ON CONFLICT (id) DO UPDATE SET label = $3, code = EXCLUDED.code, is_active = true
      `, [cat.id, code, cat.label || cat.name || "Sans Nom"]);
    }

    return { success: true };
  }

  static async getUsers() {
    const { rows } = await query(`
      SELECT id, username, display_name, role, created_at
      FROM users
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
    `);
    return rows;
  }

  // ── Créer un utilisateur (username = identifiant principal, email optionnel) ─
  static async createUser(data: {
    username: string;
    password: string;
    displayName?: string;
    role?: string;
  }) {
    const { username, password, displayName, role } = data;

    if (!username || !password) {
      throw new Error("Nom d'utilisateur et mot de passe sont obligatoires");
    }

    // Vérification unicité username
    const existing = await query(
      "SELECT id FROM users WHERE username = $1 AND deleted_at IS NULL",
      [username]
    );
    if (existing.rows.length > 0) {
      throw new Error(`Le nom d'utilisateur "${username}" est déjà pris`);
    }

    const passwordHash     = await bcrypt.hash(password, 10);
    const finalRole        = role        || 'agent_logistique';
    const finalDisplayName = displayName || username;

    // email laissé NULL — la colonne est désormais nullable
    const { rows } = await query(`
      INSERT INTO users (username, password_hash, display_name, role)
      VALUES ($1, $2, $3, $4)
      RETURNING id, username, display_name, role, created_at
    `, [username, passwordHash, finalDisplayName, finalRole]);

    return rows[0];
  }

  static async updateUserRole(id: string, role: string) {
    if (!id || !role) throw new Error("ID et rôle sont obligatoires");

    const { rows } = await query(`
      UPDATE users
      SET role = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND deleted_at IS NULL
      RETURNING id, username, role
    `, [role, id]);

    if (rows.length === 0) throw new Error("Utilisateur non trouvé");
    return rows[0];
  }

  static async deleteUser(id: string) {
    if (!id) throw new Error("ID obligatoire");

    const { rows } = await query(`
      UPDATE users
      SET deleted_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id
    `, [id]);

    if (rows.length === 0) throw new Error("Utilisateur non trouvé ou déjà supprimé");
    return { success: true };
  }

  static async resetPassword(id: string, newPassword: string) {
    if (!id || !newPassword) throw new Error("ID et nouveau mot de passe sont obligatoires");

    const passwordHash = await bcrypt.hash(newPassword, 10);

    const { rows } = await query(`
      UPDATE users
      SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND deleted_at IS NULL
      RETURNING id, username
    `, [passwordHash, id]);

    if (rows.length === 0) throw new Error("Utilisateur non trouvé");
    return rows[0];
  }
}