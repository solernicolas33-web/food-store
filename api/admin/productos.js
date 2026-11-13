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

    // GET: Listar productos con alertas de stock bajo
    if (req.method === 'GET') {
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

      if (estado) {
        params.push(estado);
        query += ` AND p.estado = $${params.length}`;
      }

      if (stock_bajo === 'true') {
        query += ` AND p.stock <= p.stock_minimo`;
      }

      query += ` ORDER BY p.id DESC`;

      const result = await client.query(query, params);

      return res.status(200).json({
        success: true,
        data: result.rows.map(r => ({
          id: r.id,
          categoria_id: r.categoria_id,
          categoria_nombre: r.categoria_nombre,
          nombre: r.nombre,
          descripcion: r.descripcion,
          precio: parseFloat(r.precio),
          stock: r.stock,
          stock_minimo: r.stock_minimo,
          imagen_url: r.imagen_url,
          estado: r.estado,
          stock_bajo: r.stock_bajo
        }))
      });
    }

    // POST: Crear producto
    if (req.method === 'POST') {
      const { categoria_id, nombre, descripcion, precio, stock, stock_minimo, imagen_url } = req.body || {};

      if (!categoria_id || !nombre || precio === undefined || stock === undefined) {
        return res.status(400).json({ success: false, error: 'categoria_id, nombre, precio y stock son obligatorios.' });
      }

      // Verificar que la categoría existe y está activa
      const catResult = await client.query('SELECT id FROM categorias WHERE id = $1 AND estado = \'activo\'', [categoria_id]);
      if (catResult.rows.length === 0) {
        return res.status(400).json({ success: false, error: 'La categoría no existe o está inactiva.' });
      }

      const result = await client.query(
        `INSERT INTO productos (categoria_id, nombre, descripcion, precio, stock, stock_minimo, imagen_url, estado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'activo')
         RETURNING id`,
        [categoria_id, nombre, descripcion || '', precio, stock, stock_minimo || 0, imagen_url || '']
      );

      return res.status(201).json({
        success: true,
        message: 'Producto creado exitosamente.',
        data: { id: result.rows[0].id }
      });
    }

    // PUT: Editar producto o ajustar stock
    if (req.method === 'PUT') {
      const { id, nombre, descripcion, precio, stock, stock_minimo, imagen_url, estado, accion } = req.body || {};

      if (!id) {
        return res.status(400).json({ success: false, error: 'ID del producto es obligatorio.' });
      }

      // Verificar que el producto existe
      const prodResult = await client.query('SELECT * FROM productos WHERE id = $1', [id]);
      if (prodResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Producto no encontrado.' });
      }

      const producto = prodResult.rows[0];

      // Acción especial: ajustar stock
      if (accion === 'ajustar_stock') {
        if (stock === undefined || stock < 0) {
          return res.status(400).json({ success: false, error: 'Stock debe ser un número no negativo.' });
        }
        await client.query('UPDATE productos SET stock = $1 WHERE id = $2', [stock, id]);
        return res.status(200).json({ success: true, message: 'Stock actualizado correctamente.' });
      }

      // Acción especial: activar/desactivar (baja lógica)
      if (accion === 'cambiar_estado') {
        if (!estado || !['activo', 'inactivo'].includes(estado)) {
          return res.status(400).json({ success: false, error: 'Estado debe ser "activo" o "inactivo".' });
        }
        await client.query('UPDATE productos SET estado = $1 WHERE id = $2', [estado, id]);
        return res.status(200).json({ success: true, message: `Producto ${estado === 'activo' ? 'activado' : 'desactivado'} correctamente.` });
      }

      // Edición normal de campos
      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (categoria_id !== undefined) {
        const catResult = await client.query('SELECT id FROM categorias WHERE id = $1 AND estado = \'activo\'', [categoria_id]);
        if (catResult.rows.length === 0) {
          return res.status(400).json({ success: false, error: 'La categoría no existe o está inactiva.' });
        }
        updates.push(`categoria_id = $${paramIndex}`);
        values.push(categoria_id);
        paramIndex++;
      }
      if (nombre !== undefined) { updates.push(`nombre = $${paramIndex}`); values.push(nombre); paramIndex++; }
      if (descripcion !== undefined) { updates.push(`descripcion = $${paramIndex}`); values.push(descripcion); paramIndex++; }
      if (precio !== undefined) { updates.push(`precio = $${paramIndex}`); values.push(precio); paramIndex++; }
      if (stock !== undefined) { updates.push(`stock = $${paramIndex}`); values.push(stock); paramIndex++; }
      if (stock_minimo !== undefined) { updates.push(`stock_minimo = $${paramIndex}`); values.push(stock_minimo); paramIndex++; }
      if (imagen_url !== undefined) { updates.push(`imagen_url = $${paramIndex}`); values.push(imagen_url); paramIndex++; }
      if (estado !== undefined) {
        if (!['activo', 'inactivo'].includes(estado)) {
          return res.status(400).json({ success: false, error: 'Estado debe ser "activo" o "inactivo".' });
        }
        updates.push(`estado = $${paramIndex}`);
        values.push(estado);
        paramIndex++;
      }

      if (updates.length === 0) {
        return res.status(400).json({ success: false, error: 'No hay campos para actualizar.' });
      }

      values.push(id);
      await client.query(`UPDATE productos SET ${updates.join(', ')} WHERE id = $${paramIndex}`, values);

      return res.status(200).json({ success: true, message: 'Producto actualizado correctamente.' });
    }

    return res.status(405).json({ success: false, error: 'Método no permitido.' });

  } catch (err) {
    console.error('Error en admin/productos:', err);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    if (client) { try { await client.end(); } catch (e) {} }
    try { await pool.end(); } catch (e) {}
  }
};