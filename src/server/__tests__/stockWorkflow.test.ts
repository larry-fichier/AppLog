import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import crypto from 'crypto';

// ── Mock db.ts avec pg-mem AVANT tout import de l'app ─────────────────────────
const queryRef = { fn: null as any };

vi.mock('../db.ts', () => ({
  query:          (...args: any[]) => queryRef.fn?.(...args),
  transact: async (fn: (q: (text: string, params?: any[]) => Promise<any>) => Promise<any>) => fn(queryRef.fn),
  connectDB:      vi.fn(),
  initSchema:     vi.fn(),
  isRealPostgres: false,
}));

import { createApp } from '../app.ts';
import { createTestQuery, seedTestData } from './helpers/testDb.ts';

let app: Express;
let ids: Awaited<ReturnType<typeof seedTestData>>;
let adminCookie: string;
let agentCookie: string;
let chefBureauCookie: string;
let csaCookie: string;
let comZoneCookie: string;
let comZoneBCookie: string;
let chefRamCookie: string;

async function loginAs(username: string, password: string) {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  return res.headers['set-cookie']?.[0] ?? '';
}

beforeAll(async () => {
  const testQuery = await createTestQuery();
  queryRef.fn = testQuery;
  ids = await seedTestData(testQuery);
  app = await createApp();

  adminCookie      = await loginAs('admin', 'AdminTest@2025');
  agentCookie      = await loginAs('agent1', 'Agent@2025');
  chefBureauCookie = await loginAs('chefbureau1', 'ChefBureau@2025');
  csaCookie        = await loginAs('csa1', 'Csa@2025');
  comZoneCookie    = await loginAs('comzone1', 'ComZone@2025');
  comZoneBCookie   = await loginAs('comzone2', 'ComZone@2025');
  chefRamCookie    = await loginAs('chefram1', 'ChefRam@2025');
});

describe('POST /api/equipment/:id/declare-stock', () => {
  it('retourne 403 pour un rôle autre que com_zone', async () => {
    const res = await request(app)
      .post(`/api/equipment/${ids.stockEquipmentId}/declare-stock`)
      .set('Cookie', agentCookie)
      .send({ quantite: 20 });
    expect(res.status).toBe(403);
  });

  it('retourne 403 si le com_zone déclare un équipement hors de sa zone', async () => {
    const res = await request(app)
      .post(`/api/equipment/${ids.stockEquipmentId}/declare-stock`)
      .set('Cookie', comZoneBCookie)
      .send({ quantite: 20 });
    expect(res.status).toBe(403);
  });

  it('applique directement une déclaration qui correspond au stock existant', async () => {
    const res = await request(app)
      .post(`/api/equipment/${ids.stockEquipmentId}/declare-stock`)
      .set('Cookie', comZoneCookie)
      .send({ quantite: 20 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ applied: true, mismatch: false });
  });

  let pendingDeclarationId: string;

  it('crée une déclaration en attente en cas d\'écart', async () => {
    const res = await request(app)
      .post(`/api/equipment/${ids.stockEquipmentId}/declare-stock`)
      .set('Cookie', comZoneCookie)
      .send({ quantite: 12 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ applied: false, mismatch: true });
    expect(res.body.declaration.status).toBe('pending');
    pendingDeclarationId = res.body.declaration.id;
  });

  describe('GET /api/stock-declarations', () => {
    it('retourne 403 pour un agent_logistique', async () => {
      const res = await request(app).get('/api/stock-declarations').set('Cookie', agentCookie);
      expect(res.status).toBe(403);
    });

    it('le chef_bureau voit la déclaration en attente', async () => {
      const res = await request(app).get('/api/stock-declarations?status=pending').set('Cookie', chefBureauCookie);
      expect(res.status).toBe(200);
      expect(res.body.some((d: any) => d.id === pendingDeclarationId)).toBe(true);
    });
  });

  describe('POST /api/stock-declarations/:id/approve', () => {
    it('retourne 403 pour un agent_logistique', async () => {
      const res = await request(app)
        .post(`/api/stock-declarations/${pendingDeclarationId}/approve`)
        .set('Cookie', agentCookie);
      expect(res.status).toBe(403);
    });

    it('permet à chef_bureau d\'approuver, applique le stock, sans ravitaillement (12 > seuil 5)', async () => {
      const res = await request(app)
        .post(`/api/stock-declarations/${pendingDeclarationId}/approve`)
        .set('Cookie', chefBureauCookie)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.declaration.status).toBe('approved');

      const eqRes = await request(app).get('/api/equipment').set('Cookie', comZoneCookie);
      const item = eqRes.body.find((e: any) => e.id === ids.stockEquipmentId);
      expect(item.details.quantite_stock).toBe('12');

      const reqRes = await request(app).get('/api/resupply-requests?status=open').set('Cookie', chefBureauCookie);
      expect(reqRes.body.length).toBe(0);
    });

    it('retourne 409 si la déclaration est déjà décidée', async () => {
      const res = await request(app)
        .post(`/api/stock-declarations/${pendingDeclarationId}/approve`)
        .set('Cookie', chefBureauCookie)
        .send({});
      expect(res.status).toBe(409);
    });
  });
});

