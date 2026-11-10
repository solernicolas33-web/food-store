const { Pool } = require('pg');

module.exports = async (req, res) => {
  // Solo permitir POST para evitar ejecuciones accidentales por GET
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método no permitido. Usa POST.' });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(500).json({
      success: false,
      message: 'DATABASE_URL no está configurada en las variables de entorno.'
    });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const client = await pool.connect();

    await client.query(`
      CREATE TABLE IF NOT EXISTS test_connection (
        id SERIAL PRIMARY KEY,
        mensaje TEXT DEFAULT 'Conexión exitosa a PostgreSQL (Neon)',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const result = await client.query('SELECT COUNT(*) AS total FROM test_connection');

    client.release();
    await pool.end();

    return res.status(200).json({
      success: true,
      message: 'Base de datos conectada y tabla test_connection verificada/creada.',
      total_registros: parseInt(result.rows[0].total, 10)
    });
  } catch (err) {
    await pool.end().catch(() => {});
    return res.status(500).json({
      success: false,
      message: 'Error al conectar o crear la tabla.',
      error: err.message
    });
  }
};
