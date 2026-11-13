const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'food-store-dev-secret-change-in-production';

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método no permitido. Usa GET.' });
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

  // Solo clientes pueden ver sus pedidos
  if (decoded.rol !== 'cliente') {
    return res.status(403).json({ success: false, error: 'Solo usuarios con rol cliente pueden ver sus pedidos.' });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let client;

  try {
    client = await pool.connect();

    // 2. Obtener pedidos del cliente ordenados del más nuevo al más viejo
    const pedidosResult = await client.query(
      `SELECT id, estado, total, costo_envio, direccion_envio, telefono_contacto, fecha_creacion
       FROM pedidos
       WHERE usuario_id = $1
       ORDER BY fecha_creacion DESC`,
      [decoded.id]
    );

    const pedidos = pedidosResult.rows;

    // 3. Para cada pedido, obtener el detalle con precio_unitario guardado en detalle_pedidos
    const pedidosConDetalle = [];
    for (const pedido of pedidos) {
      const detalleResult = await client.query(
        `SELECT dp.producto_id, dp.cantidad, dp.precio_unitario, p.nombre, p.imagen_url
         FROM detalle_pedidos dp
         JOIN productos p ON p.id = dp.producto_id
         WHERE dp.pedido_id = $1`,
        [pedido.id]
      );

      const items = detalleResult.rows.map(item => ({
        producto_id: item.producto_id,
        nombre: item.nombre,
        imagen_url: item.imagen_url,
        cantidad: item.cantidad,
        precio_unitario: parseFloat(item.precio_unitario),
        subtotal: parseFloat(item.precio_unitario) * item.cantidad
      }));

      const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);

      pedidosConDetalle.push({
        pedido_id: pedido.id,
        estado: pedido.estado,
        fecha_creacion: pedido.fecha_creacion,
        subtotal: parseFloat(subtotal.toFixed(2)),
        costo_envio: parseFloat(pedido.costo_envio),
        total: parseFloat(pedido.total),
        direccion_envio: pedido.direccion_envio,
        telefono_contacto: pedido.telefono_contacto,
        items
      });
    }

    return res.status(200).json({
      success: true,
      data: pedidosConDetalle
    });

  } catch (err) {
    console.error('Error al obtener mis pedidos:', err);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    if (client) {
      try { await client.end(); } catch (e) {}
    }
    try { await pool.end(); } catch (e) {}
  }
};