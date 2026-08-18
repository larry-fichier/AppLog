import jwt from 'jsonwebtoken';
import { query } from '../db.ts';
import { config } from '../config.ts';
import { logger } from '../logger.ts';
import { activeSessions } from '../sessions.ts';

export const authenticateToken = async (req: any, res: any, next: any) => {
  try {
    let token = req.cookies?.auth_token;
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }
    if (!token) return res.status(401).json({ error: "Non authentifié" });

    let decoded: any;
    try {
      decoded = jwt.verify(token, config.jwtSecret);
    } catch (err: any) {
      logger.security('AUTH_FAILED', 'low', {
        ip: req.ip, path: req.path,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: "Session expirée" });
      }
      return res.status(403).json({ error: "Token invalide" });
    }

    if (!decoded?.id) return res.status(403).json({ error: "Token invalide" });

    const result = await query(
      "SELECT id, username, role, email, display_name, zone_id FROM users WHERE id = $1 AND deleted_at IS NULL",
      [decoded.id]
    );
    if (result.rows.length === 0) return res.status(401).json({ error: "Utilisateur non trouvé" });

    // ── Session unique via jti ──────────────────────────────
    // Le jti est fixe pour toute la vie d'une session.
    // Seul un nouveau login génère un nouveau jti.
    if (decoded.jti) {
      const storedJti = activeSessions.get(decoded.id);
      if (storedJti !== undefined && storedJti !== decoded.jti) {
        return res.status(401).json({ error: "SESSION_REPLACED" });
      }
      // Premier accès après redémarrage serveur → enregistrer le jti existant
      if (storedJti === undefined) {
        activeSessions.set(decoded.id, decoded.jti);
      }
    }

    // ── Session glissante ───────────────────────────────────
    // Renouveler uniquement si le token expire dans moins de 5 minutes.
    // Évite la race condition sur les requêtes parallèles.
    const timeLeft = (decoded.exp ?? 0) - Math.floor(Date.now() / 1000);
    if (timeLeft < 5 * 60) {
      const slidingToken = jwt.sign(
        { id: decoded.id, username: decoded.username, role: decoded.role, jti: decoded.jti },
        config.jwtSecret,
        { expiresIn: "30m" }
      );
      res.cookie("auth_token", slidingToken, {
        httpOnly: true,
        secure: process.env.COOKIE_SECURE === 'true',
        sameSite: 'lax' as const,
      });
      // jti inchangé → pas besoin de mettre à jour activeSessions
    }

    req.user = result.rows[0];
    next();
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
