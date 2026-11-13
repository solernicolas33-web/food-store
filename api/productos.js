const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'food-store-dev-secret-change-in-production';

function getUserFromToken(req) {
  const authHeader = req.headers.authorization || '';
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  try {
    return jwt.verify(parts[1], JWT_SECRET);
  } catch {
    return null;
  }
}

function getPool() {
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

function sendError(res, status, error) {
  return res.status(status).json({ success: false, error });
}

function isAdminOrSuperAdmin(decoded) {
  return decoded && ['empleado', 'superadmin'].includes(decoded.rol);
}

module.exports = async (req, res) => {
  if (!process.env.DATABASE_URL) return sendError(res, 500, 'DATABASE_URL no está configurada.');

  const url = req.url || '';
  const method = req.method;
  const pool = getPool();
  let client;

  try {
    client = await pool.connect();

    // ==================== PUBLIC CATALOG: GET /api/productos ====================
    // Supports query params: ?categoria=&q= (for filtering)
    if (method === 'GET' && !url.includes('/admin')) {
      const { categoria, q } = req.query;

      let query = `
        SELECT p.id, p.nombre, p.descripcion, p.precio, p.stock, p.stock_minimo, p.imagen_url, p.estado,
               c.id AS categoria_id, c.nombre AS categoria_nombre
        FROM productos p
        LEFT JOIN categorias c ON p.categoria_id = c.id
        WHERE p.estado = 'activo'
      `;
      const params = [];
      let paramIndex = 1;

      if (categoria) {
        query += ` AND (c.id = $${paramIndex} OR c.nombre ILIKE $${paramIndex})`;
        params.push(categoria);
        paramIndex++;
      }
      if (q) {
        query += ` AND p.nombre ILIKE $${paramIndex}`;
        params.push(`%${q}%`);
        paramIndex++;
      }
      query += ` ORDER BY p.id`;

      const result = await client.query(query, params);
      return res.status(200).json({ success: true, data: result.rows });
    }

    // ==================== ADMIN PRODUCTS: GET/POST/PUT /api/admin/productos ====================
    // Check admin auth
    const decoded = getUserFromToken(req);
    if (!isAdminOrSuperAdmin(decoded)) return sendError(res, 403, 'Acceso denegado. Se requiere rol empleado o superadmin.');

    // ----- GET /api/admin/productos -----
    if (method === 'GET' && url.includes('/admin')) {
      const { estado, stock_bajo } = req.query;

      let query = `
        SELECT p.id, p.categoria_id, c.nombre as categoria_nombre, p.nombre, p.descripcion,
               p.precio, p.stock, p.stock_minimo, p.imagen_url, p.estado,
               (p.stock <= p.stock_minimo) as stock_bajo
        FROM productos p
        LEFT JOIN categorias c ON c.id = p.categoria_id
        WHERE 1=1
      `;
      const params = [];

      if (estado) { params.push(estado); query += ` AND p.estado = $${params.length}`; }
      if (stock_bajo === 'true') { query += ` AND p.stock <= p.stock_minimo`; }

      query += ` ORDER BY p.id DESC`;

      const result = await client.query(query, params);
      return res.status(200).json({
        success: true,
        data: result.rows.map(r => ({
          id: r.id, categoria_id: r.categoria_id, categoria_nombre: r.categoria_nombre,
          nombre: r.nombre, descripcion: r.descripcion, precio: parseFloat(r.precio),
          stock: r.stock, stock_minimo: r.stock_minimo, imagen_url: r.imagen_url,
          estado: r.estado, stock_bajo: r.stock_bajo
        }))
      });
    }

    // ----- POST /api/admin/productos -----
    if (method === 'POST' && url.includes('/admin')) {
      const { categoria_id, nombre, descripcion, precio, stock, stock_minimo, imagen_url } = req.body || {};
      if (!categoria_id || !nombre || precio === undefined || stock === undefined) {
        return sendError(res, 400, 'categoria_id, nombre, precio y stock son obligatorios.');
      }

      const catResult = await client.query('SELECT id FROM categorias WHERE id = $1 AND estado = \'activo\'', [categoria_id]);
      if (catResult.rows.length === 0) return sendError(res, 400, 'La categoría no existe o está inactiva.');

      const result = await client.query(
        `INSERT INTO productos (categoria_id, nombre, descripcion, precio, stock, stock_minimo, imagen_url, estado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'activo') RETURNING id`,
        [categoria_id, nombre, descripcion || '', precio, stock, stock_minimo || 0, imagen_url || '']
      );

      return res.status(201).json({ success: true, message: 'Producto creado exitosamente.', data: { id: result.rows[0].id } });
    }

    // ----- PUT /api/admin/productos -----
    if (method === 'PUT' && url.includes('/admin')) {
      const { id, nombre, descripcion, precio, stock, stock_minimo, imagen_url, estado, accion } = req.body || {};
      if (!id) return sendError(res, 400, 'ID del producto es obligatorio.');

      const prodResult = await client.query('SELECT * FROM productos WHERE id = $1', [id]);
      if (prodResult.rows.length === 0) return sendError(res, 404, 'Producto no encontrado.');

      const producto = prodResult.rows[0];

      // Acción: ajustar_stock
      if (accion === 'ajustar_stock') {
        if (stock === undefined || stock < 0) return sendError(res, 400, 'Stock debe ser un número no negativo.');
        await client.query('UPDATE productos SET stock = $1 WHERE id = $2', [stock, id]);
        return res.status(200).json({ success: true, message: 'Stock actualizado correctamente.' });
      }

      // Acción: cambiar_estado (soft delete)
      if (accion === 'cambiar_estado') {
        if (!estado || !['activo', 'inactivo'].includes(estado)) return sendError(res, 400, 'Estado debe ser "activo" o "inactivo".');
        await client.query('UPDATE productos SET estado = $1 WHERE id = $2', [estado, id]);
        return res.status(200).json({ success: true, message: `Producto ${estado === 'activo' ? 'activado' : 'desactivado'} correctamente.` });
      }

      // Edición normal
      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (categoria_id !== undefined) {
        const catResult = await client.query('SELECT id FROM categorias WHERE id = $1 AND estado = \'activo\'', [categoria_id]);
        if (catResult.rows.length === 0) return sendError(res, 400, 'La categoría no existe o está inactiva.');
        updates.push(`categoria_id = $${paramIndex}`); values.push(categoria_id); paramIndex++;
      }
      if (nombre !== undefined) { updates.push(`nombre = $${paramIndex}`); values.push(nombre); paramIndex++; }
      if (descripcion !== undefined) { updates.push(`descripcion = $${paramIndex}`); values.push(descripcion); paramIndex++; }
      if (precio !== undefined) { updates.push(`precio = $${paramIndex}`); values.push(precio); paramIndex++; }
      if (stock !== undefined) { updates.push(`stock = $${paramIndex}`); values.push(stock); paramIndex++; }
      if (stock_minimo !== undefined) { updates.push(`stock_minimo = $${paramIndex}`); values.push(stock_minimo); paramIndex++; }
      if (imagen_url !== undefined) { updates.push(`imagen_url = $${paramIndex}`); values.push(imagen_url); paramIndex++; }
      if (estado !== undefined) {
        if (!['activo', 'inactivo'].includes(estado)) return sendError(res, 400, 'Estado debe ser "activo" o "inactivo".');
        updates.push(`estado = $${paramIndex}`); values.push(estado); paramIndex++;
      }

      if (updates.length === 0) return sendError(res, 400, 'No hay campos para actualizar.');

      values.push(id);
      await client.query(`UPDATE productos SET ${updates.join(', ')} WHERE id = $${paramIndex}`, values);
      return res.status(200).json({ success: true, message: 'Producto actualizado correctamente.' });
    }

    return sendError(res, 404, 'Endpoint de productos no encontrado.');

  } catch (err) {
    console.error('Error en productos:', err);
    return sendError(res, 500, err.message);
  } finally {
    if (client) { try { await client.end(); } catch (e) {} }
    try { await pool.end(); } catch (e) {}
  }
};