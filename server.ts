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

    // Seed Categories de base — insère uniquement si ni l'UUID ni le code n'existent déjà
    const seedCategories = [
      { code: 'rame',         label: 'Rame (Véhicule)'         },
      { code: 'cuisine',      label: 'Cuisine'                  },
      { code: 'it',           label: 'Informatique'             },
      { code: 'energie',      label: 'Énergie'                  },
      { code: 'exploitation', label: "Matériel d'exploitation"  },
    ];
    for (const cat of seedCategories) {
      try {
        const exists = await query('SELECT 1 FROM categories WHERE code = $1', [cat.code]);
        if (exists.rows.length === 0) {
          await query(
            'INSERT INTO categories (code, label) VALUES ($1, $2)',
            [cat.code, cat.label]
          );
        }
      } catch (e: any) {
        if (e.code !== '23505') throw e;
      }
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
