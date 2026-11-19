# Studia en GitHub Pages + Supabase

Esta versión no depende de Netlify ni de Netlify CLI. GitHub Pages sirve la interfaz estática; Supabase proporciona la base de datos, el almacenamiento privado y las Edge Functions para inicio de sesión, chat, permisos, administración, diagnósticos y la conexión opcional con Gemini.

## Antes de empezar

El ZIP no incluye cuentas, mensajes, archivos ni otros datos que pudieran existir en Netlify Blobs. Al cambiar a Supabase, la base empieza vacía. Si necesitas conservar información, expórtala desde el entorno anterior y planifica una importación aparte antes de cambiar el dominio. No se ha copiado ni migrado ningún dato real.

La página de alumnos conserva el comportamiento previo: una cuenta normal entra con su nombre, sin contraseña individual. En un sitio público esto permite que alguien reclame el nombre de otra persona. Los administradores sí requieren la contraseña privada configurada en Supabase. Para uso público con identidades reales, conviene migrar a Supabase Auth y exigir una cuenta por alumno antes de anunciar la web.

## 1. Crear el proyecto Supabase

1. Crea un proyecto en Supabase y guarda su URL, referencia del proyecto y clave pública (`anon` o `publishable`). La clave pública puede estar en el navegador; **no** es una clave de servicio.
2. En **SQL Editor**, abre `supabase/migrations/20261119000100_studia_schema.sql`, ejecútalo una sola vez y comprueba que se han creado `app_state`, `chat_messages`, `collected_diagnostics` y el bucket privado `chat-files`.
3. Revisa en **Storage → Buckets → chat-files** que el bucket permanezca privado y que el límite de archivo permitido por tu proyecto/plan cubra el tamaño que quieres aceptar. La app rechaza archivos mayores de 300 MB; el límite real de Supabase puede ser inferior.
4. En **Edge Functions → Secrets** (o la sección de secretos del proyecto) crea:
   - `ADMIN_PASSWORD`: contraseña fuerte para los administradores.
   - `SESSION_SECRET`: secreto aleatorio de al menos 32 caracteres. Genéralo localmente, por ejemplo con `openssl rand -base64 48`; no lo compartas ni lo guardes en el repositorio.
   - `GEMINI_API_KEY` y `GEMINI_MODEL`: opcionales, solo si se va a usar la pestaña IA. Gemini se invoca desde el servidor y su clave no se envía al navegador.
   - `MAX_STUDIA_STORAGE_BYTES`: opcional; cuota global por defecto de 800 MiB para reservas/adjuntos. Ajusta el valor según el almacenamiento disponible en tu proyecto.
   - `ALLOWED_ORIGIN`: opcional pero recomendado; usa el origen exacto de GitHub Pages, por ejemplo `https://TU-USUARIO.github.io` (sin ruta del repositorio). Si no se configura, las funciones responden con CORS `*` y siguen exigiendo sesión firmada para datos.

La app usa las variables administradas por Supabase `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` únicamente dentro de Edge Functions. No las pongas en `js/config.js`, workflows ni archivos del repositorio.

## 2. Conectar el frontend con Supabase

Edita `js/config.js` en GitHub y sustituye:

```js
export const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
export const SUPABASE_ANON_KEY = 'PEGA_AQUI_TU_PUBLISHABLE_O_ANON_KEY';
```

Usa la URL y la clave pública del proyecto. Nunca pegues la service-role key, `ADMIN_PASSWORD`, `SESSION_SECRET` ni `GEMINI_API_KEY` en este archivo.

## 3. Subir el proyecto a GitHub y publicar Pages

1. Descomprime el ZIP y sube el contenido de la carpeta `studiaappweb` a la raíz de un repositorio GitHub. Incluye `.github`, `supabase`, `css`, `js`, `index.html` y los archivos restantes.
2. En GitHub abre **Settings → Pages** y selecciona **GitHub Actions** como fuente de publicación.
3. El workflow `.github/workflows/pages.yml` publicará el sitio al hacer push a `main`. No necesita Netlify CLI ni un paso local de build.

