# Food Store

Proyecto para la materia **Organización Empresarial**.

## 📋 Descripción del Negocio

**Food Store** es una tienda web para la gestión y venta de alimentos. Permite a los usuarios navegar por un catálogo de productos y realizar compras. El proyecto se desarrolla como práctica académica con los siguientes lineamientos:

- **Base de datos:** PostgreSQL externa (Neon), conectada mediante la variable de entorno `DATABASE_URL`.
- **Seguridad:** Los permisos y la autenticación se validan siempre en el servidor, nunca únicamente desde el frontend.
- **Productos:** No se eliminan registros de productos de la base de datos; las bajas se gestionan mediante borrado lógico (activo/inactivo).
- **Pagos:** Los procesos de pago son **100% simulados**. No se integran pasarelas de pago reales ni credenciales financieras.

## 🚀 Tecnologías

- [Node.js](https://nodejs.org/) (runtime en Vercel serverless functions)
- [pg](https://node-postgres.com/) (cliente de PostgreSQL para Node.js)
- [Neon](https://neon.tech/) (PostgreSQL como servicio en la nube)
- HTML5 + JavaScript vanilla (frontend)
- [Vercel](https://vercel.com/) (despliegue y hosting)

## 📁 Estructura Base del Proyecto

```text
food-store/
├── .gitignore              # Archivos y carpetas ignorados por Git (incluye .env)
├── .env.example            # Plantilla de variables de entorno (sin credenciales reales)
├── .env                    # Variables de entorno locales (no se sube a Git)
├── AGENTS.md               # Reglas e instrucciones para agentes de IA
├── README.md               # Documentación del proyecto (este archivo)
├── BITACORA-IA.md          # Registro de desarrollo asistido por IA
├── package.json            # Dependencias y scripts de Node.js
├── index.html              # Página de inicio ("/") con estado de la BD
└── api/
    ├── init.js             # Endpoint POST: conecta a la BD y crea tabla de prueba
    └── status.js           # Endpoint GET: verifica conexión a PostgreSQL
```

## ⚙️ Instalación y Uso en Local

1. Clona el repositorio e instala dependencias:

```bash
npm install
```

2. Copia el archivo de ejemplo y configura tus credenciales:

```bash
cp .env.example .env
```

Edita `.env` y añade tu cadena de conexión de Neon:

```env
DATABASE_URL="postgresql://usuario:contraseña@host:5432/base_de_datos?sslmode=require"
```

3. Ejecuta la app en local con Vercel CLI:

```bash
npm i -g vercel
vercel dev
```

4. Abre `http://localhost:3000` en el navegador.

5. Para inicializar la base de datos (crear la tabla `test_connection` si no existe), haz clic en el botón **"Inicializar BD (crear tabla)"** de la página de inicio, o llama al endpoint:

```bash
curl -X POST http://localhost:3000/api/init
```

6. Para consultar el estado de la conexión:

```bash
curl http://localhost:3000/api/status
```

## ☁️ Despliegue en Vercel

1. Sube el código a un repositorio de GitHub.
2. Importa el proyecto en [Vercel](https://vercel.com/).
3. Agrega la variable de entorno `DATABASE_URL` en la configuración del proyecto en Vercel.
4. Despliega. La página estará disponible en tu dominio de Vercel.

## 📚 Documentación Relacionada

- `BITACORA-IA.md`: Registro de avances y decisiones tomadas con apoyo de IA.
- `AGENTS.md`: Directrices de arquitectura y reglas de desarrollo.
