require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método no permitido. Usa POST.' });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ success: false, error: 'DATABASE_URL no está configurada.' });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let client;

  try {
    client = await pool.connect();

    const resultado = {
      tablas_creadas: [],
      categorias_insertadas: 0,
      productos_insertados: 0,
      usuarios_insertados: 0
    };

    // ---------------------------------------------------------
    // 1. Crear tablas (orden respeta claves foráneas)
    // ---------------------------------------------------------

    await client.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        rol VARCHAR(20) DEFAULT 'cliente' CHECK (rol IN ('cliente', 'empleado', 'superadmin')),
        estado VARCHAR(20) DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
        telefono VARCHAR(50),
        direccion TEXT,
        fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    resultado.tablas_creadas.push('usuarios');

    // Asegurar columnas telefono y direccion en tabla existente (migración)
    await client.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefono VARCHAR(50);`);
    await client.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS direccion TEXT;`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS categorias (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        estado VARCHAR(20) DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo'))
      )
    `);
    resultado.tablas_creadas.push('categorias');

    await client.query(`
      CREATE TABLE IF NOT EXISTS productos (
        id SERIAL PRIMARY KEY,
        categoria_id INTEGER REFERENCES categorias(id),
        nombre VARCHAR(150) NOT NULL,
        descripcion TEXT,
        precio DECIMAL(10,2) NOT NULL,
        stock INTEGER NOT NULL DEFAULT 0,
        stock_minimo INTEGER NOT NULL DEFAULT 0,
        imagen_url TEXT,
        estado VARCHAR(20) DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo'))
      )
    `);
    resultado.tablas_creadas.push('productos');

    await client.query(`
      CREATE TABLE IF NOT EXISTS pedidos (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER REFERENCES usuarios(id),
        estado VARCHAR(30) DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'confirmado', 'en_preparacion', 'en_camino', 'entregado', 'cancelado')),
        total DECIMAL(10,2) NOT NULL DEFAULT 0,
        costo_envio DECIMAL(10,2) NOT NULL DEFAULT 0,
        direccion_envio TEXT,
        telefono_contacto VARCHAR(50),
        fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    resultado.tablas_creadas.push('pedidos');

    await client.query(`
      CREATE TABLE IF NOT EXISTS detalle_pedidos (
        id SERIAL PRIMARY KEY,
        pedido_id INTEGER REFERENCES pedidos(id),
        producto_id INTEGER REFERENCES productos(id),
        cantidad INTEGER NOT NULL,
        precio_unitario DECIMAL(10,2) NOT NULL
      )
    `);
    resultado.tablas_creadas.push('detalle_pedidos');

    await client.query(`
      CREATE TABLE IF NOT EXISTS historial_pedidos (
        id SERIAL PRIMARY KEY,
        pedido_id INTEGER REFERENCES pedidos(id),
        usuario_id INTEGER REFERENCES usuarios(id),
        estado_anterior VARCHAR(30),
        estado_nuevo VARCHAR(30),
        motivo_cancelacion TEXT,
        fecha_cambio TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    resultado.tablas_creadas.push('historial_pedidos');

    // ---------------------------------------------------------
    // 2. Insertar datos de prueba solo si las tablas están vacías
    // ---------------------------------------------------------

    // Categorías
    const catCount = await client.query('SELECT COUNT(*) FROM categorias');
    if (parseInt(catCount.rows[0].count, 10) === 0) {
      const categorias = [
        { nombre: 'Bebidas', estado: 'activo' },
        { nombre: 'Lácteos', estado: 'activo' },
        { nombre: 'Panadería', estado: 'activo' },
        { nombre: 'Verduras', estado: 'activo' }
      ];
      for (const c of categorias) {
        await client.query('INSERT INTO categorias (nombre, estado) VALUES ($1, $2)', [c.nombre, c.estado]);
      }
      resultado.categorias_insertadas = categorias.length;
    }

    const cats = await client.query('SELECT id, nombre FROM categorias ORDER BY id');
    const catMap = {};
    cats.rows.forEach(c => { catMap[c.nombre] = c.id; });

    // Productos
    const prodCount = await client.query('SELECT COUNT(*) FROM productos');
    if (parseInt(prodCount.rows[0].count, 10) === 0) {
      const productos = [
        { categoria: 'Bebidas', nombre: 'Coca Cola 500ml', descripcion: 'Refresco de cola', precio: 1.50, stock: 100, stock_minimo: 10, imagen_url: '/img/coca-cola.png' },
        { categoria: 'Bebidas', nombre: 'Agua Mineral 1L', descripcion: 'Agua sin gas', precio: 0.80, stock: 150, stock_minimo: 20, imagen_url: '/img/agua.png' },
        { categoria: 'Bebidas', nombre: 'Jugo de Naranja 1L', descripcion: 'Jugo natural', precio: 2.00, stock: 80, stock_minimo: 10, imagen_url: '/img/jugo-naranja.png' },
        { categoria: 'Lácteos', nombre: 'Leche Entera 1L', descripcion: 'Leche pasteurizada', precio: 1.20, stock: 60, stock_minimo: 15, imagen_url: '/img/leche.png' },
        { categoria: 'Lácteos', nombre: 'Yogur Natural', descripcion: 'Yogur sin azúcar', precio: 0.90, stock: 40, stock_minimo: 10, imagen_url: '/img/yogur.png' },
        { categoria: 'Lácteos', nombre: 'Queso Fresco 200g', descripcion: 'Queso blanco fresco', precio: 3.50, stock: 30, stock_minimo: 5, imagen_url: '/img/queso.png' },
        { categoria: 'Panadería', nombre: 'Pan Blanco', descripcion: 'Pan de molde', precio: 1.00, stock: 50, stock_minimo: 10, imagen_url: '/img/pan-blanco.png' },
        { categoria: 'Panadería', nombre: 'Pan Integral', descripcion: 'Pan de trigo integral', precio: 1.50, stock: 40, stock_minimo: 8, imagen_url: '/img/pan-integral.png' },
        { categoria: 'Verduras', nombre: 'Tomate 1kg', descripcion: 'Tomate fresco', precio: 2.50, stock: 100, stock_minimo: 20, imagen_url: '/img/tomate.png' },
        { categoria: 'Verduras', nombre: 'Lechuga 1 unidad', descripcion: 'Lechuga romana', precio: 1.80, stock: 60, stock_minimo: 10, imagen_url: '/img/lechuga.png' },
        { categoria: 'Verduras', nombre: 'Zanahoria 1kg', descripcion: 'Zanahoria fresca', precio: 1.20, stock: 80, stock_minimo: 15, imagen_url: '/img/zanahoria.png' },
        { categoria: 'Verduras', nombre: 'Cebolla 1kg', descripcion: 'Cebolla amarilla', precio: 1.00, stock: 70, stock_minimo: 10, imagen_url: '/img/cebolla.png' }
      ];
      for (const p of productos) {
        await client.query(
          `INSERT INTO productos (categoria_id, nombre, descripcion, precio, stock, stock_minimo, imagen_url, estado)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'activo')`,
          [catMap[p.categoria], p.nombre, p.descripcion, p.precio, p.stock, p.stock_minimo, p.imagen_url]
        );
      }
      resultado.productos_insertados = productos.length;
    }

    // Usuarios con contraseñas hasheadas (6 salt rounds para serverless rápido)
    const userCount = await client.query('SELECT COUNT(*) FROM usuarios');
    if (parseInt(userCount.rows[0].count, 10) === 0) {
      const usuarios = [
        { nombre: 'Cliente Prueba', email: 'cliente@foodstore.com', password: 'Cliente123', rol: 'cliente', estado: 'activo' },
        { nombre: 'Empleado Prueba', email: 'empleado@foodstore.com', password: 'Empleado123', rol: 'empleado', estado: 'activo' },
        { nombre: 'Superadmin Prueba', email: 'superadmin@foodstore.com', password: 'SuperAdmin123', rol: 'superadmin', estado: 'activo' }
      ];
      for (const u of usuarios) {
        const hash = await bcrypt.hash(u.password, 6);
        await client.query(
          'INSERT INTO usuarios (nombre, email, password_hash, rol, estado) VALUES ($1, $2, $3, $4, $5)',
          [u.nombre, u.email, hash, u.rol, u.estado]
        );
      }
      resultado.usuarios_insertados = usuarios.length;
    }

    return res.status(200).json({
      success: true,
      message: 'Setup de base de datos completado.',
      data: resultado
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  } finally {
    if (client) {
      try { await client.end(); } catch (e) {}
    }
    try { await pool.end(); } catch (e) {}
  }
};
