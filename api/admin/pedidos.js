const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'food-store-dev-secret-change-in-production';

// Flujo válido de estados (no se puede saltar ni volver atrás)
const FLUJO_ESTADOS = {
  'confirmado': 'en_preparacion',
  'en_preparacion': 'en_camino',
  'en_camino': 'entregado'
};

// Estados desde los cuales se puede cancelar
const ESTADOS_CANCELABLES = ['confirmado', 'en_preparacion', 'en_camino'];

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

    // GET: Listar todos los pedidos con filtros
    if (req.method === 'GET') {
      const { estado, pagina = 1, por_pagina = 20 } = req.query;
      const offset = (parseInt(pagina, 10) - 1) * parseInt(por_pagina, 10);
      const limit = parseInt(por_pagina, 10);

      let query = `
        SELECT p.id, p.usuario_id, u.nombre as cliente_nombre, u.email as cliente_email,
               p.estado, p.total, p.costo_envio, p.direccion_envio, p.telefono_contacto, p.fecha_creacion
        FROM pedidos p
        JOIN usuarios u ON u.id = p.usuario_id
        WHERE 1=1
      `;
      const params = [];

      if (estado) {
        params.push(estado);
        query += ` AND p.estado = $${params.length}`;
      }

      query += ` ORDER BY p.fecha_creacion DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const result = await client.query(query, params);

      // Obtener total para paginación
      let countQuery = `SELECT COUNT(*) FROM pedidos p WHERE 1=1`;
      const countParams = [];
      if (estado) {
        countParams.push(estado);
        countQuery += ` AND p.estado = $${countParams.length}`;
      }
      const countResult = await client.query(countQuery, countParams);

      // Para cada pedido, obtener items
      const pedidosConItems = [];
      for (const pedido of result.rows) {
        const itemsResult = await client.query(
          `SELECT dp.producto_id, dp.cantidad, dp.precio_unitario, p.nombre, p.imagen_url
           FROM detalle_pedidos dp
           JOIN productos p ON p.id = dp.producto_id
           WHERE dp.pedido_id = $1`,
          [pedido.id]
        );

        const items = itemsResult.rows.map(item => ({
          producto_id: item.producto_id,
          nombre: item.nombre,
          imagen_url: item.imagen_url,
          cantidad: item.cantidad,
          precio_unitario: parseFloat(item.precio_unitario),
          subtotal: parseFloat(item.precio_unitario) * item.cantidad
        }));

        const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);

        pedidosConItems.push({
          pedido_id: pedido.id,
          usuario_id: pedido.usuario_id,
          cliente_nombre: pedido.cliente_nombre,
          cliente_email: pedido.cliente_email,
          estado: pedido.estado,
          fecha_creacion: pedido.fecha_creacion,
          subtotal: parseFloat(subtotal.toFixed(2)),
          costo_envio: parseFloat(pedido.costo_envio),
          total: parseFloat(pedido.total),
          direccion_envio: pedido.direccion_envio,
          telefono_contacto: pedido.telefono_contacto,
          items,
          // Indicar siguiente estado válido
          siguiente_estado: FLUJO_ESTADOS[pedido.estado] || null,
          puede_cancelar: ESTADOS_CANCELABLES.includes(pedido.estado)
        });
      }

      return res.status(200).json({
        success: true,
        data: pedidosConItems,
        pagination: {
          pagina: parseInt(pagina, 10),
          por_pagina: limit,
          total: parseInt(countResult.rows[0].count, 10)
        }
      });
    }

    // PUT: Avanzar estado o cancelar pedido
    if (req.method === 'PUT') {
      const { id, accion, motivo } = req.body || {};

      if (!id) {
        return res.status(400).json({ success: false, error: 'ID del pedido es obligatorio.' });
      }

      if (!accion || !['avanzar_estado', 'cancelar'].includes(accion)) {
        return res.status(400).json({ success: false, error: 'Acción inválida. Use "avanzar_estado" o "cancelar".' });
      }

      // Obtener pedido actual
      const pedidoResult = await client.query(
        `SELECT id, estado, usuario_id FROM pedidos WHERE id = $1`,
        [id]
      );

      if (pedidoResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Pedido no encontrado.' });
      }

      const pedido = pedidoResult.rows[0];
      const estadoActual = pedido.estado;

      // AVANZAR ESTADO
      if (accion === 'avanzar_estado') {
        const siguienteEstado = FLUJO_ESTADOS[estadoActual];

        if (!siguienteEstado) {
          return res.status(400).json({
            success: false,
            error: `El pedido ya está en su estado final (${estadoActual}) o no se puede avanzar desde este estado.`
          });
        }

        // Actualizar estado y registrar en historial
        await client.query('BEGIN');
        try {
          await client.query(
            `UPDATE pedidos SET estado = $1 WHERE id = $2`,
            [siguienteEstado, id]
          );

          await client.query(
            `INSERT INTO historial_pedidos (pedido_id, usuario_id, estado_anterior, estado_nuevo, motivo_cancelacion)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, decoded.id, estadoActual, siguienteEstado, `Avance de estado por empleado ${decoded.nombre}`]
          );

          await client.query('COMMIT');

          return res.status(200).json({
            success: true,
            message: `Estado avanzado a "${siguienteEstado}".`,
            data: { pedido_id: id, estado_anterior: estadoActual, estado_nuevo: siguienteEstado }
          });
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }

      // CANCELAR PEDIDO (con devolución de stock)
      if (accion === 'cancelar') {
        if (!ESTADOS_CANCELABLES.includes(estadoActual)) {
          return res.status(400).json({
            success: false,
            error: `El pedido no se puede cancelar desde el estado "${estadoActual}". Solo se puede cancelar desde: ${ESTADOS_CANCELABLES.join(', ')}.`
          });
        }

        if (!motivo || !motivo.trim()) {
          return res.status(400).json({ success: false, error: 'El motivo de cancelación es obligatorio.' });
        }

        // Transacción: actualizar pedido, devolver stock, registrar historial
        await client.query('BEGIN');
        try {
          // 1. Obtener items del pedido para devolver stock
          const itemsResult = await client.query(
            `SELECT dp.producto_id, dp.cantidad FROM detalle_pedidos dp WHERE dp.pedido_id = $1`,
            [id]
          );

          // 2. Devolver stock a cada producto
          for (const item of itemsResult.rows) {
            await client.query(
              `UPDATE productos SET stock = stock + $1 WHERE id = $2`,
              [item.cantidad, item.producto_id]
            );
          }

          // 3. Actualizar pedido a cancelado
          await client.query(
            `UPDATE pedidos SET estado = 'cancelado' WHERE id = $1`,
            [id]
          );

          // 4. Registrar en historial
          await client.query(
            `INSERT INTO historial_pedidos (pedido_id, usuario_id, estado_anterior, estado_nuevo, motivo_cancelacion)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, decoded.id, estadoActual, 'cancelado', `Cancelado por empleado ${decoded.nombre}: ${motivo.trim()}`]
          );

          await client.query('COMMIT');

          return res.status(200).json({
            success: true,
            message: 'Pedido cancelado y stock devuelto correctamente.',
            data: { pedido_id: id, estado_anterior: estadoActual, estado_nuevo: 'cancelado' }
          });
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }

      return res.status(400).json({ success: false, error: 'Acción no reconocida.' });
    }

    return res.status(405).json({ success: false, error: 'Método no permitido.' });

  } catch (err) {
    console.error('Error en admin/pedidos:', err);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    if (client) { try { await client.end(); } catch (e) {} }
    try { await pool.end(); } catch (e) {}
  }
};