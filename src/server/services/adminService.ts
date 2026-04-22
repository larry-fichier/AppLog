import { query } from '../db.ts';

export class AdminService {
  static async getFullConfig() {
    const categories = await query("SELECT * FROM categories ORDER BY label");
    const zones = await query("SELECT * FROM zones ORDER BY name");
    const stations = await query("SELECT * FROM stations ORDER BY name");
    const fields = await query("SELECT * FROM category_fields ORDER BY sort_order");
    
    return {
      categories: categories.rows,
      zones: zones.rows,
      stations: stations.rows,
      fields: fields.rows
    };
  }

  static async saveConfig(data: { categories: any[], zones: any[], stations: any[] }) {
    const { categories, zones, stations } = data;

    // Sync zones
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
    
    // Sync stations
    const stationIds = stations.map((s: any) => s.id).filter(Boolean);
    if (stationIds.length > 0) {
      await query("UPDATE stations SET is_active = false WHERE id != ANY($1)", [stationIds]);
    }
    for (const station of stations) {
      if (!station.id) continue;
      const targetZoneId = station.zoneId || (zoneIds.length > 0 ? zoneIds[0] : null);
      if (targetZoneId) {
        await query(`
          INSERT INTO stations (id, zone_id, name, is_active) 
          VALUES ($1, $2, $3, true) 
          ON CONFLICT (id) DO UPDATE SET name = $3, zone_id = $2, is_active = true
        `, [station.id, targetZoneId, station.label || station.name || "Sans Nom"]);
      }
    }

    // Sync categories
    const catIds = categories.map((c: any) => c.id).filter(Boolean);
    if (catIds.length > 0) {
      await query("UPDATE categories SET is_active = false WHERE id != ANY($1)", [catIds]);
    }
    for (const cat of categories) {
      if (!cat.id) continue;
      const code = cat.code || cat.label?.toLowerCase().replace(/\s+/g, '_') || cat.id.substring(0, 8);
      await query(`
        INSERT INTO categories (id, code, label, is_active) 
        VALUES ($1, $2, $3, true) 
        ON CONFLICT (id) DO UPDATE SET label = $3, is_active = true, code = EXCLUDED.code
      `, [cat.id, code, cat.label || cat.name || "Sans Nom"]);
    }

    return { success: true };
  }

  static async getUsers() {
    const result = await query("SELECT id, username, email, display_name, role, created_at FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC");
    return result.rows;
  }
}
