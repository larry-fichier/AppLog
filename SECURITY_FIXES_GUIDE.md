# 🚀 Guide de Correction - Implémentation des Fixes de Sécurité

## Phase 1 : Correctifs Critiques (À faire IMMÉDIATEMENT)

### Étape 1 : Régénérer et Protéger les Credentials

```bash
# 1. Générer un nouveau JWT secret fort
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# Copier le résultat

# 2. Créer un nouveau mot de passe PostgreSQL
# (via pgAdmin ou ligne de commande PostgreSQL)

# 3. Créer .gitignore entrée pour .env
echo ".env" >> .gitignore
echo ".env.local" >> .gitignore
echo ".env.*.local" >> .gitignore
```

### Étape 2 : Mettre à Jour `src/server/config.ts`

```typescript
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  jwtSecret: process.env.JWT_SECRET,
  databaseUrl: process.env.DATABASE_URL,
  adminEmail: process.env.ADMIN_EMAIL || 'admin@example.com',
  nodeEnv: process.env.NODE_ENV || 'development'
};

// ✅ Validation au démarrage
if (!config.jwtSecret || config.jwtSecret.length < 32) {
  console.error('❌ ERREUR: JWT_SECRET manquant ou trop faible!');
  console.error('JWT_SECRET doit être une chaîne aléatoire de 64+ caractères hexadécimaux');
  process.exit(1);
}

if (!config.databaseUrl) {
  console.error('❌ ERREUR: DATABASE_URL est obligatoire!');
  process.exit(1);
}
```

### Étape 3 : Supprimer le Bypass d'Auth

**Fichier :** `src/server/middleware/auth.ts`

```typescript
import jwt from 'jsonwebtoken';
import { query } from '../db.ts';
import { config } from '../config.ts';

export const authenticateToken = async (req: any, res: any, next: any) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    // ✅ PAS DE BYPASS DEMO !
    if (!token) {
      return res.status(401).json({ error: "Token requis" });
    }

    try {
      const decoded: any = jwt.verify(token, config.jwtSecret);
      if (!decoded || !decoded.id) {
        return res.status(403).json({ error: "Token invalide" });
      }

      // Vérification en base de données
      const result = await query(
        "SELECT id, role, email, display_name FROM users WHERE id = $1 AND deleted_at IS NULL",
        [decoded.id]
      );
      
      if (result.rows.length === 0) {
        return res.status(401).json({ error: "Utilisateur introuvable" });
      }
      
      req.user = result.rows[0];
      next();
    } catch (err) {
      return res.status(403).json({ error: "Token expiré ou invalide" });
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
```

### Étape 4 : Corriger `firestore.rules`

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // ✅ Fonctions d'authentification
    function isAuthenticated() {
      return request.auth != null;
    }

    function getUserRole() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role;
    }

    function canConsult() {
      return isAuthenticated() && 
        getUserRole() in ['csph', 'chef_service_administratif', 'agent_logistique', 'chef_bureau_logistique', 'admin'];
    }

    function canModify() {
      return isAuthenticated() && 
        getUserRole() in ['agent_logistique', 'chef_bureau_logistique', 'admin'];
    }

    function isAdmin() {
      return isAuthenticated() && 
        getUserRole() in ['chef_bureau_logistique', 'admin'];
    }

    // ✅ SECURISÉES
    match /config/{docId} {
      allow read: if canConsult();  // Authentifiés uniquement
      allow write: if isAdmin();
    }

    match /equipment/{equipmentId} {
      allow read: if canConsult();  // Authentifiés uniquement
      allow write: if canModify();  // PAS d'auth null
    }

    match /users/{userId} {
      allow read: if isAuthenticated() && (request.auth.uid == userId || isAdmin());
      allow create: if isAuthenticated() && request.auth.uid == userId;
      allow update: if isAdmin() || (request.auth.uid == userId && !request.resource.data.diff(resource.data).affectedKeys().hasAny(['role']));
      allow delete: if isAdmin();
    }
  }
}
```

---

## Phase 2 : Correctifs Majeurs (Semaine 1)

### Étape 5 : Ajouter Rate Limiting

```bash
npm install express-rate-limit
npm install --save-dev @types/express-rate-limit
```

**Fichier :** `src/server/app.ts`

```typescript
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';

