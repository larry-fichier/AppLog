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
import { query, transact } from './db.ts';
import { logger } from './logger.ts';
import {
  loginSchema, createEquipmentSchema, createMovementSchema,
  declareStockSchema, stockDecisionSchema, rejectDecisionSchema, fulfillResupplySchema, confirmResupplySchema,
  declasserSchema, reformerSchema, panneSchema, repareSchema,
} from './schemas.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// ── Détection catégorie "véhicule/rame" par libellé ─────────────
// Fragile (dépend du libellé exact en base) mais cohérent avec la logique
// déjà utilisée côté frontend (RameImporter.tsx, EquipmentDashboard.tsx).
function isVehicleCategory(label: string | null | undefined): boolean {
  const l = (label || '').toLowerCase();
  return l.includes('véhicule') || l.includes('vehicule') || l.includes('rame') || l.includes('automobile');
}
const VEHICLE_CATEGORY_SQL =
  `(c.label ILIKE '%véhicule%' OR c.label ILIKE '%vehicule%' OR c.label ILIKE '%rame%' OR c.label ILIKE '%automobile%')`;

// ── Zone centrale "bureau logistique" : tout équipement fraîchement acquis y
// est placé par défaut avant déploiement en zone. Pour le matériel d'exploitation,
// c'est aussi la zone qui porte l'article "catalogue" de référence (à la place
// de l'ancien zone_id NULL) — chaque zone déclare son propre stock à côté.
const CENTRAL_ZONE_SQL = `(SELECT id FROM zones WHERE name = 'SERVICE_ADMINISTRATIF')`;

// ── Rôles habilités à consulter le Journal global d'audit ──────
// Chef de bureau (admin) + rôles de supervision (CSA, CSPH).
const AUDIT_VIEWER_ROLES = ['admin', 'chef_service_administratif', 'csph'];

// ── Actions dont l'écriture au journal d'audit déclenche AUSSI une
// notification temps réel (cloche) pour AUDIT_VIEWER_ROLES ─────────
// Tout le reste de l'activité (connexions, modifications routinières, actions
// déjà couvertes par un événement SSE dédié comme stock_declaration_created,
// equipment_critical, resupply_needed...) reste tracé dans le journal global
// mais ne pollue plus la cloche de notifications. Liste blanche volontaire :
// seules les actions rares/sensibles ci-dessous méritent une alerte immédiate.
const NOTABLE_AUDIT_ACTIONS = new Set([
  'EQUIPMENT_DELETED',
  'EQUIPMENT_DECLASSE',
  'EQUIPMENT_REFORME',
  'CONFIG_UPDATED',
  'ADMIN_RECOVER',
  'USER_CREATED',
  'USER_ROLE_UPDATED',
  'USER_DELETED',
  'USER_PASSWORD_RESET',
]);

// ── Détection catégorie "stock" (Matériel d'exploitation) par libellé ──
// Même convention fragile que isVehicleCategory — cohérente avec le reste du code.
function isStockCategory(label: string | null | undefined): boolean {
  const l = (label || '').toLowerCase();
  return l.includes('exploitation');
}

// ── Rôles habilités à approuver une déclaration de stock / ravitaillement ──
// chef_bureau OU chef_service_administratif (CSA) suffit — pas de double validation.
// admin inclus par cohérence avec son accès universel ailleurs dans l'app.
const STOCK_APPROVAL_ROLES = ['admin', 'chef_bureau', 'chef_service_administratif'];
// csph a un accès lecture seule (cohérent avec son rôle de supervision existant).
const STOCK_READ_ROLES = [...STOCK_APPROVAL_ROLES, 'csph'];

// ── Notifications temps réel : com_zone est le seul rôle rattaché à une zone
// unique — il ne doit voir que les alertes de sa propre zone. Tous les autres
// rôles opèrent déjà toutes zones confondues (supervision ou gestion centrale),
// donc rien à restreindre pour eux.
const NON_ZONE_ROLES = ['admin', 'agent_logistique', 'chef_bureau', 'chef_ram', 'chef_service_administratif', 'csph'];

// ── Met à jour un champ equipment_details (pattern delete+insert, évite les doublons) ──
async function setEquipmentDetail(q: (text: string, params?: any[]) => Promise<any>, equipmentId: string, key: string, value: string) {
  await q(`DELETE FROM equipment_details WHERE equipment_id = $1 AND field_key = $2`, [equipmentId, key]);
  await q(`INSERT INTO equipment_details (equipment_id, field_key, field_value) VALUES ($1, $2, $3)`, [equipmentId, key, value]);
}