describe('Workflow complet : déclaration sous le seuil → ravitaillement → confirmation', () => {
  let declarationId: string;
  let resupplyId: string;

  it('déclare un stock sous le seuil (3 <= seuil 5) → écart créé', async () => {
    const res = await request(app)
      .post(`/api/equipment/${ids.stockEquipmentId}/declare-stock`)
      .set('Cookie', comZoneCookie)
      .send({ quantite: 3 });
    expect(res.status).toBe(201);
    declarationId = res.body.declaration.id;
  });

  it('CSA approuve → stock à 3, une demande de ravitaillement "open" est créée', async () => {
    const res = await request(app)
      .post(`/api/stock-declarations/${declarationId}/approve`)
      .set('Cookie', csaCookie)
      .send({});
    expect(res.status).toBe(200);

    const reqRes = await request(app).get('/api/resupply-requests?status=open').set('Cookie', csaCookie);
    expect(reqRes.body.length).toBe(1);
    resupplyId = reqRes.body[0].id;
  });

  it('ne crée pas de doublon si le stock reste sous le seuil (déclaration répétée)', async () => {
    const declRes = await request(app)
      .post(`/api/equipment/${ids.stockEquipmentId}/declare-stock`)
      .set('Cookie', comZoneCookie)
      .send({ quantite: 2 });
    expect(declRes.status).toBe(201);
    await request(app)
      .post(`/api/stock-declarations/${declRes.body.declaration.id}/approve`)
      .set('Cookie', chefBureauCookie)
      .send({});

    const reqRes = await request(app).get('/api/resupply-requests?status=open').set('Cookie', chefBureauCookie);
    expect(reqRes.body.length).toBe(1);
    expect(reqRes.body[0].id).toBe(resupplyId);
  });

  it('retourne 403 si com_zone (zone B) tente de confirmer une demande d\'une autre zone', async () => {
    const res = await request(app)
      .post(`/api/resupply-requests/${resupplyId}/confirm`)
      .set('Cookie', comZoneBCookie)
      .send({ quantite_recue: 20 });
    expect(res.status).toBe(403);
  });

  it('retourne 409 si com_zone confirme avant que ce soit "fulfilled"', async () => {
    const res = await request(app)
      .post(`/api/resupply-requests/${resupplyId}/confirm`)
      .set('Cookie', comZoneCookie)
      .send({ quantite_recue: 20 });
    expect(res.status).toBe(409);
  });

  it('chef_bureau marque le ravitaillement effectif — le stock ne change pas encore', async () => {
    const res = await request(app)
      .post(`/api/resupply-requests/${resupplyId}/fulfill`)
      .set('Cookie', chefBureauCookie)
      .send({ fulfilled_quantity: 20 });
    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('fulfilled');

    const eqRes = await request(app).get('/api/equipment').set('Cookie', comZoneCookie);
    const item = eqRes.body.find((e: any) => e.id === ids.stockEquipmentId);
    expect(item.details.quantite_stock).toBe('2');
  });

  it('retourne 409 si un rôle autre que com_zone tente de confirmer', async () => {
    const res = await request(app)
      .post(`/api/resupply-requests/${resupplyId}/confirm`)
      .set('Cookie', chefBureauCookie)
      .send({ quantite_recue: 20 });
    expect(res.status).toBe(403);
  });

  it('com_zone (bonne zone) confirme la réception — le stock s\'additionne (2 + 20 = 22)', async () => {
    const res = await request(app)
      .post(`/api/resupply-requests/${resupplyId}/confirm`)
      .set('Cookie', comZoneCookie)
      .send({ quantite_recue: 20 });
    expect(res.status).toBe(200);
    expect(res.body.new_stock).toBe(22);

    const eqRes = await request(app).get('/api/equipment').set('Cookie', comZoneCookie);
    const item = eqRes.body.find((e: any) => e.id === ids.stockEquipmentId);
    expect(item.details.quantite_stock).toBe('22');
  });

  it('retourne 409 en cas de nouvelle tentative de confirmation', async () => {
    const res = await request(app)
      .post(`/api/resupply-requests/${resupplyId}/confirm`)
      .set('Cookie', comZoneCookie)
      .send({ quantite_recue: 5 });
    expect(res.status).toBe(409);
  });
});

