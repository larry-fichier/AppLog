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

// ✅ Validation pour déclaration de stock COM Zone
export const declareStockSchema = z.object({
  quantite: z.number().int().min(0),
  note:     z.string().max(500).nullish(),
});

// ✅ Validation pour approbation d'une déclaration de stock / d'un transfert
export const stockDecisionSchema = z.object({
  note: z.string().max(500).nullish(),
});

// ✅ Validation pour rejet — motif obligatoire, pour que le com_zone à
// l'origine de la demande sache toujours pourquoi elle a été refusée.
export const rejectDecisionSchema = z.object({
  note: z.string().trim().min(1, "Un motif de rejet est obligatoire").max(500),
});

// ✅ Validation pour déclasser un équipement (hors service définitif, conservé
// comme source de pièces détachées — reste actif/visible dans l'inventaire)
export const declasserSchema = z.object({
  note: z.string().max(500).nullish(),
});

// ✅ Validation pour réformer un véhicule (remis à un ancien personnel — sort
// définitivement du parc actif, seule la traçabilité est conservée)
export const reformerSchema = z.object({
  recipient: z.string().trim().min(1, "Le nom du destinataire est obligatoire").max(255),
  note:      z.string().max(500).nullish(),
});

// ✅ Validation pour déclarer une panne — description obligatoire, pour que
// chef_ram / admin sachent quoi diagnostiquer sans devoir recontacter la zone.
export const panneSchema = z.object({
  description: z.string().trim().min(1, "La description de la panne est obligatoire").max(500),
});

// ✅ Validation pour signaler la réparation d'un véhicule — note optionnelle
// (contrairement à la panne, il n'y a pas de dysfonctionnement à décrire).
export const repareSchema = z.object({
  note: z.string().max(500).nullish(),
});

// ✅ Validation pour marquer un ravitaillement effectif
export const fulfillResupplySchema = z.object({
  fulfilled_quantity: z.number().int().min(0).nullish(),
  note:                z.string().max(500).nullish(),
});

// ✅ Validation pour confirmation de réception d'un ravitaillement
export const confirmResupplySchema = z.object({
  quantite_recue: z.number().int().min(0),
  note:           z.string().max(500).nullish(),
});

export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;
export type CreateMovementInput = z.infer<typeof createMovementSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type DeclareStockInput = z.infer<typeof declareStockSchema>;
export type StockDecisionInput = z.infer<typeof stockDecisionSchema>;
export type FulfillResupplyInput = z.infer<typeof fulfillResupplySchema>;
export type ConfirmResupplyInput = z.infer<typeof confirmResupplySchema>;