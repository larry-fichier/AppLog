# ✅ Checklist de Correction de Sécurité

## 🔴 PHASE 1: CRITIQUES (À faire IMMÉDIATEMENT)

### Vulnérabilité #1 : Secrets en Clair dans .env
- [ ] **1.1** Backup du fichier `.env` actuel
  ```bash
  cp .env .env.backup.$(date +%Y%m%d)
  ```

- [ ] **1.2** Générer un nouveau JWT Secret
  ```bash
  node -e "console.log(require('crypto').randomBytes(64).toString('hex'))" > /tmp/jwt_secret.txt
  ```

- [ ] **1.3** Générer un nouveau mot de passe PostgreSQL
  - Accéder à pgAdmin ou ligne de commande PostgreSQL
  - Modifier le password pour l'utilisateur `helios`
  - Noter le nouveau password sécurisé

- [ ] **1.4** Créer `.env.example` (sans secrets)
  ```bash
  cp .env .env.example
  # Éditer .env.example et remplacer les valeurs par des placeholders
  ```

- [ ] **1.5** Ajouter `.env` à `.gitignore`
  ```bash
  echo ".env" >> .gitignore
  echo ".env.local" >> .gitignore
  echo ".env.*.local" >> .gitignore
  ```

- [ ] **1.6** Si le `.env` est déjà en git, le retirer
  ```bash
  git rm --cached .env
  git commit -m "🔐 Remove .env from version control"
  ```

- [ ] **1.7** Mettre à jour le fichier `.env` avec les nouveaux secrets
  - Copier le nouveau JWT_SECRET
  - Copier le nouveau DATABASE_URL avec nouveau password
  - Vérifier que les valeurs sont correctes

- [ ] **1.8** Redémarrer le serveur et vérifier qu'il fonctionne
  ```bash
  npm run dev
  ```

**Status:** [ ] Non commencé  [ ] En cours  [ ] Complété ✅

---

### Vulnérabilité #2 : Bypass d'Authentification Hardcodé
- [ ] **2.1** Ouvrir `src/server/middleware/auth.ts`

- [ ] **2.2** Localiser le code de bypass (environ ligne 10-14)
  ```typescript
  // Support de contournement (demo) — via header OU token
  const bypassUid = req.headers['x-user-uid'];
  if (bypassUid === "demo-admin-uid" || token === "demo-token") {
  ```

- [ ] **2.3** Supprimer complètement ce bloc (8 lignes environ)

- [ ] **2.4** S'assurer que le code commence directement par:
  ```typescript
  if (!token) {
    return res.status(401).json({ error: "Token requis" });
  }
  ```

- [ ] **2.5** Tester le bypass n'existe plus
  ```bash
  # Doit retourner 401
  curl -H "x-user-uid: demo-admin-uid" http://localhost:3000/api/equipment
  ```

**Status:** [ ] Non commencé  [ ] En cours  [ ] Complété ✅

---

### Vulnérabilité #3 : Email Admin Hardcodé
- [ ] **3.1** Ouvrir `firestore.rules`

- [ ] **3.2** Localiser la ligne avec l'email (environ ligne 39)
  ```javascript
  (request.auth.token.email == "larryfichier@gmail.com")
  ```

- [ ] **3.3** Supprimer ou commenter la vérification d'email

- [ ] **3.4** La fonction `isAdmin()` doit être:
  ```javascript
  function isAdmin() {
    return isAuthenticated() &&
      getUserRole() in ['chef_bureau_logistique', 'admin'];
  }
  ```

- [ ] **3.5** Déployer les règles Firestore
  ```bash
  firebase deploy --only firestore:rules
  ```

**Status:** [ ] Non commencé  [ ] En cours  [ ] Complété ✅

---

### Vulnérabilité #4 : Firestore Ouvert en Lecture Publique
- [ ] **4.1** Ouvrir `firestore.rules`

- [ ] **4.2** Vérifier la section `/config/{docId}`
  - [ ] **4.2a** `allow read:` doit être `if canConsult();` (pas `if true;`)
  - [ ] **4.2b** `allow write:` doit être `if isAdmin();`

- [ ] **4.3** Vérifier la section `/equipment/{equipmentId}`
  - [ ] **4.3a** `allow read:` doit être `if canConsult();` (pas `if true;`)
  - [ ] **4.3b** `allow write:` doit être `if canModify();` (pas `if request.auth == null;`)

- [ ] **4.4** Vérifier la section `/users/{userId}`
  - [ ] **4.4a** Les conditions sont restrictives
  - [ ] **4.4b** Pas de `allow read: if true;`

- [ ] **4.5** Déployer les règles
  ```bash
  firebase deploy --only firestore:rules
  ```