describe('Rejet d\'une déclaration de stock', () => {
  it('rejette une déclaration en attente et notifie sans appliquer le stock', async () => {
    const declRes = await request(app)
      .post(`/api/equipment/${ids.stockEquipmentId}/declare-stock`)
      .set('Cookie', comZoneCookie)
      .send({ quantite: 999 });
    expect(declRes.status).toBe(201);

    const beforeEq = await request(app).get('/api/equipment').set('Cookie', comZoneCookie);
    const beforeStock = beforeEq.body.find((e: any) => e.id === ids.stockEquipmentId).details.quantite_stock;

    const res = await request(app)
      .post(`/api/stock-declarations/${declRes.body.declaration.id}/reject`)
      .set('Cookie', chefBureauCookie)
      .send({ note: 'Écart injustifié' });
    expect(res.status).toBe(200);
    expect(res.body.declaration.status).toBe('rejected');

    const afterEq = await request(app).get('/api/equipment').set('Cookie', comZoneCookie);
    const afterStock = afterEq.body.find((e: any) => e.id === ids.stockEquipmentId).details.quantite_stock;
    expect(afterStock).toBe(beforeStock);
  });
});

describe('Filtrage par zone', () => {
  it('un com_zone d\'une autre zone ne voit pas les déclarations de la zone A', async () => {
    const res = await request(app).get('/api/stock-declarations?status=all').set('Cookie', comZoneBCookie);
    expect(res.status).toBe(200);
    expect(res.body.every((d: any) => d.zone_id === ids.zoneBId)).toBe(true);
  });
});

describe('POST /api/equipment/:id/panne (com_zone)', () => {
  let vehicleId: string;

  beforeAll(async () => {
    const vehicleCategoryId = crypto.randomUUID();
    await queryRef.fn(
      `INSERT INTO categories (id, code, label) VALUES ($1, 'vehicules', 'Véhicules')`,
      [vehicleCategoryId]
    );
    vehicleId = crypto.randomUUID();
    await queryRef.fn(
      `INSERT INTO equipment (id, name, category_id, status, zone_id, created_by)
       VALUES ($1, 'Véhicule Test', $2, 'fonctionnel', $3, $4)`,
      [vehicleId, vehicleCategoryId, ids.zoneId, ids.adminId]
    );
  });

  it('retourne 403 si le véhicule n\'est pas dans la zone du comzone', async () => {
    const res = await request(app).post(`/api/equipment/${vehicleId}/panne`).set('Cookie', comZoneBCookie).send({ description: 'Test panne' });
    expect(res.status).toBe(403);
  });

  it('retourne 400 si la description de la panne est absente', async () => {
    const res = await request(app).post(`/api/equipment/${vehicleId}/panne`).set('Cookie', comZoneCookie);
    expect(res.status).toBe(400);
  });

  it('permet au comzone de signaler une panne sur un véhicule de sa zone', async () => {
    const res = await request(app).post(`/api/equipment/${vehicleId}/panne`).set('Cookie', comZoneCookie).send({ description: 'Moteur cale au démarrage' });
    expect(res.status).toBe(200);

    const eqRes = await request(app).get('/api/equipment').set('Cookie', comZoneCookie);
    const item = eqRes.body.find((e: any) => e.id === vehicleId);
    expect(item.status).toBe('en_reparation');
  });
});

describe('GET /api/reports/equipment (com_zone)', () => {
  const today = new Date().toISOString().slice(0, 10);

  it('retourne 403 pour un rôle autre que com_zone', async () => {
    const res = await request(app)
      .get(`/api/reports/equipment?from=${today}&to=${today}&equipment_ids=${ids.stockEquipmentId}`)
      .set('Cookie', chefBureauCookie);
    expect(res.status).toBe(403);
  });

  it('retourne 400 si la période est absente', async () => {
    const res = await request(app)
      .get(`/api/reports/equipment?equipment_ids=${ids.stockEquipmentId}`)
      .set('Cookie', comZoneCookie);
    expect(res.status).toBe(400);
  });

  it('retourne 400 si aucun équipement n\'est sélectionné', async () => {
    const res = await request(app)
      .get(`/api/reports/equipment?from=${today}&to=${today}&equipment_ids=`)
      .set('Cookie', comZoneCookie);
    expect(res.status).toBe(400);
  });

  it('retourne 403 si un équipement sélectionné n\'appartient pas à la zone', async () => {
    const res = await request(app)
      .get(`/api/reports/equipment?from=${today}&to=${today}&equipment_ids=${ids.stockEquipmentId}`)
      .set('Cookie', comZoneBCookie);
    expect(res.status).toBe(403);
  });

  it('retourne l\'historique et l\'état actuel pour un équipement de la zone', async () => {
    const res = await request(app)
      .get(`/api/reports/equipment?from=${today}&to=${today}&equipment_ids=${ids.stockEquipmentId}`)
      .set('Cookie', comZoneCookie);
    expect(res.status).toBe(200);
    expect(res.body.equipment).toHaveLength(1);
    const eq = res.body.equipment[0];
    expect(eq.id).toBe(ids.stockEquipmentId);
    expect(eq.details).toHaveProperty('quantite_stock');
    // Les déclarations/approbations des tests précédents ont généré des mouvements aujourd'hui
    expect(eq.movements.length).toBeGreaterThan(0);
  });
});

