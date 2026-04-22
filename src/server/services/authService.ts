import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query } from '../db.ts';
import { config } from '../config.ts';

export class AuthService {
  static async login(email: string, password: string) {
    // Note: On supporte email ou username pour la flexibilité
    const result = await query(
      "SELECT * FROM users WHERE (email = $1 OR username = $1) AND deleted_at IS NULL", 
      [email]
    );

    if (result.rows.length === 0) {
      throw new Error("Utilisateur non trouvé");
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      throw new Error("Mot de passe incorrect");
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      config.jwtSecret,
      { expiresIn: '24h' }
    );

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role
      }
    };
  }
}
