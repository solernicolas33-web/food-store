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

    // GET: Obtener métricas del negocio
    if (req.method === 'GET') {
      // 1. Total de ventas confirmadas/entregadas (suma de totales de pedidos en estados finales)
      const ventasResult = await client.query(
        `SELECT COALESCE(SUM(total), 0) as total_ventas
         FROM pedidos
         WHERE estado IN ('confirmado', 'en_preparacion', 'en_camino', 'entregado')`
      );
      const totalVentas = parseFloat(ventasResult.rows[0].total_ventas || 0);

      // 2. Cantidad de pedidos por estado
      const pedidosEstadoResult = await client.query(
        `SELECT estado, COUNT(*) as cantidad
         FROM pedidos
         GROUP BY estado
         ORDER BY cantidad DESC`
      );
      const pedidosPorEstado = {};
      ['pendiente', 'confirmado', 'en_preparacion', 'en_camino', 'entregado', 'cancelado'].forEach(e => {
        pedidosPorEstado[e] = 0;
      });
      pedidosEstadoResult.rows.forEach(r => {
        pedidosPorEstado[r.estado] = parseInt(r.cantidad, 10);
      });

      // 3. Productos con stock bajo (stock <= stock_minimo) y estado activo
      const stockBajoResult = await client.query(
        `SELECT id, nombre, stock, stock_minimo, categoria_id
         FROM productos
         WHERE estado = 'activo' AND stock <= stock_minimo
         ORDER BY (stock_minimo - stock) DESC, nombre`
      );
      const productosStockBajo = stockBajoResult.rows.map(r => ({
        id: r.id,
        nombre: r.nombre,
        stock: r.stock,
        stock_minimo: r.stock_minimo
      }));

      // 4. Clientes activos (usuarios con rol 'cliente' y estado 'activo')
      const clientesActivosResult = await client.query(
        `SELECT COUNT(*) as total
         FROM usuarios
         WHERE rol = 'cliente' AND estado = 'activo'`
      );
      const clientesActivos = parseInt(clientesActivosResult.rows[0].total, 10);

      // 5. Total de productos activos
      const totalProductosResult = await client.query(
        `SELECT COUNT(*) as total FROM productos WHERE estado = 'activo'`
      );
      const totalProductos = parseInt(totalProductosResult.rows[0].total, 10);

      // 6. Total de pedidos confirmados/entregados (contar no sumar)
      const totalPedidosConfirmadosResult = await client.query(
        `SELECT COUNT(*) as total
         FROM pedidos
         WHERE estado IN ('confirmado', 'en_preparacion', 'en_camino', 'entregado')`
      );
      const totalPedidosConfirmados = parseInt(totalPedidosConfirmadosResult.rows[0].total, 10);

      return res.status(200).json({
        success: true,
        data: {
          total_ventas: totalVentas,
          total_pedidos_confirmados: totalPedidosConfirmados,
          pedidos_por_estado: pedidosPorEstado,
          productos_stock_bajo: productosStockBajo,
          productos_stock_bajo_count: productosStockBajo.length,
          clientes_activos: clientesActivos,
          total_productos_activos: totalProductos
        }
      });
    }

    return res.status(405).json({ success: false, error: 'Método no permitido.' });

  } catch (err) {
    console.error('Error en admin/metricas:', err);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    if (client) { try { await client.end(); } catch (e) {} }
    try { await pool.end(); } catch (e) {}
  }
};