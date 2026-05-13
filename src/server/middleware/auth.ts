import jwt from 'jsonwebtoken';
import { query } from '../db.ts';
import { config } from '../config.ts';
import { logger } from '../logger.ts';

export const authenticateToken = async (req: any, res: any, next: any) => {
  try {
    // ✅ Récupérer le token depuis le cookie httpOnly OU depuis l'Authorization header
    let token = req.cookies?.auth_token;
    
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    try {
      const decoded: any = jwt.verify(token, config.jwtSecret);
      if (!decoded || !decoded.id) {
        return res.status(403).json({ error: "Token invalide" });
      }

      // Vérification en base (UUID)
      const result = await query(
        "SELECT id, role, email, display_name FROM users WHERE id = $1 AND deleted_at IS NULL", 
        [decoded.id]
      );
      
      if (result.rows.length === 0) {
        return res.status(401).json({ error: "Utilisateur non trouvé" });
      }
      
      req.user = result.rows[0];
      next();
    } catch (err: any) {
      logger.security('AUTH_FAILED', 'low', {
        ip: req.ip,
        path: req.path,
        error: err instanceof Error ? err.message : 'Unknown error'
      });
      // 401 = token expiré (refresh possible), 403 = token corrompu/invalide
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: "Session expirée" });
      }
      return res.status(403).json({ error: "Token invalide" });
    }
  } catch (globalErr) {
    console.error("[Auth] Middleware Error:", globalErr);
    res.status(500).json({ error: "Erreur interne" });
  }
};

export const authorize = (roles: string[]) => {
  return (req: any, res: any, next: any) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Permission insuffisante" });
    }
    next();
  };
};