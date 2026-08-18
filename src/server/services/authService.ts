import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { query } from '../db.ts';
import { config } from '../config.ts';

export class AuthService {
  static async login(identifier: string, password: string) {
    // ✅ Message d'erreur générique pour ne pas révéler si l'email existe
    const errorMessage = "Identifiants invalides";

    // Supporte email OU username comme identifiant
    const result = await query(
      `SELECT * FROM users 
       WHERE (email = $1 OR username = $1) 
         AND deleted_at IS NULL 
       LIMIT 1`,
      [identifier]
    );

    if (result.rows.length === 0) {
      throw new Error(errorMessage);
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      throw new Error(errorMessage);
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, jti: randomUUID() },
      config.jwtSecret,
      { expiresIn: '30m' }
    );

    return {
      token,
      user: {
        id:          user.id,
        username:    user.username,
        displayName: user.display_name,
        role:        user.role,
        zoneId:      user.zone_id,
      }
    };
  }
}