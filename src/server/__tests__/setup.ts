// Définir les variables d'environnement AVANT tout import de module
// (évite le process.exit(1) de config.ts lors des tests)
process.env.JWT_SECRET  = 'test_jwt_secret_suffisamment_long_pour_les_tests_helios_2025';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test_geslog';
process.env.NODE_ENV    = 'test';
process.env.PORT        = '4001';
process.env.COOKIE_SECURE     = 'false';
process.env.ALLOWED_ORIGINS   = 'http://localhost:3000';
process.env.ADMIN_PASSWORD    = 'AdminTest@2025';
process.env.ADMIN_EMAIL       = 'admin@test.com';
