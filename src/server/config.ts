import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  jwtSecret: process.env.JWT_SECRET || 'helios_secret_2024_uuid_aligned',
  databaseUrl: process.env.DATABASE_URL,
  adminEmail: 'larryfichier@gmail.com',
  nodeEnv: process.env.NODE_ENV || 'development'
};
