import { connectDB, initSchema, query } from './src/server/db.ts';
import { createApp } from './src/server/app.ts';
import { config } from './src/server/config.ts';
import bcrypt from 'bcryptjs';

// Fusionne les anciennes catégories doublons dans les catégories canoniques
async function mergeDuplicateCategories() {
  // Règles de fusion : { codeCanonique, patterns de labels à absorber }
  const mergeRules = [
    {
      canonicalCode: 'energie',
      patterns: ['groupe', 'générateur', 'generateur', 'electrogene', 'électrogène', 'equipement_energ', 'énergi', 'energ'],
    },
    {
      canonicalCode: 'it',
      patterns: ['informatique', 'électronique', 'electronique'],
    },
  ];

  for (const rule of mergeRules) {
    const canonResult = await query(
      "SELECT id FROM categories WHERE code = $1",
      [rule.canonicalCode]
    );
    if (canonResult.rows.length === 0) continue;
    const canonId = canonResult.rows[0].id;

    // Trouver toutes les catégories qui matchent les patterns (sauf la canonique elle-même)
    const patternConditions = rule.patterns
      .map((_, i) => `LOWER(label) LIKE $${i + 2}`)
      .join(' OR ');
    const patternValues = rule.patterns.map(p => `%${p}%`);

    const dupes = await query(
      `SELECT id, label FROM categories WHERE id != $1 AND (${patternConditions})`,
      [canonId, ...patternValues]
    );

    for (const dupe of dupes.rows) {
      await query("UPDATE equipment SET category_id = $1 WHERE category_id = $2", [canonId, dupe.id]);
      await query("DELETE FROM category_fields WHERE category_id = $1", [dupe.id]);
      await query("DELETE FROM categories WHERE id = $1", [dupe.id]);
      console.log(`[Migration] Catégorie "${dupe.label}" fusionnée dans '${rule.canonicalCode}' et supprimée.`);
    }
  }
}

async function startServer() {
  console.log("🚀 Lancement du serveur Helios (Mode SOLID)...");
  
  try {
    // 1. Initialisation Base de Données
    await connectDB();
    await initSchema();

    // 2. Seeding (Données Vitales)
    const adminCheck = await query("SELECT id FROM users WHERE username = 'admin'");
    if (adminCheck.rows.length === 0) {
      const adminPassword = process.env.ADMIN_PASSWORD;
      if (!adminPassword) {
        console.error('❌ ERREUR: ADMIN_PASSWORD manquant dans les variables d\'environnement!');
        process.exit(1);
      }
      const hashedPassword = await bcrypt.hash(adminPassword, 12);
      await query(`
        INSERT INTO users (username, email, password_hash, display_name, role)
        VALUES ($1, $2, $3, $4, $5)
      `, ["admin", config.adminEmail, hashedPassword, "Super Admin", "admin"]);
      console.log(`[Seed] Admin créé: ${config.adminEmail}`);
    }

    // Seed Categories de base (INSERT si absent par code)
    const seedCategories = [
      { id: '15f6658c-a379-4763-94db-eef00df2af01', code: 'rame',        label: 'Rame (Véhicule)'        },
      { id: 'f9fa63e3-a079-498c-810a-83a3bd89d402', code: 'cuisine',     label: 'Cuisine'                },
      { id: '9ea57b65-c639-4f92-b26a-f09820d3fc03', code: 'it',          label: 'Informatique'           },
      { id: 'b2c4d6e8-f0a2-4b6c-8d0e-2f4a6b8c0d2e', code: 'energie',    label: 'Énergie'                },
      { id: 'a1b3c5d7-e9f1-4a5b-7c9d-1e3f5a7b9c1d', code: 'exploitation', label: "Matériel d'exploitation" },
    ];
    for (const cat of seedCategories) {
      await query(
        `INSERT INTO categories (id, code, label) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING`,
        [cat.id, cat.code, cat.label]
      );
    }
    console.log("[Seed] Catégories vérifiées/créées.");

    // Migration: fusionner les doublons dans les catégories canoniques
    await mergeDuplicateCategories();

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
