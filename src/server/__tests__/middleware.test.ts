import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET!;
const VALID_USER  = { id: 'user-uuid-1', username: 'agent1', role: 'agent_logistique', email: null, display_name: 'Agent Test' };
const ADMIN_USER  = { id: 'admin-uuid-1', username: 'admin',  role: 'admin',            email: null, display_name: 'Admin' };

// Mock db AVANT l'import du middleware
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.ts', () => ({ query: mockQuery }));

import { authenticateToken, authorize } from '../middleware/auth.ts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(overrides: Record<string, any> = {}) {
  return { cookies: {}, headers: {}, ip: '127.0.0.1', path: '/test', ...overrides } as any;
}

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json   = vi.fn().mockReturnValue(res);
  return res;
}

function validToken(payload = VALID_USER) {
  return jwt.sign({ id: payload.id, username: payload.username, role: payload.role }, JWT_SECRET, { expiresIn: '1h' });
}

// ─── authenticateToken ────────────────────────────────────────────────────────

describe('authenticateToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [VALID_USER] });
  });

  it('retourne 401 si aucun token', async () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await authenticateToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepte un token valide dans le cookie', async () => {
    const req  = makeReq({ cookies: { auth_token: validToken() } });
    const res  = makeRes();
    const next = vi.fn();
    await authenticateToken(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe(VALID_USER.id);
  });

  it('accepte un token valide dans le header Authorization', async () => {
    const token = validToken();
    const req   = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const res   = makeRes();
    const next  = vi.fn();
    await authenticateToken(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('retourne 403 si token invalide (mauvaise signature)', async () => {
    const badToken = jwt.sign({ id: 'x', username: 'x', role: 'admin' }, 'mauvais_secret');
    const req = makeReq({ cookies: { auth_token: badToken } });
    const res = makeRes();
    const next = vi.fn();
    await authenticateToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('retourne 401 si token expiré', async () => {
    const expired = jwt.sign({ id: 'x', username: 'x', role: 'admin' }, JWT_SECRET, { expiresIn: '-1s' });
    const req = makeReq({ cookies: { auth_token: expired } });
    const res = makeRes();
    const next = vi.fn();
    await authenticateToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('retourne 401 si l\'utilisateur n\'existe plus en base', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const req = makeReq({ cookies: { auth_token: validToken() } });
    const res = makeRes();
    const next = vi.fn();
    await authenticateToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ─── authorize ────────────────────────────────────────────────────────────────

describe('authorize', () => {
  it('laisse passer un rôle autorisé', () => {
    const req  = { user: ADMIN_USER } as any;
    const res  = makeRes();
    const next = vi.fn();
    authorize(['admin'])(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('bloque un rôle non autorisé avec 403', () => {
    const req  = { user: VALID_USER } as any;
    const res  = makeRes();
    const next = vi.fn();
    authorize(['admin'])(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepte un rôle parmi plusieurs autorisés', () => {
    const req  = { user: { ...VALID_USER, role: 'chef_service_administratif' } } as any;
    const res  = makeRes();
    const next = vi.fn();
    authorize(['admin', 'chef_service_administratif'])(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('bloque si req.user est absent', () => {
    const req  = {} as any;
    const res  = makeRes();
    const next = vi.fn();
    authorize(['admin'])(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
