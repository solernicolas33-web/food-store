const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'food-store-dev-secret-change-in-production';
const COSTO_ENVIO_FIJO = 3.00;
const FLUJO_ESTADOS = { 'confirmado': 'en_preparacion', 'en_preparacion': 'en_camino', 'en_camino': 'entregado' };
const ESTADOS_CANCELABLES = ['confirmado', 'en_preparacion', 'en_camino'];

function getUserFromToken(req) {
  const authHeader = req.headers.authorization || '';
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  try { return jwt.verify(parts[1], JWT_SECRET); } catch { return null; }
}

function getPool() { return new Pool({ connectionString: process.env.DATABASE_URL }); }
function sendError(res, status, error) { return res.status(status).json({ success: false, error }); }
function isClient(decoded) { return decoded && decoded.rol === 'cliente'; }
function isAdminOrSuperAdmin(decoded) { return decoded && ['empleado', 'superadmin'].includes(decoded.rol); }

// Helper: build order with items
async function buildOrderWithItems(client, pedido) {
  const itemsResult = await client.query(
    `SELECT dp.producto_id, dp.cantidad, dp.precio_unitario, p.nombre, p.imagen_url
     FROM detalle_pedidos dp JOIN productos p ON p.id = dp.producto_id WHERE dp.pedido_id = $1`,
    [pedido.id]
  );
  const items = itemsResult.rows.map(item => ({
    producto_id: item.producto_id, nombre: item.nombre, imagen_url: item.imagen_url,
    cantidad: item.cantidad, precio_unitario: parseFloat(item.precio_unitario),
    subtotal: parseFloat(item.precio_unitario) * item.cantidad
  }));
  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  return { ...pedido, subtotal: parseFloat(subtotal.toFixed(2)), items };
}