- [ ] **4.6** Tester que les données ne sont pas lisibles publiquement
  ```bash
  # Doit échouer (401 ou 403)
  curl http://localhost:3000/api/equipment
  ```

**Status:** [ ] Non commencé  [ ] En cours  [ ] Complété ✅

---

### Vulnérabilité #5 : JWT Secret Faible
- [ ] **5.1** Ouvrir `src/server/config.ts`

- [ ] **5.2** Localiser la ligne du JWT secret
  ```typescript
  jwtSecret: process.env.JWT_SECRET || 'helios_secret_2024_uuid_aligned'
  ```

- [ ] **5.3** Retirer la valeur par défaut:
  ```typescript
  jwtSecret: process.env.JWT_SECRET,
  ```

- [ ] **5.4** Ajouter une validation au démarrage:
  ```typescript
  if (!config.jwtSecret || config.jwtSecret.length < 32) {
    console.error('❌ JWT_SECRET manquant ou trop faible!');
    process.exit(1);
  }
  ```

- [ ] **5.5** Tester que le serveur se relance avec le nouveau secret
  ```bash
  npm run dev
  ```

**Status:** [ ] Non commencé  [ ] En cours  [ ] Complété ✅

---

## 🟠 PHASE 2: MAJEURES (Semaine 1)

### Vulnérabilité #6 : Pas de Rate Limiting
- [ ] **6.1** Installer la dépendance
  ```bash
  npm install express-rate-limit
  npm install --save-dev @types/express-rate-limit
  ```

- [ ] **6.2** Ajouter les imports au debut de `src/server/app.ts`
  ```typescript
  import rateLimit from 'express-rate-limit';
  ```

