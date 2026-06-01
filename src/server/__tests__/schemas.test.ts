import { describe, it, expect } from 'vitest';
import { loginSchema, createEquipmentSchema, createMovementSchema } from '../schemas.ts';

// ─── loginSchema ─────────────────────────────────────────────────────────────

describe('loginSchema', () => {
  it('accepte un username + password valides', () => {
    const result = loginSchema.safeParse({ username: 'admin', password: 'secret' });
    expect(result.success).toBe(true);
  });

  it('accepte un email + password valides', () => {
    const result = loginSchema.safeParse({ email: 'admin@test.com', password: 'secret' });
    expect(result.success).toBe(true);
  });

  it('rejette si ni email ni username fourni', () => {
    const result = loginSchema.safeParse({ password: 'secret' });
    expect(result.success).toBe(false);
  });

  it('rejette si password manquant', () => {
    const result = loginSchema.safeParse({ username: 'admin' });
    expect(result.success).toBe(false);
  });

  it('rejette si password vide', () => {
    const result = loginSchema.safeParse({ username: 'admin', password: '' });
    expect(result.success).toBe(false);
  });

  it('rejette un email invalide', () => {
    const result = loginSchema.safeParse({ email: 'pas-un-email', password: 'secret' });
    expect(result.success).toBe(false);
  });
});

// ─── createEquipmentSchema ────────────────────────────────────────────────────

describe('createEquipmentSchema', () => {
  it('accepte un équipement minimal valide', () => {
    const result = createEquipmentSchema.safeParse({
      name: 'Laptop HP',
      category: 'informatique',
      status: 'fonctionnel',
    });
    expect(result.success).toBe(true);
  });

  it('applique le statut par défaut "fonctionnel"', () => {
    const result = createEquipmentSchema.safeParse({ name: 'Test', category: 'it' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('fonctionnel');
  });

  it('rejette un statut inconnu', () => {
    const result = createEquipmentSchema.safeParse({
      name: 'Test',
      status: 'invalide',
    });
    expect(result.success).toBe(false);
  });

  it('rejette un nom trop long (> 200 chars)', () => {
    const result = createEquipmentSchema.safeParse({
      name: 'A'.repeat(201),
      status: 'fonctionnel',
    });
    expect(result.success).toBe(false);
  });

  it('accepte un category_id UUID valide', () => {
    const result = createEquipmentSchema.safeParse({
      name: 'Test',
      category_id: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('rejette un category_id qui n\'est pas un UUID', () => {
    const result = createEquipmentSchema.safeParse({
      name: 'Test',
      category_id: 'pas-un-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('accepte des details arbitraires', () => {
    const result = createEquipmentSchema.safeParse({
      name: 'Test',
      status: 'fonctionnel',
      details: { numero_serie: 'SN-001', marque: 'Dell' },
    });
    expect(result.success).toBe(true);
  });
});

// ─── createMovementSchema ─────────────────────────────────────────────────────

describe('createMovementSchema', () => {
  const equipmentId = '550e8400-e29b-41d4-a716-446655440000';
  const zoneId      = '660e8400-e29b-41d4-a716-446655440000';

  it('accepte un mouvement "entree" valide', () => {
    const result = createMovementSchema.safeParse({
      equipment_id: equipmentId,
      type: 'entree',
      to_zone_id: zoneId,
    });
    expect(result.success).toBe(true);
  });

  it('accepte tous les types de mouvement valides', () => {
    const types = ['entree', 'sortie', 'transfert', 'retour', 'ajustement', 'deploiement'];
    for (const type of types) {
      const result = createMovementSchema.safeParse({ equipment_id: equipmentId, type });
      expect(result.success, `type "${type}" devrait être valide`).toBe(true);
    }
  });

  it('rejette un type de mouvement inconnu', () => {
    const result = createMovementSchema.safeParse({
      equipment_id: equipmentId,
      type: 'deplacement',
    });
    expect(result.success).toBe(false);
  });

  it('rejette si equipment_id manquant', () => {
    const result = createMovementSchema.safeParse({ type: 'entree' });
    expect(result.success).toBe(false);
  });

  it('rejette si equipment_id n\'est pas un UUID', () => {
    const result = createMovementSchema.safeParse({
      equipment_id: 'pas-un-uuid',
      type: 'entree',
    });
    expect(result.success).toBe(false);
  });

  it('rejette un new_status invalide', () => {
    const result = createMovementSchema.safeParse({
      equipment_id: equipmentId,
      type: 'ajustement',
      new_status: 'casse',
    });
    expect(result.success).toBe(false);
  });

  it('rejette une note trop longue (> 500 chars)', () => {
    const result = createMovementSchema.safeParse({
      equipment_id: equipmentId,
      type: 'entree',
      note: 'A'.repeat(501),
    });
    expect(result.success).toBe(false);
  });
});
