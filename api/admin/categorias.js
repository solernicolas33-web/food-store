const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'food-store-dev-secret-change-in-production';

module.exports = async (req, res) => {
  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ success: false, error: 'DATABASE_URL no está configurada.' });
  }

  // Verificar autenticación y autorización (empleado o superadmin)
  const authHeader = req.headers.authorization || '';
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ success: false, error: 'Token de autenticación requerido.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(parts[1], JWT_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Sesión expirada. Inicie sesión nuevamente.' });
    }
    return res.status(401).json({ success: false, error: 'Token inválido.' });
  }

  if (!['empleado', 'superadmin'].includes(decoded.rol)) {
    return res.status(403).json({ success: false, error: 'Acceso denegado. Se requiere rol empleado o superadmin.' });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let client;

  try {
    client = await pool.connect();

    // GET: Listar categorías
    if (req.method === 'GET') {
      const { estado } = req.query;

      let query = `SELECT id, nombre, estado FROM categorias WHERE 1=1`;
      const params = [];

      if (estado) {
        params.push(estado);
        query += ` AND estado = $${params.length}`;
      }

      query += ` ORDER BY id`;

      const result = await client.query(query, params);

      return res.status(200).json({
        success: true,
        data: result.rows
      });
    }

    // POST: Crear categoría
    if (req.method === 'POST') {
      const { nombre } = req.body || {};

      if (!nombre || !nombre.trim()) {
        return res.status(400).json({ success: false, error: 'El nombre de la categoría es obligatorio.' });
      }

      // Verificar que no existe una categoría con el mismo nombre
      const existing = await client.query('SELECT id FROM categorias WHERE nombre = $1', [nombre.trim()]);
      if (existing.rows.length > 0) {
        return res.status(400).json({ success: false, error: 'Ya existe una categoría con ese nombre.' });
      }

      const result = await client.query(
        `INSERT INTO categorias (nombre, estado) VALUES ($1, 'activo') RETURNING id`,
        [nombre.trim()]
      );

      return res.status(201).json({
        success: true,
        message: 'Categoría creada exitosamente.',
        data: { id: result.rows[0].id }
      });
    }

    // PUT: Editar categoría o activar/desactivar
    if (req.method === 'PUT') {
      const { id, nombre, estado, accion } = req.body || {};

      if (!id) {
        return res.status(400).json({ success: false, error: 'ID de la categoría es obligatorio.' });
      }

      // Verificar que la categoría existe
      const catResult = await client.query('SELECT * FROM categorias WHERE id = $1', [id]);
      if (catResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Categoría no encontrada.' });
      }

      const categoria = catResult.rows[0];

      // Acción especial: activar/desactivar
      if (accion === 'cambiar_estado') {
        if (!estado || !['activo', 'inactivo'].includes(estado)) {
          return res.status(400).json({ success: false, error: 'Estado debe ser "activo" o "inactivo".' });
        }

        // No permitir desactivar si tiene productos activos
        if (estado === 'inactivo') {
          const prodCount = await client.query('SELECT COUNT(*) FROM productos WHERE categoria_id = $1 AND estado = \'activo\'', [id]);
          if (parseInt(prodCount.rows[0].count, 10) > 0) {
            return res.status(400).json({ success: false, error: 'No se puede desactivar la categoría porque tiene productos activos.' });
          }
        }

        await client.query('UPDATE categorias SET estado = $1 WHERE id = $2', [estado, id]);
        return res.status(200).json({ success: true, message: `Categoría ${estado === 'activo' ? 'activada' : 'desactivada'} correctamente.` });
      }

      // Edición normal
      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (nombre !== undefined) {
        if (!nombre.trim()) {
          return res.status(400).json({ success: false, error: 'El nombre no puede estar vacío.' });
        }
        // Verificar duplicado
        const dup = await client.query('SELECT id FROM categorias WHERE nombre = $1 AND id != $2', [nombre.trim(), id]);
        if (dup.rows.length > 0) {
          return res.status(400).json({ success: false, error: 'Ya existe una categoría con ese nombre.' });
        }
        updates.push(`nombre = $${paramIndex}`);
        values.push(nombre.trim());
        paramIndex++;
      }
      if (estado !== undefined) {
        if (!['activo', 'inactivo'].includes(estado)) {
          return res.status(400).json({ success: false, error: 'Estado debe ser "activo" o "inactivo".' });
        }
        if (estado === 'inactivo') {
          const prodCount = await client.query('SELECT COUNT(*) FROM productos WHERE categoria_id = $1 AND estado = \'activo\'', [id]);
          if (parseInt(prodCount.rows[0].count, 10) > 0) {
            return res.status(400).json({ success: false, error: 'No se puede desactivar la categoría porque tiene productos activos.' });
          }
        }
        updates.push(`estado = $${paramIndex}`);
        values.push(estado);
        paramIndex++;
      }

      if (updates.length === 0) {
        return res.status(400).json({ success: false, error: 'No hay campos para actualizar.' });
      }

      values.push(id);
      await client.query(`UPDATE categorias SET ${updates.join(', ')} WHERE id = $${paramIndex}`, values);

      return res.status(200).json({ success: true, message: 'Categoría actualizada correctamente.' });
    }

    return res.status(405).json({ success: false, error: 'Método no permitido.' });

  } catch (err) {
    console.error('Error en admin/categorias:', err);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    if (client) { try { await client.end(); } catch (e) {} }
    try { await pool.end(); } catch (e) {}
  }
};