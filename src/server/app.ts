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
      // En production sur réseau local, accepter toutes les origines du même serveur
      if (config.nodeEnv === 'production') return callback(null, true);
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

  // ─── Helper cookie ────────────────────────────────────────
  function cookieOptions() {
    return {
      httpOnly: true,
      secure: false,        // false car HTTP derrière Nginx sans SSL
      sameSite: 'lax' as const,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
    };
  }

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", mode: config.nodeEnv });
  });

  // Auth login
  app.post("/api/auth/login", loginLimiter, async (req, res) => {
    try {
      const validated = loginSchema.parse(req.body);
      const identifier = validated.username || validated.email;
      const result = await AuthService.login(identifier, validated.password);

      logger.audit('LOGIN_SUCCESS', result.user.id, {
        username: validated.username,
        ip: req.ip
      });

      res.cookie('auth_token', result.token, cookieOptions());
      res.json({ user: result.user, message: "Connecté avec succès" });
    } catch (e: any) {
      logger.security('LOGIN_FAILED', 'medium', {
        ip: req.ip,
        identifier: req.body.email || req.body.username
      });
      res.status(401).json({ error: "Identifiants invalides" });
    }
  });

  // Auth logout
  app.post("/api/auth/logout", (req, res) => {
    res.clearCookie("auth_token", {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
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
      } catch (err: any) {
        if (err.name === "TokenExpiredError") {
          decoded = jwt.decode(token);
          if (!decoded || !decoded.id) {
            return res.status(401).json({ error: "Token invalide" });
          }
          const expiredAt = decoded.exp * 1000;
          if (Date.now() - expiredAt > 7 * 24 * 60 * 60 * 1000) {
            return res.status(401).json({ error: "Session trop ancienne, reconnectez-vous" });
          }
        } else {
          return res.status(401).json({ error: "Token invalide" });
        }
      }

      const result = await query(
        "SELECT id, role, email, username, display_name FROM users WHERE id = $1 AND deleted_at IS NULL",
        [decoded.id]
      );
      if (result.rows.length === 0) {
        return res.status(401).json({ error: "Utilisateur introuvable" });
      }

      const user = result.rows[0];
      const newToken = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        config.jwtSecret,
        { expiresIn: "24h" }
      );

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
        "SELECT id FROM equipment WHERE UPPER(TRIM(name)) = UPPER(TRIM($1)) AND deleted_at IS NULL",
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

      logger.audit('EQUIPMENT_CREATED', req.user.id, { equipmentId: id, equipmentName: name, ip: req.ip });
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
          zone_id = $4,
          station_id = $5,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $6 AND deleted_at IS NULL
      `, [name, finalCategoryId, status, zone_id || null, station_id || null, id]);

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

      logger.audit('EQUIPMENT_UPDATED', req.user.id, { equipmentId: id, ip: req.ip });
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
      await query("UPDATE equipment SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1", [req.params.id]);
      logger.audit('EQUIPMENT_DELETED', req.user.id, { equipmentId: req.params.id, ip: req.ip });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Mouvements GET
  app.get('/api/movements', authenticateToken, async (req: any, res) => {
    const { equipment_id } = req.query;
    try {
      const sql = `
        SELECT m.*,
          e.name          AS equipment_name,
          u.display_name  AS performed_by_name,
          fz.name         AS from_zone_name,
          fs.name         AS from_station_name,
          tz.name         AS to_zone_name,
          ts2.name        AS to_station_name
        FROM movements m
        LEFT JOIN equipment e  ON e.id = m.equipment_id
        LEFT JOIN users    u   ON u.id = m.performed_by
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
    const {
      equipment_id, type, note, reference,
      from_zone_id, from_station_id,
      to_zone_id, to_station_id,
      new_status, date_deploiement, date_retour_prevue,
    } = req.body;

    const ALLOWED = ['entree', 'sortie', 'transfert', 'retour', 'ajustement', 'deploiement'];
    if (!ALLOWED.includes(type)) return res.status(400).json({ error: `Type invalide: ${type}` });
    if (!equipment_id)           return res.status(400).json({ error: 'equipment_id obligatoire' });

    try {
      const { rows: [eq] } = await query(
        'SELECT status, zone_id, station_id FROM equipment WHERE id=$1 AND deleted_at IS NULL',
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
          (equipment_id, type, performed_by, note, reference,
           from_zone_id, from_station_id, to_zone_id, to_station_id,
           previous_status, new_status, date_deploiement, date_retour_prevue)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [
          equipment_id, type, userId,
          note || null, reference || null,
          sourceZoneId || null, from_station_id || eq.station_id || null,
          to_zone_id || null, to_station_id || null,
          eq.status, new_status || upd.status || eq.status,
          date_deploiement || null, date_retour_prevue || null,
        ]
      );
      res.status(201).json(mv);

      if (['sortie', 'hors_service'].includes(type) || new_status === 'hors_service') {
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

  // Historique équipement
  app.get("/api/equipment/:id/history", authenticateToken, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { rows } = await query(`
        SELECT m.id, m.type, m.note, m.reference,
          m.previous_status, m.new_status,
          m.date_deploiement, m.date_retour_prevue, m.created_at,
          u.display_name  AS performed_by_name,
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
  const sseClients = new Set<any>();
  app.get("/api/events", authenticateToken, (req: any, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write("data: {\"type\":\"connected\"}\n\n");

    const client = { res, userId: req.user.id, role: req.user.role };
    sseClients.add(client);
    const keepAlive = setInterval(() => res.write(": ping\n\n"), 25000);
    req.on("close", () => { clearInterval(keepAlive); sseClients.delete(client); });
  });

  (app as any).broadcastEvent = (event: { type: string; payload: any }) => {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    sseClients.forEach((client: any) => { try { client.res.write(data); } catch {} });
  };

  // Config
  app.get("/api/config", getConfig);
  app.get("/api/admin/config", authenticateToken, getConfig);
  app.post("/api/admin/config", authenticateToken, authorize(['admin']), async (req, res) => {
    try { res.json(await AdminService.saveConfig(req.body)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Admin Users
  app.get("/api/admin/users", authenticateToken, authorize(['admin']), async (req, res) => {
    try { res.json(await AdminService.getUsers()); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/users", authenticateToken, authorize(['admin']), async (req, res) => {
    try { res.status(201).json(await AdminService.createUser(req.body)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put("/api/admin/users/:id/role", authenticateToken, authorize(['admin']), async (req, res) => {
    try { res.json(await AdminService.updateUserRole(req.params.id, req.body.role)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/admin/users/:id", authenticateToken, authorize(['admin']), async (req, res) => {
    try { await AdminService.deleteUser(req.params.id); res.json({ success: true }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put("/api/admin/users/:id/password", authenticateToken, authorize(['admin']), async (req, res) => {
    try {
      const { newPassword } = req.body;
      if (!newPassword) return res.status(400).json({ error: "Nouveau mot de passe requis" });
      res.json({ success: true, user: await AdminService.resetPassword(req.params.id, newPassword) });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Erreur serveur" });
    }
  });

  // Vite / Static
  if (config.nodeEnv !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
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