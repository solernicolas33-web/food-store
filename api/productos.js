const { Pool } = require('pg');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método no permitido. Usa GET.' });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ success: false, error: 'DATABASE_URL no está configurada.' });
  }

  // Query parameters para filtros
  const { categoria, q } = req.query;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let client;

  try {
    client = await pool.connect();

    let query = `
      SELECT p.id, p.nombre, p.descripcion, p.precio, p.stock, p.stock_minimo, p.imagen_url, p.estado,
             c.id AS categoria_id, c.nombre AS categoria_nombre
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      WHERE p.estado = 'activo'
    `;
    const params = [];
    let paramIndex = 1;

    // Filtro por categoría (id o nombre)
    if (categoria) {
      query += ` AND (c.id = $${paramIndex} OR c.nombre ILIKE $${paramIndex})`;
      params.push(categoria);
      paramIndex++;
    }

    // Búsqueda por nombre (ILIKE para case-insensitive)
    if (q) {
      query += ` AND p.nombre ILIKE $${paramIndex}`;
      params.push(`%${q}%`);
      paramIndex++;
    }

    query += ` ORDER BY p.id`;

    const result = await client.query(query, params);

    return res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    if (client) {
      try { await client.end(); } catch (e) {}
    }
    try { await pool.end(); } catch (e) {}
  }
};
