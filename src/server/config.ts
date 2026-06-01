import dotenv from 'dotenv';
dotenv.config();

const jwtSecretRaw = process.env.JWT_SECRET;
if (!jwtSecretRaw || jwtSecretRaw.length < 32) {
  console.error('❌ ERREUR: JWT_SECRET manquant ou trop faible!');
  console.error('JWT_SECRET doit être une chaîne aléatoire de 64+ caractères hexadécimaux');
  process.exit(1);
}

const databaseUrlRaw = process.env.DATABASE_URL;
if (!databaseUrlRaw) {
  console.error('❌ ERREUR: DATABASE_URL est obligatoire!');
  process.exit(1);
}

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  jwtSecret: jwtSecretRaw as string,
  databaseUrl: databaseUrlRaw as string,
  adminEmail: process.env.ADMIN_EMAIL || 'admin@example.com',
  nodeEnv: process.env.NODE_ENV || 'development'
};