module.exports = async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(500).json({ success: false, error: 'DATABASE_URL no está configurada.' });

  const url = req.url || '';
  const method = req.method;
  const pool = getPool();
  let client;

  try {
    client = await pool.connect();
    const decoded = getUserFromToken(req);

    // ==================== CLIENT: POST /api/pedidos (create) ====================
    if (method === 'POST' && url === '/api/pedidos' && !url.includes('/pagar') && !url.includes('/cancelar')) {
      if (!isClient(decoded)) return sendError(res, 403, 'Solo clientes pueden registrar pedidos.');

      const { direccion_envio, telefono_contacto, items, costo_envio = COSTO_ENVIO_FIJO } = req.body || {};
      if (!direccion_envio || !telefono_contacto || !items || !Array.isArray(items) || items.length === 0) {
        return sendError(res, 400, 'Dirección, teléfono y al menos un ítem son obligatorios.');
      }

      await client.query('BEGIN');
      try {
        let subtotal = 0; const detalles = [];
        for (const item of items) {
          if (!item.producto_id || !item.cantidad || item.cantidad < 1) throw new Error('Cada ítem debe tener producto_id y cantidad válida.');
          const prodResult = await client.query('SELECT id, nombre, precio, stock FROM productos WHERE id = $1', [item.producto_id]);
          if (prodResult.rows.length === 0) throw new Error(`El producto ID ${item.producto_id} no existe.`);
          const producto = prodResult.rows[0];
          if (producto.stock < parseInt(item.cantidad, 10)) throw new Error(`Stock insuficiente para "${producto.nombre}". Disponible: ${producto.stock}, solicitado: ${item.cantidad}.`);
          const precioUnitario = parseFloat(producto.precio);
          subtotal += precioUnitario * parseInt(item.cantidad, 10);
          detalles.push({ producto_id: producto.id, cantidad: parseInt(item.cantidad, 10), precio_unitario: precioUnitario, nombre: producto.nombre });
        }
        const total = subtotal + parseFloat(costo_envio);
        const pedidoResult = await client.query(
          `INSERT INTO pedidos (usuario_id, estado, total, costo_envio, direccion_envio, telefono_contacto)
           VALUES ($1, 'pendiente', $2, $3, $4, $5) RETURNING id, fecha_creacion`,
          [decoded.id, total, costo_envio, direccion_envio.trim(), telefono_contacto.trim()]
        );
        const pedidoId = pedidoResult.rows[0].id;
        for (const d of detalles) {
          await client.query(`INSERT INTO detalle_pedidos (pedido_id, producto_id, cantidad, precio_unitario) VALUES ($1, $2, $3, $4)`,
            [pedidoId, d.producto_id, d.cantidad, d.precio_unitario]);
        }
        await client.query('COMMIT');
        return res.status(201).json({
          success: true, message: 'Pedido registrado exitosamente.',
          data: { pedido_id: pedidoId, estado: 'pendiente', fecha_creacion: pedidoResult.rows[0].fecha_creacion,
                  subtotal, costo_envio: parseFloat(costo_envio), total, direccion_envio, telefono_contacto, items: detalles }
        });
      } catch (err) { await client.query('ROLLBACK'); throw err; }
    }

    // ==================== CLIENT: GET /api/pedidos?mine=true (mis-pedidos) ====================
    if (method === 'GET' && url.includes('mine=true')) {
      if (!isClient(decoded)) return sendError(res, 403, 'Solo clientes pueden ver sus pedidos.');

      const pedidosResult = await client.query(
        `SELECT id, estado, total, costo_envio, direccion_envio, telefono_contacto, fecha_creacion
         FROM pedidos WHERE usuario_id = $1 ORDER BY fecha_creacion DESC`, [decoded.id]
      );

      const pedidosConDetalle = [];
      for (const pedido of pedidosResult.rows) {
        pedidosConDetalle.push(await buildOrderWithItems(client, pedido));
      }
      return res.status(200).json({ success: true, data: pedidosConDetalle });
    }

    // ==================== CLIENT: POST /api/pedidos/:id/pagar ====================
    if (method === 'POST' && url.includes('/pagar')) {
      if (!isClient(decoded)) return sendError(res, 403, 'Solo clientes pueden gestionar pagos.');

      const pedidoId = parseInt(url.split('/').pop(), 10);
      const { accion } = req.body || {};
      if (!pedidoId || isNaN(pedidoId)) return sendError(res, 400, 'ID de pedido inválido.');
      if (!accion || !['aprobar', 'rechazar'].includes(accion)) return sendError(res, 400, 'Acción inválida. Use "aprobar" o "rechazar".');

      const pedidoResult = await client.query(`SELECT id, usuario_id, estado, total FROM pedidos WHERE id = $1`, [pedidoId]);
      if (pedidoResult.rows.length === 0) return sendError(res, 404, 'Pedido no encontrado.');
      const pedido = pedidoResult.rows[0];
      if (pedido.usuario_id !== decoded.id) return sendError(res, 403, 'El pedido no pertenece al usuario actual.');
      if (pedido.estado !== 'pendiente') return sendError(res, 400, `El pedido ya no está en estado pendiente (estado actual: ${pedido.estado}).`);

      if (accion === 'rechazar') {
        await client.query(
          `INSERT INTO historial_pedidos (pedido_id, usuario_id, estado_anterior, estado_nuevo, motivo_cancelacion)
           VALUES ($1, $2, $3, $4, $5)`,
          [pedidoId, decoded.id, 'pendiente', 'pendiente', 'Pago rechazado por el cliente']
        );
        return res.status(200).json({ success: true, message: 'Pago rechazado. El pedido permanece en estado pendiente.', data: { pedido_id: pedidoId, estado: 'pendiente', accion: 'rechazar' } });
      }

      // APROBAR
      await client.query('BEGIN');
      try {
        const itemsResult = await client.query(
          `SELECT dp.producto_id, dp.cantidad, dp.precio_unitario, p.nombre, p.stock
           FROM detalle_pedidos dp JOIN productos p ON p.id = dp.producto_id WHERE dp.pedido_id = $1`,
          [pedidoId]
        );
        if (itemsResult.rows.length === 0) throw new Error('El pedido no tiene items.');

        const productosSinStock = [];
        for (const item of itemsResult.rows) {
          if (item.stock < item.cantidad) productosSinStock.push({ producto_id: item.producto_id, nombre: item.nombre, stock_disponible: item.stock, cantidad_solicitada: item.cantidad });
        }
        if (productosSinStock.length > 0) throw { status: 400, error: 'Stock insuficiente', data: { productos_sin_stock: productosSinStock } };

        for (const item of itemsResult.rows) {
          await client.query(`UPDATE productos SET stock = stock - $1 WHERE id = $2`, [item.cantidad, item.producto_id]);
        }
        await client.query(`UPDATE pedidos SET estado = 'confirmado' WHERE id = $1`, [pedidoId]);
        await client.query(
          `INSERT INTO historial_pedidos (pedido_id, usuario_id, estado_anterior, estado_nuevo, motivo_cancelacion)
           VALUES ($1, $2, $3, $4, $5)`,
          [pedidoId, decoded.id, 'pendiente', 'confirmado', 'Pago aprobado y stock descontado']
        );
        await client.query('COMMIT');
        return res.status(200).json({ success: true, message: 'Pago aprobado. Stock descontado y pedido confirmado.', data: { pedido_id: pedidoId, estado: 'confirmado', accion: 'aprobar' } });
      } catch (err) { await client.query('ROLLBACK'); throw err; }
    }

    // ==================== CLIENT: POST /api/pedidos/:id/cancelar ====================
    if (method === 'POST' && url.includes('/cancelar')) {
      if (!isClient(decoded)) return sendError(res, 403, 'Solo clientes pueden cancelar pedidos.');

      const pedidoId = parseInt(url.split('/').pop(), 10);
      const { motivo } = req.body || {};
      if (!pedidoId || isNaN(pedidoId)) return sendError(res, 400, 'ID de pedido inválido.');
      if (!motivo || !motivo.trim()) return sendError(res, 400, 'El motivo de cancelación es obligatorio.');

      const pedidoResult = await client.query(`SELECT id, usuario_id, estado FROM pedidos WHERE id = $1`, [pedidoId]);
      if (pedidoResult.rows.length === 0) return sendError(res, 404, 'Pedido no encontrado.');
      const pedido = pedidoResult.rows[0];
      if (pedido.usuario_id !== decoded.id) return sendError(res, 403, 'El pedido no pertenece al usuario actual.');
      if (pedido.estado !== 'pendiente') return sendError(res, 400, `Solo se pueden cancelar pedidos en estado "pendiente".`);

      await client.query('BEGIN');
      try {
        await client.query(`UPDATE pedidos SET estado = 'cancelado' WHERE id = $1`, [pedidoId]);
        await client.query(
          `INSERT INTO historial_pedidos (pedido_id, usuario_id, estado_anterior, estado_nuevo, motivo_cancelacion)
           VALUES ($1, $2, $3, $4, $5)`,
          [pedidoId, decoded.id, 'pendiente', 'cancelado', motivo.trim()]
        );
        await client.query('COMMIT');
        return res.status(200).json({ success: true, message: 'Pedido cancelado correctamente.', data: { pedido_id: pedidoId, estado: 'cancelado' } });
      } catch (err) { await client.query('ROLLBACK'); throw err; }
    }

    // ==================== ADMIN: GET /api/admin/pedidos ====================
    if (method === 'GET' && url.includes('/admin')) {
      if (!isAdminOrSuperAdmin(decoded)) return sendError(res, 403, 'Acceso denegado. Se requiere rol empleado o superadmin.');

      const { estado, pagina = 1, por_pagina = 20 } = req.query;
      const offset = (parseInt(pagina, 10) - 1) * parseInt(por_pagina, 10);
      const limit = parseInt(por_pagina, 10);

      let query = `SELECT p.id, p.usuario_id, u.nombre as cliente_nombre, u.email as cliente_email, p.estado, p.total, p.costo_envio, p.direccion_envio, p.telefono_contacto, p.fecha_creacion FROM pedidos p JOIN usuarios u ON u.id = p.usuario_id WHERE 1=1`;
      const params = [];
      if (estado) { params.push(estado); query += ` AND p.estado = $${params.length}`; }
      query += ` ORDER BY p.fecha_creacion DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const result = await client.query(query, params);
      let countQuery = `SELECT COUNT(*) FROM pedidos p WHERE 1=1`; const countParams = [];
      if (estado) { countParams.push(estado); countQuery += ` AND p.estado = $${countParams.length}`; }
      const countResult = await client.query(countQuery, countParams);

      const pedidosConItems = [];
      for (const pedido of result.rows) { pedidosConItems.push(await buildOrderWithItems(client, { ...pedido, siguiente_estado: FLUJO_ESTADOS[pedido.estado] || null, puede_cancelar: ESTADOS_CANCELABLES.includes(pedido.estado) })); }

      return res.status(200).json({ success: true, data: pedidosConItems, pagination: { pagina: parseInt(pagina, 10), por_pagina: limit, total: parseInt(countResult.rows[0].count, 10) } });
    }

    // ==================== ADMIN: PUT /api/admin/pedidos (advance/cancel) ====================
    if (method === 'PUT' && url.includes('/admin')) {
      if (!isAdminOrSuperAdmin(decoded)) return sendError(res, 403, 'Acceso denegado.');

      const { id, accion, motivo } = req.body || {};
      if (!id) return sendError(res, 400, 'ID del pedido es obligatorio.');
      if (!accion || !['avanzar_estado', 'cancelar'].includes(accion)) return sendError(res, 400, 'Acción inválida.');

      const pedidoResult = await client.query(`SELECT id, estado, usuario_id FROM pedidos WHERE id = $1`, [id]);
      if (pedidoResult.rows.length === 0) return sendError(res, 404, 'Pedido no encontrado.');
      const pedido = pedidoResult.rows[0];
      const estadoActual = pedido.estado;

      if (accion === 'avanzar_estado') {
        const siguienteEstado = FLUJO_ESTADOS[estadoActual];
        if (!siguienteEstado) return sendError(res, 400, `El pedido ya está en su estado final (${estadoActual}).`);
        await client.query('BEGIN');
        try {
          await client.query(`UPDATE pedidos SET estado = $1 WHERE id = $2`, [siguienteEstado, id]);
          await client.query(`INSERT INTO historial_pedidos (pedido_id, usuario_id, estado_anterior, estado_nuevo, motivo_cancelacion) VALUES ($1, $2, $3, $4, $5)`, [id, decoded.id, estadoActual, siguienteEstado, `Avance de estado por empleado ${decoded.nombre}`]);
          await client.query('COMMIT');
          return res.status(200).json({ success: true, message: `Estado avanzado a "${siguienteEstado}".`, data: { pedido_id: id, estado_anterior: estadoActual, estado_nuevo: siguienteEstado } });
        } catch (err) { await client.query('ROLLBACK'); throw err; }
      }

      if (accion === 'cancelar') {
        if (!ESTADOS_CANCELABLES.includes(estadoActual)) return sendError(res, 400, `No se puede cancelar desde "${estadoActual}". Solo: ${ESTADOS_CANCELABLES.join(', ')}.`);
        if (!motivo || !motivo.trim()) return sendError(res, 400, 'Motivo obligatorio.');
        await client.query('BEGIN');
        try {
          const itemsResult = await client.query(`SELECT dp.producto_id, dp.cantidad FROM detalle_pedidos dp WHERE dp.pedido_id = $1`, [id]);
          for (const item of itemsResult.rows) { await client.query(`UPDATE productos SET stock = stock + $1 WHERE id = $2`, [item.cantidad, item.producto_id]); }
          await client.query(`UPDATE pedidos SET estado = 'cancelado' WHERE id = $1`, [id]);
          await client.query(`INSERT INTO historial_pedidos (pedido_id, usuario_id, estado_anterior, estado_nuevo, motivo_cancelacion) VALUES ($1, $2, $3, $4, $5)`, [id, decoded.id, estadoActual, 'cancelado', `Cancelado por empleado ${decoded.nombre}: ${motivo.trim()}`]);
          await client.query('COMMIT');
          return res.status(200).json({ success: true, message: 'Pedido cancelado y stock devuelto.', data: { pedido_id: id, estado_anterior: estadoActual, estado_nuevo: 'cancelado' } });
        } catch (err) { await client.query('ROLLBACK'); throw err; }
      }
    }

    return sendError(res, 404, 'Endpoint de pedidos no encontrado.');

  } catch (err) {
    console.error('Error en pedidos:', err);
    return sendError(res, err.status || 500, err.error || err.message);
  } finally {
    if (client) { try { await client.end(); } catch (e) {} }
    try { await pool.end(); } catch (e) {}
  }
};