const app = express();

// ✅ Middleware de sécurité
app.use(helmet());

// ✅ CORS restrictif
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// ✅ Rate limiting pour login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 tentatives
  message: 'Trop de tentatives de connexion, réessayez dans 15 minutes',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV !== 'production', // Désactiver en dev
});

// ✅ Rate limiting général
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requêtes par minute
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(express.json({ limit: '1mb' })); // ✅ Limiter la taille

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", mode: config.nodeEnv });
});

// ✅ Login avec rate limiting
app.post("/api/auth/login", loginLimiter, async (req, res) => {
  try {
    const { email, username, password } = req.body;
    const identifier = username || email;
    
    if (!identifier || !password) {
      return res.status(400).json({ error: "Identifiants requis" });
    }
    
    const result = await AuthService.login(identifier, password);
    res.json(result);
  } catch (e: any) {
    // ✅ Message générique
    res.status(401).json({ error: "Identifiants invalides" });
  }
});

// Autres routes avec rate limiting général
app.use(generalLimiter);
```

### Étape 6 : Messages d'Erreur Sécurisés

**Fichier :** `src/server/services/authService.ts`

```typescript
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query } from '../db.ts';
import { config } from '../config.ts';

export class AuthService {
  static async login(identifier: string, password: string) {
    const result = await query(
      `SELECT * FROM users 
       WHERE (email = $1 OR username = $1) 
       AND deleted_at IS NULL 
       LIMIT 1`,
      [identifier]
    );

    // ✅ Message identique pour les 2 cas
    const errorMessage = "Identifiants invalides";

    if (result.rows.length === 0) {
      throw new Error(errorMessage);
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      throw new Error(errorMessage); // Même message
    }

    // ✅ JWT expirant
    const token = jwt.sign(
      { 
        id: user.id, 
        username: user.username, 
        role: user.role 
      },
      config.jwtSecret,
      { expiresIn: '24h' } // Tokens de courte durée
    );

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
      }
    };
  }
}
```

### Étape 7 : Validation d'Entrée avec Zod

```bash
npm install zod
```

**Créer :** `src/server/schemas.ts`

```typescript
import { z } from 'zod';

export const createEquipmentSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  category_id: z.string().uuid().optional(),
  zone: z.string().optional(),
  zone_id: z.string().uuid().optional(),
  station: z.string().optional(),
  station_id: z.string().uuid().optional(),
  status: z.enum(['fonctionnel', 'en_reparation', 'hors_service']),
  details: z.record(z.string(), z.string()).optional()
});

export const createMovementSchema = z.object({
  equipment_id: z.string().uuid(),
  type: z.enum(['deployment', 'return', 'transfer', 'maintenance']),
  from_zone_id: z.string().uuid().optional(),
  to_zone_id: z.string().uuid(),
  note: z.string().max(500).optional(),
  date_deploiement: z.string().datetime().optional(),
});

export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;
export type CreateMovementInput = z.infer<typeof createMovementSchema>;
```

**Utilisation :**

```typescript
app.post("/api/equipment", authenticateToken, async (req, res) => {
  try {
    const validated = createEquipmentSchema.parse(req.body);
    // ... utiliser validated
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: "Validation échouée",
        details: error.errors 
      });
    }
    res.status(500).json({ error: "Erreur interne" });
  }
});
```

### Étape 8 : HTTPS et Headers de Sécurité

**Fichier :** `src/server/app.ts`

```typescript
// ✅ Forcer HTTPS en production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}

