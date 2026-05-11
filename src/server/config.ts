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
