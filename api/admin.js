const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'food-store-dev-secret-change-in-production';

function getUserFromToken(req) {
  const authHeader = req.headers.authorization || '';
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  try { return jwt.verify(parts[1], JWT_SECRET); } catch { return null; }
}

function getPool() { return new Pool({ connectionString: process.env.DATABASE_URL }); }
function sendError(res, status, error) { return res.status(status).json({ success: false, error }); }
function isAdminOrSuperAdmin(decoded) { return decoded && ['empleado', 'superadmin'].includes(decoded.rol); }
function isSuperAdmin(decoded) { return decoded && decoded.rol === 'superadmin'; }

module.exports = async (req, res) => {
  if (!process.env.DATABASE_URL) return sendError(res, 500, 'DATABASE_URL no está configurada.');

  const url = req.url || '';
  const method = req.method;
  const pool = getPool();
  let client;

  try {
    client = await pool.connect();

    // ---------- ADMIN AUTH CHECK ----------
    const decoded = getUserFromToken(req);
    if (!decoded) return sendError(res, 401, 'Token de autenticación requerido.');

    // ==================== METRICAS: GET /api/admin/metricas ====================
    if (method === 'GET' && url.includes('/metricas')) {
      if (!isAdminOrSuperAdmin(decoded)) return sendError(res, 403, 'Se requiere rol empleado o superadmin.');

      // 1. Total ventas confirmadas/entregadas
      const ventasResult = await client.query(`SELECT COALESCE(SUM(total), 0) as total_ventas FROM pedidos WHERE estado IN ('confirmado', 'en_preparacion', 'en_camino', 'entregado')`);
      const totalVentas = parseFloat(ventasResult.rows[0].total_ventas || 0);

      // 2. Pedidos por estado
      const pedidosEstadoResult = await client.query(`SELECT estado, COUNT(*) as cantidad FROM pedidos GROUP BY estado ORDER BY cantidad DESC`);
      const pedidosPorEstado = {}; ['pendiente','confirmado','en_preparacion','en_camino','entregado','cancelado'].forEach(e => pedidosPorEstado[e] = 0);
      pedidosEstadoResult.rows.forEach(r => pedidosPorEstado[r.estado] = parseInt(r.cantidad, 10));

      // 3. Stock bajo
      const stockBajoResult = await client.query(`SELECT id, nombre, stock, stock_minimo FROM productos WHERE estado = 'activo' AND stock <= stock_minimo ORDER BY (stock_minimo - stock) DESC, nombre`);
      const productosStockBajo = stockBajoResult.rows.map(r => ({ id: r.id, nombre: r.nombre, stock: r.stock, stock_minimo: r.stock_minimo }));

      // 4. Clientes activos
      const clientesActivosResult = await client.query(`SELECT COUNT(*) as total FROM usuarios WHERE rol = 'cliente' AND estado = 'activo'`);
      const clientesActivos = parseInt(clientesActivosResult.rows[0].total, 10);

      // 5. Total productos activos
      const totalProductosResult = await client.query(`SELECT COUNT(*) as total FROM productos WHERE estado = 'activo'`);
      const totalProductos = parseInt(totalProductosResult.rows[0].total, 10);

      // 6. Total pedidos confirmados
      const totalPedidosConfirmadosResult = await client.query(`SELECT COUNT(*) as total FROM pedidos WHERE estado IN ('confirmado', 'en_preparacion', 'en_camino', 'entregado')`);
      const totalPedidosConfirmados = parseInt(totalPedidosConfirmadosResult.rows[0].total, 10);

      return res.status(200).json({ success: true, data: { total_ventas: totalVentas, total_pedidos_confirmados: totalPedidosConfirmados, pedidos_por_estado: pedidosPorEstado, productos_stock_bajo: productosStockBajo, productos_stock_bajo_count: productosStockBajo.length, clientes_activos: clientesActivos, total_productos_activos: totalProductos } });
    }

    // ==================== CATEGORIAS: GET/POST/PUT /api/admin/categorias ====================
    if (url.includes('/categorias')) {
      if (!isAdminOrSuperAdmin(decoded)) return sendError(res, 403, 'Se requiere rol empleado o superadmin.');

      // GET
      if (method === 'GET') {
        const { estado } = req.query;
        let query = `SELECT id, nombre, estado FROM categorias WHERE 1=1`; const params = [];
        if (estado) { params.push(estado); query += ` AND estado = $${params.length}`; }
        query += ` ORDER BY id`;
        const result = await client.query(query, params);
        return res.status(200).json({ success: true, data: result.rows });
      }

      // POST
      if (method === 'POST') {
        const { nombre } = req.body || {};
        if (!nombre || !nombre.trim()) return sendError(res, 400, 'El nombre es obligatorio.');
        const existing = await client.query('SELECT id FROM categorias WHERE nombre = $1', [nombre.trim()]);
        if (existing.rows.length > 0) return sendError(res, 400, 'Ya existe una categoría con ese nombre.');
        const result = await client.query(`INSERT INTO categorias (nombre, estado) VALUES ($1, 'activo') RETURNING id`, [nombre.trim()]);
        return res.status(201).json({ success: true, message: 'Categoría creada.', data: { id: result.rows[0].id } });
      }

      // PUT
      if (method === 'PUT') {
        const { id, nombre, estado, accion } = req.body || {};
        if (!id) return sendError(res, 400, 'ID obligatorio.');
        const catResult = await client.query('SELECT * FROM categorias WHERE id = $1', [id]);
        if (catResult.rows.length === 0) return sendError(res, 404, 'No encontrada.');
        const categoria = catResult.rows[0];

        if (accion === 'cambiar_estado') {
          if (!estado || !['activo','inactivo'].includes(estado)) return sendError(res, 400, 'Estado inválido.');
          if (estado === 'inactivo') {
            const prodCount = await client.query('SELECT COUNT(*) FROM productos WHERE categoria_id = $1 AND estado = \'activo\'', [id]);
            if (parseInt(prodCount.rows[0].count, 10) > 0) return sendError(res, 400, 'Tiene productos activos.');
          }
          await client.query('UPDATE categorias SET estado = $1 WHERE id = $2', [estado, id]);
          return res.status(200).json({ success: true, message: `Categoría ${estado === 'activo' ? 'activada' : 'desactivada'}.` });
        }

        const updates = []; const values = []; let pi = 1;
        if (nombre !== undefined) {
          if (!nombre.trim()) return sendError(res, 400, 'Nombre vacío.');
          const dup = await client.query('SELECT id FROM categorias WHERE nombre = $1 AND id != $2', [nombre.trim(), id]);
          if (dup.rows.length > 0) return sendError(res, 400, 'Nombre duplicado.');
          updates.push(`nombre = $${pi}`); values.push(nombre.trim()); pi++;
        }
        if (estado !== undefined) {
          if (!['activo','inactivo'].includes(estado)) return sendError(res, 400, 'Estado inválido.');
          if (estado === 'inactivo') { const pc = await client.query('SELECT COUNT(*) FROM productos WHERE categoria_id = $1 AND estado = \'activo\'', [id]); if (parseInt(pc.rows[0].count,10) > 0) return sendError(res, 400, 'Tiene productos activos.'); }
          updates.push(`estado = $${pi}`); values.push(estado); pi++;
        }
        if (!updates.length) return sendError(res, 400, 'Sin cambios.');
        values.push(id);
        await client.query(`UPDATE categorias SET ${updates.join(', ')} WHERE id = $${pi}`, values);
        return res.status(200).json({ success: true, message: 'Categoría actualizada.' });
      }
    }

    // ==================== USUARIOS: GET/PUT /api/admin/usuarios (SUPERADMIN ONLY) ====================
    if (url.includes('/usuarios')) {
      if (!isSuperAdmin(decoded)) return sendError(res, 403, 'Se requiere superadmin.');

      // GET
      if (method === 'GET') {
        const result = await client.query(`SELECT id, nombre, email, rol, estado, fecha_creacion FROM usuarios ORDER BY fecha_creacion DESC`);
        return res.status(200).json({ success: true, data: result.rows.map(r => ({ id: r.id, nombre: r.nombre, email: r.email, rol: r.rol, activo: r.estado === 'activo', fecha_creacion: r.fecha_creacion })) });
      }

      // PUT
      if (method === 'PUT') {
        const { id, rol, activo } = req.body || {};
        if (!id) return sendError(res, 400, 'ID obligatorio.');
        const userResult = await client.query('SELECT id, nombre, email, rol, estado FROM usuarios WHERE id = $1', [id]);
        if (userResult.rows.length === 0) return sendError(res, 404, 'Usuario no encontrado.');
        const usuario = userResult.rows[0];
        const esMismo = decoded.id === id;

        if (rol !== undefined) {
          if (!['cliente','empleado','superadmin'].includes(rol)) return sendError(res, 400, 'Rol inválido.');
          if (usuario.rol === 'superadmin' && rol !== 'superadmin') {
            const saCount = await client.query(`SELECT COUNT(*) FROM usuarios WHERE rol = 'superadmin' AND estado = 'activo'`);
            if (parseInt(saCount.rows[0].count, 10) <= 1) return sendError(res, 400, 'Es el último superadmin activo.');
          }
          if (esMismo && usuario.rol === 'superadmin' && rol !== 'superadmin') return sendError(res, 400, 'No puedes quitar tu propio rol.');
        }

        if (activo !== undefined) {
          const nuevo = activo ? 'activo' : 'inactivo';
          if (usuario.rol === 'superadmin' && usuario.estado === 'activo' && !activo) {
            const saCount = await client.query(`SELECT COUNT(*) FROM usuarios WHERE rol = 'superadmin' AND estado = 'activo'`);
            if (parseInt(saCount.rows[0].count, 10) <= 1) return sendError(res, 400, 'Es el último superadmin activo.');
          }
          if (esMismo && usuario.estado === 'activo' && !activo) return sendError(res, 400, 'No puedes desactivarte a ti mismo.');
          await client.query('UPDATE usuarios SET estado = $1 WHERE id = $2', [nuevo, id]);
        }

        if (rol !== undefined) await client.query('UPDATE usuarios SET rol = $1 WHERE id = $2', [rol, id]);

        const upd = await client.query(`SELECT id, nombre, email, rol, estado, fecha_creacion FROM usuarios WHERE id = $1`, [id]);
        return res.status(200).json({ success: true, message: 'Usuario actualizado.', data: { id: upd.rows[0].id, nombre: upd.rows[0].nombre, email: upd.rows[0].email, rol: upd.rows[0].rol, activo: upd.rows[0].estado === 'activo', fecha_creacion: upd.rows[0].fecha_creacion } });
      }
    }

    return sendError(res, 404, 'Endpoint admin no encontrado.');

  } catch (err) {
    console.error('Error en admin:', err);
    return sendError(res, 500, err.message);
  } finally {
    if (client) { try { await client.end(); } catch (e) {} }
    try { await pool.end(); } catch (e) {}
  }
};