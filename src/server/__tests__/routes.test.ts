import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// ── Mock db.ts avec pg-mem AVANT tout import de l'app ─────────────────────────
const queryRef = { fn: null as any };

vi.mock('../db.ts', () => ({
  query:          (...args: any[]) => queryRef.fn?.(...args),
  connectDB:      vi.fn(),
  initSchema:     vi.fn(),
  isRealPostgres: false,
}));

import { createApp } from '../app.ts';
import { createTestQuery, seedTestData } from './helpers/testDb.ts';

// ─── Setup global ─────────────────────────────────────────────────────────────

let app: Express;
let adminCookie: string;
let agentCookie: string;
let ids: { adminId: string; agentId: string; categoryId: string; zoneId: string };

beforeAll(async () => {
  // 1. Créer la base pg-mem et les tables
  const testQuery = await createTestQuery();
  queryRef.fn = testQuery;

  // 2. Insérer les données de test (admin, agent, catégorie, zone)
  ids = await seedTestData(testQuery);

  // 3. Créer l'app Express
  app = await createApp();

  // 4. Obtenir des cookies de session pour chaque rôle
  const adminRes = await request(app)
    .post('/api/auth/login')
    .send({ username: 'admin', password: 'AdminTest@2025' });
  adminCookie = adminRes.headers['set-cookie']?.[0] ?? '';

  const agentRes = await request(app)
    .post('/api/auth/login')
    .send({ username: 'agent1', password: 'Agent@2025' });
  agentCookie = agentRes.headers['set-cookie']?.[0] ?? '';
});

// ─── GET /api/health ──────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('retourne status ok sans authentification', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  it('connecte un utilisateur valide et pose un cookie httpOnly', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'AdminTest@2025' });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('admin');
    expect(res.body.user.role).toBe('admin');
    expect(res.headers['set-cookie']).toBeDefined();
    // Le mot de passe ne doit jamais figurer dans la réponse
    expect(JSON.stringify(res.body)).not.toContain('password');
  });

  it('retourne 401 pour des identifiants invalides', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'mauvais_mdp' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it('retourne 400 si username et email sont absents', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'secret' });
    expect(res.status).toBe(400);
  });

  it('retourne 400 si password est absent', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin' });
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  it('supprime le cookie de session', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Le cookie doit être vidé (Max-Age=0 ou Expires passé)
    const cookieHeader = res.headers['set-cookie']?.[0] ?? '';
    expect(cookieHeader).toContain('auth_token=;');
  });
});

// ─── GET /api/equipment ───────────────────────────────────────────────────────

