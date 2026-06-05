import { z } from 'zod';

// ✅ Validation pour création d'équipement
export const createEquipmentSchema = z.object({
  name:        z.string().max(200).optional(),
  category:    z.string().max(100).optional(),
  category_id: z.string().optional(),
  zone:        z.string().optional(),
  zone_id:     z.string().optional(),
  station:     z.string().optional(),
  station_id:  z.string().optional(),
  status: z.enum(['fonctionnel', 'en_reparation', 'hors_service']).default('fonctionnel'),
  details: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.any()), z.record(z.string(), z.any())])
  ).optional(),
});

// ✅ Validation pour création de mouvement
// .nullish() = accepte undefined ET null (le frontend envoie null pour les champs vides)
export const createMovementSchema = z.object({
  equipment_id:       z.string().uuid(),
  type:               z.enum(['entree', 'sortie', 'transfert', 'retour', 'ajustement', 'deploiement']),
  from_zone_id:       z.string().uuid().nullish(),
  from_station_id:    z.string().uuid().nullish(),
  to_zone_id:         z.string().uuid().nullish(),
  to_station_id:      z.string().uuid().nullish(),
  note:               z.string().max(500).nullish(),
  reference:          z.string().max(100).nullish(),
  new_status:         z.enum(['fonctionnel', 'en_reparation', 'hors_service']).nullish(),
  date_deploiement:   z.string().nullish(),
  date_retour_prevue: z.string().nullish(),
});

// ✅ Validation pour login
export const loginSchema = z.object({
  email: z.string().email().optional(),
  username: z.string().optional(),
  password: z.string().min(1)
}).refine(
  (data) => data.email || data.username,
  { message: "Email ou username requis" }
);

export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;
export type CreateMovementInput = z.infer<typeof createMovementSchema>;
export type LoginInput = z.infer<typeof loginSchema>;