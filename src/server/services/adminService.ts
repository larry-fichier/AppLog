import { query, transact } from '../db.ts';
import bcrypt from 'bcryptjs';

export class AdminService {

  static async getFullConfig() {
    try {
      const [categories, zones, stations, fields] = await Promise.all([
        query("SELECT * FROM categories WHERE is_active = true ORDER BY label"),
        query("SELECT * FROM zones WHERE is_active = true ORDER BY name"),
        query("SELECT * FROM stations WHERE is_active = true ORDER BY name"),
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

    return transact(async (q) => {
      // ── Zones ─────────────────────────────────────────────
      // Désactive TOUTES les zones d'abord (évite les conflits de noms avec
      // l'index partiel UNIQUE sur name WHERE is_active = true).
      // La transaction garantit le rollback si une erreur survient.
      await q(`UPDATE zones SET is_active = false`);
      const zoneIds = zones.map((z: any) => z.id).filter(Boolean);
      for (const zone of zones) {
        if (!zone.id) continue;
        try {
          await q(`
            INSERT INTO zones (id, name, is_active)
            VALUES ($1, $2, true)
            ON CONFLICT (id) DO UPDATE SET name = $2, is_active = true
          `, [zone.id, zone.label || zone.name || "Sans Nom"]);
        } catch (e: any) {
          throw new Error(`Zone "${zone.label || zone.name}" : ${e.message}`);
        }
      }

      // ── Stations ──────────────────────────────────────────
      await q(`UPDATE stations SET is_active = false`);
      for (const station of stations) {
        if (!station.id) continue;
        const targetZoneId = station.zoneId || (zoneIds.length > 0 ? zoneIds[0] : null);
        if (!targetZoneId) continue;
        try {
          await q(`
            INSERT INTO stations (id, zone_id, name, is_active)
            VALUES ($1, $2, $3, true)
            ON CONFLICT (id) DO UPDATE SET name = $3, zone_id = $2, is_active = true
          `, [station.id, targetZoneId, station.label || station.name || "Sans Nom"]);
        } catch (e: any) {
          throw new Error(`Station "${station.label || station.name}" : ${e.message}`);
        }
      }

      // ── Catégories ────────────────────────────────────────
      const catIds = categories.map((c: any) => c.id).filter(Boolean);
      if (catIds.length > 0) {
        await q(
          `UPDATE categories SET is_active = false WHERE NOT (id = ANY($1::uuid[]))`,
          [catIds]
        );
      }
      for (const cat of categories) {
        if (!cat.id) continue;
        const label = cat.label || cat.name || "Sans Nom";
        const code  = cat.code
          || label.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
          || cat.id.substring(0, 8);
        try {
          await q(`
            INSERT INTO categories (id, code, label, is_active)
            VALUES ($1, $2, $3, true)
            ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, is_active = true
          `, [cat.id, code, label]);
        } catch (e: any) {
          if (e.code === '23505') {
            await q(`
              INSERT INTO categories (id, code, label, is_active)
              VALUES ($1, $2, $3, true)
              ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, is_active = true
            `, [cat.id, cat.id.substring(0, 8), label]);
          } else {
            throw e;
          }
        }
      }

      return { success: true };
    });
  }

  static async getUsers() {
    const { rows } = await query(`
      SELECT u.id, u.username, u.display_name, u.role, u.zone_id, z.name AS zone_name, u.created_at
      FROM users u
      LEFT JOIN zones z ON z.id = u.zone_id
      WHERE u.deleted_at IS NULL
      ORDER BY u.created_at DESC
    `);
    return rows;
  }

  // ── Créer un utilisateur (username = identifiant principal, email optionnel) ─
  static async createUser(data: {
    username: string;
    password: string;
    displayName?: string;
    role?: string;
    zoneId?: string;
  }) {
    const { username, password, displayName, role, zoneId } = data;

    if (!username || !password) {
      throw new Error("Nom d'utilisateur et mot de passe sont obligatoires");
    }

    // Vérification unicité username (insensible à la casse, cohérent avec
    // l'index unique users_active_username_unique côté base)
    const existing = await query(
      "SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND deleted_at IS NULL",
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
      INSERT INTO users (username, password_hash, display_name, role, zone_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, username, display_name, role, zone_id, created_at
    `, [username, passwordHash, finalDisplayName, finalRole, zoneId || null]);

    return rows[0];
  }

  // zoneId : undefined = ne pas toucher à la zone actuelle, null = la retirer, string = l'assigner
  static async updateUserRole(id: string, role: string, zoneId?: string | null) {
    if (!id || !role) throw new Error("ID et rôle sont obligatoires");

    const setClauses = ['role = $1', 'updated_at = CURRENT_TIMESTAMP'];
    const params: any[] = [role];
    if (zoneId !== undefined) {
      params.push(zoneId || null);
      setClauses.push(`zone_id = $${params.length}`);
    }
    params.push(id);

    const { rows } = await query(`
      UPDATE users
      SET ${setClauses.join(', ')}
      WHERE id = $${params.length} AND deleted_at IS NULL
      RETURNING id, username, role, zone_id
    `, params);

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

  static async resetPassword(id: string, newPassword: string, mustChangePassword: boolean = false) {
    if (!id || !newPassword) throw new Error("ID et nouveau mot de passe sont obligatoires");

    const passwordHash = await bcrypt.hash(newPassword, 10);

    const { rows } = await query(`
      UPDATE users
      SET password_hash = $1, must_change_password = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND deleted_at IS NULL
      RETURNING id, username
    `, [passwordHash, mustChangePassword, id]);

    if (rows.length === 0) throw new Error("Utilisateur non trouvé");
    return rows[0];
  }
}