// ✅ Headers CSP, X-Frame-Options, etc.
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'");
  next();
});
```

### Étape 9 : Token en Cookie httpOnly

**Fichier :** `src/server/app.ts`

```typescript
app.post("/api/auth/login", loginLimiter, async (req, res) => {
  try {
    const { email, username, password } = req.body;
    const identifier = username || email;
    
    if (!identifier || !password) {
      return res.status(400).json({ error: "Identifiants requis" });
    }
    
    const result = await AuthService.login(identifier, password);
    
    // ✅ Stocker le token en cookie httpOnly
    res.cookie('auth_token', result.token, {
      httpOnly: true,      // Pas accessible via JavaScript
      secure: process.env.NODE_ENV === 'production',  // HTTPS uniquement
      sameSite: 'strict',  // CSRF protection
      maxAge: 24 * 60 * 60 * 1000  // 24 heures
    });
    
    // Retourner les infos utilisateur (pas le token)
    res.json({
      user: result.user,
      message: "Connecté avec succès"
    });
  } catch (e: any) {
    res.status(401).json({ error: "Identifiants invalides" });
  }
});
```

**Récupérer le token depuis le middleware :**

```typescript
export const authenticateToken = async (req: any, res: any, next: any) => {
  try {
    // ✅ Token depuis cookie httpOnly
    const token = req.cookies.auth_token;

    if (!token) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    const decoded: any = jwt.verify(token, config.jwtSecret);
    // ... reste du code
  } catch (err) {
    return res.status(403).json({ error: "Session expirée" });
  }
};
```

Installation : `npm install cookie-parser`

```typescript
import cookieParser from 'cookie-parser';
app.use(cookieParser());
```

---

## Phase 3 : Correctifs de Robustesse (Semaine 2)

### Étape 10 : Logs d'Audit

```bash
npm install winston
```

**Créer :** `src/server/logger.ts`

```typescript
import winston from 'winston';
import path from 'path';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'applog' },
  transports: [
    new winston.transports.File({ 
      filename: path.join('logs', 'error.log'), 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: path.join('logs', 'combined.log') 
    }),
    new winston.transports.File({ 
      filename: path.join('logs', 'audit.log'),
      format: winston.format.simple()
    })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}
```

**Utilisation :**

```typescript
import { logger } from './logger.ts';

app.post("/api/equipment", authenticateToken, async (req, res) => {
  try {
    const validated = createEquipmentSchema.parse(req.body);
    const userId = (req as any).user.id;
    
    // ✅ Logger l'action
    logger.info('Equipment created', {
      userId,
      equipment: validated,
      ip: req.ip,
      timestamp: new Date()
    });
    
    // ... créer l'équipement
  } catch (error) {
    logger.error('Equipment creation failed', {
      error: error instanceof Error ? error.message : String(error),
      ip: req.ip
    });
  }
});
```

### Étape 11 : Audit de Dépendances

```bash
# Vérifier les vulnérabilités connues
npm audit

# Mettre à jour les dépendances vulnérables
npm audit fix

# Vérifier spécifiquement les deps critiques
npm list | grep -i (jwt|bcrypt|postgres|express)
```

---

## .env.example (Versionnable)

```env
# ✅ Ce fichier est versionné (pas de secrets)
PORT=3000
NODE_ENV=development

# PostgreSQL
DATABASE_URL=postgres://USER:PASSWORD@HOST:PORT/DATABASE

# JWT (générer avec: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
JWT_SECRET=YOUR_64_CHAR_HEX_STRING_HERE

# Admin email
ADMIN_EMAIL=admin@example.com

# CORS
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# Logging
LOG_LEVEL=info
```

---

## Checklist de Déploiement

- [ ] `.env` généré avec secrets forts (PAS dans git)
- [ ] `npm audit` exécuté et validé
- [ ] Tous les fixes des phases 1-3 implémentés
- [ ] Tests de sécurité basiques effectués
- [ ] Firestore rules testées et déployées
- [ ] Variables d'environnement de prod configurées
- [ ] HTTPS activé et certificat valide
- [ ] Rate limiting en production
- [ ] Logs d'audit fonctionnels
- [ ] Backup de base de données configuré
- [ ] Plan de réponse aux incidents préparé
- [ ] Email admin sécurisé et validé

---

## Test de Sécurité Rapide

```bash
# 1. Test d'authentification
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"wrong"}' 
# ✅ Doit retourner "Identifiants invalides" (pas de détails)

# 2. Test rate limiting
for i in {1..10}; do
  curl -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"test"}'
done
# ✅ Doit être bloqué après 5 tentatives

# 3. Test sans token
curl http://localhost:3000/api/equipment
# ✅ Doit retourner 401 Unauthorized

# 4. Test token invalide
curl -H "Authorization: Bearer invalid_token" \
  http://localhost:3000/api/equipment
# ✅ Doit retourner 403 Forbidden
```

---

**Temps total de correction :** ~4 heures pour Phase 1-2  
**Criticité :** 🔴 À faire AVANT ANY production deployment
