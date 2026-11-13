const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'food-store-dev-secret-change-in-production';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método no permitido. Usa POST.' });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ success: false, error: 'DATABASE_URL no está configurada.' });
  }

  // 1. Verificar autenticación (JWT)
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

  // Solo clientes pueden aprobar/rechazar pagos
  if (decoded.rol !== 'cliente') {
    return res.status(403).json({ success: false, error: 'Solo usuarios con rol cliente pueden gestionar pagos.' });
  }

  const pedidoId = parseInt(req.query.id, 10);
  const { accion } = req.body || {};

  if (!pedidoId || isNaN(pedidoId)) {
    return res.status(400).json({ success: false, error: 'ID de pedido inválido.' });
  }

  if (!accion || !['aprobar', 'rechazar'].includes(accion)) {
    return res.status(400).json({ success: false, error: 'Acción inválida. Use "aprobar" o "rechazar".' });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let client;

  try {
    client = await pool.connect();

    // 2. Verificar que el pedido existe, pertenece al usuario y está en estado 'pendiente'
    const pedidoResult = await client.query(
      `SELECT id, usuario_id, estado, total FROM pedidos WHERE id = $1`,
      [pedidoId]
    );

    if (pedidoResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado.' });
    }

    const pedido = pedidoResult.rows[0];

    if (pedido.usuario_id !== decoded.id) {
      return res.status(403).json({ success: false, error: 'El pedido no pertenece al usuario actual.' });
    }

    if (pedido.estado !== 'pendiente') {
      return res.status(400).json({ success: false, error: `El pedido ya no está en estado pendiente (estado actual: ${pedido.estado}).` });
    }

    // 3. Si la acción es 'rechazar': mantener estado 'pendiente' sin tocar stock
    if (accion === 'rechazar') {
      // Registrar en historial que se rechazó el pago (opcional, para auditoría)
      await client.query(
        `INSERT INTO historial_pedidos (pedido_id, usuario_id, estado_anterior, estado_nuevo, motivo_cancelacion)
         VALUES ($1, $2, $3, $4, $5)`,
        [pedidoId, decoded.id, 'pendiente', 'pendiente', 'Pago rechazado por el cliente']
      );

      return res.status(200).json({
        success: true,
        message: 'Pago rechazado. El pedido permanece en estado pendiente y puede volver a intentarlo.',
        data: {
          pedido_id: pedidoId,
          estado: 'pendiente',
          accion: 'rechazar'
        }
      });
    }

    // 4. Si la acción es 'aprobar': ejecutar transacción atómica
    await client.query('BEGIN');

    try {
      // Obtener los items del pedido con stock actual de productos
      const itemsResult = await client.query(
        `SELECT dp.producto_id, dp.cantidad, dp.precio_unitario, p.nombre, p.stock
         FROM detalle_pedidos dp
         JOIN productos p ON p.id = dp.producto_id
         WHERE dp.pedido_id = $1`,
        [pedidoId]
      );

      if (itemsResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'El pedido no tiene items.' });
      }

      // Verificar stock suficiente para TODOS los productos (Regla R1)
      const productosSinStock = [];
      for (const item of itemsResult.rows) {
        if (item.stock < item.cantidad) {
          productosSinStock.push({
            producto_id: item.producto_id,
            nombre: item.nombre,
            stock_disponible: item.stock,
            cantidad_solicitada: item.cantidad
          });
        }
      }

      if (productosSinStock.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'Stock insuficiente para uno o más productos. No se ha descontado ningún stock.',
          data: {
            productos_sin_stock: productosSinStock
          }
        });
      }

      // Descontar stock de cada producto
      for (const item of itemsResult.rows) {
        await client.query(
          `UPDATE productos SET stock = stock - $1 WHERE id = $2`,
          [item.cantidad, item.producto_id]
        );
      }

      // Actualizar pedido a estado 'confirmado'
      await client.query(
        `UPDATE pedidos SET estado = 'confirmado' WHERE id = $1`,
        [pedidoId]
      );

      // Registrar cambio en historial_pedidos
      await client.query(
        `INSERT INTO historial_pedidos (pedido_id, usuario_id, estado_anterior, estado_nuevo, motivo_cancelacion)
         VALUES ($1, $2, $3, $4, $5)`,
        [pedidoId, decoded.id, 'pendiente', 'confirmado', 'Pago aprobado y stock descontado']
      );

      await client.query('COMMIT');

      return res.status(200).json({
        success: true,
        message: 'Pago aprobado. Stock descontado y pedido confirmado.',
        data: {
          pedido_id: pedidoId,
          estado: 'confirmado',
          accion: 'aprobar'
        }
      });

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

  } catch (err) {
    console.error('Error en pago:', err);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    if (client) {
      try { await client.end(); } catch (e) {}
    }
    try { await pool.end(); } catch (e) {}
  }
};