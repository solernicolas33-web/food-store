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

  // Solo clientes pueden cancelar sus pedidos
  if (decoded.rol !== 'cliente') {
    return res.status(403).json({ success: false, error: 'Solo usuarios con rol cliente pueden cancelar pedidos.' });
  }

  const pedidoId = parseInt(req.query.id, 10);
  const { motivo } = req.body || {};

  if (!pedidoId || isNaN(pedidoId)) {
    return res.status(400).json({ success: false, error: 'ID de pedido inválido.' });
  }

  if (!motivo || !motivo.trim()) {
    return res.status(400).json({ success: false, error: 'El motivo de cancelación es obligatorio.' });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let client;

  try {
    client = await pool.connect();

    // 2. Verificar que el pedido existe, pertenece al usuario y está en estado 'pendiente'
    const pedidoResult = await client.query(
      `SELECT id, usuario_id, estado FROM pedidos WHERE id = $1`,
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
      return res.status(400).json({ 
        success: false, 
        error: `El pedido no se puede cancelar porque su estado actual es "${pedido.estado}". Solo se pueden cancelar pedidos en estado "pendiente".` 
      });
    }

    // 3. Actualizar pedido a estado 'cancelado' y registrar en historial
    await client.query('BEGIN');

    try {
      await client.query(
        `UPDATE pedidos SET estado = 'cancelado' WHERE id = $1`,
        [pedidoId]
      );

      await client.query(
        `INSERT INTO historial_pedidos (pedido_id, usuario_id, estado_anterior, estado_nuevo, motivo_cancelacion)
         VALUES ($1, $2, $3, $4, $5)`,
        [pedidoId, decoded.id, 'pendiente', 'cancelado', motivo.trim()]
      );

      await client.query('COMMIT');

      return res.status(200).json({
        success: true,
        message: 'Pedido cancelado correctamente.',
        data: {
          pedido_id: pedidoId,
          estado: 'cancelado'
        }
      });

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

  } catch (err) {
    console.error('Error al cancelar pedido:', err);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    if (client) {
      try { await client.end(); } catch (e) {}
    }
    try { await pool.end(); } catch (e) {}
  }
};