La aplicación usa rutas por hash (`#/chat`, etc.), adecuadas para GitHub Pages. Los archivos JS y CSS usan rutas relativas para funcionar tanto en un dominio `usuario.github.io` como en un proyecto `usuario.github.io/repositorio`.

## 4. Publicar las funciones de Supabase desde GitHub

En el repositorio GitHub abre **Settings → Secrets and variables → Actions** y añade:

- `SUPABASE_ACCESS_TOKEN`: token de acceso personal de Supabase, guardado solo como secreto de Actions.
- `SUPABASE_PROJECT_REF`: referencia del proyecto Supabase.

El workflow `.github/workflows/supabase-functions.yml` publica `app-api` y `ai` cuando cambian archivos bajo `supabase/`, o manualmente desde **Actions**. No se necesita instalar ni usar Netlify CLI. El SQL de la base de datos se ejecuta una vez desde el panel de Supabase; el workflow no migra automáticamente el esquema.

## Funciones incluidas

- Inicio de sesión Studia con sesiones HMAC firmadas en servidor; clave de administrador validada en la Edge Function.
- Gestión de usuarios y roles admin/modder/user, permisos de secciones, apodos, avatares, notificaciones, baneos por cuenta, calendario, horario, noticias, asignaturas y contenido de exámenes.
- Chat global almacenado en Postgres, con URLs temporales para descargar adjuntos de un bucket privado. Los archivos se cargan directamente a Supabase Storage; no atraviesan la Edge Function.
- Límites antiabuso de carga: hasta 300 MB por archivo, 350 MB por usuario, 20 solicitudes por cuenta y 100 solicitudes globales por hora, y una cuota global de 800 MiB por defecto. El backend comprueba el tamaño real de objetos ya subidos. Las cargas incompletas caducan tras 24 horas y se limpian perezosamente cuando se solicita otra carga.
- IA opcional vía Gemini en una Edge Function con respuesta en streaming.
- Diagnósticos solo después de que el usuario acepte el aviso en la web. Incluyen datos técnicos y, si el usuario da permiso explícito al navegador, ubicación. La detección/bloqueo por IP depende de que Supabase exponga la IP del visitante en las cabeceras; el bloqueo por cuenta sí se valida en servidor.
- Sincronización del estado mediante revisión compare-and-swap para reducir pérdidas por escrituras administrativas simultáneas.

## Seguridad y límites conocidos

La clave `anon`/`publishable` del navegador es pública por diseño. La base tiene RLS activado y no permite acceso directo a las tablas a `anon`/`authenticated`; las operaciones sensibles pasan por Edge Functions con `service_role` solo en servidor. No abras las políticas de estas tablas ni publiques secretos.

Este cambio conserva el login anterior de alumnos basado únicamente en nombre, por lo que no es una identidad segura contra suplantación. Un visitante puede reclamar el nombre de otra persona y también intentar abusar de recursos. Hay cuotas de adjuntos globales y por cuenta, pero como los alumnos no se autentican individualmente, no son una defensa completa ante suplantación de nombres. Para uso público con identidades/datos reales, cambia a Supabase Auth antes de publicar ampliamente. Además, los bloqueos por IP dependen de cabeceras que el proxy del proveedor podría no entregar. Desactiva el consentimiento de diagnóstico si no necesitas recoger esos datos.

El envío de chat se sincroniza por consultas periódicas, no mediante WebSocket/realtime. El límite del frontend es 300 MB, pero la carga efectiva dependerá del tamaño máximo permitido por tu proyecto Supabase, navegador y plan. Los datos del almacenamiento antiguo de Netlify no se migran automáticamente.

## Comprobación local

Con Node.js instalado, ejecuta `npm test` desde la raíz del proyecto. Estas pruebas verifican el procesamiento del streaming, rutas Supabase, privacidad básica de configuración y manejo de adjuntos. No sustituyen a una comprobación en tu propio proyecto de Supabase con sus secretos y límites reales.
