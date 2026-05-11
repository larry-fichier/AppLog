import { Router } from 'express';
import { query } from '../db.ts';
import { authenticateToken } from '../middleware/auth.ts';

const router = Router();

// ── GET /api/movements?equipment_id=xxx ─────────────────────────────────────
router.get('/', authenticateToken, async (req, res) => {
  const { equipment_id } = req.query;
  const sql = `
    SELECT
      m.*,
      e.name          AS equipment_name,
      u.display_name  AS performed_by_name,
      fz.name         AS from_zone_name,
      fs.name         AS from_station_name,
      tz.name         AS to_zone_name,
      ts2.name        AS to_station_name
    FROM movements m
    LEFT JOIN equipment e  ON e.id = m.equipment_id
    LEFT JOIN users    u   ON u.id = m.performed_by
    LEFT JOIN zones    fz  ON fz.id = m.from_zone_id
    LEFT JOIN stations fs  ON fs.id = m.from_station_id
    LEFT JOIN zones    tz  ON tz.id = m.to_zone_id
    LEFT JOIN stations ts2 ON ts2.id = m.to_station_id
    ${equipment_id ? 'WHERE m.equipment_id = $1' : ''}
    ORDER BY m.created_at DESC
    LIMIT 200
  `;
  const params = equipment_id ? [equipment_id] : [];
  try {
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (e: any) {
    console.error('[GET movements]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/movements ──────────────────────────────────────────────────────
router.post('/', authenticateToken, async (req, res) => {
  const userId = (req as any).user.id;
  const {
    equipment_id, type, note, reference,
    from_zone_id, from_station_id,
    to_zone_id,   to_station_id,
    new_status,
    date_deploiement,
    date_retour_prevue,
  } = req.body;

  const ALLOWED = ['entree', 'sortie', 'transfert', 'retour', 'ajustement', 'deploiement'];
  if (!ALLOWED.includes(type)) {
    return res.status(400).json({ error: `Type invalide. Valeurs: ${ALLOWED.join(', ')}` });
  }
  if (!equipment_id) {
    return res.status(400).json({ error: 'equipment_id obligatoire' });
  }

  try {
    // ── Lecture état actuel ──────────────────────────────────────────────
    const { rows: [eq] } = await query(
      'SELECT status, zone_id, station_id FROM equipment WHERE id=$1 AND deleted_at IS NULL',
      [equipment_id]
    );
    if (!eq) return res.status(404).json({ error: 'Équipement introuvable' });

    const sourceZoneId = from_zone_id || eq.zone_id;

    // ── Règle métier : transfert = même zone uniquement ──────────────────
    if (type === 'transfert') {
      if (!to_zone_id) {
        return res.status(400).json({ error: 'Zone de destination obligatoire pour un transfert.' });
      }
      if (to_zone_id !== sourceZoneId) {
        const { rows: zones } = await query(
          'SELECT id, name FROM zones WHERE id = ANY($1)',
          [[sourceZoneId, to_zone_id]]
        );
        const zoneMap = Object.fromEntries(zones.map((z: any) => [z.id, z.name]));
        return res.status(400).json({
          error: `Transfert refusé : les deux stations doivent être dans la même zone "${zoneMap[sourceZoneId] || 'inconnue'}". Pour changer de zone, utilisez "Retour" puis "Déploiement".`
        });
      }
      if (!to_station_id) {
        return res.status(400).json({ error: 'Station de destination obligatoire pour un transfert.' });
      }
    }

    if (type === 'retour' && !to_zone_id) {
      return res.status(400).json({ error: 'Zone de destination (labo) obligatoire pour un retour.' });
    }
    if (type === 'ajustement' && !new_status) {
      return res.status(400).json({ error: 'Nouveau statut obligatoire pour un ajustement.' });
    }
    if (type === 'deploiement' && !to_zone_id) {
      return res.status(400).json({ error: 'Zone de déploiement obligatoire.' });
    }

    // ── Mise à jour équipement ───────────────────────────────────────────
    const updates: Record<string, any> = {
      entree:      { zone_id: to_zone_id, station_id: to_station_id || null },
      sortie:      { zone_id: null, station_id: null, status: 'hors_service' },
      transfert:   { station_id: to_station_id },
      retour:      { zone_id: to_zone_id, station_id: to_station_id || null, status: 'en_reparation' },
      ajustement:  { status: new_status },
      deploiement: { zone_id: to_zone_id, station_id: to_station_id || null },
    };

    const upd = updates[type];
    const setCols = Object.keys(upd).map((k, i) => `${k}=$${i + 2}`).join(', ');
    await query(
      `UPDATE equipment SET ${setCols}, updated_at=NOW() WHERE id=$1`,
      [equipment_id, ...Object.values(upd)]
    );

    // ── Enregistrement mouvement ─────────────────────────────────────────
    const { rows: [mv] } = await query(
      `INSERT INTO movements
        (equipment_id, type, performed_by, note, reference,
         from_zone_id, from_station_id, to_zone_id, to_station_id,
         previous_status, new_status,
         date_deploiement, date_retour_prevue)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        equipment_id,
        type,
        userId,
        note            || null,
        reference       || null,
        sourceZoneId    || null,
        from_station_id || eq.station_id || null,
        to_zone_id      || null,
        to_station_id   || null,
        eq.status,
        new_status || upd.status || eq.status,
        date_deploiement   || null,
        date_retour_prevue || null,
      ]
    );

    res.status(201).json(mv);

  } catch (e: any) {
    console.error('[POST movements]', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;