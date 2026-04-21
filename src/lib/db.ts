import pg from 'pg';

const { Pool } = pg;

// Use regular connection string or individual components
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: parseInt(process.env.PGPORT || '5432'),
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// IMPORTANT: Add a global error handler to the pool to prevent process crash
// or unhandled rejections on background connection issues.
pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client or connection issue:', err.message);
  if (err.message.includes('ECONNREFUSED')) {
    console.warn('[DB] Database appears to be offline. Verify PGHOST/PGPORT settings.');
  }
});

/**
 * Execute a query with the helios context set for RLS (Row Level Security)
 */
export async function queryHelios(text: string, params: any[], userContext: { id: string, role: string }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Set local variables for the transaction to satisfy RLS policies
    await client.query(`SET LOCAL helios.role = $1`, [userContext.role]);
    await client.query(`SET LOCAL helios.user_id = $1`, [userContext.id]);
    
    const res = await client.query(text, params);
    
    await client.query('COMMIT');
    return res;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Standard query for non-RLS or admin tasks
export const query = (text: string, params?: any[]) => pool.query(text, params);

export default pool;
