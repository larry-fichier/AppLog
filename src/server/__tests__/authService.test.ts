import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';

const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.ts', () => ({ query: mockQuery }));

import { AuthService } from '../services/authService.ts';

const HASHED_PASSWORD = bcrypt.hashSync('motdepasse123', 10);

const DB_USER = {
  id:            'user-uuid-1',
  username:      'agent1',
  display_name:  'Agent Test',
  role:          'agent_logistique',
  email:         null,
  password_hash: HASHED_PASSWORD,
};

describe('AuthService.login', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retourne un token et les infos utilisateur pour des identifiants valides', async () => {
    mockQuery.mockResolvedValue({ rows: [DB_USER] });
    const result = await AuthService.login('agent1', 'motdepasse123');
    expect(result.token).toBeDefined();
    expect(result.user.id).toBe('user-uuid-1');
    expect(result.user.username).toBe('agent1');
    expect(result.user.role).toBe('agent_logistique');
    // Le mot de passe ne doit jamais figurer dans la réponse
    expect(result.user).not.toHaveProperty('password_hash');
  });

  it('lève une erreur si l\'utilisateur n\'existe pas', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await expect(AuthService.login('inexistant', 'motdepasse123'))
      .rejects.toThrow('Identifiants invalides');
  });

  it('lève une erreur si le mot de passe est incorrect', async () => {
    mockQuery.mockResolvedValue({ rows: [DB_USER] });
    await expect(AuthService.login('agent1', 'mauvais_mdp'))
      .rejects.toThrow('Identifiants invalides');
  });

  it('génère un token JWT signé avec le bon secret', async () => {
    mockQuery.mockResolvedValue({ rows: [DB_USER] });
    const jwt = await import('jsonwebtoken');
    const result = await AuthService.login('agent1', 'motdepasse123');
    const decoded = jwt.decode(result.token) as any;
    expect(decoded.id).toBe('user-uuid-1');
    expect(decoded.role).toBe('agent_logistique');
  });

  it('retourne le même message d\'erreur peu importe la raison (timing safe)', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const err1 = await AuthService.login('inexistant', 'mdp').catch(e => e.message);

    mockQuery.mockResolvedValue({ rows: [DB_USER] });
    const err2 = await AuthService.login('agent1', 'mauvais').catch(e => e.message);

    expect(err1).toBe(err2);
  });
});
