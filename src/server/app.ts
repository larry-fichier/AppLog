import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { authenticateToken, authorize } from './middleware/auth.ts';
import { activeSessions } from './sessions.ts';
import { checkLock, recordFailure, recordSuccess, remainingAttempts } from './loginGuard.ts';
import { EquipmentService } from './services/equipmentService.ts';
import { AdminService } from './services/adminService.ts';
import { AuthService } from './services/authService.ts';
import { config } from './config.ts';
import { query } from './db.ts';
import { logger } from './logger.ts';
import { loginSchema, createEquipmentSchema, createMovementSchema } from './schemas.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// ── Rôles habilités à consulter le Journal global d'audit ──────
// Chef de bureau (admin) + rôles de supervision (CSA, CSPH).
const AUDIT_VIEWER_ROLES = ['admin', 'chef_service_administratif', 'csph'];

export async function createApp() {
  const app = express();

  // ✅ Trust proxy Nginx
  app.set('trust proxy', 1);

  // ✅ HTTPS Enforcement — uniquement si un vrai proxy SSL transmet x-forwarded-proto
  if (config.nodeEnv === 'production') {
    app.use((req, res, next) => {
      const proto = req.header('x-forwarded-proto');
      // Ne rediriger que si le header est explicitement 'http' (proxy SSL actif)
      // et jamais pour les appels API (évite les boucles)
      if (proto === 'http' && !req.path.startsWith('/api/')) {
        return res.redirect(301, `https://${req.header('host')}${req.url}`);
      }
      next();
    });
  }

  // ✅ Security headers avec helmet
  if (config.nodeEnv === 'production') {
    app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'", 'https:'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'self'"]
        }
      }
    }));
  } else {
    app.use(helmet({ contentSecurityPolicy: false }));
  }

  // ✅ CORS — accepte l'IP du serveur en HTTP et HTTPS
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:5173').split(',');
  app.use(cors({
    origin: (origin, callback) => {
      // Accepter les requêtes sans origin (mobile, curl, même domaine)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error('CORS non autorisé'));
    },
    credentials: true,
    optionsSuccessStatus: 200
  }));

  // ✅ Disable CSP en dev
  if (config.nodeEnv !== 'production') {
    app.use((req, res, next) => {
      res.removeHeader('Content-Security-Policy');
      res.removeHeader('Content-Security-Policy-Report-Only');
      res.removeHeader('Cross-Origin-Embedder-Policy');
      next();
    });
  }

  // ✅ Cookie parser
  app.use(cookieParser());

  // ✅ Body parser
  app.use(express.json({ limit: '1mb' }));

  // ✅ Rate limiting login
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: config.nodeEnv === 'production' ? 5 : 20,
    message: 'Trop de tentatives de connexion, réessayez dans 15 minutes',
    standardHeaders: true,
    legacyHeaders: false,
  });

  // ✅ Rate limiting général
  const generalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  });

  if (config.nodeEnv === 'production') {
    app.use(generalLimiter);
  }

  // ─── Journal global d'audit (traçabilité de toutes les actions) ───
  // Écrit dans logs/audit.log (fichier), persiste en base (table audit_logs)
  // et notifie en temps réel (SSE) les rôles admin / chef_service_administratif / csph.
  async function recordAudit(
    action: string,
    user: { id: string; role?: string; username?: string; display_name?: string },
    details?: Record<string, any>,
    ip?: string
  ) {
    const userName = user.display_name || user.username || 'Inconnu';
    logger.audit(action, user.id, { ...details, ip });
    try {
      await query(
        `INSERT INTO audit_logs (action, user_id, user_name, role, details, ip)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [action, user.id || null, userName, user.role || null, JSON.stringify(details || {}), ip || null]
      );
    } catch (e: any) {
      console.error('[AUDIT] Échec insertion audit_logs:', e.message);
    }
    (app as any).broadcastEvent?.(
      {
        type: 'audit_log',
        payload: { action, userName, role: user.role, details, timestamp: new Date().toISOString() },
      },
      AUDIT_VIEWER_ROLES
    );
  }

  // ─── Helper cookie ────────────────────────────────────────
  function cookieOptions() {
    return {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: 'lax' as const,
    };
  }

  // ─── Restriction IP ───────────────────────────────────────
  // ALLOWED_IPS=192.168.1.0/24,10.0.0.5  (vide = aucune restriction)
  const ALLOWED_IPS = (process.env.ALLOWED_IPS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  function ipInCidr(ip: string, cidr: string): boolean {
    const cleanIp = ip.replace(/^::ffff:/, '');
    if (!cidr.includes('/')) return cleanIp === cidr;
    const [network, prefix] = cidr.split('/');
    const bits = parseInt(prefix, 10);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    const toNum = (s: string) =>
      s.split('.').reduce((acc, o) => ((acc << 8) | parseInt(o, 10)) >>> 0, 0);
    return (toNum(cleanIp) & mask) === (toNum(network) & mask);
  }

  if (ALLOWED_IPS.length > 0) {
    app.use('/api/', (req, res, next) => {
      const ip = (req.ip || '').replace(/^::ffff:/, '');
      if (ALLOWED_IPS.some(allowed => ipInCidr(ip, allowed))) return next();
      logger.security('IP_BLOCKED', 'high', { ip, path: req.path });
      res.status(403).json({ error: "Accès refusé depuis cette adresse IP." });
    });
  }

  // ─── Validation complexité mot de passe ───────────────────
  function validatePassword(password: string): string | null {
    if (!password || password.length < 8)
      return "Le mot de passe doit contenir au moins 8 caractères.";
    if (!/[A-Z]/.test(password))
      return "Le mot de passe doit contenir au moins une lettre majuscule.";
    if (!/[0-9]/.test(password))
      return "Le mot de passe doit contenir au moins un chiffre.";
    if (!/[^A-Za-z0-9]/.test(password))
      return "Le mot de passe doit contenir au moins un caractère spécial (!@#$…).";
    return null;
  }

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", mode: config.nodeEnv });
  });

  // Auth login
  app.post("/api/auth/login", loginLimiter, async (req, res) => {
    try {
      const validated = loginSchema.parse(req.body);
      const identifier = (validated.username || validated.email || '') as string;

      // ── Blocage serveur (indépendant du client) ──
      const lock = checkLock(identifier);
      if (lock.locked) {
        logger.security('LOGIN_BLOCKED', 'medium', { ip: req.ip, identifier });
        return res.status(429).json({
          error: `Compte temporairement bloqué. Réessayez dans ${lock.remainingSeconds}s.`,
        });
      }

      const result = await AuthService.login(identifier, validated.password);

      recordSuccess(identifier);
      recordAudit('LOGIN_SUCCESS', {
        id: result.user.id, role: result.user.role,
        username: result.user.username, display_name: result.user.displayName,
      }, { username: identifier }, req.ip);

      // Déconnecter toute session SSE existante pour cet utilisateur
      Array.from(sseClients)
        .filter((c: any) => c.userId === result.user.id)
        .forEach((c: any) => {
          try {
            c.res.write(`data: ${JSON.stringify({ type: 'session_replaced' })}\n\n`);
            c.res.end();
          } catch {}
          sseClients.delete(c);
        });

      // Enregistrer le jti de la nouvelle session (identifiant fixe)
      const decodedNew: any = jwt.decode(result.token);
      if (decodedNew?.jti) activeSessions.set(result.user.id, decodedNew.jti);

      res.cookie('auth_token', result.token, cookieOptions());
      res.json({ user: result.user, message: "Connecté avec succès" });
    } catch (e: any) {
      if (e.name === 'ZodError') {
        return res.status(400).json({ error: "Données invalides", details: e.errors });
      }
      const identifier = req.body.username || req.body.email || '';
      recordFailure(identifier);
      const left = remainingAttempts(identifier);
      logger.security('LOGIN_FAILED', 'medium', { ip: req.ip, identifier, attemptsLeft: left });
      res.status(401).json({
        error: "Identifiants invalides",
        attemptsLeft: left,
      });
    }
  });

  // Auth logout
  app.post("/api/auth/logout", (req, res) => {
    const token = req.cookies?.auth_token;
    if (token) {
      const decoded: any = jwt.decode(token);
      if (decoded?.id) {
        activeSessions.delete(decoded.id);
        recordAudit('LOGOUT', { id: decoded.id, role: decoded.role, username: decoded.username }, {}, req.ip);
      }
    }
    res.clearCookie("auth_token", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === 'true',
    });
    res.json({ success: true });
  });

  // Auth refresh
  app.post("/api/auth/refresh", async (req, res) => {
    try {
      const token = req.cookies?.auth_token;
      if (!token) return res.status(401).json({ error: "Non authentifié" });

      let decoded: any;
      try {
        decoded = jwt.verify(token, config.jwtSecret);
      } catch {
        // Token expiré = inactivité > 30 min → reconnexion obligatoire
        return res.status(401).json({ error: "Session expirée après inactivité. Veuillez vous reconnecter." });
      }

      const result = await query(
        "SELECT id, role, email, username, display_name FROM users WHERE id = $1 AND deleted_at IS NULL",
        [decoded.id]
      );
      if (result.rows.length === 0) {
        return res.status(401).json({ error: "Utilisateur introuvable" });
      }

      const user = result.rows[0];
      // Préserver le jti original → la session unique reste cohérente
      const newToken = jwt.sign(
        { id: user.id, username: user.username, role: user.role, jti: decoded.jti },
        config.jwtSecret,
        { expiresIn: "30m" }
      );
      // Pas de mise à jour d'activeSessions : le jti ne change pas

      res.cookie("auth_token", newToken, cookieOptions());
      res.json({
        user: {
          id:          user.id,
          username:    user.username,
          displayName: user.display_name,
          role:        user.role,
        }
      });
    } catch (e) {
      console.error("[Refresh] Erreur:", e);
      res.status(500).json({ error: "Erreur interne" });
    }
  });

  // Equipment - GET
  app.get("/api/equipment", authenticateToken, async (req, res) => {
    try {
      const equipment = await EquipmentService.getAllEquipment();
      const ids = equipment.map(e => e.id);
      const details = await EquipmentService.getEquipmentDetails(ids);

      const merged = equipment.map(e => ({
        ...e,
        id: String(e.id),
        details: details
          .filter(d => String(d.equipment_id) === String(e.id))
          .reduce((acc, curr) => ({ ...acc, [curr.field_key]: curr.field_value }), {})
      }));

      res.json(merged);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Equipment - POST
  app.post("/api/equipment", authenticateToken, async (req: any, res) => {
    try {
      let validated;
      try {
        validated = createEquipmentSchema.parse(req.body);
      } catch (zodErr: any) {
        console.error("[API POST /equipment] ZodError:", JSON.stringify(zodErr.errors, null, 2));
        return res.status(400).json({ error: "Validation échouée", details: zodErr.errors });
      }

      const { category, category_id, zone, zone_id, station, station_id, status, details } = validated;

      const isArmement = (category || "").toLowerCase().match(/armement|arme|armes/);
      const name = (validated.name?.trim()) || (
        isArmement
          ? String(details?.designation || details?.numero_serie || "").trim()
          : String(details?.numero_serie || details?.numero_inventaire || details?.numero_chassis || details?.designation || "").trim()
      ) || "Sans nom";

      if (!name || (name === "Sans nom" && !details)) {
        return res.status(400).json({ error: "Nom ou identifiant obligatoire" });
      }

      const existing = await query(
        "SELECT id FROM equipment WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL",
        [name]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({
          error: `Doublon: "${name}" existe déjà`,
          existing_id: existing.rows[0].id
        });
      }

      let finalCategoryId = category_id || category;
      if (finalCategoryId && !isUUID(finalCategoryId)) {
        const r = await query("SELECT id FROM categories WHERE code = $1 OR label ILIKE $2 LIMIT 1",
          [finalCategoryId, `%${finalCategoryId}%`]);
        finalCategoryId = r.rows[0]?.id || null;
      }

      let finalZoneId = zone_id || zone;
      if (finalZoneId && !isUUID(finalZoneId)) {
        const r = await query("SELECT id FROM zones WHERE name ILIKE $1 LIMIT 1", [finalZoneId]);
        finalZoneId = r.rows[0]?.id || null;
      }

      let finalStationId = station_id || station || null;
      if (finalStationId && !isUUID(finalStationId)) {
        const r = await query("SELECT id FROM stations WHERE name ILIKE $1 LIMIT 1", [finalStationId]);
        finalStationId = r.rows[0]?.id || null;
      }

      const id = await EquipmentService.createEquipment({
        name,
        category_id: finalCategoryId,
        status: status || 'fonctionnel',
        zone_id: finalZoneId,
        station_id: finalStationId,
        created_by: req.user.id,
        details
      });

      recordAudit('EQUIPMENT_CREATED', req.user, { equipmentId: id, equipmentName: name }, req.ip);
      (req.app as any).broadcastEvent?.({ type: 'equipment_created', payload: { id: String(id), name } });
      res.status(201).json({ id: String(id) });
    } catch (e: any) {
      if (e.name === 'ZodError') {
        return res.status(400).json({ error: "Validation échouée", details: e.errors });
      }
      console.error("[API] Equipment POST error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Equipment - PUT
  app.put("/api/equipment/:id", authenticateToken, async (req: any, res) => {
    try {
      const { id } = req.params;
      if (!isUUID(id)) return res.status(400).json({ error: 'ID invalide' });
      const updateSchema = createEquipmentSchema.partial();
      const validated = updateSchema.parse(req.body);
      const { category, category_id, status, zone_id, station_id, details } = validated as any;

      const isArmement = (category || "").toLowerCase().match(/armement|arme|armes/);
      const name = (validated.name?.trim()) || (
        isArmement
          ? String(details?.designation || details?.numero_serie || "").trim()
          : String(details?.numero_serie || details?.numero_inventaire || details?.numero_chassis || details?.designation || "").trim()
      ) || undefined;

      let finalCategoryId = category_id;
      if (finalCategoryId && !isUUID(finalCategoryId)) {
        const r = await query("SELECT id FROM categories WHERE code = $1 OR label ILIKE $2 LIMIT 1",
          [finalCategoryId, `%${finalCategoryId}%`]);
        finalCategoryId = r.rows[0]?.id || null;
      }

      await query(`
        UPDATE equipment SET
          name = COALESCE($1, name),
          category_id = COALESCE($2, category_id),
          status = COALESCE($3, status),
          zone_id = COALESCE($4, zone_id),
          station_id = COALESCE($5, station_id),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $6 AND deleted_at IS NULL
      `, [name || null, finalCategoryId || null, status || null, zone_id || null, station_id || null, id]);

      if (details && Object.keys(details).length > 0) {
        await query("DELETE FROM equipment_details WHERE equipment_id = $1", [id]);
        for (const [key, val] of Object.entries(details)) {
          if (val !== null && val !== undefined && val !== "") {
            await query(
              "INSERT INTO equipment_details (equipment_id, field_key, field_value) VALUES ($1, $2, $3)",
              [id, key, String(val)]
            );
          }
        }
      }

      recordAudit('EQUIPMENT_UPDATED', req.user, { equipmentId: id, equipmentName: name || undefined }, req.ip);
      res.json({ success: true });
    } catch (e: any) {
      if (e.name === 'ZodError') {
        return res.status(400).json({ error: "Validation échouée", details: e.errors });
      }
      console.error("[API] Equipment PUT error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Equipment - DELETE
  app.delete("/api/equipment/:id", authenticateToken, authorize(['admin']), async (req: any, res) => {
    try {
      if (!isUUID(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
      await query("UPDATE equipment SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1", [req.params.id]);
      recordAudit('EQUIPMENT_DELETED', req.user, { equipmentId: req.params.id }, req.ip);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Mouvements PUT — modifier note, référence, dates, destination
  app.put('/api/movements/:id', authenticateToken, async (req: any, res) => {
    const { id } = req.params;
    if (!isUUID(id)) return res.status(400).json({ error: 'ID invalide' });
    const { note, reference, date_deploiement, date_retour_prevue, to_zone_id, to_station_id, new_status } = req.body;
    try {
      await query(`
        UPDATE movements SET
          note               = COALESCE($1, note),
          reference          = COALESCE($2, reference),
          date_deploiement   = COALESCE($3, date_deploiement),
          date_retour_prevue = COALESCE($4, date_retour_prevue),
          to_zone_id         = COALESCE($5, to_zone_id),
          to_station_id      = COALESCE($6, to_station_id),
          new_status         = COALESCE($7, new_status)
        WHERE id = $8
      `, [
        note ?? null,
        reference ?? null,
        date_deploiement ?? null,
        date_retour_prevue ?? null,
        to_zone_id ?? null,
        to_station_id ?? null,
        new_status ?? null,
        id
      ]);
      recordAudit('MOVEMENT_UPDATED', req.user, { movementId: id }, req.ip);
      res.json({ success: true });
    } catch (e: any) {
      console.error('[PUT /api/movements]', e.message);
      res.status(500).json({ error: e.message });
    }
  });
  app.get('/api/movements', authenticateToken, async (req: any, res) => {
    const { equipment_id } = req.query;
    if (equipment_id && !isUUID(String(equipment_id))) {
      return res.status(400).json({ error: 'equipment_id invalide' });
    }
    try {
      const sql = `
        SELECT m.*,
          e.name          AS equipment_name,
          COALESCE(u.display_name, m.performed_by_name, 'Utilisateur supprimé') AS performed_by_name,
          fz.name         AS from_zone_name,
          fs.name         AS from_station_name,
          tz.name         AS to_zone_name,
          ts2.name        AS to_station_name
        FROM movements m
        LEFT JOIN equipment e  ON e.id = m.equipment_id
        LEFT JOIN users    u   ON u.id = m.performed_by AND u.deleted_at IS NULL
        LEFT JOIN zones    fz  ON fz.id = m.from_zone_id
        LEFT JOIN stations fs  ON fs.id = m.from_station_id
        LEFT JOIN zones    tz  ON tz.id = m.to_zone_id
        LEFT JOIN stations ts2 ON ts2.id = m.to_station_id
        ${equipment_id ? 'WHERE m.equipment_id = $1' : ''}
        ORDER BY m.created_at DESC LIMIT 200
      `;
      const { rows } = await query(sql, equipment_id ? [equipment_id] : []);
      res.json(rows);
    } catch (e: any) {
      console.error('[GET /api/movements]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Mouvements POST
  app.post('/api/movements', authenticateToken, async (req: any, res) => {
    const userId = req.user.id;

    let validated: any;
    try {
      validated = createMovementSchema.parse(req.body);
    } catch (zodErr: any) {
      return res.status(400).json({ error: 'Validation échouée', details: zodErr.errors });
    }

    const {
      equipment_id, type, note, reference,
      from_zone_id, from_station_id,
      to_zone_id, to_station_id,
      new_status, date_deploiement, date_retour_prevue,
    } = validated;

    try {
      const { rows: [eq] } = await query(
        'SELECT name, status, zone_id, station_id FROM equipment WHERE id=$1 AND deleted_at IS NULL',
        [equipment_id]
      );
      if (!eq) return res.status(404).json({ error: 'Equipement introuvable' });

      const sourceZoneId = from_zone_id || eq.zone_id;

      if (type === 'transfert') {
        if (!to_zone_id)                          return res.status(400).json({ error: 'Zone obligatoire pour un transfert.' });
        if (to_zone_id !== sourceZoneId)          return res.status(400).json({ error: 'Transfert refusé : zone différente. Utilisez un déploiement.' });
        if (!to_station_id)                       return res.status(400).json({ error: 'Station obligatoire pour un transfert.' });
      }
      if (type === 'retour'      && !to_zone_id)  return res.status(400).json({ error: 'Zone obligatoire pour un retour.' });
      if (type === 'ajustement'  && !new_status)  return res.status(400).json({ error: 'Nouveau statut obligatoire.' });
      if (type === 'deploiement' && !to_zone_id)  return res.status(400).json({ error: 'Zone de déploiement obligatoire.' });

      const updates: Record<string, any> = {
        entree:      { zone_id: to_zone_id, station_id: to_station_id || null },
        sortie:      { zone_id: null, station_id: null, status: 'hors_service' },
        transfert:   { station_id: to_station_id },
        retour:      { zone_id: to_zone_id, station_id: to_station_id || null, status: 'en_reparation' },
        ajustement:  { status: new_status },
        deploiement: { zone_id: to_zone_id, station_id: to_station_id || null },
      };
      const upd = updates[type];
      const setCols = Object.keys(upd).map((k, i) => `${k}=$${i + 2}`).join(', ');
      await query(`UPDATE equipment SET ${setCols}, updated_at=NOW() WHERE id=$1`, [equipment_id, ...Object.values(upd)]);

      const { rows: [mv] } = await query(
        `INSERT INTO movements
          (equipment_id, type, performed_by, performed_by_name, note, reference,
           from_zone_id, from_station_id, to_zone_id, to_station_id,
           previous_status, new_status, date_deploiement, date_retour_prevue)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [
          equipment_id, type, userId,
          req.user.display_name || req.user.username || "Inconnu",
          note || null, reference || null,
          sourceZoneId || null, from_station_id || eq.station_id || null,
          to_zone_id || null, to_station_id || null,
          eq.status, new_status || upd.status || eq.status,
          date_deploiement || null, date_retour_prevue || null,
        ]
      );
      res.status(201).json(mv);

      recordAudit('MOVEMENT_CREATED', req.user, {
        movementId: mv.id, equipmentId: equipment_id, equipmentName: eq.name, movementType: type,
      }, req.ip);

      if (type === 'sortie' || new_status === 'hors_service') {
        (req.app as any).broadcastEvent?.({
          type: 'equipment_critical',
          payload: { equipment_id, movement_type: type, new_status: new_status || upd.status || eq.status }
        });
      }
    } catch (e: any) {
      console.error('[POST /api/movements]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Sortie de stock — Matériel d'exploitation
  app.post('/api/equipment/:id/stock-sortie', authenticateToken, async (req: any, res) => {
    const { id } = req.params;
    const { quantite, note, zone_id, zone_name } = req.body;
    const qty = Number(quantite);
    if (!quantite || isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Quantité invalide (doit être > 0)' });
    }
    if (!zone_id) {
      return res.status(400).json({ error: 'Zone / service de destination obligatoire' });
    }
    try {
      const { rows: [eq] } = await query(
        `SELECT e.id, e.name, e.status, e.zone_id, e.station_id, c.label as category_label
         FROM equipment e LEFT JOIN categories c ON e.category_id = c.id
         WHERE e.id = $1 AND e.deleted_at IS NULL`, [id]
      );
      if (!eq) return res.status(404).json({ error: 'Équipement introuvable' });

      const { rows: detailRows } = await query(
        `SELECT field_key, field_value FROM equipment_details
         WHERE equipment_id = $1 AND field_key IN ('quantite_stock','seuil_alerte','unite')`, [id]
      );
      const det: Record<string, string> = Object.fromEntries(detailRows.map((r: any) => [r.field_key, r.field_value]));

      const currentStock = parseInt(det.quantite_stock || '0', 10);
      const seuilAlerte  = parseInt(det.seuil_alerte  || '0', 10);
      const unite        = det.unite || 'unité(s)';
      const newStock     = Math.max(0, currentStock - qty);

      // Mettre à jour le stock (delete + insert pour éviter les doublons)
      await query(`DELETE FROM equipment_details WHERE equipment_id = $1 AND field_key = 'quantite_stock'`, [id]);
      await query(`INSERT INTO equipment_details (equipment_id, field_key, field_value) VALUES ($1, 'quantite_stock', $2)`, [id, String(newStock)]);
      await query(`UPDATE equipment SET updated_at = NOW() WHERE id = $1`, [id]);

      // Enregistrer le mouvement avec la zone de destination
      const destLabel = zone_name || zone_id;
      await query(
        `INSERT INTO movements (equipment_id, type, performed_by, performed_by_name, note, to_zone_id, previous_status, new_status)
         VALUES ($1, 'sortie', $2, $3, $4, $5, $6, $6)`,
        [id, req.user.id, req.user.display_name || req.user.username || 'Inconnu',
         `Sortie stock : -${qty} ${unite} → ${destLabel}${note ? ' — ' + note : ''}`,
         isUUID(zone_id) ? zone_id : null,
         eq.status]
      );

      recordAudit('STOCK_SORTIE', req.user, {
        equipmentId: id, equipmentName: eq.name, quantite: qty, destination: destLabel, newStock,
      }, req.ip);

      const alerte = seuilAlerte > 0 && newStock <= seuilAlerte;
      if (alerte) {
        (req.app as any).broadcastEvent?.({
          type: 'stock_alerte',
          payload: { equipment_id: id, name: eq.name, new_stock: newStock, seuil: seuilAlerte, unite }
        });
      }

      res.json({ new_stock: newStock, seuil_alerte: seuilAlerte, unite, alerte });
    } catch (e: any) {
      console.error('[POST /api/equipment/:id/stock-sortie]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Historique équipement
  app.get("/api/equipment/:id/history", authenticateToken, async (req: any, res) => {
    try {
      const { id } = req.params;
      if (!isUUID(id)) return res.status(400).json({ error: 'ID invalide' });
      const { rows } = await query(`
        SELECT m.id, m.type, m.note, m.reference,
          m.previous_status, m.new_status,
          m.date_deploiement, m.date_retour_prevue, m.created_at,
          COALESCE(u.display_name, m.performed_by_name, 'Utilisateur supprimé') AS performed_by_name,
          fz.name AS from_zone_name, fs.name AS from_station_name,
          tz.name AS to_zone_name,  ts2.name AS to_station_name
        FROM movements m
        LEFT JOIN users    u   ON u.id  = m.performed_by
        LEFT JOIN zones    fz  ON fz.id = m.from_zone_id
        LEFT JOIN stations fs  ON fs.id = m.from_station_id
        LEFT JOIN zones    tz  ON tz.id = m.to_zone_id
        LEFT JOIN stations ts2 ON ts2.id = m.to_station_id
        WHERE m.equipment_id = $1
        ORDER BY m.created_at DESC LIMIT 100
      `, [id]);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // SSE notifications
  const SSE_MAX_CLIENTS = 100;
  const sseClients = new Set<any>();
  app.get("/api/events", authenticateToken, (req: any, res) => {
    if (sseClients.size >= SSE_MAX_CLIENTS) {
      return res.status(503).json({ error: 'Trop de connexions actives, réessayez plus tard' });
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write("data: {\"type\":\"connected\"}\n\n");

    const client = { res, userId: req.user.id, role: req.user.role };
    sseClients.add(client);
    const keepAlive = setInterval(() => {
      try { res.write(": ping\n\n"); }
      catch { clearInterval(keepAlive); sseClients.delete(client); }
    }, 25000);
    req.on("close", () => { clearInterval(keepAlive); sseClients.delete(client); });
  });

  (app as any).broadcastEvent = (event: { type: string; payload: any }, roles?: string[]) => {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    sseClients.forEach((client: any) => {
      if (roles && !roles.includes(client.role)) return;
      try { client.res.write(data); }
      catch { sseClients.delete(client); }
    });
  };

  // Config
  app.get("/api/config", getConfig);
  app.get("/api/admin/config", authenticateToken, getConfig);
  app.post("/api/admin/config", authenticateToken, authorize(['admin']), async (req: any, res) => {
    try {
      const result = await AdminService.saveConfig(req.body);
      recordAudit('CONFIG_UPDATED', req.user, {
        categories: req.body?.categories?.length,
        zones: req.body?.zones?.length,
        stations: req.body?.stations?.length,
      }, req.ip);
      res.json(result);
    }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Récupération d'urgence : réactive les stations/zones coincées inactives
  app.post("/api/admin/recover", authenticateToken, authorize(['admin']), async (req: any, res) => {
    try {
      const stations = await query(`
        UPDATE stations SET is_active = true
        WHERE is_active = false
          AND zone_id IN (SELECT id FROM zones WHERE is_active = true)
        RETURNING id, name
      `);
      const zones = await query(`
        UPDATE zones SET is_active = true
        WHERE is_active = false
        RETURNING id, name
      `);
      recordAudit('ADMIN_RECOVER', req.user, {
        recoveredStations: stations.rows.length, recoveredZones: zones.rows.length,
      }, req.ip);
      res.json({
        recovered_stations: stations.rows.length,
        recovered_zones: zones.rows.length,
        stations: stations.rows.map((r: any) => r.name),
        zones: zones.rows.map((r: any) => r.name),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Admin Users — lecture ouverte aux superviseurs, écriture admin seulement
  app.get("/api/admin/users", authenticateToken, authorize(['admin', 'chef_service_administratif', 'csph']), async (req, res) => {
    try { res.json(await AdminService.getUsers()); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Utilisateurs connectés — ouvert aux superviseurs
  app.get("/api/admin/users/online", authenticateToken, authorize(['admin', 'chef_service_administratif', 'csph']), (req, res) => {
    const seen = new Set<string>();
    const online = Array.from(sseClients)
      .filter((c: any) => {
        if (seen.has(c.userId)) return false;
        seen.add(c.userId);
        return true;
      })
      .map((c: any) => ({ userId: c.userId, role: c.role }));
    res.json(online);
  });

  app.post("/api/admin/users", authenticateToken, authorize(['admin']), async (req: any, res) => {
    const pwdError = validatePassword(req.body.password);
    if (pwdError) return res.status(400).json({ error: pwdError });
    try {
      const created = await AdminService.createUser(req.body);
      recordAudit('USER_CREATED', req.user, {
        targetUserId: created.id, targetUsername: created.username, targetRole: created.role,
      }, req.ip);
      res.status(201).json(created);
    }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put("/api/admin/users/:id/role", authenticateToken, authorize(['admin']), async (req: any, res) => {
    try {
      const updated = await AdminService.updateUserRole(req.params.id, req.body.role);
      recordAudit('USER_ROLE_UPDATED', req.user, {
        targetUserId: req.params.id, targetUsername: updated.username, newRole: updated.role,
      }, req.ip);
      res.json(updated);
    }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/admin/users/:id", authenticateToken, authorize(['admin']), async (req: any, res) => {
    try {
      await AdminService.deleteUser(req.params.id);
      recordAudit('USER_DELETED', req.user, { targetUserId: req.params.id }, req.ip);
      res.json({ success: true });
    }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put("/api/admin/users/:id/password", authenticateToken, authorize(['admin']), async (req: any, res) => {
    const { newPassword } = req.body;
    if (!newPassword) return res.status(400).json({ error: "Nouveau mot de passe requis" });
    const pwdError = validatePassword(newPassword);
    if (pwdError) return res.status(400).json({ error: pwdError });
    try {
      const resetUser = await AdminService.resetPassword(req.params.id, newPassword);
      recordAudit('USER_PASSWORD_RESET', req.user, {
        targetUserId: req.params.id, targetUsername: resetUser.username,
      }, req.ip);
      res.json({ success: true, user: resetUser });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Erreur serveur" });
    }
  });

  // ── Journal global d'audit — traçabilité complète de toutes les actions ──
  // Accès réservé au chef de bureau (admin) et aux rôles de supervision.
  app.get("/api/admin/audit-logs", authenticateToken, authorize(AUDIT_VIEWER_ROLES), async (req: any, res) => {
    try {
      const page     = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize || '50'), 10) || 50));
      const { action, role, q, from, to } = req.query;

      const conditions: string[] = [];
      const params: any[] = [];

      if (action && action !== 'all') {
        params.push(action);
        conditions.push(`action = $${params.length}`);
      }
      if (role && role !== 'all') {
        params.push(role);
        conditions.push(`role = $${params.length}`);
      }
      if (from) {
        params.push(from);
        conditions.push(`created_at >= $${params.length}`);
      }
      if (to) {
        params.push(to);
        conditions.push(`created_at <= $${params.length}`);
      }
      if (q) {
        params.push(`%${q}%`);
        conditions.push(`(user_name ILIKE $${params.length} OR action ILIKE $${params.length} OR details::text ILIKE $${params.length})`);
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const { rows: countRows } = await query(`SELECT COUNT(*) AS total FROM audit_logs ${where}`, params);
      const total = parseInt(countRows[0]?.total || '0', 10);

      params.push(pageSize, (page - 1) * pageSize);
      const { rows } = await query(
        `SELECT id, action, user_id, user_name, role, details, ip, created_at
         FROM audit_logs ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );

      res.json({ rows, total, page, pageSize });
    } catch (e: any) {
      console.error('[API] audit-logs GET error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Vite / Static
  if (config.nodeEnv === 'production') {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else if (config.nodeEnv !== 'test') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  return app;
}

async function getConfig(req: any, res: any) {
  try {
    res.json(await AdminService.getFullConfig());
  } catch (e: any) {
    console.error("[API] Config Error:", e);
    res.status(500).json({ error: e.message });
  }
}