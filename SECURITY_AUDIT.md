# 🔒 Audit de Sécurité - Projet AppLog

**Date :** 6 mai 2026  
**Statut :** ⚠️ CRITIQUE - 10 vulnérabilités identifiées  
**Niveau de risque global :** 🔴 TRÈS ÉLEVÉ

---

## 📋 Table des matières

1. [Résumé Exécutif](#résumé-exécutif)
2. [Vulnérabilités Critiques](#vulnérabilités-critiques)
3. [Vulnérabilités Majeures](#vulnérabilités-majeures)
4. [Vulnérabilités Mineures](#vulnérabilités-mineures)
5. [Recommandations](#recommandations)

---

## Résumé Exécutif

Ce projet présente **plusieurs failles de sécurité graves** qui compromettent l'intégrité des données et l'authentification. La plus critique est **l'exposition publique des credentials de base de données** dans le fichier `.env`. Le système doit être corrigé **avant toute utilisation en production**.

---

## 🔴 Vulnérabilités Critiques

### 1. **Exposition des Credentials de Base de Données** ⚠️⚠️⚠️
**Fichier :** `.env`  
**Sévérité :** 🔴 CRITIQUE  
**CVSS Score :** 9.8

#### Problème :
```
DATABASE_URL=postgres://helios:Helios@2025@192.168.100.48:5432/geslog
PGPASSWORD=Helios@2025
JWT_SECRET=Hdsjdnqsdjqsndknqsld,qskdnlqknsdljqisjdqisndknql
```

- **Identifiant :** `helios`
- **Mot de passe :** `Helios@2025` (visible en clair)
- **Adresse IP serveur :** `192.168.100.48` (exposée)
- **Secrets JWT :** Visibles et faibles

#### Impact :
- Accès non autorisé à la base de données
- Vol complet des données de l'application
- Modification/suppression de données sensibles
- Accès au réseau interne

#### Recommandation :
```bash
# 1. Régénérer TOUS les credentials immédiatement
# 2. Ajouter .env au .gitignore
echo ".env" >> .gitignore
echo ".env.local" >> .gitignore

# 3. Utiliser des variables d'environnement chiffrées (gestion secrets)
# 4. Pour le développement local : .env.local (non committé)
# 5. Pour la production : utiliser un gestionnaire de secrets (AWS Secrets Manager, HashiCorp Vault, etc.)

# .env.example (versionnable)
DATABASE_URL=postgres://USER:PASSWORD@HOST:PORT/DATABASE
JWT_SECRET=YOUR_SECRET_KEY_HERE
```

---

### 2. **Bypass d'Authentification - Hardcodé en Clair** ⚠️⚠️⚠️
**Fichier :** `src/server/middleware/auth.ts`  
**Sévérité :** 🔴 CRITIQUE

#### Problème :
```typescript
// Support de contournement (demo) — via header OU token
const bypassUid = req.headers['x-user-uid'];
if (bypassUid === "demo-admin-uid" || token === "demo-token") {
  req.user = { id: '00000000-0000-0000-0000-000000000000', role: "admin", email: config.adminEmail };
  return next();
}
```

- Un attaquant peut usurper l'identité d'admin avec : `x-user-uid: demo-admin-uid`
- Aucune protection contre les attaques brute force
- Token de demo `demo-token` accepté partout

#### Impact :
- Authentification complètement contournée
- Accès administrateur sans identifiants valides
- Modification de tous les équipements
- Accès à toutes les données sensibles

#### Recommandation :
```typescript
// ❌ SUPPRIMER COMPLÈTEMENT ce code demo !
// if (bypassUid === "demo-admin-uid" || token === "demo-token") { ... }

// ✅ Garder uniquement l'authentification stricte
export const authenticateToken = async (req: any, res: any, next: any) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: "Token requis" });
    }

    const decoded: any = jwt.verify(token, config.jwtSecret);
    if (!decoded || !decoded.id) {
      return res.status(403).json({ error: "Token invalide" });
    }

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
};
```

---

### 3. **Email Admin Hardcodé dans les Règles Firestore** ⚠️⚠️⚠️
**Fichier :** `firestore.rules`  
**Sévérité :** 🔴 CRITIQUE

#### Problème :
```javascript
function isAdmin() {
  return isAuthenticated() &&
    (getUserRole() in ['chef_bureau_logistique', 'admin'] ||
     (request.auth.token.email == "larryfichier@gmail.com"));  // ❌ EXPOSÉ
}
```

- Email personnel hardcodé : `larryfichier@gmail.com`
- Vulnérable à l'usurpation d'identité
- Visible dans le code source

#### Recommandation :
```javascript
// ✅ Utiliser uniquement les rôles
function isAdmin() {
  return isAuthenticated() &&
    getUserRole() in ['chef_bureau_logistique', 'admin'];
}
```

---

### 4. **Firestore Ouvert en Lecture Publique** ⚠️⚠️⚠️
**Fichier :** `firestore.rules`  
**Sévérité :** 🔴 CRITIQUE

#### Problème :
```javascript
match /config/{docId} {
  allow read: if true;  // ❌ Lecture pour TOUS
  allow write: if isAdmin();
}

match /equipment/{equipmentId} {
  allow read: if true;  // ❌ Lecture pour TOUS
  allow write: if canModify() || request.auth == null;  // ❌ Écriture sans auth
}
```

#### Impact :
- Tous les équipements lisibles publiquement
- Les configurations système exposées
- Données sensibles accessibles sans authentification

#### Recommandation :
```javascript
function isAuthenticated() {
  return request.auth != null;
}

function canConsult() {
  return isAuthenticated() && getUserRole() in ['csph', 'chef_service_administratif', 'agent_logistique', 'chef_bureau_logistique', 'admin'];
}

function canModify() {
  return isAuthenticated() && getUserRole() in ['agent_logistique', 'chef_bureau_logistique', 'admin'];
}

match /config/{docId} {
  allow read: if canConsult();  // ✅ Authentifiés uniquement
  allow write: if isAdmin();
}

match /equipment/{equipmentId} {
  allow read: if canConsult();  // ✅ Authentifiés uniquement
  allow write: if canModify();  // ✅ Pas d'auth null
}
```

---

### 5. **JWT Secret Faible et Hardcodé** ⚠️⚠️⚠️
**Fichier :** `src/server/config.ts`  
**Sévérité :** 🔴 CRITIQUE

#### Problème :
```typescript
jwtSecret: process.env.JWT_SECRET || 'helios_secret_2024_uuid_aligned'
```

- Secret par défaut visible dans le code
- Qualité cryptographique faible
- Facile à bruteforce

#### Recommandation :
```typescript
// ✅ Générer un secret fort
// Node.js: require('crypto').randomBytes(64).toString('hex')
// Resultat: Un secret de 128 caractères hexadécimaux

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  jwtSecret: process.env.JWT_SECRET, // ❌ OBLIGATOIRE, pas de défaut
  databaseUrl: process.env.DATABASE_URL,
  adminEmail: process.env.ADMIN_EMAIL || 'admin@example.com',
  nodeEnv: process.env.NODE_ENV || 'development'
};

// Validation au démarrage
if (!config.jwtSecret || config.jwtSecret.length < 32) {
  throw new Error('❌ JWT_SECRET manquant ou trop faible !');
}
```

---

## 🟠 Vulnérabilités Majeures

### 6. **Pas de Rate Limiting sur les Routes d'Auth** ⚠️⚠️
**Fichier :** `src/server/app.ts`  
**Sévérité :** 🟠 MAJEURE

#### Problème :
```typescript
app.post("/api/auth/login", async (req, res) => {
  // ❌ Aucun rate limiting
  const { email, username, password } = req.body;
  const result = await AuthService.login(identifier, password);
  res.json(result);
});
```

Un attaquant peut faire des milliers de tentatives de login par seconde.

#### Recommandation :
```typescript
import rateLimit from 'express-rate-limit';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 tentatives max
  message: 'Trop de tentatives de connexion, réessayez plus tard',
  standardHeaders: true,
  legacyHeaders: false,
});

app.post("/api/auth/login", loginLimiter, async (req, res) => {
  // ...
});
```

Installation : `npm install express-rate-limit`

---

### 7. **Messages d'Erreur Révèlent des Informations Sensibles** ⚠️⚠️
**Fichier :** `src/server/services/authService.ts`  
**Sévérité :** 🟠 MAJEURE

#### Problème :
```typescript
if (result.rows.length === 0) {
  throw new Error("Utilisateur non trouvé");  // ❌ Révèle que l'email n'existe pas
}

const validPassword = await bcrypt.compare(password, user.password_hash);
if (!validPassword) {
  throw new Error("Mot de passe incorrect");  // ❌ Révèle que l'email existe
}
```

#### Impact :
- Énumération d'utilisateurs
- Un attaquant peut lister tous les utilisateurs valides du système

#### Recommandation :
```typescript
static async login(identifier: string, password: string) {
  const result = await query(
    `SELECT * FROM users WHERE (email = $1 OR username = $1) AND deleted_at IS NULL LIMIT 1`,
    [identifier]
  );

  // ✅ Message générique pour tous les cas
  if (result.rows.length === 0) {
    throw new Error("Identifiants invalides");  // Identique pour email/password faux
  }

  const user = result.rows[0];
  const validPassword = await bcrypt.compare(password, user.password_hash);

  if (!validPassword) {
    throw new Error("Identifiants invalides");  // Identique
  }

  // ... générer JWT
}
```

---

### 8. **Pas de Validation d'Entrée (SQL Injection Risquée)** ⚠️⚠️
**Fichier :** `src/server/routes/movements.ts`  
**Sévérité :** 🟠 MAJEURE

#### Problème :
```typescript
const { equipment_id } = req.query;
const sql = `
  ...
  ${equipment_id ? 'WHERE m.equipment_id = $1' : ''}  // SQL concaténée
  ...
`;
const params = equipment_id ? [equipment_id] : [];
const { rows } = await query(sql, params);
```

Bien que les paramètres soient liés (`$1`), la construction SQL est fragile.

#### Recommandation :
```typescript
router.get('/', authenticateToken, async (req, res) => {
  const { equipment_id } = req.query;

  // ✅ Validation stricte
  if (equipment_id && !isValidUUID(equipment_id as string)) {
    return res.status(400).json({ error: "equipment_id invalide" });
  }

  const sql = equipment_id
    ? `SELECT ... FROM movements WHERE m.equipment_id = $1 ORDER BY m.created_at DESC LIMIT 200`
    : `SELECT ... FROM movements ORDER BY m.created_at DESC LIMIT 200`;

  try {
    const params = equipment_id ? [equipment_id] : [];
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (e: any) {
    console.error('[GET movements]', e.message);
    res.status(500).json({ error: "Erreur interne" });  // ❌ Pas de détails techniques
  }
});

function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}
```

---

### 9. **Pas de HTTPS Enforced** ⚠️⚠️
**Fichier :** `src/server/app.ts`  
**Sévérité :** 🟠 MAJEURE

#### Problème :
- Pas de redirection HTTP → HTTPS
- Tokens JWT envoyés en clair sur HTTP
- Les credentials peuvent être intercceptés

#### Recommandation :
```typescript
// Forcer HTTPS en production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}

// Headers de sécurité supplémentaires
import helmet from 'helmet';
app.use(helmet());

// CORS stricte
import cors from 'cors';
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));
```

Installation : `npm install helmet cors`

---

### 10. **Configuration Firebase Stub Non Sécurisée** ⚠️⚠️
**Fichier :** `src/lib/firebase.ts`  
**Sévérité :** 🟠 MAJEURE

#### Problème :
```typescript
export const signOut = async () => {
  removeAuthToken();
  removeUserData();
  window.location.reload(); // ❌ Reload complet
};
```

- Les données en mémoire ne sont pas effacées correctement
- Stockage localStorage facilement accessible par XSS
- Pas de protection CSRF

#### Recommandation :
```typescript
export const signOut = async () => {
  // ✅ Nettoyage complet
  removeAuthToken();
  removeUserData();
  
  // ✅ Vider le contenu de sessionStorage aussi
  sessionStorage.clear();
  
  // ✅ Avertir le serveur (optionnel)
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {
    console.error('Logout API call failed:', e);
  }
  
  // ✅ Redirection seulement (pas reload)
  window.location.href = '/login';
};

// ✅ Stocker le token en httpOnly cookie (côté serveur)
// Plutôt que dans localStorage !
```

---

## 🟡 Vulnérabilités Mineures

### 11. **Pas de Validation de Longueur des Données** ⚠️
**Fichier :** `src/server/app.ts`  
**Sévérité :** 🟡 MINEURE

#### Problème :
```typescript
const { name, category, category_id, ... } = req.body;
// Aucune validation de longueur/type
```

#### Recommandation :
```typescript
// Utiliser une librairie de validation : zod ou joi
import { z } from 'zod';

const createEquipmentSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  status: z.enum(['fonctionnel', 'en_reparation', 'hors_service']),
  details: z.record(z.string()).optional()
});

app.post("/api/equipment", authenticateToken, async (req, res) => {
  try {
    const validated = createEquipmentSchema.parse(req.body);
    // ... utiliser validated
  } catch (e) {
    return res.status(400).json({ error: e.errors });
  }
});
```

Installation : `npm install zod`

---

### 12. **Logs Insuffisants pour l'Audit** ⚠️
**Fichier :** Toute l'application  
**Sévérité :** 🟡 MINEURE

#### Problème :
- Pas de logs détaillés des actions sensibles
- Impossible de tracer qui a modifié les équipements
- Pas d'alertes de sécurité

#### Recommandation :
```typescript
// Utiliser Winston ou Pino pour les logs
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/audit.log' })
  ]
});

// Exemple : logger les accès sensibles
app.post("/api/equipment", authenticateToken, async (req, res) => {
  const userId = (req as any).user.id;
  logger.info(`Equipment created by ${userId}`, {
    equipment: req.body,
    timestamp: new Date(),
    ip: req.ip
  });
  // ...
});
```

---

## 📊 Résumé des Fixes à Appliquer

| Priorité | Élément | Temps | Impact |
|----------|--------|-------|--------|
| 🔴 URGENT | Régénérer .env credentials | 5 min | Critique |
| 🔴 URGENT | Retirer bypass d'auth hardcodé | 10 min | Critique |
| 🔴 URGENT | Retirer email admin hardcodé | 2 min | Critique |
| 🔴 URGENT | Sécuriser Firestore rules | 10 min | Critique |
| 🔴 URGENT | Renforcer JWT secret | 5 min | Critique |
| 🟠 Précoce | Ajouter rate limiting | 15 min | Majeure |
| 🟠 Précoce | Messages d'erreur génériques | 10 min | Majeure |
| 🟠 Précoce | Validation d'entrée | 30 min | Majeure |
| 🟠 Précoce | HTTPS enforced | 15 min | Majeure |
| 🟠 Précoce | Token en httpOnly | 20 min | Majeure |
| 🟡 Standard | Validation zod | 30 min | Mineure |
| 🟡 Standard | Logs d'audit | 30 min | Mineure |

---

## ✅ Checklist de Sécurité Production

- [ ] Fichier `.env` régénéré et ajouté à `.gitignore`
- [ ] Tous les secrets en variables d'environnement
- [ ] Bypass d'auth supprimé
- [ ] JWT secret fort (128+ caractères)
- [ ] Firestore rules sécurisées
- [ ] Rate limiting sur auth
- [ ] HTTPS enforced en production
- [ ] CORS configuré restrictif
- [ ] Validation d'entrée complète (zod)
- [ ] Logs d'audit activés
- [ ] Secrets Manager configuré (AWS/Vault)
- [ ] Tests de pénétration effectués
- [ ] Dépendances npm auditées (`npm audit`)
- [ ] Cookies httpOnly activés
- [ ] CSRF protection activée

---

## 📚 Ressources Recommandées

- [OWASP Top 10 2024](https://owasp.org/Top10/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Firebase Security Rules](https://firebase.google.com/docs/firestore/security/rules-structure)
- [Express.js Security](https://expressjs.com/en/advanced/best-practice-security.html)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8949)

---

**Rapport généré le :** 6 mai 2026  
**Statut :** 🔴 Le projet est DANGEREUX en production
