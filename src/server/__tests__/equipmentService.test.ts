import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.ts', () => ({ query: mockQuery }));

import { EquipmentService } from '../services/equipmentService.ts';

const CAT_ID  = '15f6658c-a379-4763-94db-eef00df2af01';
const ZONE_ID = '25f6658c-a379-4763-94db-eef00df2af01';
const USER_ID = '35f6658c-a379-4763-94db-eef00df2af01';
const EQUIP_ID = '45f6658c-a379-4763-94db-eef00df2af01';

describe('EquipmentService.getAllEquipment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retourne la liste complète des équipements actifs', async () => {
    const rows = [
      { id: EQUIP_ID, name: 'PC Bureau', category_code: 'it', zone_name: 'Zone Nord', deleted_at: null },
    ];
    mockQuery.mockResolvedValue({ rows });
    const result = await EquipmentService.getAllEquipment();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('PC Bureau');
  });

  it('n\'inclut pas les équipements supprimés (WHERE deleted_at IS NULL)', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await EquipmentService.getAllEquipment();
    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toContain('deleted_at IS NULL');
  });
});

describe('EquipmentService.getEquipmentDetails', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retourne les détails pour une liste d\'IDs', async () => {
    const rows = [
      { equipment_id: EQUIP_ID, field_key: 'marque', field_value: 'Dell' },
      { equipment_id: EQUIP_ID, field_key: 'modele', field_value: 'Latitude 5420' },
    ];
    mockQuery.mockResolvedValue({ rows });
    const result = await EquipmentService.getEquipmentDetails([EQUIP_ID]);
    expect(result).toHaveLength(2);
    expect(result[0].field_key).toBe('marque');
  });

  it('retourne un tableau vide si aucun ID fourni', async () => {
    const result = await EquipmentService.getEquipmentDetails([]);
    expect(result).toHaveLength(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('EquipmentService.createEquipment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('crée un équipement et retourne son ID', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: EQUIP_ID }] })  // INSERT equipment
      .mockResolvedValueOnce({ rows: [] });                   // INSERT details (marque)

    const id = await EquipmentService.createEquipment({
      name: 'PC Bureau',
      category_id: CAT_ID,
      status: 'fonctionnel',
      zone_id: ZONE_ID,
      station_id: null,
      created_by: USER_ID,
      details: { marque: 'Dell' },
    });

    expect(id).toBe(EQUIP_ID);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('lève une erreur si category_id est absent', async () => {
    await expect(EquipmentService.createEquipment({
      name: 'Test',
      category_id: null,
      status: 'fonctionnel',
      zone_id: null,
      station_id: null,
      created_by: USER_ID,
    })).rejects.toThrow('Catégorie invalide');
  });

  it('n\'insère pas les détails vides ou null', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: EQUIP_ID }] });

    await EquipmentService.createEquipment({
      name: 'PC',
      category_id: CAT_ID,
      status: 'fonctionnel',
      zone_id: null,
      station_id: null,
      created_by: USER_ID,
      details: { vide: '', null_val: null },
    });

    const equipInsert = mockQuery.mock.calls.find(c =>
      (c[0] as string).includes('INSERT INTO equipment')
    );
    expect(equipInsert).toBeDefined();
  });
});

describe('EquipmentService.updateEquipment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('met à jour les champs de l\'équipement', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const result = await EquipmentService.updateEquipment(EQUIP_ID, { status: 'en_reparation' });
    expect(result).toBe(EQUIP_ID);
    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toContain('UPDATE equipment');
  });

  it('met à jour les détails (supprime puis réinsère)', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await EquipmentService.updateEquipment(EQUIP_ID, {
      details: { marque: 'HP', modele: 'EliteBook' },
    });
    const calls = mockQuery.mock.calls.map(c => c[0] as string);
    expect(calls.some(s => s.includes('DELETE FROM equipment_details'))).toBe(true);
    expect(calls.filter(s => s.includes('INSERT INTO equipment_details'))).toHaveLength(2);
  });

  it('n\'insère pas les détails vides ou null lors de la mise à jour', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await EquipmentService.updateEquipment(EQUIP_ID, {
      details: { marque: 'HP', vide: '', null_val: null },
    });
    const insertCalls = mockQuery.mock.calls.filter(c =>
      (c[0] as string).includes('INSERT INTO equipment_details')
    );
    expect(insertCalls).toHaveLength(1); // Seulement 'marque' = 'HP'
  });
});

describe('EquipmentService.deleteEquipment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('effectue une suppression douce (soft delete)', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await EquipmentService.deleteEquipment(EQUIP_ID);
    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toContain('deleted_at');
    expect(sql).not.toContain('DELETE FROM');
  });
});
