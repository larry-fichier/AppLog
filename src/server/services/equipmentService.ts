import { query } from '../db.ts';

export class EquipmentService {
  /**
   * Liste tous les équipements actifs avec leurs détails de localisation
   */
  static async getAllEquipment() {
    const result = await query(`
      SELECT e.*, c.code as category_code, c.label as category_label, 
             z.name as zone_name, s.name as station_name
      FROM equipment e
      LEFT JOIN categories c ON e.category_id = c.id
      LEFT JOIN zones z ON e.zone_id = z.id
      LEFT JOIN stations s ON e.station_id = s.id
      WHERE e.deleted_at IS NULL
      ORDER BY e.created_at DESC
    `);
    return result.rows;
  }

  /**
   * Récupère les détails spécifiques d'un ensemble d'équipements
   */
  static async getEquipmentDetails(equipmentIds: string[]) {
    if (equipmentIds.length === 0) return [];
    const result = await query(
      "SELECT * FROM equipment_details WHERE equipment_id = ANY($1)",
      [equipmentIds]
    );
    return result.rows;
  }

  /**
   * Crée un nouvel équipement et ses détails
   */
  static async createEquipment(data: {
    name: string;
    category_id: string;
    status: string;
    zone_id: string;
    station_id: string;
    created_by: string;
    details?: Record<string, any>;
  }) {
    const { name, category_id, status, zone_id, station_id, created_by, details } = data;
    
    // On peuple à la fois zone/station et service/bureau pour la compatibilité schéma
    const equipRes = await query(`
      INSERT INTO equipment (name, category_id, status, zone_id, station_id, service_id, bureau_id, created_by)
      VALUES ($1, $2, $3, $4, $5, $4, $5, $6)
      RETURNING id
    `, [name, category_id, status, zone_id, station_id, created_by]);
    
    const equipmentId = equipRes.rows[0].id;

    if (details) {
      for (const [key, val] of Object.entries(details)) {
        await query(`
          INSERT INTO equipment_details (equipment_id, field_key, field_value)
          VALUES ($1, $2, $3)
        `, [equipmentId, key, String(val)]);
      }
    }

    return equipmentId;
  }
}
