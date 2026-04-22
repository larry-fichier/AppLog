import jwt from 'jsonwebtoken';
import { query } from '../db.ts';
import { config } from '../config.ts';

export const authenticateToken = async (req: any, res: any, next: any) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    // Support de contournement (demo)
    const bypassUid = req.headers['x-user-uid'];
    if (bypassUid === "demo-admin-uid") {
      req.user = { id: '00000000-0000-0000-0000-000000000000', role: "admin", email: config.adminEmail };
      return next();
    }

    if (!token) {
      return res.status(401).json({ error: "Session expirée ou invalide. Veuillez vous connecter." });
    }

    try {
      const decoded: any = jwt.verify(token, config.jwtSecret);
      if (!decoded || !decoded.id) {
        return res.status(403).json({ error: "Accès refusé. Token invalide." });
      }

      // Vérification en base (UUID)
      const result = await query("SELECT id, role, email, display_name FROM users WHERE id = $1 AND deleted_at IS NULL", [decoded.id]);
      if (result.rows.length === 0) {
        return res.status(401).json({ error: "Utilisateur non trouvé" });
      }
      
      req.user = result.rows[0];
      next();
    } catch (err) {
      return res.status(403).json({ error: "Accès refusé. Token expiré ou corrompu." });
    }
  } catch (globalErr) {
    console.error("[Auth] Middleware Error:", globalErr);
    res.status(500).json({ error: "Erreur interne de sécurité" });
  }
};

export const authorize = (roles: string[]) => {
  return (req: any, res: any, next: any) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Permission insuffisante." });
    }
    next();
  };
};
