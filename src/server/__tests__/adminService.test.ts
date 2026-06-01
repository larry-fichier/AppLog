import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';

const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.ts', () => ({ query: mockQuery }));

import { AdminService } from '../services/adminService.ts';

describe('AdminService.createUser', () => {
  beforeEach(() => vi.clearAllMocks());

  it('crée un utilisateur et retourne ses données sans mot de passe', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })        // vérif unicité username
      .mockResolvedValueOnce({ rows: [{ id: 'new-uuid', username: 'newuser', display_name: 'New User', role: 'agent_logistique', created_at: new Date() }] });

    const result = await AdminService.createUser({
      username: 'newuser',
      password: 'Pass@2025!',
      displayName: 'New User',
      role: 'agent_logistique',
    });

    expect(result.username).toBe('newuser');
    expect(result).not.toHaveProperty('password_hash');
  });

  it('hache le mot de passe avant insertion', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'x', username: 'u', display_name: 'U', role: 'agent_logistique', created_at: new Date() }] });

    await AdminService.createUser({ username: 'u', password: 'MonMotDePasse' });

    const insertCall = mockQuery.mock.calls[1];
    const hashedInCall = insertCall[1][1]; // 2e paramètre de l'INSERT = password_hash
    const isHashed = await bcrypt.compare('MonMotDePasse', hashedInCall);
    expect(isHashed).toBe(true);
  });

  it('lève une erreur si username déjà pris', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing' }] });
    await expect(AdminService.createUser({ username: 'admin', password: 'Pass@2025!' }))
      .rejects.toThrow('déjà pris');
  });

  it('lève une erreur si username manquant', async () => {
    await expect(AdminService.createUser({ username: '', password: 'Pass@2025!' }))
      .rejects.toThrow('obligatoires');
  });

  it('lève une erreur si password manquant', async () => {
    await expect(AdminService.createUser({ username: 'user', password: '' }))
      .rejects.toThrow('obligatoires');
  });

  it('applique le rôle "agent_logistique" par défaut', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'x', username: 'u', display_name: 'u', role: 'agent_logistique', created_at: new Date() }] });

    await AdminService.createUser({ username: 'u', password: 'Pass@2025!' });

    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[1][3]).toBe('agent_logistique'); // 4e param = role
  });
});

describe('AdminService.updateUserRole', () => {
  beforeEach(() => vi.clearAllMocks());

  it('met à jour le rôle et retourne l\'utilisateur', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'uuid-1', username: 'admin', role: 'admin' }] });
    const result = await AdminService.updateUserRole('uuid-1', 'admin');
    expect(result.role).toBe('admin');
  });

  it('lève une erreur si utilisateur non trouvé', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await expect(AdminService.updateUserRole('uuid-inexistant', 'admin'))
      .rejects.toThrow('non trouvé');
  });

  it('lève une erreur si id ou rôle manquant', async () => {
    await expect(AdminService.updateUserRole('', 'admin')).rejects.toThrow();
    await expect(AdminService.updateUserRole('uuid-1', '')).rejects.toThrow();
  });
});

describe('AdminService.deleteUser', () => {
  beforeEach(() => vi.clearAllMocks());

  it('effectue une suppression douce (soft delete)', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'uuid-1' }] });
    const result = await AdminService.deleteUser('uuid-1');
    expect(result.success).toBe(true);

    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toContain('deleted_at');
    expect(sql).not.toContain('DELETE FROM');
  });

  it('lève une erreur si utilisateur déjà supprimé ou inexistant', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await expect(AdminService.deleteUser('uuid-inexistant'))
      .rejects.toThrow('non trouvé');
  });
});

describe('AdminService.resetPassword', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hache le nouveau mot de passe avant de le stocker', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'uuid-1', username: 'admin' }] });
    await AdminService.resetPassword('uuid-1', 'NouveauPass@2025!');

    const sql: string = mockQuery.mock.calls[0][0];
    const hash: string = mockQuery.mock.calls[0][1][0];
    expect(sql).toContain('password_hash');
    const ok = await bcrypt.compare('NouveauPass@2025!', hash);
    expect(ok).toBe(true);
  });

  it('lève une erreur si id ou nouveau mot de passe manquant', async () => {
    await expect(AdminService.resetPassword('', 'pass')).rejects.toThrow();
    await expect(AdminService.resetPassword('uuid-1', '')).rejects.toThrow();
  });
});

describe('AdminService.getUsers', () => {
  it('retourne la liste des utilisateurs actifs', async () => {
    const users = [
      { id: '1', username: 'admin', display_name: 'Admin', role: 'admin', created_at: new Date() },
      { id: '2', username: 'agent', display_name: 'Agent', role: 'agent_logistique', created_at: new Date() },
    ];
    mockQuery.mockResolvedValue({ rows: users });
    const result = await AdminService.getUsers();
    expect(result).toHaveLength(2);
    expect(result[0].username).toBe('admin');
  });
});
