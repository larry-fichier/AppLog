import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import admin from "firebase-admin";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue, Firestore } from "firebase-admin/firestore";
import { query, queryHelios } from "./src/lib/db.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Health check route
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Initialize Firebase Admin
  const configPath = path.join(__dirname, "firebase-applet-config.json");
  const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  
  if (getApps().length === 0) {
    try {
      initializeApp({
        projectId: firebaseConfig.projectId
      });
      console.log("Firebase Admin initialized for project:", firebaseConfig.projectId);
    } catch (error) {
      console.error("Firebase Admin initialization failed:", error);
    }
  }

  const db = firebaseConfig.firestoreDatabaseId 
    ? new Firestore({ 
        projectId: firebaseConfig.projectId, 
        databaseId: firebaseConfig.firestoreDatabaseId 
      })
    : getFirestore();

  const auth = getAuth();

  app.use(express.json());

  // --- DATABASE INITIALIZATION ---
  async function initDatabase() {
    try {
      console.log("[DB] Initialisation des tables PostgreSQL...");
      
      await query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          firebase_uid VARCHAR(128) UNIQUE NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          display_name VARCHAR(255),
          role VARCHAR(50) DEFAULT 'agent_logistique',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          deleted_at TIMESTAMP
        )
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS categories (
          id VARCHAR(50) PRIMARY KEY,
          code VARCHAR(50) UNIQUE NOT NULL,
          label VARCHAR(100) NOT NULL,
          is_active BOOLEAN DEFAULT true
        )
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS zones (
          id VARCHAR(50) PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          is_active BOOLEAN DEFAULT true
        )
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS stations (
          id VARCHAR(50) PRIMARY KEY,
          zone_id VARCHAR(50) REFERENCES zones(id),
          name VARCHAR(100) NOT NULL,
          is_active BOOLEAN DEFAULT true
        )
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS services (
          id VARCHAR(50) PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          is_active BOOLEAN DEFAULT true
        )
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS bureaux (
          id VARCHAR(50) PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          is_active BOOLEAN DEFAULT true
        )
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS equipment (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          category_id VARCHAR(50) REFERENCES categories(id),
          status VARCHAR(50) DEFAULT 'fonctionnel',
          zone_id VARCHAR(50) REFERENCES zones(id),
          station_id VARCHAR(50) REFERENCES stations(id),
          service_id VARCHAR(50) REFERENCES services(id),
          bureau_id VARCHAR(50) REFERENCES bureaux(id),
          created_by VARCHAR(128),
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
      
      // Seed default categories if empty
      const catCheck = await query("SELECT COUNT(*) FROM categories");
      if (parseInt(catCheck.rows[0].count) === 0) {
        await query(`INSERT INTO categories (id, code, label) VALUES 
          ('rame', 'rame', 'Rame (Véhicule)'),
          ('cuisine', 'cuisine', 'Cuisine'),
          ('electronique', 'electronique', 'Électronique'),
          ('groupe', 'groupe', 'Groupe Électrogène')
        `);
      }
    } catch (e) {
      console.error("[DB] Erreur lors de l'initialisation de la base :", (e as Error).message);
    }
  }

  await initDatabase();

  // --- HELPER: get context for RLS ---
  const getContext = async (uid: string) => {
    // Special case for bypass/demo mode
    if (uid === "demo-admin-uid") {
      return { id: uid, role: "super_admin" };
    }

    if (!uid) return { id: "anonymous", role: "guest" };

    try {
      // 1. Check if it's the first user
      const userCountRes = await query('SELECT COUNT(*) FROM users');
      const isFirstUser = parseInt(userCountRes.rows[0].count) === 0;

      // 2. Lookup role in PostgreSQL
      const res = await query('SELECT id, role FROM users WHERE firebase_uid = $1 AND deleted_at IS NULL', [uid]);
      if (res.rows.length > 0) {
        return { id: res.rows[0].id, role: res.rows[0].role };
      }

      // 3. Admin fallback (Get email from Auth)
      const firebaseUser = await auth.getUser(uid);
      if (firebaseUser.email === "larryfichier@gmail.com" || isFirstUser) {
        return { id: uid, role: "admin" };
      }

      // 4. Fallback: Check Firestore profile
      const userDoc = await db.collection("users").doc(uid).get();
      if (userDoc.exists) {
        const data = userDoc.data();
        return { id: uid, role: data?.role || "agent_logistique" };
      }

    } catch (e) {
      console.error("[DB] Exception in getContext", (e as Error).message);
    }

    return { id: uid, role: "agent_logistique" };
  };

  // --- API: CONFIG ---
  app.get("/api/config", async (req, res) => {
    try {
      try {
        const categories = await query("SELECT * FROM categories WHERE is_active = true ORDER BY label");
        const zones = await query("SELECT * FROM zones WHERE is_active = true ORDER BY name");
        const stations = await query("SELECT * FROM stations WHERE is_active = true ORDER BY name");
        const services = await query("SELECT * FROM services WHERE is_active = true ORDER BY name");
        const bureaux = await query("SELECT * FROM bureaux WHERE is_active = true ORDER BY name");
        
        const categoryFields = await query("SELECT * FROM category_fields ORDER BY category_id, sort_order");

        return res.json({
          categories: categories.rows,
          zones: zones.rows,
          stations: stations.rows,
          services: services.rows,
          bureaux: bureaux.rows,
          fields: categoryFields.rows
        });
      } catch (err) {
        console.warn("[DB] PostgreSQL config fetch failed, trying Firestore fallback...");
        const configSnap = await db.collection("config").doc("global").get();
        if (configSnap.exists) {
          const data = configSnap.data();
          return res.json({
            categories: (data?.categories || []).map((c: any) => ({ ...c, is_active: true })),
            zones: (data?.zones || []).map((z: any) => ({ ...z, name: z.label, is_active: true })),
            stations: (data?.stations || []).map((s: any) => ({ ...s, name: s.label, is_active: true })),
            services: [],
            bureaux: [],
            fields: []
          });
        }
        throw err;
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/config", async (req, res) => {
    const callerUid = req.headers['x-user-uid'] as string;
    const { categories, zones, stations } = req.body;
    
    if (!callerUid) return res.status(401).json({ error: "Non authentifié" });

    console.log(`[Admin] Tentative de sauvegarde config par ${callerUid}`);
    try {
      const ctx = await getContext(callerUid);
      console.log(`[Admin] Contexte utilisateur:`, ctx);
      const allowedRoles = ["admin", "chef_bureau_logistique", "super_admin"];
      if (!allowedRoles.includes(ctx.role)) {
        console.warn(`[Admin] Accès refusé: rôle ${ctx.role} non autorisé`);
        return res.status(403).json({ error: "Autorisation refusée" });
      }

      // This is a complex update. For demo purposes, we'll implement a basic sync.
      // In a real app, you'd handle each entity separately.
      
      // Sync zones
      try {
        for (const zone of zones) {
          await query(`INSERT INTO zones (id, name, is_active) VALUES ($1, $2, true) ON CONFLICT (id) DO UPDATE SET name = $2`, [zone.id, zone.label]);
        }
      } catch (pgErr) {
        console.warn("[DB] Échec de la synchronisation des zones dans PG:", (pgErr as Error).message);
      }
      
      // Sync stations
      try {
        for (const station of stations) {
          const targetZoneId = station.zoneId || (await query("SELECT id FROM zones LIMIT 1")).rows[0]?.id;
          if (targetZoneId) {
            await query(`INSERT INTO stations (id, zone_id, name, is_active) VALUES ($1, $2, $3, true) ON CONFLICT (id) DO UPDATE SET name = $3, zone_id = $2`, [station.id, targetZoneId, station.label]);
          }
        }
      } catch (pgErr) {
        console.warn("[DB] Échec de la synchronisation des stations dans PG:", (pgErr as Error).message);
      }

      // Sync categories
      try {
        for (const cat of categories) {
          await query(`INSERT INTO categories (id, code, label, is_active) VALUES ($1, $2, $3, true) ON CONFLICT (id) DO UPDATE SET label = $3`, [cat.id, cat.id, cat.label]);
        }
      } catch (pgErr) {
        console.warn("[DB] Échec de la synchronisation des catégories dans PG:", (pgErr as Error).message);
      }

      // Also save to Firestore for backward compatibility
      await db.collection("config").doc("global").set(req.body);

      res.json({ success: true });
    } catch (e: any) {
      console.error("Save config error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // --- API: EQUIPMENT ---
  app.get("/api/equipment", async (req, res) => {
    const callerUid = req.headers['x-user-uid'] as string;
    if (!callerUid) return res.status(401).json({ error: "Non authentifié" });

    try {
      const ctx = await getContext(callerUid);
      let pgData: any[] = [];
      let firestoreData: any[] = [];

      // 1. Try PostgreSQL
      try {
        // Fetch equipment using RLS context
        const result = await queryHelios(`
          SELECT e.*, c.code as category_code, c.label as category_label 
          FROM equipment e
          JOIN categories c ON e.category_id = c.id
          WHERE e.deleted_at IS NULL
          ORDER BY e.created_at DESC
        `, [], ctx);

        // Fetch details for each equipment
        const equipmentIds = result.rows.map(r => r.id);
        let detailsResults: any[] = [];
        if (equipmentIds.length > 0) {
          const detailsRes = await query(`
            SELECT * FROM equipment_details WHERE equipment_id = ANY($1)
          `, [equipmentIds]);
          detailsResults = detailsRes.rows;
        }

        // Merge details into equipment objects
        pgData = result.rows.map(e => ({
          ...e,
          id: String(e.id),
          details: detailsResults
            .filter(d => d.equipment_id === e.id)
            .reduce((acc, curr) => ({ ...acc, [curr.field_key]: curr.field_value }), {})
        }));
      } catch (pgError) {
        console.warn("[DB] PostgreSQL fetch equipment failed, checking Firestore...", (pgError as Error).message);
      }

      // 2. Try Firestore
      try {
        const snapshot = await db.collection("equipment").where("deleted_at", "==", null).get();
        firestoreData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          created_at: doc.data().created_at?.toDate?.()?.toISOString() || doc.data().created_at
        }));
      } catch (fsError) {
        console.error("[DB] Firestore fetch equipment failed", (fsError as Error).message);
      }

      // 3. Merge and deduplicate (prefer Firestore for the same ID if we were syncing, but here they are likely distinct sets)
      const merged = [...pgData, ...firestoreData].sort((a, b) => {
        const dateA = new Date(a.created_at || 0).getTime();
        const dateB = new Date(b.created_at || 0).getTime();
        return dateB - dateA;
      });

      res.json(merged);
    } catch (e: any) {
      console.error("Fetch equipment error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/equipment", async (req, res) => {
    const callerUid = req.headers['x-user-uid'] as string;
    const { name, category_id, status, zone_id, station_id, service_id, bureau_id, details } = req.body;
    
    if (!callerUid) return res.status(401).json({ error: "Non authentifié" });

    try {
      const ctx = await getContext(callerUid);
      let equipmentId: string | number | null = null;
      
      // 1. Try PostgreSQL
      try {
        const queryText = `
          INSERT INTO equipment (name, category_id, status, zone_id, station_id, service_id, bureau_id, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id
        `;
        const values = [name, category_id, status, zone_id, station_id, service_id, bureau_id, ctx.id];
        
        const equipRes = await queryHelios(queryText, values, ctx);
        equipmentId = equipRes.rows[0].id;

        // Insert details
        if (details && typeof details === 'object') {
          for (const [key, val] of Object.entries(details)) {
            await query(`
              INSERT INTO equipment_details (equipment_id, field_key, field_value)
              VALUES ($1, $2, $3)
            `, [equipmentId, key, String(val)]);
          }
        }
      } catch (pgError) {
        console.warn("[DB] PostgreSQL create equipment failed, falling back to Firestore...", (pgError as Error).message);
      }

      // 2. Always write to Firestore (or fallback)
      const firestoreRef = await db.collection("equipment").add({
        name,
        category_id,
        status,
        zone_id,
        station_id: station_id || null,
        service_id: service_id || null,
        bureau_id: bureau_id || null,
        created_by: ctx.id,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
        deleted_at: null,
        details: details || {},
        pg_id: equipmentId ? String(equipmentId) : null
      });

      res.status(201).json({ id: equipmentId || firestoreRef.id });
    } catch (e: any) {
      console.error("Create equipment error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/equipment/:id", async (req, res) => {
    const { id } = req.params;
    const callerUid = req.headers['x-user-uid'] as string;
    const { name, category_id, status, zone_id, station_id, service_id, bureau_id, details } = req.body;
    
    if (!callerUid) return res.status(401).json({ error: "Non authentifié" });

    try {
      const ctx = await getContext(callerUid);
      
      // 1. Try PostgreSQL
      try {
        if (!isNaN(Number(id))) {
          const queryText = `
            UPDATE equipment 
            SET name = $1, category_id = $2, status = $3, zone_id = $4, station_id = $5, service_id = $6, bureau_id = $7, updated_at = NOW()
            WHERE id = $8
          `;
          const values = [name, category_id, status, zone_id, station_id, service_id, bureau_id, id];
          await queryHelios(queryText, values, ctx);

          // Update details: simplest is delete all and re-insert for the equipment
          await query(`DELETE FROM equipment_details WHERE equipment_id = $1`, [id]);
          if (details && typeof details === 'object') {
            for (const [key, val] of Object.entries(details)) {
              await query(`
                INSERT INTO equipment_details (equipment_id, field_key, field_value)
                VALUES ($1, $2, $3)
              `, [id, key, String(val)]);
            }
          }
        }
      } catch (pgError) {
        console.warn("[DB] PostgreSQL update equipment failed, falling back to Firestore...", (pgError as Error).message);
      }

      // 2. Try Firestore Update
      // Try by doc ID or by pg_id
      try {
        const docRef = db.collection("equipment").doc(id);
        const docSnap = await docRef.get();
        
        if (docSnap.exists) {
          await docRef.update({
            name, category_id, status, zone_id, 
            station_id: station_id || null, 
            service_id: service_id || null, 
            bureau_id: bureau_id || null, 
            details: details || {},
            updated_at: FieldValue.serverTimestamp()
          });
        } else {
          // Find by pg_id
          const pgSnap = await db.collection("equipment").where("pg_id", "==", id).get();
          if (!pgSnap.empty) {
            await pgSnap.docs[0].ref.update({
              name, category_id, status, zone_id, 
              details: details || {},
              updated_at: FieldValue.serverTimestamp()
            });
          }
        }
      } catch (fsError) {
        console.warn("[DB] Firestore update equipment failed:", (fsError as Error).message);
      }

      res.status(200).json({ success: true });
    } catch (e: any) {
      console.error("Update equipment error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/equipment/:id", async (req, res) => {
    const { id } = req.params;
    const callerUid = req.headers['x-user-uid'] as string;
    
    if (!callerUid) return res.status(401).json({ error: "Non authentifié" });

    try {
      const ctx = await getContext(callerUid);
      
      // 1. Try PostgreSQL
      try {
        if (!isNaN(Number(id))) {
          await queryHelios(`UPDATE equipment SET deleted_at = NOW() WHERE id = $1`, [id], ctx);
        }
      } catch (pgError) {
        console.warn("[DB] PostgreSQL delete equipment failed, falling back to Firestore...", (pgError as Error).message);
      }

      // 2. Try Firestore Mark Deleted
      try {
        const docRef = db.collection("equipment").doc(id);
        const docSnap = await docRef.get();
        if (docSnap.exists) {
          await docRef.update({ deleted_at: FieldValue.serverTimestamp() });
        } else {
          const pgSnap = await db.collection("equipment").where("pg_id", "==", id).get();
          if (!pgSnap.empty) {
            await pgSnap.docs[0].ref.update({ deleted_at: FieldValue.serverTimestamp() });
          }
        }
      } catch (fsError) {
        console.warn("[DB] Firestore delete equipment failed:", (fsError as Error).message);
      }

      res.status(200).json({ success: true });
    } catch (e: any) {
      console.error("Delete equipment error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // API Route to register a user (Admin only)
  app.post("/api/admin/users", async (req, res) => {
    const { email, password, displayName, role } = req.body;
    const callerUid = req.headers['x-user-uid'] as string;

    try {
      console.log(`[Admin] Création utilisateur: ${email} par l'appelant: ${callerUid}`);
      
      const ctx = await getContext(callerUid);
      const allowedRoles = ["admin", "chef_bureau_logistique", "super_admin"];
      if (!allowedRoles.includes(ctx.role)) {
        return res.status(403).json({ error: "Autorisation refusée (Admin requis)" });
      }

      // Create Auth User
      const userRecord = await auth.createUser({
        email,
        password,
        displayName,
      });

      // 1. Sync with PG
      try {
        await query(`
          INSERT INTO users (firebase_uid, email, display_name, role)
          VALUES ($1, $2, $3, $4)
        `, [userRecord.uid, userRecord.email, userRecord.displayName, role || "agent_logistique"]);
      } catch (pgError) {
        console.warn("[DB] Échec de la synchronisation PG lors de la création d'utilisateur, continuation locale...", (pgError as Error).message);
      }

      // 2. Keep Firestore Profile (Backward compatibility for now)
      await db.collection("users").doc(userRecord.uid).set({
        uid: userRecord.uid,
        email: userRecord.email,
        displayName: userRecord.displayName,
        role: role || "agent_logistique",
        createdAt: FieldValue.serverTimestamp(),
      });

      res.status(201).json({ uid: userRecord.uid });
    } catch (error: any) {
      console.error("Error creating user:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API Route to delete a user (Admin only)
  app.delete("/api/admin/users/:uid", async (req, res) => {
    const { uid } = req.params;
    const callerUid = req.headers['x-user-uid'] as string;

    try {
      console.log(`[Admin] Suppression utilisateur: ${uid} par l'appelant: ${callerUid}`);
      
      const ctx = await getContext(callerUid);
      const allowedRoles = ["admin", "chef_bureau_logistique", "super_admin"];
      if (!allowedRoles.includes(ctx.role)) {
        return res.status(403).json({ error: "Autorisation refusée (Admin requis)" });
      }

      // Delete Auth User
      await auth.deleteUser(uid);

      // 1. PG Soft Delete
      try {
        await query(`UPDATE users SET deleted_at = NOW() WHERE firebase_uid = $1`, [uid]);
      } catch (pgError) {
        console.warn("[DB] Échec du soft delete PG, continuation locale...", (pgError as Error).message);
      }

      // 2. Delete Firestore Profile
      await db.collection("users").doc(uid).delete();

      res.status(200).json({ success: true });
    } catch (error: any) {
      console.error("Error deleting user:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // --- API: BULK IMPORT ---
  app.post("/api/admin/import", async (req, res) => {
    const callerUid = req.headers['x-user-uid'] as string;
    const { data } = req.body; // Array of items
    
    if (!callerUid) return res.status(401).json({ error: "Non authentifié" });
    if (!Array.isArray(data)) return res.status(400).json({ error: "Format de données invalide" });

    try {
      const ctx = await getContext(callerUid);
      const allowedRoles = ["admin", "super_admin"];
      if (!allowedRoles.includes(ctx.role)) {
        return res.status(403).json({ error: "Autorisation refusée" });
      }

      console.log(`[Import] Début import de ${data.length} lignes par ${ctx.id}`);
      
      let importedCount = 0;
      let errors: string[] = [];

      // Get existing config to map names to IDs
      let cats: any[] = [];
      let zones: any[] = [];
      let stations: any[] = [];

      try {
        const catsRes = await query("SELECT id, code, label FROM categories");
        const zonesRes = await query("SELECT id, name FROM zones");
        const stationsRes = await query("SELECT id, name FROM stations");
        cats = catsRes.rows;
        zones = zonesRes.rows;
        stations = stationsRes.rows;
      } catch (pgErr) {
        console.warn("[Import] PG config fetch failed, using Firestore config for mapping...");
        const configSnap = await db.collection("config").doc("global").get();
        if (configSnap.exists) {
          const cfg = configSnap.data();
          cats = (cfg?.categories || []).map((c: any) => ({ ...c, code: c.id }));
          zones = (cfg?.zones || []).map((z: any) => ({ ...z, name: z.label }));
          stations = (cfg?.stations || []).map((s: any) => ({ ...s, name: s.label }));
        }
      }

      // Helper for fuzzy matching
      const findBestMatch = (input: string, choices: { id: string, name?: string, label?: string, code?: string }[], type: 'name' | 'label' | 'code' = 'label') => {
        if (!input) return null;
        const normalizedInput = input.trim().toLowerCase();
        
        // 1. Exact match
        let match = choices.find(c => {
          const val = (c as any)[type] || (c as any).name || (c as any).label || (c as any).code;
          return val?.toString().toLowerCase() === normalizedInput;
        });
        if (match) return match;

        // 2. Substring match
        match = choices.find(c => {
          const val = ((c as any)[type] || (c as any).name || (c as any).label || (c as any).code)?.toString().toLowerCase();
          return val?.includes(normalizedInput) || normalizedInput.includes(val || "");
        });
        if (match) return match;

        // 3. Fallback: First one for the type if strictly needed or null
        return null;
      };

      for (let i = 0; i < data.length; i++) {
        const item = data[i];
        try {
          // 1. Map Category (Intelligent fuzzy match)
          const cat = findBestMatch(item.category, cats, 'label');
          if (!cat) throw new Error(`Catégorie non reconnue: "${item.category}".`);

          // 2. Map Zone (Intelligent fuzzy match)
          const zone = findBestMatch(item.zone, zones, 'name');
          if (!zone) throw new Error(`Zone non reconnue: "${item.zone}".`);

          // 3. Map Station (optional)
          const station = findBestMatch(item.station, stations, 'name');

          // 4. Map Status (Intelligent mapping for Access codes)
          let finalStatus = "fonctionnel";
          const rawStatus = String(item.status || "").toLowerCase();
          if (rawStatus === "1" || rawStatus.includes("fonction") || rawStatus.includes("neuf")) {
            finalStatus = "fonctionnel";
          } else if (rawStatus === "2" || rawStatus.includes("repar") || rawStatus.includes("panne")) {
            finalStatus = "en_reparation";
          } else if (rawStatus === "3" || rawStatus.includes("hors") || rawStatus.includes("mort")) {
            finalStatus = "hors_service";
          }

          // 5. Try PostgreSQL Insert first
          let pgSuccess = false;
          try {
            const queryText = `
              INSERT INTO equipment (name, category_id, status, zone_id, station_id, created_by)
              VALUES ($1, $2, $3, $4, $5, $6)
              RETURNING id
            `;
            const values = [item.name || `Import #${i+1}`, cat.id, finalStatus, zone.id, station?.id || null, ctx.id];
            
            const equipRes = await queryHelios(queryText, values, ctx);
            const equipmentId = equipRes.rows[0].id;

            // Details (optional)
            if (item.details && typeof item.details === 'object') {
              for (const [key, val] of Object.entries(item.details)) {
                if (val) {
                  await query(`
                    INSERT INTO equipment_details (equipment_id, field_key, field_value)
                    VALUES ($1, $2, $3)
                  `, [equipmentId, key, String(val)]);
                }
              }
            }
            pgSuccess = true;
          } catch (e) {
            // Silently allow fallback to Firestore
          }

          // 6. Firestore Fallback (or Dual Write)
          const equipmentDoc = {
            name: item.name || `Import #${i+1}`,
            category_id: cat.id,
            category_label: cat.label || "",
            status: finalStatus,
            zone_id: zone.id,
            zone_label: zone.name || "",
            station_id: station?.id || null,
            station_label: station?.name || "",
            created_by: ctx.id,
            created_at: FieldValue.serverTimestamp(),
            deleted_at: null,
            details: item.details || {}
          };
          await db.collection("equipment").add(equipmentDoc);
          
          importedCount++;
        } catch (e: any) {
          errors.push(`Ligne ${i + 1}: ${e.message}`);
        }
      }

      res.json({ 
        success: true, 
        imported: importedCount, 
        total: data.length,
        errors: errors.slice(0, 10), // Return only first 10 errors
        hasMoreErrors: errors.length > 10
      });
    } catch (e: any) {
      console.error("Import error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🚀 HELIOS démarré avec succès !`);
    console.log(`🔗 Accès local: http://localhost:${PORT}`);
    console.log(`⚙️ Mode: ${process.env.NODE_ENV || 'development'}\n`);
  });
}

startServer();