// ── Crée une demande de ravitaillement si aucune n'est déjà ouverte/en cours pour cet équipement ──
async function ensureResupplyRequest(
  q: (text: string, params?: any[]) => Promise<any>,
  opts: { equipmentId: string; zoneId: string | null; currentStock: number; seuilAlerte: number; unite: string | null; triggeredBy: string | null }
) {
  const { equipmentId, zoneId, currentStock, seuilAlerte, unite, triggeredBy } = opts;
  const existing = await q(
    `SELECT id FROM resupply_requests WHERE equipment_id = $1 AND status IN ('open','fulfilled') LIMIT 1`,
    [equipmentId]
  );
  if (existing.rows.length > 0) return null;
  const { rows: [rr] } = await q(
    `INSERT INTO resupply_requests (equipment_id, zone_id, triggered_by, quantity_at_trigger, seuil_alerte, unite)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [equipmentId, zoneId, triggeredBy, currentStock, seuilAlerte, unite]
  );
  return rr;
}

export async function createApp() {
  const app = express();

  // ✅ Trust proxy Nginx
  app.set('trust proxy', 1);

  // ✅ HTTPS Enforcement — uniquement si un vrai proxy SSL transmet x-forwarded-proto
  // if (config.nodeEnv === 'production') {
  //  app.use((req, res, next) => {
  //    const proto = req.header('x-forwarded-proto');
      // Ne rediriger que si le header est explicitement 'http' (proxy SSL actif)
      // et jamais pour les appels API (évite les boucles)
  //    if (proto === 'http' && !req.path.startsWith('/api/')) {
  //      return res.redirect(301, `https://${req.header('host')}${req.url}`);
  //    }
  //    next();
  //  });
 //  }

  // ✅ Security headers avec helmet
  if (config.nodeEnv === 'production') {
    app.use(helmet({
      hsts: false, 
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
          frameAncestors: ["'self'"],
	  upgradeInsecureRequests: null
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
    if (NOTABLE_AUDIT_ACTIONS.has(action)) {
      (app as any).broadcastEvent?.(
        {
          type: 'audit_log',
          payload: { action, userName, role: user.role, details, timestamp: new Date().toISOString() },
        },
        { roles: AUDIT_VIEWER_ROLES, excludeUserId: user.id }
      );
    }
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
        "SELECT id, role, email, username, display_name, zone_id FROM users WHERE id = $1 AND deleted_at IS NULL",
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
          zoneId:      user.zone_id,
        }
      });
    } catch (e) {
      console.error("[Refresh] Erreur:", e);
      res.status(500).json({ error: "Erreur interne" });
    }
  });

  // ── Identité courante réelle (côté cookie) ─────────────────────
  // Ne fait AUCUNE rotation de token, contrairement à /refresh — sert uniquement
  // à ce que le frontend vérifie que l'utilisateur affiché dans cet onglet
  // correspond toujours au cookie auth_token actuel du navigateur. Nécessaire
  // car le cookie est partagé par tous les onglets : si un autre onglet se
  // connecte avec un compte différent, ce cookie est silencieusement remplacé
  // et un onglet resté ouvert continuerait sinon d'agir (côté serveur) sous la
  // nouvelle identité tout en affichant l'ancienne.
  app.get("/api/auth/me", authenticateToken, (req: any, res) => {
    res.json({
      user: {
        id:                  req.user.id,
        username:            req.user.username,
        displayName:         req.user.display_name,
        role:                req.user.role,
        zoneId:              req.user.zone_id,
        mustChangePassword:  req.user.must_change_password === true,
      }
    });
  });

  // Equipment - GET
  app.get("/api/equipment", authenticateToken, async (req: any, res) => {
    try {
      const filter: { zoneId?: string; vehicleOnly?: boolean; hideZoneStock?: boolean } = {};
      if (req.user.role === "com_zone") filter.zoneId = req.user.zone_id;
      if (req.user.role === "chef_ram") filter.vehicleOnly = true;
      // Le parc "central" (tous les rôles sauf com_zone) ne doit pas afficher
      // ni compter les instances de stock d'exploitation propres à chaque zone —
      // seul l'article catalogue (zone_id NULL) y figure.
      if (req.user.role !== "com_zone") filter.hideZoneStock = true;
      const equipment = await EquipmentService.getAllEquipment(filter);
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

      // Numéro de châssis = identifiant unique pour les véhicules (dédoublonnage prioritaire
      // sur le nom, qui peut varier — immatriculation, désignation commerciale, etc.)
      const numeroChassis = String(details?.numero_chassis || "").trim();
      if (numeroChassis) {
        const chassisExisting = await query(
          `SELECT e.id, e.name FROM equipment e
           JOIN equipment_details ed ON ed.equipment_id = e.id
           WHERE ed.field_key = 'numero_chassis' AND LOWER(ed.field_value) = LOWER($1) AND e.deleted_at IS NULL
           LIMIT 1`,
          [numeroChassis]
        );
        if (chassisExisting.rows.length > 0) {
          return res.status(409).json({
            error: `Doublon: le véhicule "${chassisExisting.rows[0].name}" a déjà le numéro de châssis "${numeroChassis}"`,
            existing_id: chassisExisting.rows[0].id
          });
        }
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

      // ── Autorisation par rôle ────────────────────────────────
      let targetCategoryLabel: string | null = null;
      if (finalCategoryId) {
        const catRes = await query("SELECT label FROM categories WHERE id = $1", [finalCategoryId]);
        targetCategoryLabel = catRes.rows[0]?.label || null;
      }

      // Tout nouvel équipement est d'abord acquis par la logistique avant
      // déploiement en zone : sans zone précisée, il est placé au service
      // administratif (bureau logistique) — au magasin pour le matériel
      // d'exploitation, au bureau logistique pour le reste (y compris les
      // véhicules pas encore déployés). Ne s'applique pas au com_zone, dont
      // l'équipement reste toujours scopé à sa propre zone.
      if (!finalZoneId && req.user.role !== 'com_zone') {
        const { rows: [svcZone] } = await query(`SELECT id FROM zones WHERE name = 'SERVICE_ADMINISTRATIF' LIMIT 1`);
        if (svcZone) {
          finalZoneId = svcZone.id;
          if (!finalStationId) {
            const stationName = isStockCategory(targetCategoryLabel) ? 'MAGASIN' : 'BLOG';
            const { rows: [defStation] } = await query(
              `SELECT id FROM stations WHERE zone_id = $1 AND name = $2 LIMIT 1`,
              [svcZone.id, stationName]
            );
            finalStationId = defStation?.id || null;
          }
        }
      }

      const isVehicle = isVehicleCategory(targetCategoryLabel);
      const userRole = req.user.role;
      const canWrite =
        userRole === "admin" ||
        userRole === "chef_bureau" ||
        userRole === "agent_logistique" ||
        (userRole === "chef_ram" && isVehicle) ||
        (userRole === "com_zone" && !isVehicle && finalZoneId === req.user.zone_id);

      if (!canWrite) {
        return res.status(403).json({ error: "Action non autorisée" });
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
      (req.app as any).broadcastEvent?.({ type: 'equipment_created', payload: { id: String(id), name } }, { roles: NON_ZONE_ROLES, excludeUserId: req.user.id });
      if (finalZoneId) {
        (req.app as any).broadcastEvent?.({ type: 'equipment_created', payload: { id: String(id), name } }, { roles: ['com_zone'], zoneId: finalZoneId, excludeUserId: req.user.id });
      }
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

      const { rows: [existing] } = await query(
        `SELECT e.category_id, e.zone_id, c.label AS category_label
         FROM equipment e LEFT JOIN categories c ON c.id = e.category_id
         WHERE e.id = $1 AND e.deleted_at IS NULL`,
        [id]
      );
      if (!existing) return res.status(404).json({ error: 'Équipement introuvable' });

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

      // ── Autorisation par rôle — basée sur la zone/catégorie ACTUELLES de
      // l'équipement, jamais sur les valeurs envoyées dans le body (sinon un
      // com_zone pourrait contourner la restriction en changeant lui-même
      // la zone dans sa requête).
      let targetCategoryLabel = existing.category_label;
      if (finalCategoryId && finalCategoryId !== existing.category_id) {
        const catRes = await query("SELECT label FROM categories WHERE id = $1", [finalCategoryId]);
        targetCategoryLabel = catRes.rows[0]?.label || targetCategoryLabel;
      }
      const isVehicle = isVehicleCategory(targetCategoryLabel);
      const userRole = req.user.role;
      const canWrite =
        userRole === "admin" ||
        userRole === "chef_bureau" ||
        userRole === "agent_logistique" ||
        (userRole === "chef_ram" && isVehicle) ||
        (userRole === "com_zone" && !isVehicle && existing.zone_id === req.user.zone_id);

      if (!canWrite) {
        return res.status(403).json({ error: "Action non autorisée" });
      }

      // ── Anti-doublon, comme à la création — sans ça, on pouvait créer un
      // équipement avec un nom/châssis provisoire unique puis le modifier pour
      // qu'il coïncide avec un équipement existant, sans aucun garde-fou.
      const numeroChassisUpdate = String(details?.numero_chassis || "").trim();
      if (numeroChassisUpdate) {
        const chassisExisting = await query(
          `SELECT e.id, e.name FROM equipment e
           JOIN equipment_details ed ON ed.equipment_id = e.id
           WHERE ed.field_key = 'numero_chassis' AND LOWER(ed.field_value) = LOWER($1)
             AND e.deleted_at IS NULL AND e.id != $2
           LIMIT 1`,
          [numeroChassisUpdate, id]
        );
        if (chassisExisting.rows.length > 0) {
          return res.status(409).json({
            error: `Doublon: le véhicule "${chassisExisting.rows[0].name}" a déjà le numéro de châssis "${numeroChassisUpdate}"`,
            existing_id: chassisExisting.rows[0].id
          });
        }
      }
      if (name) {
        const nameExisting = await query(
          "SELECT id FROM equipment WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL AND id != $2",
          [name, id]
        );
        if (nameExisting.rows.length > 0) {
          return res.status(409).json({
            error: `Doublon: "${name}" existe déjà`,
            existing_id: nameExisting.rows[0].id
          });
        }
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
  app.delete("/api/equipment/:id", authenticateToken, async (req: any, res) => {
    try {
      if (!isUUID(req.params.id)) return res.status(400).json({ error: 'ID invalide' });

      const { rows: [existing] } = await query(
        `SELECT c.label AS category_label
         FROM equipment e LEFT JOIN categories c ON c.id = e.category_id
         WHERE e.id = $1 AND e.deleted_at IS NULL`,
        [req.params.id]
      );
      if (!existing) return res.status(404).json({ error: 'Équipement introuvable' });

      const authorized =
        req.user.role === "admin" ||
        (req.user.role === "chef_ram" && isVehicleCategory(existing.category_label));
      if (!authorized) return res.status(403).json({ error: "Action non autorisée" });

      await query("UPDATE equipment SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1", [req.params.id]);
      recordAudit('EQUIPMENT_DELETED', req.user, { equipmentId: req.params.id }, req.ip);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Déclaration de panne — droit limité au changement de statut, distinct de
  // PUT /api/equipment/:id pour ne jamais donner à com_zone un accès en écriture
  // à la fiche complète du véhicule.
  app.post("/api/equipment/:id/panne", authenticateToken, async (req: any, res) => {
    try {
      const { id } = req.params;
      if (!isUUID(id)) return res.status(400).json({ error: 'ID invalide' });

      let validated: any;
      try { validated = panneSchema.parse(req.body || {}); }
      catch (zodErr: any) { return res.status(400).json({ error: 'Validation échouée', details: zodErr.errors }); }

      const equipRes = await query(
        `SELECT e.name, e.zone_id, e.status, c.label AS category_label
         FROM equipment e
         JOIN categories c ON c.id = e.category_id
         WHERE e.id = $1 AND e.deleted_at IS NULL`,
        [id]
      );
      if (equipRes.rows.length === 0) {
        return res.status(404).json({ error: "Équipement introuvable" });
      }
      const equip = equipRes.rows[0];
      const isVehicle = isVehicleCategory(equip.category_label);

      const userRole = req.user.role;
      const authorized =
        userRole === "admin" ||
        userRole === "chef_ram" ||
        (userRole === "com_zone" && isVehicle && equip.zone_id === req.user.zone_id);

      if (!authorized) {
        return res.status(403).json({ error: "Action non autorisée" });
      }

      await query(
        `UPDATE equipment SET status = 'en_reparation', updated_at = NOW() WHERE id = $1`,
        [id]
      );

      await query(
        `INSERT INTO movements (equipment_id, type, performed_by, performed_by_name, previous_status, new_status, note)
         VALUES ($1, 'ajustement', $2, $3, $4, 'en_reparation', $5)`,
        [id, req.user.id, req.user.display_name || req.user.username || 'Inconnu', equip.status,
         `Déclaration de panne : ${validated.description}`]
      );

      recordAudit('EQUIPMENT_PANNE_DECLAREE', req.user, {
        equipmentId: id, equipmentName: equip.name, description: validated.description,
      }, req.ip);
      const panneEvent = {
        type: 'equipment_critical',
        payload: {
          equipment_id: id, movement_type: 'ajustement', new_status: 'en_reparation',
          message: `"${equip.name}" en panne — ${validated.description}`,
        }
      };
      (req.app as any).broadcastEvent?.(panneEvent, { roles: NON_ZONE_ROLES, excludeUserId: req.user.id });
      if (equip.zone_id) {
        (req.app as any).broadcastEvent?.(panneEvent, { roles: ['com_zone'], zoneId: equip.zone_id, excludeUserId: req.user.id });
      }

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Déclaration de réparation — pendant symétrique de /panne : ramène le
  // véhicule au statut fonctionnel et prévient les rôles de supervision.
  app.post("/api/equipment/:id/repare", authenticateToken, async (req: any, res) => {
    try {
      const { id } = req.params;
      if (!isUUID(id)) return res.status(400).json({ error: 'ID invalide' });

      let validated: any;
      try { validated = repareSchema.parse(req.body || {}); }
      catch (zodErr: any) { return res.status(400).json({ error: 'Validation échouée', details: zodErr.errors }); }

      const equipRes = await query(
        `SELECT e.name, e.zone_id, e.status, c.label AS category_label
         FROM equipment e
         JOIN categories c ON c.id = e.category_id
         WHERE e.id = $1 AND e.deleted_at IS NULL`,
        [id]
      );
      if (equipRes.rows.length === 0) {
        return res.status(404).json({ error: "Équipement introuvable" });
      }
      const equip = equipRes.rows[0];
      const isVehicle = isVehicleCategory(equip.category_label);

      if (!['en_reparation', 'hors_service'].includes(equip.status)) {
        return res.status(409).json({ error: "Ce véhicule n'est pas en panne / hors service" });
      }

      const userRole = req.user.role;
      const authorized =
        userRole === "admin" ||
        userRole === "chef_ram" ||
        (userRole === "com_zone" && isVehicle && equip.zone_id === req.user.zone_id);

      if (!authorized) {
        return res.status(403).json({ error: "Action non autorisée" });
      }

      await query(
        `UPDATE equipment SET status = 'fonctionnel', updated_at = NOW() WHERE id = $1`,
        [id]
      );

      await query(
        `INSERT INTO movements (equipment_id, type, performed_by, performed_by_name, previous_status, new_status, note)
         VALUES ($1, 'ajustement', $2, $3, $4, 'fonctionnel', $5)`,
        [id, req.user.id, req.user.display_name || req.user.username || 'Inconnu', equip.status,
         validated.note ? `Réparation confirmée : ${validated.note}` : 'Réparation confirmée']
      );

      recordAudit('EQUIPMENT_REPARATION_DECLAREE', req.user, {
        equipmentId: id, equipmentName: equip.name, note: validated.note,
      }, req.ip);
      const repareEvent = {
        type: 'equipment_repaired',
        payload: {
          equipment_id: id,
          message: `"${equip.name}" réparé — de retour en service${validated.note ? ` (${validated.note})` : ''}`,
        }
      };
      (req.app as any).broadcastEvent?.(repareEvent, { roles: NON_ZONE_ROLES, excludeUserId: req.user.id });
      if (equip.zone_id) {
        (req.app as any).broadcastEvent?.(repareEvent, { roles: ['com_zone'], zoneId: equip.zone_id, excludeUserId: req.user.id });
      }

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Déclassement d'un équipement (matériel général, hors service définitif) ──
  // Reste ACTIF/visible dans l'inventaire (pas de soft-delete) : le but est de
  // pouvoir le retrouver comme source de pièces détachées pour dépanner d'autres
  // équipements. Distinct de la réforme (véhicules), qui elle sort du parc actif.
  app.post("/api/equipment/:id/declasser", authenticateToken, async (req: any, res) => {
    const { id } = req.params;
    if (!isUUID(id)) return res.status(400).json({ error: 'ID invalide' });
    let validated: any;
    try { validated = declasserSchema.parse(req.body || {}); }
    catch (zodErr: any) { return res.status(400).json({ error: 'Validation échouée', details: zodErr.errors }); }

    try {
      const { rows: [equip] } = await query(
        `SELECT e.zone_id, e.status, c.label AS category_label
         FROM equipment e JOIN categories c ON c.id = e.category_id
         WHERE e.id = $1 AND e.deleted_at IS NULL`,
        [id]
      );
      if (!equip) return res.status(404).json({ error: 'Équipement introuvable' });
      if (isVehicleCategory(equip.category_label)) {
        return res.status(400).json({ error: 'Les véhicules se réforment, ils ne se déclassent pas' });
      }
      if (isStockCategory(equip.category_label)) {
        return res.status(400).json({ error: "Le matériel d'exploitation se gère par sortie/entrée de stock, pas par déclassement" });
      }
      if (equip.status === 'declasse') {
        return res.status(409).json({ error: 'Cet équipement est déjà déclassé' });
      }

      const userRole = req.user.role;
      const authorized =
        userRole === "admin" ||
        userRole === "chef_bureau" ||
        userRole === "agent_logistique" ||
        (userRole === "com_zone" && equip.zone_id === req.user.zone_id);
      if (!authorized) return res.status(403).json({ error: "Action non autorisée" });

      await query(`UPDATE equipment SET status = 'declasse', updated_at = NOW() WHERE id = $1`, [id]);
      await query(
        `INSERT INTO movements (equipment_id, type, performed_by, performed_by_name, previous_status, new_status, note)
         VALUES ($1, 'ajustement', $2, $3, $4, 'declasse', $5)`,
        [id, req.user.id, req.user.display_name || req.user.username || 'Inconnu', equip.status,
         `Déclassé — pièces récupérables${validated.note ? ' — ' + validated.note : ''}`]
      );

      recordAudit('EQUIPMENT_DECLASSE', req.user, { equipmentId: id, note: validated.note || undefined }, req.ip);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Réforme d'un véhicule (remis à un ancien personnel) ────────────────
  // Sort du parc actif (soft-delete) : seule la traçabilité (mouvements, audit)
  // est conservée, cohérent avec le reste de l'app où deleted_at exclut des
  // listings actifs sans effacer l'historique.
  app.post("/api/equipment/:id/reformer", authenticateToken, async (req: any, res) => {
    const { id } = req.params;
    if (!isUUID(id)) return res.status(400).json({ error: 'ID invalide' });
    let validated: any;
    try { validated = reformerSchema.parse(req.body || {}); }
    catch (zodErr: any) { return res.status(400).json({ error: 'Validation échouée', details: zodErr.errors }); }

    try {
      const { rows: [equip] } = await query(
        `SELECT e.status, c.label AS category_label
         FROM equipment e JOIN categories c ON c.id = e.category_id
         WHERE e.id = $1 AND e.deleted_at IS NULL`,
        [id]
      );
      if (!equip) return res.status(404).json({ error: 'Équipement introuvable' });
      if (!isVehicleCategory(equip.category_label)) {
        return res.status(400).json({ error: 'Seuls les véhicules peuvent être réformés' });
      }

      const authorized = req.user.role === "admin" || req.user.role === "chef_ram";
      if (!authorized) return res.status(403).json({ error: "Action non autorisée" });

      await query(
        `UPDATE equipment SET status = 'reforme', deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [id]
      );
      await query(
        `INSERT INTO movements (equipment_id, type, performed_by, performed_by_name, previous_status, new_status, note)
         VALUES ($1, 'ajustement', $2, $3, $4, 'reforme', $5)`,
        [id, req.user.id, req.user.display_name || req.user.username || 'Inconnu', equip.status,
         `Réformé — remis à ${validated.recipient}${validated.note ? ' — ' + validated.note : ''}`]
      );

      recordAudit('EQUIPMENT_REFORME', req.user, { equipmentId: id, recipient: validated.recipient, note: validated.note || undefined }, req.ip);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Liste des véhicules réformés — seule fenêtre restante sur ces véhicules
  // une fois sortis du parc actif (deleted_at exclut equipment/history normaux).
  app.get("/api/equipment/reformed", authenticateToken, async (req: any, res) => {
    if (!["admin", "chef_ram"].includes(req.user.role)) {
      return res.status(403).json({ error: "Action non autorisée" });
    }
    try {
      // Le destinataire/note structurés viennent de audit_logs.details (JSONB) —
      // plus fiable que de re-parser le texte libre de movements.note.
      const { rows } = await query(`
        SELECT e.id, e.name, e.updated_at,
          al.details->>'recipient' AS recipient,
          al.details->>'note' AS note,
          al.created_at AS reformed_at,
          al.user_name AS reformed_by_name
        FROM equipment e
        JOIN categories c ON c.id = e.category_id
        LEFT JOIN LATERAL (
          SELECT details, created_at, user_name
          FROM audit_logs
          WHERE action = 'EQUIPMENT_REFORME' AND details->>'equipmentId' = e.id::text
          ORDER BY created_at DESC LIMIT 1
        ) al ON true
        WHERE e.status = 'reforme' AND e.deleted_at IS NOT NULL AND ${VEHICLE_CATEGORY_SQL}
        ORDER BY al.created_at DESC NULLS LAST
      `);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Mouvements PUT — modifier note, référence, dates, destination
  app.put('/api/movements/:id', authenticateToken, async (req: any, res) => {
    const { id } = req.params;
    if (!isUUID(id)) return res.status(400).json({ error: 'ID invalide' });
    // ⚠️ Restriction a minima en attendant l'arbitrage du workflow d'approbation
    // (voir §5.1 de la spec) — à revoir dès qu'il sera tranché.
    if (!["admin", "chef_bureau", "agent_logistique", "com_zone"].includes(req.user.role)) {
      return res.status(403).json({ error: "Action non autorisée" });
    }
    const { note, reference, date_deploiement, date_retour_prevue, to_zone_id, to_station_id, new_status } = req.body;
    try {
      // ── COM Zone : ne peut modifier que les mouvements de sa propre zone, et
      // ne peut pas déplacer la destination hors de sa zone ──
      if (req.user.role === 'com_zone') {
        if (!req.user.zone_id) return res.status(400).json({ error: "Aucune zone assignée à ce compte" });
        const { rows: [mv] } = await query(
          `SELECT e.zone_id AS equipment_zone_id
           FROM movements m LEFT JOIN equipment e ON e.id = m.equipment_id
           WHERE m.id = $1`,
          [id]
        );
        if (!mv) return res.status(404).json({ error: 'Mouvement introuvable' });
        if (mv.equipment_zone_id !== req.user.zone_id) {
          return res.status(403).json({ error: "Ce mouvement ne concerne pas votre zone" });
        }
        if (to_zone_id && to_zone_id !== req.user.zone_id) {
          return res.status(403).json({ error: "Destination refusée : hors de votre zone" });
        }
      }

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
    const { equipment_id, status, from, to } = req.query;
    if (equipment_id && !isUUID(String(equipment_id))) {
      return res.status(400).json({ error: 'equipment_id invalide' });
    }
    if ((from && isNaN(Date.parse(String(from)))) || (to && isNaN(Date.parse(String(to))))) {
      return res.status(400).json({ error: 'Période (from/to) invalide' });
    }
    try {
      const conditions: string[] = [];
      const params: any[] = [];
      if (status && status !== 'all') {
        params.push(status);
        conditions.push(`m.status = $${params.length}`);
      }
      if (equipment_id) {
        params.push(equipment_id);
        conditions.push(`m.equipment_id = $${params.length}`);
      }
      // Période — utilisée pour le rapport « état des entrées/sorties » ;
      // sans borne, on garde le comportement historique (200 plus récents).
      if (from) {
        params.push(String(from));
        conditions.push(`m.created_at >= $${params.length}::timestamp`);
      }
      if (to) {
        params.push(String(to));
        conditions.push(`m.created_at < ($${params.length}::timestamp + INTERVAL '1 day')`);
      }
      if (req.user.role === "com_zone") {
        // Mouvements effectués dans sa zone (origine ou destination) — pas seulement
        // ceux des équipements actuellement dans sa zone, pour ne pas perdre
        // l'historique d'un équipement depuis transféré ailleurs.
        params.push(req.user.zone_id);
        conditions.push(`(m.from_zone_id = $${params.length} OR m.to_zone_id = $${params.length})`);
      } else if (req.user.role === "chef_ram") {
        conditions.push(VEHICLE_CATEGORY_SQL);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

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
        LEFT JOIN categories c ON c.id = e.category_id
        LEFT JOIN users    u   ON u.id = m.performed_by AND u.deleted_at IS NULL
        LEFT JOIN zones    fz  ON fz.id = m.from_zone_id
        LEFT JOIN stations fs  ON fs.id = m.from_station_id
        LEFT JOIN zones    tz  ON tz.id = m.to_zone_id
        LEFT JOIN stations ts2 ON ts2.id = m.to_station_id
        ${where}
        ORDER BY m.created_at DESC LIMIT ${from || to ? 5000 : 200}
      `;
      const { rows } = await query(sql, params);
      res.json(rows);
    } catch (e: any) {
      console.error('[GET /api/movements]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Mouvements POST
  app.post('/api/movements', authenticateToken, async (req: any, res) => {
    const userId = req.user.id;

    // ⚠️ Restriction a minima en attendant l'arbitrage du workflow d'approbation
    // (voir §5.1 de la spec) — à revoir dès qu'il sera tranché.
    if (!["admin", "chef_bureau", "agent_logistique", "com_zone"].includes(req.user.role)) {
      return res.status(403).json({ error: "Action non autorisée" });
    }

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

      // ── COM Zone : uniquement des transferts entre stations de sa propre
      // zone, et toujours en attente d'approbation (chef_bureau / CSA) ──
      if (req.user.role === 'com_zone') {
        if (!req.user.zone_id) return res.status(400).json({ error: "Aucune zone assignée à ce compte" });
        if (type !== 'transfert') {
          return res.status(403).json({ error: "Seul le transfert entre stations de votre zone est autorisé." });
        }
        if (sourceZoneId !== req.user.zone_id) {
          return res.status(403).json({ error: "Cet équipement n'appartient pas à votre zone" });
        }
        if (to_zone_id && to_zone_id !== req.user.zone_id) {
          return res.status(403).json({ error: "Destination refusée : hors de votre zone" });
        }
      }

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

      // ── COM Zone : le transfert part en attente — l'équipement n'est mis à
      // jour qu'à l'approbation (chef_bureau / CSA), voir /api/movements/:id/approve ──
      if (req.user.role === 'com_zone') {
        const { rows: [mv] } = await query(
          `INSERT INTO movements
            (equipment_id, type, performed_by, performed_by_name, note, reference,
             from_zone_id, from_station_id, to_zone_id, to_station_id,
             previous_status, new_status, date_deploiement, date_retour_prevue, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending') RETURNING *`,
          [
            equipment_id, type, userId,
            req.user.display_name || req.user.username || "Inconnu",
            note || null, reference || null,
            sourceZoneId || null, from_station_id || eq.station_id || null,
            to_zone_id || null, to_station_id || null,
            eq.status, eq.status,
            date_deploiement || null, date_retour_prevue || null,
          ]
        );
        res.status(201).json(mv);

        recordAudit('MOVEMENT_TRANSFER_REQUESTED', req.user, {
          movementId: mv.id, equipmentId: equipment_id, equipmentName: eq.name,
        }, req.ip);
        (req.app as any).broadcastEvent?.({
          type: 'movement_transfer_requested',
          payload: { movementId: mv.id, equipmentId: equipment_id, equipmentName: eq.name, toStationId: to_station_id }
        }, STOCK_APPROVAL_ROLES);
        return;
      }

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
        const criticalEvent = {
          type: 'equipment_critical',
          payload: {
            equipment_id, movement_type: type, new_status: new_status || upd.status || eq.status,
            message: type === 'sortie'
              ? `"${eq.name}" sorti du parc actif`
              : `"${eq.name}" passé hors service`,
          }
        };
        (req.app as any).broadcastEvent?.(criticalEvent, { roles: NON_ZONE_ROLES, excludeUserId: req.user.id });
        if (sourceZoneId) {
          (req.app as any).broadcastEvent?.(criticalEvent, { roles: ['com_zone'], zoneId: sourceZoneId, excludeUserId: req.user.id });
        }
      }
    } catch (e: any) {
      console.error('[POST /api/movements]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Approbation d'un transfert COM Zone ──────────────────────────
  // Applique le changement de station à l'équipement, seulement maintenant.
  app.post('/api/movements/:id/approve', authenticateToken, authorize(STOCK_APPROVAL_ROLES), async (req: any, res) => {
    const { id } = req.params;
    if (!isUUID(id)) return res.status(400).json({ error: 'ID invalide' });
    let validated: any;
    try { validated = stockDecisionSchema.parse(req.body || {}); }
    catch (zodErr: any) { return res.status(400).json({ error: 'Validation échouée', details: zodErr.errors }); }

    try {
      let mv: any = null;
      let eqName: string | null = null;

      await transact(async (q) => {
        const { rows: [m] } = await q(`SELECT * FROM movements WHERE id = $1`, [id]);
        if (!m) throw Object.assign(new Error('Mouvement introuvable'), { status: 404 });
        if (m.status !== 'pending') throw Object.assign(new Error('Mouvement déjà traité'), { status: 409 });
        if (m.type !== 'transfert') throw Object.assign(new Error('Seuls les transferts sont soumis à approbation'), { status: 400 });

        const { rows: [eq] } = await q(`SELECT id, name, station_id FROM equipment WHERE id = $1`, [m.equipment_id]);
        if (!eq) throw Object.assign(new Error('Équipement introuvable'), { status: 404 });
        eqName = eq.name;

        await q(`UPDATE equipment SET station_id = $1, updated_at = NOW() WHERE id = $2`, [m.to_station_id, m.equipment_id]);

        const { rows: [updated] } = await q(
          `UPDATE movements
           SET status='approved', decided_by=$1, decided_by_name=$2, decision_note=$3, decided_at=NOW()
           WHERE id=$4 RETURNING *`,
          [req.user.id, req.user.display_name || req.user.username || 'Inconnu', validated.note || null, id]
        );
        mv = updated;
      });

      recordAudit('MOVEMENT_TRANSFER_APPROVED', req.user, { movementId: id, equipmentId: mv.equipment_id }, req.ip);
      (req.app as any).broadcastEvent?.({
        type: 'movement_transfer_approved',
        payload: { movementId: id, equipmentId: mv.equipment_id, equipmentName: eqName }
      }, { roles: ['com_zone'], zoneId: mv.from_zone_id });

      res.json({ success: true, movement: mv });
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // ── Rejet d'un transfert COM Zone ─────────────────────────────────
  app.post('/api/movements/:id/reject', authenticateToken, authorize(STOCK_APPROVAL_ROLES), async (req: any, res) => {
    const { id } = req.params;
    if (!isUUID(id)) return res.status(400).json({ error: 'ID invalide' });
    let validated: any;
    try { validated = rejectDecisionSchema.parse(req.body || {}); }
    catch (zodErr: any) { return res.status(400).json({ error: 'Validation échouée', details: zodErr.errors }); }

    try {
      const { rows: [m] } = await query(`SELECT * FROM movements WHERE id = $1`, [id]);
      if (!m) return res.status(404).json({ error: 'Mouvement introuvable' });
      if (m.status !== 'pending') return res.status(409).json({ error: 'Mouvement déjà traité' });

      const { rows: [updated] } = await query(
        `UPDATE movements
         SET status='rejected', decided_by=$1, decided_by_name=$2, decision_note=$3, decided_at=NOW()
         WHERE id=$4 RETURNING *`,
        [req.user.id, req.user.display_name || req.user.username || 'Inconnu', validated.note, id]
      );

      recordAudit('MOVEMENT_TRANSFER_REJECTED', req.user, { movementId: id, equipmentId: m.equipment_id, reason: validated.note }, req.ip);
      (req.app as any).broadcastEvent?.({
        type: 'movement_transfer_rejected',
        payload: { movementId: id, equipmentId: m.equipment_id, reason: validated.note }
      }, { roles: ['com_zone'], zoneId: m.from_zone_id });

      res.json({ success: true, movement: updated });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Sortie de stock — Matériel d'exploitation
  app.post('/api/equipment/:id/stock-sortie', authenticateToken, async (req: any, res) => {
    if (!["admin", "chef_bureau", "agent_logistique"].includes(req.user.role)) {
      return res.status(403).json({ error: "Action non autorisée" });
    }
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

      // ── Suivi côté zone destinataire : la sortie vers une vraie zone crée
      // directement un ravitaillement "fulfilled" (chef_bureau vient de l'envoyer),
      // pour que le com_zone le voie dans "Ravitaillements" et confirme réception
      // à l'arrivée du matériel — même mécanisme que le flux déclenché par un
      // stock bas, mais sans étape d'approbation puisque l'envoi est déjà fait.
      if (isUUID(zone_id)) {
        let { rows: [zoneEquip] } = await query(
          `SELECT id FROM equipment
           WHERE zone_id = $1 AND category_id = (SELECT category_id FROM equipment WHERE id = $2) AND LOWER(name) = LOWER($3) AND deleted_at IS NULL`,
          [zone_id, id, eq.name]
        );
        if (!zoneEquip) {
          const { rows: catalogDetailRows } = await query(
            `SELECT field_key, field_value FROM equipment_details
             WHERE equipment_id = $1 AND field_key IN ('unite','seuil_alerte','type_consommable')`,
            [id]
          );
          const catalogDetails: Record<string, string> = Object.fromEntries(
            catalogDetailRows.map((r: any) => [r.field_key, r.field_value])
          );
          const { rows: [catRow] } = await query(`SELECT category_id FROM equipment WHERE id = $1`, [id]);
          const newZoneId = await EquipmentService.createEquipment({
            name: eq.name,
            category_id: catRow.category_id,
            status: 'fonctionnel',
            zone_id,
            station_id: null,
            created_by: req.user.id,
            details: Object.keys(catalogDetails).length ? catalogDetails : undefined,
          });
          zoneEquip = { id: newZoneId };
          recordAudit('EQUIPMENT_CREATED', req.user, { equipmentId: newZoneId, equipmentName: eq.name }, req.ip);
        }

        const { rows: zoneDetailRows } = await query(
          `SELECT field_value FROM equipment_details WHERE equipment_id = $1 AND field_key = 'quantite_stock'`,
          [zoneEquip.id]
        );
        const zoneCurrentStock = parseInt(zoneDetailRows[0]?.field_value || '0', 10);

        const performerName = req.user.display_name || req.user.username || 'Inconnu';
        const { rows: [rr] } = await query(
          `INSERT INTO resupply_requests
            (equipment_id, zone_id, triggered_by, quantity_at_trigger, seuil_alerte, unite,
             status, fulfilled_by, fulfilled_by_name, fulfilled_at, fulfilled_quantity, fulfillment_note)
           VALUES ($1,$2,$3,$4,$5,$6,'fulfilled',$3,$7,NOW(),$8,$9) RETURNING *`,
          [zoneEquip.id, zone_id, req.user.id, zoneCurrentStock, seuilAlerte, unite, performerName, qty, note || null]
        );

        recordAudit('RESUPPLY_FULFILLED', req.user, {
          requestId: rr.id, equipmentId: zoneEquip.id, equipmentName: eq.name, zoneId: zone_id, quantity: qty,
        }, req.ip);
        (req.app as any).broadcastEvent?.({
          type: 'resupply_fulfilled',
          payload: { requestId: rr.id, equipmentId: zoneEquip.id, equipmentName: eq.name, quantity: qty, unite }
        }, { roles: ['com_zone'], zoneId: zone_id, excludeUserId: req.user.id });
      }

      const alerte = seuilAlerte > 0 && newStock <= seuilAlerte;
      if (alerte) {
        // Alerte sur le stock central (chef_bureau) — pas une zone en particulier,
        // com_zone n'a pas à voir cette alerte (elle ne concerne pas sa propre zone).
        (req.app as any).broadcastEvent?.({
          type: 'stock_alerte',
          payload: { equipment_id: id, name: eq.name, new_stock: newStock, seuil: seuilAlerte, unite }
        }, { roles: NON_ZONE_ROLES, excludeUserId: req.user.id });

        const rr = await ensureResupplyRequest(query, {
          equipmentId: id, zoneId: eq.zone_id, currentStock: newStock,
          seuilAlerte, unite, triggeredBy: req.user.id,
        });
        if (rr) {
          recordAudit('RESUPPLY_NEEDED', req.user, { equipmentId: id, equipmentName: eq.name, quantity: newStock }, req.ip);
          (req.app as any).broadcastEvent?.({
            type: 'resupply_needed',
            payload: { requestId: rr.id, equipment_id: id, name: eq.name, quantity: newStock, seuil: seuilAlerte, unite }
          }, { roles: STOCK_APPROVAL_ROLES, excludeUserId: req.user.id });
        }
      }

      res.json({ new_stock: newStock, seuil_alerte: seuilAlerte, unite, alerte });
    } catch (e: any) {
      console.error('[POST /api/equipment/:id/stock-sortie]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Entrée de stock — réapprovisionnement du matériel central (fournisseur),
  // sans zone de destination : distinct de la sortie, qui elle alimente une zone.
  app.post('/api/equipment/:id/stock-entree', authenticateToken, async (req: any, res) => {
    if (!["admin", "chef_bureau", "agent_logistique"].includes(req.user.role)) {
      return res.status(403).json({ error: "Action non autorisée" });
    }
    const { id } = req.params;
    const { quantite, note } = req.body;
    const qty = Number(quantite);
    if (!quantite || isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Quantité invalide (doit être > 0)' });
    }
    try {
      const { rows: [eq] } = await query(
        `SELECT e.id, e.name, e.status FROM equipment e WHERE e.id = $1 AND e.deleted_at IS NULL`, [id]
      );
      if (!eq) return res.status(404).json({ error: 'Équipement introuvable' });

      const { rows: detailRows } = await query(
        `SELECT field_key, field_value FROM equipment_details
         WHERE equipment_id = $1 AND field_key IN ('quantite_stock','unite')`, [id]
      );
      const det: Record<string, string> = Object.fromEntries(detailRows.map((r: any) => [r.field_key, r.field_value]));
      const currentStock = parseInt(det.quantite_stock || '0', 10);
      const unite = det.unite || 'unité(s)';
      const newStock = currentStock + qty;

      await query(`DELETE FROM equipment_details WHERE equipment_id = $1 AND field_key = 'quantite_stock'`, [id]);
      await query(`INSERT INTO equipment_details (equipment_id, field_key, field_value) VALUES ($1, 'quantite_stock', $2)`, [id, String(newStock)]);
      await query(`UPDATE equipment SET updated_at = NOW() WHERE id = $1`, [id]);

      await query(
        `INSERT INTO movements (equipment_id, type, performed_by, performed_by_name, note, previous_status, new_status)
         VALUES ($1, 'entree', $2, $3, $4, $5, $5)`,
        [id, req.user.id, req.user.display_name || req.user.username || 'Inconnu',
         `Entrée stock : +${qty} ${unite}${note ? ' — ' + note : ''}`, eq.status]
      );

      recordAudit('STOCK_ENTREE', req.user, {
        equipmentId: id, equipmentName: eq.name, quantite: qty, newStock,
      }, req.ip);

      res.json({ new_stock: newStock, unite });
    } catch (e: any) {
      console.error('[POST /api/equipment/:id/stock-entree]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Déclaration de stock COM Zone ────────────────────────────
  // Applique directement si la quantité déclarée correspond à l'existant.
  // Sinon, crée une déclaration en attente d'approbation (chef_bureau OU CSA).
  app.post('/api/equipment/:id/declare-stock', authenticateToken, async (req: any, res) => {
    const { id } = req.params;
    if (!isUUID(id)) return res.status(400).json({ error: 'ID invalide' });
    if (req.user.role !== 'com_zone') return res.status(403).json({ error: 'Action non autorisée' });
    if (!req.user.zone_id) return res.status(400).json({ error: "Aucune zone assignée à ce compte" });

    let validated: any;
    try {
      validated = declareStockSchema.parse(req.body);
    } catch (zodErr: any) {
      return res.status(400).json({ error: 'Validation échouée', details: zodErr.errors });
    }

    try {
      const { rows: [eq] } = await query(
        `SELECT e.id, e.name, e.zone_id, c.label AS category_label
         FROM equipment e LEFT JOIN categories c ON c.id = e.category_id
         WHERE e.id = $1 AND e.deleted_at IS NULL`,
        [id]
      );
      if (!eq) return res.status(404).json({ error: 'Équipement introuvable' });
      if (eq.zone_id !== req.user.zone_id) return res.status(403).json({ error: 'Action non autorisée' });
      if (!isStockCategory(eq.category_label)) return res.status(400).json({ error: "Cet équipement n'est pas du stock" });

      const { rows: detailRows } = await query(
        `SELECT field_key, field_value FROM equipment_details
         WHERE equipment_id = $1 AND field_key IN ('quantite_stock','unite')`, [id]
      );
      const det: Record<string, string> = Object.fromEntries(detailRows.map((r: any) => [r.field_key, r.field_value]));
      const currentStock = parseInt(det.quantite_stock || '0', 10);
      const unite = det.unite || 'unité(s)';
      const declaredBy = req.user.display_name || req.user.username || 'Inconnu';

      if (validated.quantite === currentStock) {
        await query(
          `INSERT INTO movements (equipment_id, type, performed_by, performed_by_name, previous_status, new_status, note)
           VALUES ($1, 'ajustement', $2, $3, NULL, NULL, $4)`,
          [id, req.user.id, declaredBy, `Déclaration de stock confirmée (${currentStock} ${unite}, aucun écart)${validated.note ? ' — ' + validated.note : ''}`]
        );
        recordAudit('STOCK_DECLARATION_CONFIRMED', req.user, { equipmentId: id, equipmentName: eq.name, quantite: currentStock }, req.ip);
        return res.json({ applied: true, mismatch: false, quantite: currentStock });
      }

      const { rows: [decl] } = await query(
        `INSERT INTO stock_declarations
          (equipment_id, zone_id, declared_by, declared_by_name, previous_quantity, declared_quantity, unite, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [id, eq.zone_id, req.user.id, declaredBy, currentStock, validated.quantite, unite, validated.note || null]
      );
      recordAudit('STOCK_DECLARATION_CREATED', req.user, {
        equipmentId: id, equipmentName: eq.name, previousQuantity: currentStock, declaredQuantity: validated.quantite,
      }, req.ip);
      (req.app as any).broadcastEvent?.({
        type: 'stock_declaration_created',
        payload: { declarationId: decl.id, equipmentId: id, equipmentName: eq.name, previousQuantity: currentStock, declaredQuantity: validated.quantite, unite }
      }, STOCK_APPROVAL_ROLES);

      res.status(201).json({ applied: false, mismatch: true, declaration: decl });
    } catch (e: any) {
      console.error('[POST /api/equipment/:id/declare-stock]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Catalogue "Matériel d'exploitation" (articles centraux du chef_bureau, zone_id = NULL) ──
  // Référence commune (toners, rames de papier, registres...) que chaque zone utilise
  // pour déclarer son propre stock du même article.
  app.get('/api/exploitation-catalog', authenticateToken, async (req: any, res) => {
    if (![...STOCK_READ_ROLES, 'com_zone'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Action non autorisée' });
    }
    try {
      const { rows } = await query(
        `SELECT e.id, e.name, e.category_id,
                MAX(CASE WHEN ed.field_key = 'unite' THEN ed.field_value END) AS unite,
                MAX(CASE WHEN ed.field_key = 'type_consommable' THEN ed.field_value END) AS type_consommable,
                MAX(CASE WHEN ed.field_key = 'seuil_alerte' THEN ed.field_value END) AS seuil_alerte
         FROM equipment e
         JOIN categories c ON c.id = e.category_id
         LEFT JOIN equipment_details ed ON ed.equipment_id = e.id
         WHERE c.label ILIKE '%exploitation%' AND e.zone_id = ${CENTRAL_ZONE_SQL} AND e.deleted_at IS NULL
         GROUP BY e.id, e.name, e.category_id
         ORDER BY e.name`
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Déclaration de stock COM Zone pour un article du catalogue ──────────
  // Crée l'instance de zone au premier usage (copie nom/catégorie/unité du
  // catalogue), puis applique la même logique que /api/equipment/:id/declare-stock
  // (écart → déclaration en attente d'approbation chef_bureau/CSA).
  app.post('/api/exploitation-catalog/:catalogId/declare-stock', authenticateToken, async (req: any, res) => {
    const { catalogId } = req.params;
    if (!isUUID(catalogId)) return res.status(400).json({ error: 'ID invalide' });
    if (req.user.role !== 'com_zone') return res.status(403).json({ error: 'Action non autorisée' });
    if (!req.user.zone_id) return res.status(400).json({ error: "Aucune zone assignée à ce compte" });

    let validated: any;
    try {
      validated = declareStockSchema.parse(req.body);
    } catch (zodErr: any) {
      return res.status(400).json({ error: 'Validation échouée', details: zodErr.errors });
    }

    try {
      const { rows: [catalogItem] } = await query(
        `SELECT e.id, e.name, e.category_id, c.label AS category_label
         FROM equipment e LEFT JOIN categories c ON c.id = e.category_id
         WHERE e.id = $1 AND e.zone_id = ${CENTRAL_ZONE_SQL} AND e.deleted_at IS NULL`,
        [catalogId]
      );
      if (!catalogItem) return res.status(404).json({ error: 'Article introuvable dans le catalogue' });
      if (!isStockCategory(catalogItem.category_label)) {
        return res.status(400).json({ error: "Cet article n'est pas du matériel d'exploitation" });
      }

      let { rows: [zoneEquip] } = await query(
        `SELECT id FROM equipment
         WHERE zone_id = $1 AND category_id = $2 AND LOWER(name) = LOWER($3) AND deleted_at IS NULL`,
        [req.user.zone_id, catalogItem.category_id, catalogItem.name]
      );

      if (!zoneEquip) {
        const { rows: catalogDetailRows } = await query(
          `SELECT field_key, field_value FROM equipment_details
           WHERE equipment_id = $1 AND field_key IN ('unite','seuil_alerte','type_consommable')`,
          [catalogId]
        );
        const catalogDetails: Record<string, string> = Object.fromEntries(
          catalogDetailRows.map((r: any) => [r.field_key, r.field_value])
        );
        const newId = await EquipmentService.createEquipment({
          name: catalogItem.name,
          category_id: catalogItem.category_id,
          status: 'fonctionnel',
          zone_id: req.user.zone_id,
          station_id: null,
          created_by: req.user.id,
          details: Object.keys(catalogDetails).length ? catalogDetails : undefined,
        });
        zoneEquip = { id: newId };
        recordAudit('EQUIPMENT_CREATED', req.user, { equipmentId: newId, equipmentName: catalogItem.name }, req.ip);
      }

      const declaredBy = req.user.display_name || req.user.username || 'Inconnu';
      const { rows: zoneDetailRows } = await query(
        `SELECT field_key, field_value FROM equipment_details
         WHERE equipment_id = $1 AND field_key IN ('quantite_stock','unite')`,
        [zoneEquip.id]
      );
      const zoneDet: Record<string, string> = Object.fromEntries(zoneDetailRows.map((r: any) => [r.field_key, r.field_value]));
      const currentStock = parseInt(zoneDet.quantite_stock || '0', 10);
      const unite = zoneDet.unite || 'unité(s)';

      if (validated.quantite === currentStock) {
        await query(
          `INSERT INTO movements (equipment_id, type, performed_by, performed_by_name, previous_status, new_status, note)
           VALUES ($1, 'ajustement', $2, $3, NULL, NULL, $4)`,
          [zoneEquip.id, req.user.id, declaredBy, `Déclaration de stock confirmée (${currentStock} ${unite}, aucun écart)${validated.note ? ' — ' + validated.note : ''}`]
        );
        recordAudit('STOCK_DECLARATION_CONFIRMED', req.user, { equipmentId: zoneEquip.id, equipmentName: catalogItem.name, quantite: currentStock }, req.ip);
        return res.json({ applied: true, mismatch: false, quantite: currentStock });
      }

      const { rows: [decl] } = await query(
        `INSERT INTO stock_declarations
          (equipment_id, zone_id, declared_by, declared_by_name, previous_quantity, declared_quantity, unite, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [zoneEquip.id, req.user.zone_id, req.user.id, declaredBy, currentStock, validated.quantite, unite, validated.note || null]
      );
      recordAudit('STOCK_DECLARATION_CREATED', req.user, {
        equipmentId: zoneEquip.id, equipmentName: catalogItem.name, previousQuantity: currentStock, declaredQuantity: validated.quantite,
      }, req.ip);
      (req.app as any).broadcastEvent?.({
        type: 'stock_declaration_created',
        payload: { declarationId: decl.id, equipmentId: zoneEquip.id, equipmentName: catalogItem.name, previousQuantity: currentStock, declaredQuantity: validated.quantite, unite }
      }, STOCK_APPROVAL_ROLES);

      res.status(201).json({ applied: false, mismatch: true, declaration: decl });
    } catch (e: any) {
      console.error('[POST /api/exploitation-catalog/:catalogId/declare-stock]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Déclarations de stock : liste (approbateurs/CSPH voient tout, comzone voit sa zone) ──
  app.get('/api/stock-declarations', authenticateToken, async (req: any, res) => {
    const { status } = req.query;
    try {
      const conditions: string[] = [];
      const params: any[] = [];
      if (STOCK_READ_ROLES.includes(req.user.role)) {
        if (status && status !== 'all') { params.push(status); conditions.push(`sd.status = $${params.length}`); }
        else { params.push('pending'); conditions.push(`sd.status = $${params.length}`); }
      } else if (req.user.role === 'com_zone') {
        params.push(req.user.zone_id); conditions.push(`sd.zone_id = $${params.length}`);
        if (status && status !== 'all') { params.push(status); conditions.push(`sd.status = $${params.length}`); }
      } else {
        return res.status(403).json({ error: 'Action non autorisée' });
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await query(
        `SELECT sd.*, e.name AS equipment_name, z.name AS zone_name
         FROM stock_declarations sd
         LEFT JOIN equipment e ON e.id = sd.equipment_id
         LEFT JOIN zones z ON z.id = sd.zone_id
         ${where} ORDER BY sd.created_at DESC LIMIT 200`,
        params
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Approbation d'une déclaration de stock ────────────────────
  app.post('/api/stock-declarations/:id/approve', authenticateToken, authorize(STOCK_APPROVAL_ROLES), async (req: any, res) => {
    const { id } = req.params;
    if (!isUUID(id)) return res.status(400).json({ error: 'ID invalide' });
    let validated: any;
    try { validated = stockDecisionSchema.parse(req.body || {}); }
    catch (zodErr: any) { return res.status(400).json({ error: 'Validation échouée', details: zodErr.errors }); }

    try {
      let resupplyCreated: any = null;
      let decl: any = null;
      let eqInfo: any = null;

      await transact(async (q) => {
        const { rows: [d] } = await q(`SELECT * FROM stock_declarations WHERE id = $1`, [id]);
        if (!d) throw Object.assign(new Error('Déclaration introuvable'), { status: 404 });
        if (d.status !== 'pending') throw Object.assign(new Error('Déclaration déjà traitée'), { status: 409 });

        const { rows: [eq] } = await q(
          `SELECT e.id, e.name, ed.field_value AS quantite_stock, seuil.field_value AS seuil_alerte, unite.field_value AS unite
           FROM equipment e
           LEFT JOIN equipment_details ed    ON ed.equipment_id = e.id AND ed.field_key = 'quantite_stock'
           LEFT JOIN equipment_details seuil ON seuil.equipment_id = e.id AND seuil.field_key = 'seuil_alerte'
           LEFT JOIN equipment_details unite ON unite.equipment_id = e.id AND unite.field_key = 'unite'
           WHERE e.id = $1`, [d.equipment_id]
        );
        const currentStock = parseInt(eq?.quantite_stock || '0', 10);
        if (currentStock !== d.previous_quantity) {
          throw Object.assign(new Error('Le stock a changé depuis la déclaration — merci de la rejeter et de redéclarer'), { status: 409 });
        }
        eqInfo = eq;

        await setEquipmentDetail(q, d.equipment_id, 'quantite_stock', String(d.declared_quantity));
        const { rows: [updated] } = await q(
          `UPDATE stock_declarations
           SET status='approved', decided_by=$1, decided_by_name=$2, decision_note=$3, decided_at=NOW()
           WHERE id=$4 RETURNING *`,
          [req.user.id, req.user.display_name || req.user.username || 'Inconnu', validated.note || null, id]
        );
        decl = updated;

        await q(
          `INSERT INTO movements (equipment_id, type, performed_by, performed_by_name, previous_status, new_status, note)
           VALUES ($1, 'ajustement', $2, $3, NULL, NULL, $4)`,
          [d.equipment_id, req.user.id, req.user.display_name || req.user.username || 'Inconnu',
           `Déclaration de stock approuvée : ${d.previous_quantity} → ${d.declared_quantity} ${d.unite || ''}`]
        );

        const seuilAlerte = parseInt(eq?.seuil_alerte || '0', 10);
        if (seuilAlerte > 0 && d.declared_quantity <= seuilAlerte) {
          resupplyCreated = await ensureResupplyRequest(q, {
            equipmentId: d.equipment_id, zoneId: d.zone_id, currentStock: d.declared_quantity,
            seuilAlerte, unite: d.unite, triggeredBy: req.user.id,
          });
        }
      });

      recordAudit('STOCK_DECLARATION_APPROVED', req.user, {
        declarationId: id, equipmentId: decl.equipment_id, declaredQuantity: decl.declared_quantity,
      }, req.ip);
      (req.app as any).broadcastEvent?.({
        type: 'stock_declaration_approved',
        payload: { declarationId: id, equipmentId: decl.equipment_id, equipmentName: eqInfo?.name, declaredQuantity: decl.declared_quantity }
      }, { roles: ['com_zone'], zoneId: decl.zone_id });

      if (resupplyCreated) {
        recordAudit('RESUPPLY_NEEDED', req.user, { equipmentId: decl.equipment_id, quantity: decl.declared_quantity }, req.ip);
        (req.app as any).broadcastEvent?.({
          type: 'resupply_needed',
          payload: { requestId: resupplyCreated.id, equipment_id: decl.equipment_id, name: eqInfo?.name, quantity: decl.declared_quantity }
        }, { roles: STOCK_APPROVAL_ROLES, excludeUserId: req.user.id });
      }

      res.json({ success: true, declaration: decl });
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // ── Rejet d'une déclaration de stock ──────────────────────────
  app.post('/api/stock-declarations/:id/reject', authenticateToken, authorize(STOCK_APPROVAL_ROLES), async (req: any, res) => {
    const { id } = req.params;
    if (!isUUID(id)) return res.status(400).json({ error: 'ID invalide' });
    let validated: any;
    try { validated = rejectDecisionSchema.parse(req.body || {}); }
    catch (zodErr: any) { return res.status(400).json({ error: 'Validation échouée', details: zodErr.errors }); }

    try {
      const { rows: [d] } = await query(`SELECT * FROM stock_declarations WHERE id = $1`, [id]);
      if (!d) return res.status(404).json({ error: 'Déclaration introuvable' });
      if (d.status !== 'pending') return res.status(409).json({ error: 'Déclaration déjà traitée' });

      const { rows: [updated] } = await query(
        `UPDATE stock_declarations
         SET status='rejected', decided_by=$1, decided_by_name=$2, decision_note=$3, decided_at=NOW()
         WHERE id=$4 RETURNING *`,
        [req.user.id, req.user.display_name || req.user.username || 'Inconnu', validated.note, id]
      );

      recordAudit('STOCK_DECLARATION_REJECTED', req.user, { declarationId: id, equipmentId: d.equipment_id, reason: validated.note }, req.ip);
      (req.app as any).broadcastEvent?.({
        type: 'stock_declaration_rejected',
        payload: { declarationId: id, equipmentId: d.equipment_id, reason: validated.note }
      }, { roles: ['com_zone'], zoneId: d.zone_id });

      res.json({ success: true, declaration: updated });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Demandes de ravitaillement : liste ────────────────────────
  app.get('/api/resupply-requests', authenticateToken, async (req: any, res) => {
    const { status } = req.query;
    try {
      const conditions: string[] = [];
      const params: any[] = [];
      if (STOCK_READ_ROLES.includes(req.user.role)) {
        if (status && status !== 'all') { params.push(status); conditions.push(`rr.status = $${params.length}`); }
      } else if (req.user.role === 'com_zone') {
        params.push(req.user.zone_id); conditions.push(`rr.zone_id = $${params.length}`);
        if (status && status !== 'all') { params.push(status); conditions.push(`rr.status = $${params.length}`); }
      } else {
        return res.status(403).json({ error: 'Action non autorisée' });
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await query(
        `SELECT rr.*, e.name AS equipment_name, z.name AS zone_name
         FROM resupply_requests rr
         LEFT JOIN equipment e ON e.id = rr.equipment_id
         LEFT JOIN zones z ON z.id = rr.zone_id
         ${where} ORDER BY rr.created_at DESC LIMIT 200`,
        params
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Marquer un ravitaillement comme effectif ──────────────────
  app.post('/api/resupply-requests/:id/fulfill', authenticateToken, authorize(STOCK_APPROVAL_ROLES), async (req: any, res) => {
    const { id } = req.params;
    if (!isUUID(id)) return res.status(400).json({ error: 'ID invalide' });
    let validated: any;
    try { validated = fulfillResupplySchema.parse(req.body || {}); }
    catch (zodErr: any) { return res.status(400).json({ error: 'Validation échouée', details: zodErr.errors }); }

    try {
      const { rows: [rr] } = await query(`SELECT * FROM resupply_requests WHERE id = $1`, [id]);
      if (!rr) return res.status(404).json({ error: 'Demande introuvable' });
      if (rr.status !== 'open') return res.status(409).json({ error: 'Demande déjà traitée' });

      const { rows: [updated] } = await query(
        `UPDATE resupply_requests
         SET status='fulfilled', fulfilled_by=$1, fulfilled_by_name=$2, fulfilled_at=NOW(), fulfilled_quantity=$3, fulfillment_note=$4
         WHERE id=$5 RETURNING *`,
        [req.user.id, req.user.display_name || req.user.username || 'Inconnu',
         validated.fulfilled_quantity ?? null, validated.note || null, id]
      );

      recordAudit('RESUPPLY_FULFILLED', req.user, { requestId: id, equipmentId: rr.equipment_id }, req.ip);
      (req.app as any).broadcastEvent?.({
        type: 'resupply_fulfilled',
        payload: { requestId: id, equipmentId: rr.equipment_id }
      }, { roles: ['com_zone'], zoneId: rr.zone_id });

      res.json({ success: true, request: updated });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Confirmation de réception d'un ravitaillement (COM Zone, sa zone uniquement) ──
  app.post('/api/resupply-requests/:id/confirm', authenticateToken, async (req: any, res) => {
    const { id } = req.params;
    if (!isUUID(id)) return res.status(400).json({ error: 'ID invalide' });
    if (req.user.role !== 'com_zone') return res.status(403).json({ error: 'Action non autorisée' });
    let validated: any;
    try { validated = confirmResupplySchema.parse(req.body); }
    catch (zodErr: any) { return res.status(400).json({ error: 'Validation échouée', details: zodErr.errors }); }

    try {
      const { rows: [rr] } = await query(`SELECT * FROM resupply_requests WHERE id = $1`, [id]);
      if (!rr) return res.status(404).json({ error: 'Demande introuvable' });
      if (rr.zone_id !== req.user.zone_id) return res.status(403).json({ error: 'Action non autorisée' });
      if (rr.status !== 'fulfilled') return res.status(409).json({ error: 'Demande non prête pour confirmation' });

      const { rows: detailRows } = await query(
        `SELECT field_value FROM equipment_details WHERE equipment_id = $1 AND field_key = 'quantite_stock'`, [rr.equipment_id]
      );
      const currentStock = parseInt(detailRows[0]?.field_value || '0', 10);
      const newStock = currentStock + validated.quantite_recue;

      await setEquipmentDetail(query, rr.equipment_id, 'quantite_stock', String(newStock));
      const { rows: [updated] } = await query(
        `UPDATE resupply_requests
         SET status='confirmed', confirmed_by=$1, confirmed_by_name=$2, confirmed_at=NOW(), confirmed_quantity=$3
         WHERE id=$4 RETURNING *`,
        [req.user.id, req.user.display_name || req.user.username || 'Inconnu', validated.quantite_recue, id]
      );

      await query(
        `INSERT INTO movements (equipment_id, type, performed_by, performed_by_name, to_zone_id, note)
         VALUES ($1, 'entree', $2, $3, $4, $5)`,
        [rr.equipment_id, req.user.id, req.user.display_name || req.user.username || 'Inconnu', rr.zone_id,
         `Réception ravitaillement confirmée : +${validated.quantite_recue} ${rr.unite || ''}${validated.note ? ' — ' + validated.note : ''}`]
      );

      recordAudit('RESUPPLY_CONFIRMED', req.user, { requestId: id, equipmentId: rr.equipment_id, newStock }, req.ip);
      (req.app as any).broadcastEvent?.({
        type: 'resupply_confirmed',
        payload: { requestId: id, equipmentId: rr.equipment_id, newStock }
      }, STOCK_APPROVAL_ROLES);

      res.json({ success: true, new_stock: newStock });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Historique équipement
  app.get("/api/equipment/:id/history", authenticateToken, async (req: any, res) => {
    try {
      const { id } = req.params;
      if (!isUUID(id)) return res.status(400).json({ error: 'ID invalide' });

      if (req.user.role === "com_zone" || req.user.role === "chef_ram") {
        // Pas de filtre deleted_at IS NULL ici : un véhicule réformé doit
        // rester consultable par chef_ram (traçabilité), seul l'équipement
        // actif disparaît des listings, jamais son historique.
        const { rows: [eq] } = await query(
          `SELECT e.zone_id, c.label AS category_label
           FROM equipment e LEFT JOIN categories c ON c.id = e.category_id
           WHERE e.id = $1`,
          [id]
        );
        if (!eq) return res.status(404).json({ error: 'Équipement introuvable' });
        const allowed =
          (req.user.role === "com_zone" && eq.zone_id === req.user.zone_id) ||
          (req.user.role === "chef_ram" && isVehicleCategory(eq.category_label));
        if (!allowed) return res.status(403).json({ error: "Action non autorisée" });
      }

      const { rows } = await query(`
        SELECT m.id, m.type, m.note, m.reference,
          m.previous_status, m.new_status,
          m.status, m.decision_note,
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

  // ── Rapport : historique + état actuel, période + équipements choisis ──
  // com_zone : restreint aux équipements de sa propre zone.
  // chef_ram : restreint aux véhicules, toutes zones confondues (pas de zone_id personnel).
  app.get('/api/reports/equipment', authenticateToken, async (req: any, res) => {
    const role = req.user.role;
    if (!['com_zone', 'chef_ram'].includes(role)) return res.status(403).json({ error: 'Action non autorisée' });
    if (role === 'com_zone' && !req.user.zone_id) return res.status(400).json({ error: 'Aucune zone assignée à ce compte' });

    const { from, to } = req.query;
    const equipmentIds = String(req.query.equipment_ids || '').split(',').map(s => s.trim()).filter(Boolean);

    if (!from || !to || isNaN(Date.parse(String(from))) || isNaN(Date.parse(String(to)))) {
      return res.status(400).json({ error: 'Période (from/to) invalide' });
    }
    if (equipmentIds.length === 0 || equipmentIds.some(id => !isUUID(id))) {
      return res.status(400).json({ error: 'Au moins un équipement valide doit être sélectionné' });
    }

    try {
      // IN (...) plutôt que ANY($1) : équivalent sur une clé primaire, plus portable.
      const params: any[] = [...equipmentIds];
      const idPlaceholders = equipmentIds.map((_, i) => `$${i + 1}`).join(', ');
      let zoneCondition = '';
      if (role === 'com_zone') {
        params.push(req.user.zone_id);
        zoneCondition = `AND e.zone_id = $${params.length}`;
      }
      const { rows: equipRows } = await query(
        `SELECT e.id, e.name, e.status, c.label AS category_label, z.name AS zone_name, s.name AS station_name
         FROM equipment e
         LEFT JOIN categories c ON c.id = e.category_id
         LEFT JOIN zones z ON z.id = e.zone_id
         LEFT JOIN stations s ON s.id = e.station_id
         WHERE e.id IN (${idPlaceholders}) ${zoneCondition} AND e.deleted_at IS NULL`,
        params
      );
      const authorized = role === 'com_zone'
        ? equipRows.length === equipmentIds.length
        : equipRows.length === equipmentIds.length && equipRows.every(e => isVehicleCategory(e.category_label));
      if (!authorized) {
        return res.status(403).json({
          error: role === 'com_zone'
            ? "Un ou plusieurs équipements sélectionnés ne sont pas dans votre zone"
            : "Un ou plusieurs équipements sélectionnés ne sont pas des véhicules",
        });
      }

      const { rows: detailRows } = await query(
        `SELECT equipment_id, field_key, field_value FROM equipment_details WHERE equipment_id = ANY($1)`,
        [equipmentIds]
      );
      const detailsByEquip: Record<string, Record<string, string>> = {};
      for (const d of detailRows) {
        (detailsByEquip[d.equipment_id] ||= {})[d.field_key] = d.field_value;
      }

      const { rows: movementRows } = await query(
        `SELECT m.equipment_id, m.type, m.note, m.reference, m.previous_status, m.new_status,
                COALESCE(u.display_name, m.performed_by_name, 'Utilisateur supprimé') AS performed_by_name,
                m.created_at
         FROM movements m
         LEFT JOIN users u ON u.id = m.performed_by
         WHERE m.equipment_id = ANY($1) AND m.created_at >= $2::timestamp AND m.created_at < ($3::timestamp + INTERVAL '1 day')
         ORDER BY m.created_at DESC`,
        [equipmentIds, from, to]
      );
      const movementsByEquip: Record<string, any[]> = {};
      for (const m of movementRows) {
        (movementsByEquip[m.equipment_id] ||= []).push(m);
      }

      const equipment = equipRows.map(e => ({
        id: e.id,
        name: e.name,
        category_label: e.category_label,
        status: e.status,
        zone_name: e.zone_name,
        station_name: e.station_name,
        details: detailsByEquip[e.id] || {},
        movements: movementsByEquip[e.id] || [],
      }));

      recordAudit('REPORT_GENERATED', req.user, { from, to, equipmentCount: equipment.length }, req.ip);
      res.json({ from, to, equipment });
    } catch (e: any) {
      console.error('[GET /api/reports/equipment]', e.message);
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

    const client = { res, userId: req.user.id, role: req.user.role, zoneId: req.user.zone_id };
    sseClients.add(client);
    const keepAlive = setInterval(() => {
      try { res.write(": ping\n\n"); }
      catch { clearInterval(keepAlive); sseClients.delete(client); }
    }, 25000);
    req.on("close", () => { clearInterval(keepAlive); sseClients.delete(client); });
  });

  // filter : tableau de rôles (comportement historique) OU { roles?, zoneId?, excludeUserId? }
  // pour cibler en plus une zone précise (ex: alerter uniquement le com_zone de la zone
  // concernée) ou exclure l'auteur de l'action (ex: ne pas notifier l'admin de sa propre
  // suppression d'utilisateur — l'alerte sert à prévenir les AUTRES superviseurs).
  (app as any).broadcastEvent = (event: { type: string; payload: any }, filter?: string[] | { roles?: string[]; zoneId?: string; excludeUserId?: string }) => {
    const roles         = Array.isArray(filter) ? filter : filter?.roles;
    const zoneId        = Array.isArray(filter) ? undefined : filter?.zoneId;
    const excludeUserId = Array.isArray(filter) ? undefined : filter?.excludeUserId;
    const data = `data: ${JSON.stringify(event)}\n\n`;
    sseClients.forEach((client: any) => {
      if (roles && !roles.includes(client.role)) return;
      if (zoneId && client.zoneId !== zoneId) return;
      if (excludeUserId && client.userId === excludeUserId) return;
      try { client.res.write(data); }
      catch { sseClients.delete(client); }
    });
  };

  // ── Notifications récentes (backfill) ──────────────────────────
  // Les notifications SSE (broadcastEvent) sont éphémères : un utilisateur non
  // connecté au moment de l'émission (ex: chef_ram pas encore loggé quand une
  // panne est déclarée) ne les reçoit jamais. Cet endpoint reconstruit les
  // événements récents pertinents à partir des données persistées (audit_logs,
  // movements) pour que la cloche soit peuplée dès la connexion, avec le même
  // format de payload que les événements SSE en direct (mêmes clés, réutilisées
  // par le même buildNotificationMessage côté client).
  app.get('/api/notifications/recent', authenticateToken, async (req: any, res) => {
    try {
      const role = req.user.role;
      const zoneId = req.user.zone_id;
      const items: { type: string; payload: any; created_at: string }[] = [];

      if (NON_ZONE_ROLES.includes(role) || role === 'com_zone') {
        const { rows: panneRows } = await query(
          `SELECT al.id, al.created_at, al.details, e.zone_id
           FROM audit_logs al
           LEFT JOIN equipment e ON e.id = NULLIF(al.details->>'equipmentId', '')::uuid
           WHERE al.action = 'EQUIPMENT_PANNE_DECLAREE'
             AND al.created_at > NOW() - INTERVAL '14 days'
           ORDER BY al.created_at DESC LIMIT 30`
        );
        for (const r of panneRows) {
          if (role === 'com_zone' && r.zone_id !== zoneId) continue;
          const name = r.details?.equipmentName || 'Équipement';
          const description = r.details?.description;
          items.push({
            type: 'equipment_critical', created_at: r.created_at,
            payload: {
              equipment_id: r.details?.equipmentId,
              message: `"${name}" en panne${description ? ` — ${description}` : ''}`,
            },
          });
        }

        const { rows: repareRows } = await query(
          `SELECT al.id, al.created_at, al.details, e.zone_id
           FROM audit_logs al
           LEFT JOIN equipment e ON e.id = NULLIF(al.details->>'equipmentId', '')::uuid
           WHERE al.action = 'EQUIPMENT_REPARATION_DECLAREE'
             AND al.created_at > NOW() - INTERVAL '14 days'
           ORDER BY al.created_at DESC LIMIT 30`
        );
        for (const r of repareRows) {
          if (role === 'com_zone' && r.zone_id !== zoneId) continue;
          const name = r.details?.equipmentName || 'Équipement';
          const note = r.details?.note;
          items.push({
            type: 'equipment_repaired', created_at: r.created_at,
            payload: {
              equipment_id: r.details?.equipmentId,
              message: `"${name}" réparé — de retour en service${note ? ` (${note})` : ''}`,
            },
          });
        }

        const { rows: mvRows } = await query(
          `SELECT m.id, m.created_at, m.type, m.new_status, m.from_zone_id, e.name AS equipment_name
           FROM movements m
           LEFT JOIN equipment e ON e.id = m.equipment_id
           WHERE (m.type = 'sortie' OR m.new_status = 'hors_service')
             AND m.created_at > NOW() - INTERVAL '14 days'
           ORDER BY m.created_at DESC LIMIT 30`
        );
        for (const r of mvRows) {
          if (role === 'com_zone' && r.from_zone_id !== zoneId) continue;
          items.push({
            type: 'equipment_critical', created_at: r.created_at,
            payload: {
              message: `"${r.equipment_name || 'Équipement'}" ${r.type === 'sortie' ? 'sorti du parc actif' : 'passé hors service'}`,
            },
          });
        }
      }

      if (STOCK_APPROVAL_ROLES.includes(role)) {
        const { rows: stockRows } = await query(
          `SELECT id, created_at, action, details
           FROM audit_logs
           WHERE action IN ('STOCK_DECLARATION_CREATED', 'RESUPPLY_NEEDED')
             AND created_at > NOW() - INTERVAL '14 days'
           ORDER BY created_at DESC LIMIT 30`
        );
        for (const r of stockRows) {
          if (r.action === 'STOCK_DECLARATION_CREATED') {
            items.push({
              type: 'stock_declaration_created', created_at: r.created_at,
              payload: {
                equipmentName: r.details?.equipmentName,
                previousQuantity: r.details?.previousQuantity,
                declaredQuantity: r.details?.declaredQuantity,
              },
            });
          } else {
            items.push({
              type: 'resupply_needed', created_at: r.created_at,
              payload: { name: r.details?.equipmentName, quantity: r.details?.quantity },
            });
          }
        }
      }

      items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      res.json(items.slice(0, 30));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

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
      const created = await AdminService.createUser({ ...req.body, zoneId: req.body.zone_id });
      recordAudit('USER_CREATED', req.user, {
        targetUserId: created.id, targetUsername: created.username, targetRole: created.role,
      }, req.ip);
      res.status(201).json(created);
    }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // zone_id : absent du body = zone inchangée, null = retirer la zone, uuid = assigner
  app.put("/api/admin/users/:id/role", authenticateToken, authorize(['admin']), async (req: any, res) => {
    try {
      const zoneId = Object.prototype.hasOwnProperty.call(req.body, 'zone_id') ? req.body.zone_id : undefined;
      const updated = await AdminService.updateUserRole(req.params.id, req.body.role, zoneId);
      recordAudit('USER_ROLE_UPDATED', req.user, {
        targetUserId: req.params.id, targetUsername: updated.username, newRole: updated.role, zoneId: updated.zone_id,
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
    const { newPassword, mustChangePassword } = req.body;
    if (!newPassword) return res.status(400).json({ error: "Nouveau mot de passe requis" });
    const pwdError = validatePassword(newPassword);
    if (pwdError) return res.status(400).json({ error: pwdError });
    try {
      const resetUser = await AdminService.resetPassword(req.params.id, newPassword, mustChangePassword === true);
      recordAudit('USER_PASSWORD_RESET', req.user, {
        targetUserId: req.params.id, targetUsername: resetUser.username, mustChangePassword: mustChangePassword === true,
      }, req.ip);
      res.json({ success: true, user: resetUser });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Erreur serveur" });
    }
  });

  // ── Changement de mot de passe par l'utilisateur lui-même ──────
  // Utilisé aussi bien pour un changement volontaire que pour le passage
  // obligatoire après un mot de passe par défaut (must_change_password).
  app.post("/api/auth/change-password", authenticateToken, async (req: any, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Mot de passe actuel et nouveau mot de passe requis" });
    }
    const pwdError = validatePassword(newPassword);
    if (pwdError) return res.status(400).json({ error: pwdError });
    try {
      await AuthService.changePassword(req.user.id, currentPassword, newPassword);
      recordAudit('USER_PASSWORD_CHANGED_SELF', req.user, {}, req.ip);
      res.json({ success: true });
    } catch (err: any) {
      const status = err.message === "Mot de passe actuel incorrect" ? 401 : 500;
      res.status(status).json({ error: err.message || "Erreur serveur" });
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

  // ── Journal global d'audit — agrégat par utilisateur (pour l'onglet Utilisateurs) ──
  app.get("/api/admin/audit-logs/summary", authenticateToken, authorize(AUDIT_VIEWER_ROLES), async (req: any, res) => {
    try {
      const { rows } = await query(`
        SELECT user_id, user_name, COUNT(*) AS total, MAX(created_at) AS last_at
        FROM audit_logs
        GROUP BY user_id, user_name
      `);
      res.json(rows.map((r: any) => ({
        userId: r.user_id, userName: r.user_name,
        total: parseInt(r.total, 10), lastAt: r.last_at,
      })));
    } catch (e: any) {
      console.error('[API] audit-logs summary error:', e.message);
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