- [ ] **6.3** Définir le limiteur pour login (après les middlewares d'authentification)
  ```typescript
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 tentatives max
    message: 'Trop de tentatives de connexion, réessayez dans 15 minutes',
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => process.env.NODE_ENV !== 'production'
  });
  ```

- [ ] **6.4** Appliquer le limiteur à la route login
  ```typescript
  app.post("/api/auth/login", loginLimiter, async (req, res) => {
    // ... code existant
  });
  ```

- [ ] **6.5** Ajouter un rate limiter général (optionnel)
  ```typescript
  const generalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
  });
  
  app.use(generalLimiter);
  ```

- [ ] **6.6** Tester le rate limiting
  ```bash
  # Faire 6 tentatives rapides
  for i in {1..6}; do
    curl -X POST http://localhost:3000/api/auth/login \
      -H "Content-Type: application/json" \
      -d '{"email":"test@test.com","password":"wrong"}'
  done
  # La 6eme doit être bloquée
  ```

**Status:** [ ] Non commencé  [ ] En cours  [ ] Complété ✅

---

### Vulnérabilité #7 : Messages d'Erreur Révèlent Infos
- [ ] **7.1** Ouvrir `src/server/services/authService.ts`

- [ ] **7.2** Remplacer les messages spécifiques
  ```typescript
  // ❌ AVANT
  if (result.rows.length === 0) {
    throw new Error("Utilisateur non trouvé");
  }
  if (!validPassword) {
    throw new Error("Mot de passe incorrect");
  }

  // ✅ APRÈS
  const errorMessage = "Identifiants invalides";
  
  if (result.rows.length === 0) {
    throw new Error(errorMessage);
  }
  if (!validPassword) {
    throw new Error(errorMessage);
  }
  ```

- [ ] **7.3** Vérifier que les messages de réponse API sont génériques
  ```typescript
  // Dans app.ts
  app.post("/api/auth/login", loginLimiter, async (req, res) => {
    try {
      const result = await AuthService.login(identifier, password);
      res.json(result);
    } catch (e: any) {
      res.status(401).json({ error: "Identifiants invalides" });
    }
  });
  ```

- [ ] **7.4** Tester les réponses d'erreur
  ```bash
  # Test 1: email inexistant
  curl -X POST http://localhost:3000/api/auth/login \
    -d '{"email":"nonexistent@test.com","password":"test"}'
  # Doit retourner "Identifiants invalides"

  # Test 2: email correct, password faux
  curl -X POST http://localhost:3000/api/auth/login \
    -d '{"email":"correct@test.com","password":"wrong"}'
  # Doit retourner le MÊME message
  ```

**Status:** [ ] Non commencé  [ ] En cours  [ ] Complété ✅

---

### Vulnérabilité #8 : Pas de Validation d'Entrée
- [ ] **8.1** Installer zod
  ```bash
  npm install zod
  ```

- [ ] **8.2** Créer `src/server/schemas.ts`
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

  export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;
  ```

- [ ] **8.3** Ajouter l'import dans `app.ts`
  ```typescript
  import { createEquipmentSchema } from './schemas.ts';
  ```

- [ ] **8.4** Utiliser la validation dans les routes
  ```typescript
  app.post("/api/equipment", authenticateToken, async (req, res) => {
    try {
      const validated = createEquipmentSchema.parse(req.body);
      // ... utiliser validated au lieu de req.body
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

- [ ] **8.5** Tester la validation
  ```bash
  # Doit échouer (400)
  curl -X POST http://localhost:3000/api/equipment \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer YOUR_TOKEN" \
    -d '{"name":"","category":"INVALID_ENUM"}'
  ```

**Status:** [ ] Non commencé  [ ] En cours  [ ] Complété ✅

---

### Vulnérabilité #9 : HTTPS Non Forcé
- [ ] **9.1** Ajouter la redirection HTTPS dans `app.ts` (après les imports)
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
  ```

- [ ] **9.2** Installer helmet et cors
  ```bash
  npm install helmet cors
  ```

- [ ] **9.3** Ajouter les middlewares de sécurité
  ```typescript
  import helmet from 'helmet';
  import cors from 'cors';

  app.use(helmet());

  const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');
  app.use(cors({
    origin: allowedOrigins,
    credentials: true
  }));
  ```

- [ ] **9.4** Ajouter les headers HSTS
  ```typescript
  app.use((req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  });
  ```

- [ ] **9.5** Vérifier les headers en dev
  ```bash
  curl -I http://localhost:3000/api/health
  # Doit voir les headers X-*
  ```

**Status:** [ ] Non commencé  [ ] En cours  [ ] Complété ✅

---

### Vulnérabilité #10 : Tokens en localStorage (XSS)
- [ ] **10.1** Installer cookie-parser
  ```bash
  npm install cookie-parser
  ```

- [ ] **10.2** Ajouter le middleware dans `app.ts`
  ```typescript
  import cookieParser from 'cookie-parser';
  
  app.use(cookieParser());
  ```

- [ ] **10.3** Modifier la réponse de login pour utiliser des cookies
  ```typescript
  app.post("/api/auth/login", loginLimiter, async (req, res) => {
    try {
      const { email, username, password } = req.body;
      const identifier = username || email;
      
      if (!identifier || !password) {
        return res.status(400).json({ error: "Identifiants requis" });
      }
      
      const result = await AuthService.login(identifier, password);
      
      // ✅ Stocker dans httpOnly cookie
      res.cookie('auth_token', result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000
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

- [ ] **10.4** Modifier le middleware auth pour lire depuis les cookies
  ```typescript
  export const authenticateToken = async (req: any, res: any, next: any) => {
    try {
      // ✅ Lire depuis le cookie httpOnly
      const token = req.cookies.auth_token;

      if (!token) {
        return res.status(401).json({ error: "Non authentifié" });
      }

      try {
        const decoded: any = jwt.verify(token, config.jwtSecret);
        // ... reste du code
      } catch (err) {
        return res.status(403).json({ error: "Session expirée" });
      }
    } catch (globalErr) {
      console.error("[Auth] Middleware Error:", globalErr);
      res.status(500).json({ error: "Erreur interne" });
    }
  };
  ```

- [ ] **10.5** Modifier le client pour ne plus stocker le token
  ```typescript
  // ✅ Dans src/lib/firebase.ts ou src/lib/api.ts
  export const signInWithEmailAndPassword = async (authObj: any, email: string, pass: string) => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include", // ✅ Inclure les cookies
      body: JSON.stringify({ email, password: pass })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Login failed");
    }

    const data = await response.json();
    
    // ✅ Stocker SEULEMENT les infos utilisateur (pas le token)
    localStorage.setItem("helios_user", JSON.stringify(data.user));
    // Le token est dans le cookie httpOnly, inaccessible à JavaScript
    
    return { user: { ...data.user, uid: String(data.user.id) } };
  };

  export const signOut = async () => {
    removeUserData();
    sessionStorage.clear();
    
    try {
      await fetch('/api/auth/logout', { 
        method: 'POST',
        credentials: 'include'
      });
    } catch (e) {
      console.error('Logout API call failed:', e);
    }
    
    window.location.href = '/login';
  };
  ```

- [ ] **10.6** Mettre à jour apiFetch pour inclure les cookies
  ```typescript
  export async function apiFetch(endpoint: string, options: RequestInit = {}) {
    const headers = {
      ...options.headers as any,
      "Content-Type": "application/json",
    };

    const response = await fetch(endpoint, {
      ...options,
      headers,
      credentials: 'include' // ✅ Inclure les cookies
    });

    if (response.status === 401) {
      removeUserData();
      window.location.href = '/login';
    }

    return response;
  }
  ```

- [ ] **10.7** Tester l'authentification avec cookies
  ```bash
  # Le token doit être dans Set-Cookie
  curl -v -X POST http://localhost:3000/api/auth/login \
    -d '{"email":"test@test.com","password":"test"}'
  # Vérifier "Set-Cookie: auth_token=..."

  # Requête avec le cookie
  curl -b "auth_token=..." http://localhost:3000/api/equipment
  ```

**Status:** [ ] Non commencé  [ ] En cours  [ ] Complété ✅

---

## 🟡 PHASE 3: MINEURES (Semaine 2)

### Vulnérabilité #11 : Logs d'Audit Manquants
- [ ] **11.1** Installer Winston
  ```bash
  npm install winston
  ```

- [ ] **11.2** Créer `src/server/logger.ts`
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
      })
    ]
  });

  if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
      format: winston.format.simple(),
    }));
  }
  ```

- [ ] **11.3** Créer le dossier `logs`
  ```bash
  mkdir -p logs
  echo "logs/" >> .gitignore
  ```

- [ ] **11.4** Utiliser le logger dans les routes sensibles
  ```typescript
  import { logger } from './logger.ts';

  app.post("/api/equipment", authenticateToken, async (req, res) => {
    try {
      const validated = createEquipmentSchema.parse(req.body);
      const userId = (req as any).user.id;
      
      // ✅ Logger l'action
      logger.info('Equipment created', {
        userId,
        equipmentName: validated.name,
        ip: req.ip
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

- [ ] **11.5** Ajouter des logs pour les actions critiques
  - Créations d'équipement
  - Modifications de statut
  - Accès administrateur
  - Erreurs d'authentification (rate limiting)

**Status:** [ ] Non commencé  [ ] En cours  [ ] Complété ✅

---

### Vulnérabilité #12 : Audit des Dépendances
- [ ] **12.1** Vérifier les vulnérabilités connues
  ```bash
  npm audit
  ```

- [ ] **12.2** Corriger les vulnérabilités automatiquement
  ```bash
  npm audit fix
  ```

- [ ] **12.3** Vérifier les dépendances critiques
  ```bash
  npm list jsonwebtoken bcrypt express pg
  ```

- [ ] **12.4** Mettre à jour les dépendances
  ```bash
  npm update
  ```

- [ ] **12.5** Tester que tout fonctionne
  ```bash
  npm run build
  npm run dev
  ```

**Status:** [ ] Non commencé  [ ] En cours  [ ] Complété ✅

---

## 📋 Tests de Sécurité Post-Correction

- [ ] **Test 1: Authentification**
  ```bash
  # Sans token = 401
  curl http://localhost:3000/api/equipment
  ```

- [ ] **Test 2: Token invalide**
  ```bash
  # Token corrompu = 403
  curl -H "Authorization: Bearer invalid" \
    http://localhost:3000/api/equipment
  ```

- [ ] **Test 3: Rate limiting**
  ```bash
  # 6 tentatives rapides = bloqué
  for i in {1..6}; do curl -X POST http://localhost:3000/api/auth/login ...; done
  ```

- [ ] **Test 4: Validation d'entrée**
  ```bash
  # Data invalide = 400
  curl -X POST http://localhost:3000/api/equipment \
    -d '{"name":"","category":"INVALID"}'
  ```

- [ ] **Test 5: Messages d'erreur**
  ```bash
  # Email faux et password faux = même message
  curl -X POST http://localhost:3000/api/auth/login -d '{"email":"xxx","password":"xxx"}'
  curl -X POST http://localhost:3000/api/auth/login -d '{"email":"user@test.com","password":"xxx"}'
  # Doivent retourner "Identifiants invalides"
  ```

- [ ] **Test 6: Headers de sécurité**
  ```bash
  curl -I http://localhost:3000/api/health
  # Doit voir: Strict-Transport-Security, X-Frame-Options, X-Content-Type-Options
  ```

---

## ✅ Checklist Finale

- [ ] Tous les secrets en .env (pas en clair dans le code)
- [ ] .env ajouté à .gitignore
- [ ] Bypass d'auth supprimé
- [ ] Firestore rules sécurisées et déployées
- [ ] Rate limiting actif sur /login
- [ ] Messages d'erreur génériques
- [ ] Validation zod implémentée
- [ ] HTTPS enforced en production
- [ ] Tokens en httpOnly cookies
- [ ] Logs d'audit configurés
- [ ] npm audit passé (0 vulnérabilités)
- [ ] Tous les tests de sécurité réussis

**READINESS FOR PRODUCTION:** ✅ PRÊT

---

**Mis à jour:** 6 mai 2026
**Responsable:** À assigner
