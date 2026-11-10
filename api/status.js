const { Pool } = require('pg');

module.exports = async (req, res) => {
  if (!process.env.DATABASE_URL) {
    return res.status(500).json({
      connected: false,
      message: 'DATABASE_URL no está configurada.'
    });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() AS hora_servidor, version() AS version_postgres');
    client.release();
    await pool.end();

    return res.status(200).json({
      connected: true,
      message: 'Conexión exitosa a PostgreSQL (Neon).',
      data: result.rows[0]
    });
  } catch (err) {
    await pool.end().catch(() => {});
    return res.status(500).json({
      connected: false,
      message: 'No se pudo conectar a la base de datos.',
      error: err.message
    });
  }
};
