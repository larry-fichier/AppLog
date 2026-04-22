import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { query, queryHelios, initPersistence } from "./src/lib/db.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// JWT Secret - ideally from env
const JWT_SECRET = process.env.JWT_SECRET || "helios-super-secret-key-2024";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Health check route
  app.get("/api/health", async (req, res) => {
    // @ts-ignore
    const dbStatus = (await import("./src/lib/db.ts")).default;
    res.json({ 
      status: "ok", 
      timestamp: new Date().toISOString(), 
      databaseMode: dbStatus.isRealPostgres ? "PostgreSQL Réel" : "Mémoire (Fallback)",
      env: {
        hasDbUrl: !!process.env.DATABASE_URL,
        hasDbHost: !!process.env.PGHOST
      }
    });
  });

  app.use(express.json());

  // --- DATABASE INITIALIZATION ---
  async function initDatabase() {
    if (!process.env.DATABASE_URL && !process.env.PGHOST) {
      console.error("[DB] ALERTE: Aucune configuration PostgreSQL trouvée.");
    }
    try {
      await query("SELECT 1");
      console.log("[DB] Connexion PostgreSQL vérifiée.");
      
      // Extension pour UUID si besoin (ne fonctionne que sur PG réel avec droits superuser)
      try { await query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'); } catch (e) {}

      await query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(128) UNIQUE,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash TEXT,
          display_name VARCHAR(255),
          role VARCHAR(50) DEFAULT 'agent_logistique',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          deleted_at TIMESTAMP
        )
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS categories (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          code VARCHAR(100) UNIQUE NOT NULL,
          label VARCHAR(150) NOT NULL,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS zones (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(150) UNIQUE NOT NULL,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS stations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          zone_id UUID REFERENCES zones(id),
          name VARCHAR(150) NOT NULL,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(zone_id, name)
        )
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS category_fields (
          id SERIAL PRIMARY KEY,
          category_id UUID REFERENCES categories(id),
          label VARCHAR(100) NOT NULL,
          type VARCHAR(50) DEFAULT 'text',
          sort_order INTEGER DEFAULT 0
        )
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS equipment (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          category_id UUID REFERENCES categories(id),
          status VARCHAR(50) DEFAULT 'fonctionnel',
          zone_id UUID REFERENCES zones(id),
          station_id UUID REFERENCES stations(id),
          created_by INTEGER REFERENCES users(id),
          description TEXT,
          serial_number VARCHAR(100),
          purchase_date DATE,
          qr_code_data TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          deleted_at TIMESTAMP
        )
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS equipment_details (
          id SERIAL PRIMARY KEY,
          equipment_id INTEGER REFERENCES equipment(id),
          field_key VARCHAR(100) NOT NULL,
          field_value TEXT
        )
      `);

      console.log("[DB] Tables PostgreSQL prêtes.");
      
      // Create Super Admin if not exists
      const adminEmail = "larryfichier@gmail.com";
      const adminCheck = await query("SELECT id FROM users WHERE email = $1", [adminEmail]);
      if (adminCheck.rows.length === 0) {
        const hashedPassword = await bcrypt.hash("admin123", 10);
        await query(`
          INSERT INTO users (username, email, password_hash, display_name, role)
          VALUES ($1, $2, $3, $4, $5)
        `, ["admin", adminEmail, hashedPassword, "Super Admin", "admin"]);
        console.log(`[Auth] Utilisateur admin par défaut créé: ${adminEmail} (Pass: admin123)`);
      }

      // Seed default categories if empty
      const catCheck = await query("SELECT COUNT(*) FROM categories");
      if (parseInt(catCheck.rows[0].count) === 0) {
        await query(`INSERT INTO categories (id, code, label) VALUES 
          ('rame', 'rame', 'Rame (Véhicule)'),
          ('cuisine', 'cuisine', 'Cuisine'),
          ('electronique', 'electronique', 'Électronique'),
          ('groupe', 'groupe', 'Groupe Électrogène')
          ON CONFLICT (id) DO NOTHING
        `);
      }

      // Seed default zones if empty
      const zoneCheck = await query("SELECT COUNT(*) FROM zones");
      if (parseInt(zoneCheck.rows[0].count) === 0) {
        await query(`INSERT INTO zones (id, name, is_active) VALUES 
          ('operation', 'Opérations', true),
          ('administratif', 'Administratif', true)
          ON CONFLICT (id) DO NOTHING
        `);
      }
    } catch (e) {
      console.error("[DB] Erreur lors de l'initialisation de la base :", (e as Error).message);
    }
  }

  await initDatabase();
  await initPersistence();

  // --- AUTH MIDDLEWARE ---
  const authenticateToken = async (req: any, res: any, next: any) => {
    try {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];

      // Fallback support for old client mode if needed (not recommended)
      const bypassUid = req.headers['x-user-uid'];
      if (bypassUid === "demo-admin-uid") {
        req.user = { id: 1, role: "admin", email: "larryfichier@gmail.com" };
        return next();
      }

      if (!token) {
        return res.status(401).json({ error: "Session expirée ou invalide. Veuillez vous connecter." });
      }

      // Promisified jwt.verify for cleaner async/await
      const decoded: any = await new Promise((resolve, reject) => {
        jwt.verify(token, JWT_SECRET, (err: any, data: any) => {
          if (err) reject(err);
          else resolve(data);
        });
      }).catch(err => {
        return null;
      });

      if (!decoded || !decoded.id) {
        return res.status(403).json({ error: "Accès refusé. Token invalide." });
      }

      // Verify user still exists in DB
      const result = await query("SELECT id, role, email, display_name FROM users WHERE id = $1 AND deleted_at IS NULL", [decoded.id]);
      if (result.rows.length === 0) {
        return res.status(401).json({ error: "Utilisateur non trouvé" });
      }
      
      req.user = result.rows[0];
      next();
    } catch (globalErr) {
      console.error("[Auth] Global middleware error:", globalErr);
      res.status(500).json({ error: "Erreur interne de sécurité" });
    }
  };

  // --- HELPER: get context for RLS ---
  // Modified to use local user object
  const getContext = async (user: any) => {
    if (!user) return { id: 0, role: "guest" };
    return { id: user.id, role: user.role };
  };

  // --- API: AUTH ---
  app.post("/api/auth/login", async (req, res) => {
    const { email, username, password } = req.body;
    try {
      // Find user by email or username
      const result = await query(
        "SELECT * FROM users WHERE (email = $1 OR username = $2) AND deleted_at IS NULL",
        [email || "", username || ""]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: "Utilisateur non trouvé" });
      }

      const user = result.rows[0];
      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) {
        return res.status(401).json({ error: "Mot de passe incorrect" });
      }

      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          displayName: user.display_name,
          role: user.role
        }
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/auth/me", authenticateToken, (req: any, res) => {
    res.json(req.user);
  });

  // --- API: CONFIG ---
  app.get("/api/config", async (req, res) => {
    try {
      const categories = await query("SELECT * FROM categories WHERE is_active = true ORDER BY label");
      const zones = await query("SELECT * FROM zones WHERE is_active = true ORDER BY name");
      const stations = await query("SELECT * FROM stations WHERE is_active = true ORDER BY name");
      const categoryFields = await query("SELECT * FROM category_fields ORDER BY category_id");

      return res.json({
        categories: categories.rows,
        zones: zones.rows,
        stations: stations.rows,
        fields: categoryFields.rows
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/config", authenticateToken, async (req: any, res) => {
    const { categories, zones, stations } = req.body;
    
    try {
      const ctx = await getContext(req.user);
      const allowedRoles = ["admin", "chef_bureau_logistique"];
      if (!allowedRoles.includes(ctx.role)) {
        return res.status(403).json({ error: "Autorisation refusée" });
      }

      // Sync zones
      console.log(`[Config] Syncing ${zones.length} zones...`);
      const zoneIds = zones.map((z: any) => z.id).filter(Boolean);
      if (zoneIds.length > 0) {
        await query("UPDATE zones SET is_active = false WHERE id != ANY($1)", [zoneIds]);
      }
      for (const zone of zones) {
        if (!zone.id) continue;
        await query(`
          INSERT INTO zones (id, name, is_active) 
          VALUES ($1, $2, true) 
          ON CONFLICT (id) DO UPDATE SET name = $2, is_active = true
        `, [zone.id, zone.label || zone.name || "Sans Nom"]);
      }
      
      // Sync stations
      console.log(`[Config] Syncing ${stations.length} stations...`);
      const stationIds = stations.map((s: any) => s.id).filter(Boolean);
      if (stationIds.length > 0) {
        await query("UPDATE stations SET is_active = false WHERE id != ANY($1)", [stationIds]);
      }
      for (const station of stations) {
        if (!station.id) continue;
        // Ensure we have a valid zoneId, otherwise use a fallback or skip
        const targetZoneId = station.zoneId || (zoneIds.length > 0 ? zoneIds[0] : null);
        if (targetZoneId) {
          await query(`
            INSERT INTO stations (id, zone_id, name, is_active) 
            VALUES ($1, $2, $3, true) 
            ON CONFLICT (id) DO UPDATE SET name = $3, zone_id = $2, is_active = true
          `, [station.id, targetZoneId, station.label || station.name || "Sans Nom"]);
        }
      }

      // Sync categories
      console.log(`[Config] Syncing ${categories.length} categories...`);
      const catIds = categories.map((c: any) => c.id).filter(Boolean);
      if (catIds.length > 0) {
        await query("UPDATE categories SET is_active = false WHERE id != ANY($1)", [catIds]);
      }
      for (const cat of categories) {
        if (!cat.id) continue;
        await query(`
          INSERT INTO categories (id, code, label, is_active) 
          VALUES ($1, $2, $3, true) 
          ON CONFLICT (id) DO UPDATE SET label = $3, is_active = true
        `, [cat.id, cat.id, cat.label || cat.name || "Sans Nom"]);
      }

      console.log("[Config] Configuration synchronisée avec succès.");
      res.json({ success: true });
    } catch (e: any) {
      console.error("Save config error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // --- API: EQUIPMENT ---
  app.get("/api/equipment", authenticateToken, async (req: any, res) => {
    try {
      const ctx = await getContext(req.user);
      
      // Fetch equipment using RLS context
      const result = await queryHelios(`
        SELECT e.*, c.code as category_code, c.label as category_label, 
               z.name as zone_name, s.name as station_name
        FROM equipment e
        LEFT JOIN categories c ON e.category_id = c.id
        LEFT JOIN zones z ON e.zone_id = z.id
        LEFT JOIN stations s ON e.station_id = s.id
        WHERE e.deleted_at IS NULL
        ORDER BY e.created_at DESC
      `, [], ctx);

      // Fetch details
      const equipmentIds = result.rows.map(r => r.id);
      let detailsResults: any[] = [];
      if (equipmentIds.length > 0) {
        const detailsRes = await query(`
          SELECT * FROM equipment_details WHERE equipment_id = ANY($1)
        `, [equipmentIds]);
        detailsResults = detailsRes.rows;
      }

      const merged = result.rows.map(e => ({
        ...e,
        id: String(e.id),
        category: e.category_id,
        location: {
          zone: e.zone_id,
          station: e.station_id,
          service: e.zone_id, // Legacy support for dashboard view
          office: e.station_id  // Legacy support for dashboard view
        },
        details: detailsResults
          .filter(d => d.equipment_id === e.id)
          .reduce((acc, curr) => ({ ...acc, [curr.field_key]: curr.field_value }), {})
      }));

      res.json(merged);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/equipment", authenticateToken, async (req: any, res) => {
    const { name, category_id, status, zone_id, station_id, details } = req.body;
    try {
      const ctx = await getContext(req.user);
      
      const equipRes = await queryHelios(`
        INSERT INTO equipment (name, category_id, status, zone_id, station_id, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `, [name, category_id, status, zone_id, station_id, ctx.id], ctx);
      
      const equipmentId = equipRes.rows[0].id;

      if (details) {
        for (const [key, val] of Object.entries(details)) {
          await query(`
            INSERT INTO equipment_details (equipment_id, field_key, field_value)
            VALUES ($1, $2, $3)
          `, [equipmentId, key, String(val)]);
        }
      }

      res.status(201).json({ id: String(equipmentId) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/equipment/:id", authenticateToken, async (req: any, res) => {
    const { id } = req.params;
    const { name, category_id, status, zone_id, station_id, details } = req.body;
    try {
      const ctx = await getContext(req.user);
      
      await queryHelios(`
        UPDATE equipment 
        SET name = $1, category_id = $2, status = $3, zone_id = $4, station_id = $5, updated_at = NOW()
        WHERE id = $6
      `, [name, category_id, status, zone_id, station_id, id], ctx);

      await query(`DELETE FROM equipment_details WHERE equipment_id = $1`, [id]);
      if (details) {
        for (const [key, val] of Object.entries(details)) {
          await query(`
            INSERT INTO equipment_details (equipment_id, field_key, field_value)
            VALUES ($1, $2, $3)
          `, [id, key, String(val)]);
        }
      }

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/equipment/:id", authenticateToken, async (req: any, res) => {
    const { id } = req.params;
    try {
      const ctx = await getContext(req.user);
      await queryHelios(`UPDATE equipment SET deleted_at = NOW() WHERE id = $1`, [id], ctx);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- API: USER MANAGEMENT ---
  app.get("/api/admin/users", authenticateToken, async (req: any, res) => {
    try {
      const ctx = await getContext(req.user);
      if (ctx.role !== "admin") return res.status(403).json({ error: "Admin requis" });
      
      const result = await query("SELECT id, username, email, display_name, role FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC");
      res.json(result.rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/users", authenticateToken, async (req: any, res) => {
    const { username, email, password, displayName, role } = req.body;
    try {
      const ctx = await getContext(req.user);
      if (ctx.role !== "admin") return res.status(403).json({ error: "Admin requis" });

      const hashedPassword = await bcrypt.hash(password, 10);
      const result = await query(`
        INSERT INTO users (username, email, password_hash, display_name, role)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [username, email, hashedPassword, displayName, role || "agent_logistique"]);

      res.status(201).json({ id: result.rows[0].id });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/admin/users/:id", authenticateToken, async (req: any, res) => {
    const { id } = req.params;
    try {
      const ctx = await getContext(req.user);
      if (ctx.role !== "admin") return res.status(403).json({ error: "Admin requis" });
      if (parseInt(id) === ctx.id) return res.status(400).json({ error: "Impossible de se supprimer soi-même" });

      await query("UPDATE users SET deleted_at = NOW() WHERE id = $1", [id]);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/admin/users/:id/role", authenticateToken, async (req: any, res) => {
    const { id } = req.params;
    const { role } = req.body;
    try {
      const ctx = await getContext(req.user);
      if (ctx.role !== "admin") return res.status(403).json({ error: "Admin requis" });
      
      await query("UPDATE users SET role = $1 WHERE id = $2", [role, id]);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- API: BULK IMPORT SETUP (ZONES/STATIONS) ---
  app.post("/api/admin/import-setup", authenticateToken, async (req: any, res) => {
    const { data } = req.body;
    try {
      const ctx = await getContext(req.user);
      const allowedRoles = ["admin", "chef_bureau_logistique"];
      if (!allowedRoles.includes(ctx.role)) {
        return res.status(403).json({ error: "Accès refusé" });
      }

      let importedCount = 0;
      const errors: string[] = [];

      // Simple deduplication for zones in the batch
      const uniqueZones = Array.from(new Set(data.map((item: any) => item.zone))).filter(Boolean);
      const zoneMap: Record<string, string> = {};

      // Create or ensure zones exist
      for (const zoneName of uniqueZones as string[]) {
        try {
          const zoneRes = await query(`
            INSERT INTO zones (name, is_active) 
            VALUES ($1, true) 
            ON CONFLICT (name) DO UPDATE SET is_active = true, updated_at = NOW()
            RETURNING id
          `, [zoneName]);
          
          if (zoneRes.rows.length > 0) {
            zoneMap[zoneName] = zoneRes.rows[0].id;
          }
        } catch (e: any) {
          errors.push(`Erreur zone "${zoneName}": ${e.message}`);
        }
      }

      // Create stations
      for (const item of data) {
        if (!item.station) continue;
        try {
          const zoneId = zoneMap[item.zone];
          if (!zoneId) {
            errors.push(`Erreur station "${item.station}": Zone "${item.zone}" introuvable`);
            continue;
          }
          
          await query(`
            INSERT INTO stations (zone_id, name, is_active) 
            VALUES ($1, $2, true) 
            ON CONFLICT (zone_id, name) DO UPDATE SET is_active = true, updated_at = NOW()
          `, [zoneId, item.station]);
          
          importedCount++;
        } catch (e: any) {
          errors.push(`Erreur station "${item.station}": ${e.message}`);
        }
      }

      res.json({ imported: importedCount, total: data.length, errors });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- API: BULK IMPORT EQUIPMENT ---
  app.post("/api/admin/import", authenticateToken, async (req: any, res) => {
    const { data } = req.body;
    try {
      const ctx = await getContext(req.user);
      if (ctx.role !== "admin" && ctx.role !== "chef_bureau_logistique") {
        return res.status(403).json({ error: "Accès refusé" });
      }

      let importedCount = 0;
      const errors: string[] = [];

      for (const item of data) {
        try {
          // Find or create category
          let categoryId = item.category;
          const catRes = await query("SELECT id FROM categories WHERE label = $1 OR id = $2", [item.category, item.category]);
          if (catRes.rows.length > 0) {
            categoryId = catRes.rows[0].id;
          } else {
            // Use 'rame' as default if not found
            categoryId = 'rame';
          }

          // Find or create zone
          let zoneId = item.zone;
          const zoneRes = await query("SELECT id FROM zones WHERE name = $1 OR id = $2", [item.zone, item.zone]);
          if (zoneRes.rows.length > 0) {
            zoneId = zoneRes.rows[0].id;
          } else {
             zoneId = 'operation';
          }

          // Find or create station
          let stationId = item.station;
          const stationRes = await query("SELECT id FROM stations WHERE name = $1 OR id = $2", [item.station, item.station]);
          if (stationRes.rows.length > 0) {
            stationId = stationRes.rows[0].id;
          } else {
            stationId = null;
          }

          const equipRes = await query(`
            INSERT INTO equipment (name, category_id, status, zone_id, station_id, created_by)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
          `, [item.name, categoryId, item.status || 'fonctionnel', zoneId, stationId, ctx.id]);
          
          const newId = equipRes.rows[0].id;

          if (item.details) {
            for (const [key, val] of Object.entries(item.details)) {
              await query(`
                INSERT INTO equipment_details (equipment_id, field_key, field_value)
                VALUES ($1, $2, $3)
              `, [newId, key, String(val)]);
            }
          }
          importedCount++;
        } catch (e: any) {
          errors.push(`Erreur sur "${item.name}": ${e.message}`);
        }
      }

      res.json({ imported: importedCount, total: data.length, errors });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Vite middleware for development ---
  if (process.env.NODE_ENV !== "production") {
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Helios] Serveur opérationnel (Mode PostgreSQL). Port:${PORT}`);
  });
}

startServer();
