import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import admin from "firebase-admin";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
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
        credential: admin.credential.applicationDefault(),
        projectId: firebaseConfig.projectId
      });
      console.log("Firebase Admin initialized for project:", firebaseConfig.projectId);
    } catch (error) {
      console.warn("Firebase Admin initialization with default credentials failed. Falling back...");
      try {
        initializeApp({
          projectId: firebaseConfig.projectId
        });
        console.log("Firebase Admin initialized with projectId only (Development mode)");
      } catch (innerError) {
        console.error("Firebase Admin initialization failed completely:", innerError);
      }
    }
  }

  const db = firebaseConfig.firestoreDatabaseId 
    ? getFirestore(firebaseConfig.firestoreDatabaseId)
    : getFirestore();

  const auth = getAuth();

  app.use(express.json());

  // --- HELPER: get context for RLS ---
  const getContext = async (uid: string) => {
    // We check PG first for the role
    const res = await query('SELECT role FROM users WHERE firebase_uid = $1 AND deleted_at IS NULL', [uid]);
    if (res.rows.length > 0) {
      return { id: res.rows[0].id, role: res.rows[0].role };
    }
    // Fallback: Check Firestore if PG is not yet populated (e.g. during migration)
    const userDoc = await db.collection("users").doc(uid).get();
    if (userDoc.exists) {
      return { id: uid, role: userDoc.data()?.role || "agent_logistique" };
    }
    return { id: uid, role: "agent_logistique" };
  };

  // --- API: CONFIG ---
  app.get("/api/config", async (req, res) => {
    try {
      const categories = await query("SELECT * FROM categories WHERE is_active = true ORDER BY label");
      const zones = await query("SELECT * FROM zones WHERE is_active = true ORDER BY name");
      const stations = await query("SELECT * FROM stations WHERE is_active = true ORDER BY name");
      const services = await query("SELECT * FROM services WHERE is_active = true ORDER BY name");
      const bureaux = await query("SELECT * FROM bureaux WHERE is_active = true ORDER BY name");
      
      const categoryFields = await query("SELECT * FROM category_fields ORDER BY category_id, sort_order");

      res.json({
        categories: categories.rows,
        zones: zones.rows,
        stations: stations.rows,
        services: services.rows,
        bureaux: bureaux.rows,
        fields: categoryFields.rows
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/config", async (req, res) => {
    const callerUid = req.headers['x-user-uid'] as string;
    const { categories, zones, stations } = req.body;
    
    if (!callerUid) return res.status(401).json({ error: "Non authentifié" });

    try {
      const ctx = await getContext(callerUid);
      const allowedRoles = ["admin", "chef_bureau_logistique", "super_admin"];
      if (!allowedRoles.includes(ctx.role)) {
        return res.status(403).json({ error: "Autorisation refusée" });
      }

      // This is a complex update. For demo purposes, we'll implement a basic sync.
      // In a real app, you'd handle each entity separately.
      
      // Sync zones
      for (const zone of zones) {
        await query(`INSERT INTO zones (id, name, is_active) VALUES ($1, $2, true) ON CONFLICT (id) DO UPDATE SET name = $2`, [zone.id, zone.label]);
      }
      
      // Sync stations
      for (const station of stations) {
        // We assume station belongs to a default zone if not specified, find first zone
        const zoneRes = await query("SELECT id FROM zones LIMIT 1");
        const defaultZoneId = zoneRes.rows[0]?.id;
        if (defaultZoneId) {
          await query(`INSERT INTO stations (id, zone_id, name, is_active) VALUES ($1, $2, $3, true) ON CONFLICT (id) DO UPDATE SET name = $3`, [station.id, defaultZoneId, station.label]);
        }
      }

      // Sync categories
      for (const cat of categories) {
        await query(`INSERT INTO categories (id, code, label, is_active) VALUES ($1, $2, $3, true) ON CONFLICT (id) DO UPDATE SET label = $3`, [cat.id, cat.id, cat.label]);
      }

      // Also save to Firestore for backward compatibility
      await db.collection("config").doc("global").set({ categories, zones, stations });

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
      const data = result.rows.map(e => ({
        ...e,
        details: detailsResults
          .filter(d => d.equipment_id === e.id)
          .reduce((acc, curr) => ({ ...acc, [curr.field_key]: curr.field_value }), {})
      }));

      res.json(data);
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
      
      // We perform all writes in a transaction using queryHelios for RLS
      const queryText = `
        INSERT INTO equipment (name, category_id, status, zone_id, station_id, service_id, bureau_id, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `;
      const values = [name, category_id, status, zone_id, station_id, service_id, bureau_id, ctx.id];
      
      const equipRes = await queryHelios(queryText, values, ctx);
      const equipmentId = equipRes.rows[0].id;

      // Insert details
      if (details && typeof details === 'object') {
        for (const [key, val] of Object.entries(details)) {
          await query(`
            INSERT INTO equipment_details (equipment_id, field_key, field_value)
            VALUES ($1, $2, $3)
          `, [equipmentId, key, String(val)]);
        }
      }

      res.status(201).json({ id: equipmentId });
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
      
      // Soft delete using RLS context
      await queryHelios(`UPDATE equipment SET deleted_at = NOW() WHERE id = $1`, [id], ctx);

      res.status(200).json({ success: true });
    } catch (e: any) {
      console.error("Delete equipment error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // API Route to register a user (Admin only)
  app.post("/api/admin/users", async (req, res) => {
    const { email, password, displayName, role, callerUid } = req.body;

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
      await query(`
        INSERT INTO users (firebase_uid, email, display_name, role)
        VALUES ($1, $2, $3, $4)
      `, [userRecord.uid, userRecord.email, userRecord.displayName, role || "agent_logistique"]);

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
    const { callerUid } = req.body;

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
      await query(`UPDATE users SET deleted_at = NOW() WHERE firebase_uid = $1`, [uid]);

      // 2. Delete Firestore Profile
      await db.collection("users").doc(uid).delete();

      res.status(200).json({ success: true });
    } catch (error: any) {
      console.error("Error deleting user:", error);
      res.status(500).json({ error: error.message });
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
