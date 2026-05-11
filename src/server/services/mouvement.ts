import { query } from "../db";

export async function createMovement({
  equipment_id,
  type,
  userId,
  note,
  reference,
  from_zone_id,
  from_station_id,
  to_zone_id,
  to_station_id,
  eq,
  new_status,
  upd,
  date_deploiement,
  date_retour_prevue,
}: {
  equipment_id: string;
  type: string;
  userId: string;
  note?: string;
  reference?: string;
  from_zone_id?: string;
  from_station_id?: string;
  to_zone_id?: string;
  to_station_id?: string;
  eq: { zone_id: string; station_id: string; status: string };
  new_status?: string;
  upd?: { status: string };
  date_deploiement?: string;
  date_retour_prevue?: string;
}) {
  const { rows: [mv] } = await query(
    `INSERT INTO movements
      (equipment_id, type, performed_by, note, reference,
       from_zone_id, from_station_id, to_zone_id, to_station_id,
       previous_status, new_status,
       date_deploiement, date_retour_prevue)        -- ✅ ajout
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      equipment_id, type, userId, note || null, reference || null,
      from_zone_id || eq.zone_id || null,
      from_station_id || eq.station_id || null,
      to_zone_id    || null,
      to_station_id || null,
      eq.status,
      new_status || upd?.status || eq.status,
      date_deploiement   || null,                   // ✅
      date_retour_prevue || null,                   // ✅
    ]
  );

  return mv;
}