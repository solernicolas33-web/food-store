const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'food-store-dev-secret-change-in-production';
const COSTO_ENVIO_FIJO = 3.00;

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

  // Solo clientes pueden registrar pedidos
  if (decoded.rol !== 'cliente') {
    return res.status(403).json({ success: false, error: 'Solo usuarios con rol cliente pueden registrar pedidos.' });
  }

  const { direccion_envio, telefono_contacto, items, costo_envio = COSTO_ENVIO_FIJO } = req.body || {};

  if (!direccion_envio || !telefono_contacto || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'Dirección, teléfono y al menos un ítem son obligatorios.' });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // 2. Revisar stock suficiente y calcular subtotal
    let subtotal = 0;
    const detalles = [];

    for (const item of items) {
      if (!item.producto_id || !item.cantidad || item.cantidad < 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'Cada ítem debe tener producto_id y cantidad válida.' });
      }

      const prodResult = await client.query(
        'SELECT id, nombre, precio, stock FROM productos WHERE id = $1',
        [item.producto_id]
      );

      if (prodResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: `El producto ID ${item.producto_id} no existe.` });
      }

      const producto = prodResult.rows[0];

      if (producto.stock < parseInt(item.cantidad, 10)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: `Stock insuficiente para "${producto.nombre}". Disponible: ${producto.stock}, solicitado: ${item.cantidad}.`
        });
      }

      const precioUnitario = parseFloat(producto.precio);
      subtotal += precioUnitario * parseInt(item.cantidad, 10);

      detalles.push({
        producto_id: producto.id,
        cantidad: parseInt(item.cantidad, 10),
        precio_unitario: precioUnitario,
        nombre: producto.nombre
      });
    }

    const total = subtotal + parseFloat(costo_envio);

    // 3. Guardar pedido en estado 'pendiente'
    const pedidoResult = await client.query(
      `INSERT INTO pedidos (usuario_id, estado, total, costo_envio, direccion_envio, telefono_contacto)
       VALUES ($1, 'pendiente', $2, $3, $4, $5)
       RETURNING id, fecha_creacion`,
      [decoded.id, total, costo_envio, direccion_envio.trim(), telefono_contacto.trim()]
    );

    const pedidoId = pedidoResult.rows[0].id;

    // 4. Guardar cada ítem en detalle_pedidos conservando precio unitario del momento
    for (const d of detalles) {
      await client.query(
        `INSERT INTO detalle_pedidos (pedido_id, producto_id, cantidad, precio_unitario)
         VALUES ($1, $2, $3, $4)`,
        [pedidoId, d.producto_id, d.cantidad, d.precio_unitario]
      );
    }

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'Pedido registrado exitosamente.',
      data: {
        pedido_id: pedidoId,
        estado: 'pendiente',
        fecha_creacion: pedidoResult.rows[0].fecha_creacion,
        subtotal,
        costo_envio: parseFloat(costo_envio),
        total,
        direccion_envio,
        telefono_contacto,
        items: detalles
      }
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    if (client) {
      try { await client.end(); } catch (e) {}
    }
    try { await pool.end(); } catch (e) {}
  }
};
