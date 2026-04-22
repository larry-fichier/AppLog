import { connectDB, initSchema, query } from './src/server/db.ts';
import { createApp } from './src/server/app.ts';
import { config } from './src/server/config.ts';
import bcrypt from 'bcrypt';

async function startServer() {
  console.log("🚀 Lancement du serveur Helios (Mode SOLID)...");
  
  try {
    // 1. Initialisation Base de Données
    await connectDB();
    await initSchema();

    // 2. Seeding (Données Vitales)
    const adminCheck = await query("SELECT id FROM users WHERE email = $1", [config.adminEmail]);
    if (adminCheck.rows.length === 0) {
      const hashedPassword = await bcrypt.hash("admin123", 10);
      await query(`
        INSERT INTO users (username, email, password_hash, display_name, role)
        VALUES ($1, $2, $3, $4, $5)
      `, ["admin", config.adminEmail, hashedPassword, "Super Admin", "admin"]);
      console.log(`[Seed] Admin créé: ${config.adminEmail}`);
    }

    // Seed Categories si vide
    const catCheck = await query("SELECT COUNT(*) FROM categories");
    if (parseInt(catCheck.rows[0].count) === 0) {
       await query(`INSERT INTO categories (id, code, label) VALUES 
          ('15f6658c-a379-4763-94db-eef00df2af01', 'rame', 'Rame (Véhicule)'),
          ('f9fa63e3-a079-498c-810a-83a3bd89d402', 'cuisine', 'Cuisine'),
          ('9ea57b65-c639-4f92-b26a-f09820d3fc03', 'it', 'Informatique')
       `);
       console.log("[Seed] Catégories initiales créées.");
    }

    // 3. Lancement App Express
    const app = await createApp();
    
    app.listen(config.port, "0.0.0.0", () => {
      console.log(`✅ Serveur prêt sur http://localhost:${config.port}`);
      console.log(`🔹 Mode: ${config.nodeEnv}`);
    });

  } catch (err) {
    console.error("❌ Échec critique du démarrage:", err);
    process.exit(1);
  }
}

startServer();