describe('GET /api/equipment', () => {
  it('retourne 401 sans authentification', async () => {
    const res = await request(app).get('/api/equipment');
    expect(res.status).toBe(401);
  });

  it('retourne la liste des équipements pour un utilisateur connecté', async () => {
    const res = await request(app)
      .get('/api/equipment')
      .set('Cookie', agentCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ─── POST /api/equipment ──────────────────────────────────────────────────────

describe('POST /api/equipment', () => {
  it('crée un équipement et retourne son ID', async () => {
    const res = await request(app)
      .post('/api/equipment')
      .set('Cookie', agentCookie)
      .send({
        name: 'PC Test Vitest',
        category_id: ids.categoryId,
        status: 'fonctionnel',
        zone_id: ids.zoneId,
        details: { marque: 'Dell', modele: 'Latitude' },
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  it('retourne 409 si un équipement du même nom existe déjà', async () => {
    const payload = {
      name: 'PC Doublon',
      category_id: ids.categoryId,
      status: 'fonctionnel',
    };
    await request(app).post('/api/equipment').set('Cookie', agentCookie).send(payload);
    const res = await request(app).post('/api/equipment').set('Cookie', agentCookie).send(payload);
    expect(res.status).toBe(409);
  });

  it('retourne 401 sans authentification', async () => {
    const res = await request(app).post('/api/equipment').send({ name: 'Test' });
    expect(res.status).toBe(401);
  });
});

// ─── DELETE /api/equipment/:id ────────────────────────────────────────────────

describe('DELETE /api/equipment/:id', () => {
  it('permet à un admin de supprimer un équipement', async () => {
    // Créer d'abord un équipement
    const created = await request(app)
      .post('/api/equipment')
      .set('Cookie', adminCookie)
      .send({ name: 'Équipement À Supprimer', category_id: ids.categoryId, status: 'fonctionnel' });

    const res = await request(app)
      .delete(`/api/equipment/${created.body.id}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('retourne 403 si un agent essaie de supprimer', async () => {
    const created = await request(app)
      .post('/api/equipment')
      .set('Cookie', adminCookie)
      .send({ name: 'Équipement Protégé', category_id: ids.categoryId, status: 'fonctionnel' });

    const res = await request(app)
      .delete(`/api/equipment/${created.body.id}`)
      .set('Cookie', agentCookie);
    expect(res.status).toBe(403);
  });

  it('retourne 400 si l\'ID n\'est pas un UUID', async () => {
    const res = await request(app)
      .delete('/api/equipment/pas-un-uuid')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/movements ──────────────────────────────────────────────────────

describe('POST /api/movements', () => {
  let equipmentId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/equipment')
      .set('Cookie', agentCookie)
      .send({ name: 'Équipement Mouvement', category_id: ids.categoryId, status: 'fonctionnel' });
    equipmentId = res.body.id;
  });

  it('crée un mouvement "entree" valide', async () => {
    const res = await request(app)
      .post('/api/movements')
      .set('Cookie', agentCookie)
      .send({
        equipment_id: equipmentId,
        type: 'entree',
        to_zone_id: ids.zoneId,
        note: 'Entrée initiale',
      });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('entree');
  });

  it('retourne 400 pour un type de mouvement invalide', async () => {
    const res = await request(app)
      .post('/api/movements')
      .set('Cookie', agentCookie)
      .send({ equipment_id: equipmentId, type: 'deplacement_invalide' });
    expect(res.status).toBe(400);
  });

  it('retourne 400 si equipment_id manquant', async () => {
    const res = await request(app)
      .post('/api/movements')
      .set('Cookie', agentCookie)
      .send({ type: 'entree' });
    expect(res.status).toBe(400);
  });

  it('retourne 404 si l\'équipement n\'existe pas', async () => {
    const res = await request(app)
      .post('/api/movements')
      .set('Cookie', agentCookie)
      .send({
        equipment_id: '00000000-0000-0000-0000-000000000000',
        type: 'entree',
      });
    expect(res.status).toBe(404);
  });

  it('retourne 401 sans authentification', async () => {
    const res = await request(app).post('/api/movements').send({ equipment_id: equipmentId, type: 'entree' });
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/movements ───────────────────────────────────────────────────────

describe('GET /api/movements', () => {
  it('retourne la liste des mouvements', async () => {
    const res = await request(app).get('/api/movements').set('Cookie', agentCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('retourne 400 si equipment_id n\'est pas un UUID', async () => {
    const res = await request(app)
      .get('/api/movements?equipment_id=pas-un-uuid')
      .set('Cookie', agentCookie);
    expect(res.status).toBe(400);
  });

  it('retourne 401 sans authentification', async () => {
    const res = await request(app).get('/api/movements');
    expect(res.status).toBe(401);
  });
});

// ─── PUT /api/movements/:id ───────────────────────────────────────────────────

describe('PUT /api/movements/:id', () => {
  it('retourne 401 sans authentification', async () => {
    const res = await request(app)
      .put('/api/movements/00000000-0000-0000-0000-000000000000')
      .send({ note: 'Tentative sans cookie' });
    expect(res.status).toBe(401);
  });

  it('retourne 400 si l\'ID n\'est pas un UUID', async () => {
    const res = await request(app)
      .put('/api/movements/pas-un-uuid')
      .set('Cookie', adminCookie)
      .send({ note: 'Test' });
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/admin/users ─────────────────────────────────────────────────────

describe('GET /api/admin/users', () => {
  it('retourne la liste des utilisateurs pour un admin', async () => {
    const res = await request(app).get('/api/admin/users').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    // Les mots de passe ne doivent pas figurer dans la liste
    expect(JSON.stringify(res.body)).not.toContain('password_hash');
  });

  it('retourne 403 pour un agent logistique', async () => {
    const res = await request(app).get('/api/admin/users').set('Cookie', agentCookie);
    expect(res.status).toBe(403);
  });

  it('retourne 401 sans authentification', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/admin/users ────────────────────────────────────────────────────

describe('POST /api/admin/users', () => {
  it('permet à un admin de créer un utilisateur', async () => {
    const res = await request(app)
      .post('/api/admin/users')
      .set('Cookie', adminCookie)
      .send({ username: 'nouvel_agent', password: 'Pass@2025!', role: 'agent_logistique' });
    expect(res.status).toBe(201);
    expect(res.body.username).toBe('nouvel_agent');
    expect(res.body).not.toHaveProperty('password_hash');
  });

  it('retourne 403 pour un agent', async () => {
    const res = await request(app)
      .post('/api/admin/users')
      .set('Cookie', agentCookie)
      .send({ username: 'test', password: 'Pass@2025!' });
    expect(res.status).toBe(403);
  });
});

// ─── GET /api/config ──────────────────────────────────────────────────────────

describe('GET /api/config', () => {
  it('retourne la config publique sans authentification', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('categories');
    expect(res.body).toHaveProperty('zones');
    expect(res.body).toHaveProperty('stations');
  });
});