describe('GET /api/reports/equipment (chef_ram)', () => {
  const today = new Date().toISOString().slice(0, 10);
  let vehicleId: string;

  beforeAll(async () => {
    const vehicleCategoryId = crypto.randomUUID();
    await queryRef.fn(
      `INSERT INTO categories (id, code, label) VALUES ($1, 'vehicules_rapport', 'Véhicules')`,
      [vehicleCategoryId]
    );
    vehicleId = crypto.randomUUID();
    await queryRef.fn(
      `INSERT INTO equipment (id, name, category_id, status, zone_id, created_by)
       VALUES ($1, 'Véhicule Rapport Test', $2, 'fonctionnel', $3, $4)`,
      [vehicleId, vehicleCategoryId, ids.zoneId, ids.adminId]
    );
  });

  it('permet à chef_ram de générer un rapport sur un véhicule, toutes zones confondues', async () => {
    const res = await request(app)
      .get(`/api/reports/equipment?from=${today}&to=${today}&equipment_ids=${vehicleId}`)
      .set('Cookie', chefRamCookie);
    expect(res.status).toBe(200);
    expect(res.body.equipment).toHaveLength(1);
    expect(res.body.equipment[0].id).toBe(vehicleId);
  });

  it('retourne 403 si chef_ram sélectionne un équipement qui n\'est pas un véhicule', async () => {
    const res = await request(app)
      .get(`/api/reports/equipment?from=${today}&to=${today}&equipment_ids=${ids.stockEquipmentId}`)
      .set('Cookie', chefRamCookie);
    expect(res.status).toBe(403);
  });

  it('un chef_ram peut inclure un véhicule d\'une zone qui n\'est pas la sienne (pas de cloisonnement par zone)', async () => {
    // Le véhicule est en zoneId, chef_ram n'a pas de zone_id personnel — doit quand même passer.
    const res = await request(app)
      .get(`/api/reports/equipment?from=${today}&to=${today}&equipment_ids=${vehicleId}`)
      .set('Cookie', chefRamCookie);
    expect(res.status).toBe(200);
  });

  it('permet à chef_ram de signaler une panne sur ce véhicule, hors de toute zone assignée', async () => {
    const res = await request(app).post(`/api/equipment/${vehicleId}/panne`).set('Cookie', chefRamCookie).send({ description: 'Freins qui grincent' });
    expect(res.status).toBe(200);

    const eqRes = await request(app).get('/api/equipment').set('Cookie', chefRamCookie);
    const item = eqRes.body.find((e: any) => e.id === vehicleId);
    expect(item.status).toBe('en_reparation');
  });
});

describe('POST /api/equipment (chef_ram — création véhicule + déduplication par châssis)', () => {
  let vehicleCategoryId: string;

  beforeAll(async () => {
    vehicleCategoryId = crypto.randomUUID();
    await queryRef.fn(
      `INSERT INTO categories (id, code, label) VALUES ($1, 'vehicules_creation', 'Véhicules')`,
      [vehicleCategoryId]
    );
  });

  it('permet à chef_ram de créer un véhicule avec un numéro de châssis', async () => {
    const res = await request(app)
      .post('/api/equipment')
      .set('Cookie', chefRamCookie)
      .send({
        name: 'Nouveau Véhicule',
        category_id: vehicleCategoryId,
        status: 'fonctionnel',
        details: { numero_chassis: 'CHASSIS-UNIQUE-001', marque: 'Toyota' },
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  it('retourne 409 si un véhicule avec le même numéro de châssis existe déjà (même avec un nom différent)', async () => {
    const res = await request(app)
      .post('/api/equipment')
      .set('Cookie', chefRamCookie)
      .send({
        name: 'Véhicule Nom Totalement Différent',
        category_id: vehicleCategoryId,
        status: 'fonctionnel',
        details: { numero_chassis: 'CHASSIS-UNIQUE-001', marque: 'Toyota' },
      });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/châssis/i);
  });

  it('un numéro de châssis différent passe sans conflit', async () => {
    const res = await request(app)
      .post('/api/equipment')
      .set('Cookie', chefRamCookie)
      .send({
        name: 'Encore Un Autre Véhicule',
        category_id: vehicleCategoryId,
        status: 'fonctionnel',
        details: { numero_chassis: 'CHASSIS-UNIQUE-002' },
      });
    expect(res.status).toBe(201);
  });
});
