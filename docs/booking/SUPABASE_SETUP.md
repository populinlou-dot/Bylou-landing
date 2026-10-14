# Supabase Setup — Hosted project for Bylou booking

Guía paso a paso para que **la dueña del proyecto** cree y configure el proyecto de Supabase en la nube (hosted). Nadie más crea cuentas ni toca sistemas remotos: el orquestador solo recibe el *project ref* y la confirmación de cada paso.

> **Regla de oro:** las contraseñas, la `service_role`/secret key y el access token **nunca** se pegan en el chat, en el repo ni en GitHub. Viven en tu gestor de contraseñas y en tu máquina.

Contexto: ADR-002 (Supabase), ADR-004 (login con código OTP de 6 dígitos), ADR-010 (pnpm 9), ADR-013 (data source explícito, sin link a `/reservas` hasta el lanzamiento), `ARCHITECTURE.md` §9–§10, `DATA_MODEL.md` §11/§14.

## Quick path

| # | Paso | Dónde | Tiempo aprox. |
|---|------|-------|---------------|
| 1 | [Crear el proyecto](#1-create-the-project) | supabase.com | 10 min |
| 2 | [Configurar Auth](#2-auth-settings) | Dashboard → Authentication | 20 min |
| 3 | [SMTP propio + DNS](#3-custom-smtp-and-dns) | Proveedor de email + DNS de bylou.com.ar | 30–60 min (+ espera DNS) |
| 4 | [Aplicar migraciones](#4-apply-migrations) | Terminal (CLI) | 10 min |
| 5 | [Crear la admin (Lou)](#5-first-admin-lou) | App + SQL Editor | 5 min |
| 6 | [Variables en GitHub](#6-github-repository-variables) | GitHub → Settings | 5 min |
| 7 | [`.env.local` para desarrollo](#7-local-envlocal) | Tu máquina | 5 min |
| 8 | [Avisar al orquestador](#8-what-to-send-back) | Chat | 1 min |
| 9 | [Rollback y costos](#9-rollback-and-cost-notes) | Lectura | — |

---

## 1. Create the project

**Recomendación: un solo proyecto, `bylou-prod`, desde el inicio.** Pruebas con cuentas descartables antes del lanzamiento y limpias esos datos antes de abrirlo al público.

| Opción | Pros | Contras |
|--------|------|---------|
| **Solo `bylou-prod`** (recomendada) | Una sola configuración que mantener; usa 1 de los 2 proyectos gratis; el desarrollo diario ya corre en Supabase local (Docker). | Las pruebas pre-lanzamiento dejan datos de prueba que hay que limpiar. |
| `bylou-staging` primero | Pruebas aisladas de producción. | GitHub Pages no tiene staging (un solo sitio, deploy solo desde `main`, `ARCHITECTURE.md` §10): no habría dónde publicarlo. Un proyecto free sin uso se pausa a la semana. Habría que repetir toda esta guía dos veces. |

Si más adelante hace falta staging, se crea un segundo proyecto con esta misma guía.

### Pasos

1. [ ] Entra a <https://supabase.com/dashboard> e inicia sesión (o crea la cuenta).
2. [ ] Crea una organización si no tienes una. Plan: **Free**.
3. [ ] **New project** con estos valores:

   | Campo | Valor |
   |-------|-------|
   | Name | `bylou-prod` |
   | Database Password | Usa **Generate a password**. Guárdala **en tu gestor de contraseñas** antes de continuar. No la pegues en ningún otro lado. |
   | Region | **South America (São Paulo)** — `sa-east-1`, la más cercana a Argentina |
   | Plan | Free |
   | Data API / seguridad (si aparece) | Deja habilitada la **Data API** con el schema `public` (la app la usa vía RPC). |

4. [ ] Espera a que el proyecto termine de crearse (1–2 min).
5. [ ] Anota el **Project ref**: es el código que aparece en la URL `https://supabase.com/dashboard/project/<ref>` y en **Project Settings → General**. No es secreto.

---

## 2. Auth settings

La app usa **solo** login con código de 6 dígitos por email (`signInWithOtp` + `verifyOtp`, ver `booking/infrastructure/supabase/supabase-auth.ts`). No hay contraseñas, ni magic links, ni OAuth.

### 2.1 Email provider

Ruta: **Authentication → Sign In / Providers → Email**.

1. [ ] **Enable Email provider**: ON.
2. [ ] **Confirm email**: ON. (Con el login por código, ingresar el código ya confirma el email.)
3. [ ] **Allow new users to sign up** (en la configuración general de Sign In / Providers): ON. Si lo apagas, las alumnas nuevas no pueden entrar porque la app crea la cuenta en el primer código (`shouldCreateUser: true`).
4. [ ] **Email OTP Length**: **6**. ⚠️ Obligatorio: la app solo acepta exactamente 6 dígitos.
5. [ ] **Email OTP Expiration**: `3600` segundos (1 hora, el default). Es el valor que usa la configuración local y el que dicen los emails ("Vence en 1 hora"). Bajarlo (ej. `900` = 15 min) es más seguro, pero entonces hay que actualizar el texto de los templates (paso 2.3).

> **Sobre "desactivar el registro con contraseña":** Supabase no tiene un interruptor separado para "solo OTP". El proveedor Email cubre contraseña y código a la vez, y apagar los registros por email también bloquea a las alumnas nuevas. La app no muestra ningún formulario de contraseña. Alguien técnico podría registrarse con contraseña llamando a la API directamente, pero igual tiene que confirmar el email y queda como `student` sin créditos: RLS y las RPC impiden cualquier abuso. Riesgo aceptado para el MVP.

### 2.2 URL configuration

Ruta: **Authentication → URL Configuration**.

1. [ ] **Site URL**: `https://www.bylou.com.ar` (con `www`: el dominio sin `www` redirige a `www`).
2. [ ] **Redirect URLs** → **Add URL**, una por una:
   - `https://www.bylou.com.ar/reservas/**`
   - `http://localhost:3000/reservas/**`

> Como el código se escribe en la misma página, el flujo actual no usa redirecciones. Esta lista es una protección por si alguna vez se usa un link. `**` acepta cualquier subruta. La documentación de Supabase sugiere rutas exactas en producción; si quieres ser más estricta, usa `https://www.bylou.com.ar/reservas/ingresar/` en vez de la de `**`.

### 2.3 Email templates

Ruta: **Authentication → Emails → Templates** (o directo: `https://supabase.com/dashboard/project/<ref>/auth/templates`).

Edita **los dos** templates. Una alumna nueva (o sin confirmar) recibe **Confirm sign up**; una ya confirmada recibe **Magic link or OTP**. Los dos tienen que mostrar el código (`{{ .Token }}`), **no** un link.

Copia el contenido **exacto** de los archivos del repo; son los mismos que usa Supabase local (`supabase/config.toml`):

| Template en el dashboard | Subject | Body (copiar el archivo completo) |
|--------------------------|---------|-----------------------------------|
| **Confirm sign up** | `Tu código para ingresar` | `supabase/templates/confirmation.html` |
| **Magic link or OTP** | `Tu código para ingresar` | `supabase/templates/magic_link.html` |

1. [ ] **Confirm sign up**: subject + body de `confirmation.html`.
2. [ ] **Magic link or OTP**: subject + body de `magic_link.html`.
3. [ ] Revisa que **ninguno** de los dos contenga `{{ .ConfirmationURL }}`.

> El texto de los emails está en voseo a propósito, para mantener el tono de la app (`brands/bylou/copy.ts`). Dice "Vence en 1 hora": si cambiaste la expiración en 2.1, edita esa línea en el dashboard **y** en el archivo del repo.

### 2.4 Rate limits

Ruta: **Authentication → Rate Limits**. Valores por defecto según la documentación:

| Límite | Default | Qué hacer |
|--------|---------|-----------|
| Emails enviados | **2 por hora** con el email incorporado; **30 por hora** al activar SMTP propio | Después del paso 3, súbelo según el plan de tu proveedor (ej.: Resend Free = 100/día). |
| Pedidos de código por usuaria | 1 cada 60 s | Dejar. La app ya muestra "Podés pedir otro código en N s". |
| Verificaciones de código | 30 cada 5 min por IP | Dejar. |
| Sign-ups + sign-ins | 30 cada 5 min por IP | Dejar. |

### 2.5 CAPTCHA (Cloudflare Turnstile): recomendado antes del lanzamiento público

- [ ] **Por ahora NO lo actives.** Necesita un cambio en el frontend (widget de Turnstile + pasar `captchaToken` a `signInWithOtp`) que todavía no existe: es un **slice pendiente**. Si lo activas antes, el login deja de funcionar.
- Cuando ese slice esté listo: **Authentication → Bot and Abuse Protection → Enable CAPTCHA protection** → proveedor **Cloudflare Turnstile** → pega la *Secret Key* de Turnstile (en el dashboard, nunca en el chat).

---

## 3. Custom SMTP and DNS

El email incorporado de Supabase **no sirve para producción**: solo envía a direcciones del equipo del proyecto (al resto le da "Email address not authorized"), permite 2 emails por hora y no tiene garantías de entrega. Hace falta un proveedor SMTP propio.

### 3.1 Elegir proveedor

| Proveedor | Plan gratis | Notas |
|-----------|-------------|-------|
| **Resend** (recomendado) | 3.000 emails/mes, **100/día**, 3 dominios | Tiene guía oficial para Supabase. Alcanza para el volumen de un estudio chico. |
| Brevo | Plan gratis con límite diario (verifica el número actual en su web) | Buena opción si ya lo usas para newsletters. |
| Amazon SES | Pago por uso, muy barato | Arranca en *sandbox*: hay que pedir acceso a producción. Más complejo de configurar. |

### 3.2 Verificar el dominio (DNS: acción externa, la haces tú)

> ⚠️ **Los cambios de DNS de `bylou.com.ar` son externos y te pertenecen.** Se hacen en el panel donde administras el dominio, no en el repo. Un registro mal cargado puede afectar el email o el sitio: copia los valores **exactamente** como te los da el proveedor. No toques los registros que ya apuntan el sitio a GitHub Pages.

1. [ ] En el proveedor, agrega un dominio de envío. Recomendado: un **subdominio** (ej. `mail.bylou.com.ar`), así la reputación de envío queda separada del dominio principal.
2. [ ] El proveedor te muestra los registros a crear. Normalmente son:
   - **SPF** (TXT) — autoriza al proveedor a enviar por tu dominio.
   - **DKIM** (TXT o CNAME) — firma los emails.
   - **MX** opcional para rebotes, según el proveedor.
   - **DMARC** (TXT en `_dmarc`) — recomendado después de verificar.
3. [ ] Cárgalos en tu panel DNS y espera a que el proveedor marque el dominio como **Verified** (de minutos a horas).

### 3.3 Conectar el SMTP a Supabase

Ruta: **Authentication → Emails → SMTP Settings** → **Enable custom SMTP**.

| Campo | Ejemplo con Resend |
|-------|--------------------|
| Sender email | `no-reply@mail.bylou.com.ar` (del dominio verificado) |
| Sender name | `Bylou` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | Una API key de Resend. Creala en Resend y **pégala solo en este campo** del dashboard. |

1. [ ] Guarda con **Save**.
2. [ ] Vuelve a **Authentication → Rate Limits** (paso 2.4) y ajusta el límite de emails por hora sin pasarte del límite diario del proveedor.
3. [ ] Prueba: en la app local (paso 7), pide un código con tu email personal y verifica que llega desde `no-reply@...` con el código de 6 dígitos.

---

## 4. Apply migrations

Esto crea las tablas, RLS y funciones en la base de producción. Lo ejecutas tú en tu terminal, o autorizas explícitamente al orquestador a correrlo en tu máquina.

> ⚠️ **`supabase/seed.sql` NUNCA se aplica a producción.** Tiene usuarios y datos falsos (`staff@example.test`, `alumna1@example.test`…). No uses `--include-seed` y no corras `supabase db reset --linked`.
>
> ⚠️ **No corras `supabase config push`.** Copia `supabase/config.toml` (configuración *local*: Site URL `127.0.0.1`, confirmación de email apagada, etc.) sobre el proyecto hosted y deshace el paso 2.

### Pasos (desde la raíz del repo)

1. [ ] Verifica que tienes la CLI: `supabase --version`.
2. [ ] Login:

   ```bash
   supabase login
   ```

   Abre el navegador para autorizar la CLI con tu cuenta. El token queda guardado en tu sistema (keychain); no lo copies a ningún lado.
3. [ ] Vincular el repo con el proyecto:

   ```bash
   supabase link --project-ref <ref>
   ```

   Conecta esta carpeta con `bylou-prod`. Te pide la **Database Password**: escríbela en la terminal desde tu gestor de contraseñas. El vínculo se guarda en `supabase/.temp/`, que está en `.gitignore`.
4. [ ] Ver qué se va a aplicar, sin aplicar nada:

   ```bash
   supabase db push --dry-run
   ```

   Tienen que aparecer **todas** las migraciones de `supabase/migrations/`, en orden. Hoy son 11, de `20261014000100_baseline_privileges.sql` a `20261014001100_credit_expiry_job.sql`.
5. [ ] Aplicar:

   ```bash
   supabase db push
   ```

   Aplica en orden las migraciones de `supabase/migrations/` y las registra en `supabase_migrations.schema_migrations`. La próxima vez solo aplica las nuevas.
6. [ ] Confirmar que local y remoto coinciden:

   ```bash
   supabase migration list
   ```

   Cada migración tiene que figurar en las columnas Local y Remote.

### Verificación en el dashboard

1. [ ] **Table Editor** (schema `public`): están `profiles`, `studio_settings`, `class_types`, `sessions`, `session_private_details`, `credit_grants`, `bookings`, `credit_ledger`.
2. [ ] **SQL Editor** → ejecuta esto y confirma que **todas** las filas dicen `rls_enabled = true`:

   ```sql
   select c.relname as table_name, c.relrowsecurity as rls_enabled
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by 1;
   ```

3. [ ] La configuración del estudio ya viene cargada por la migración (Bylou: cancelación gratis hasta 24 h, después se bloquea):

   ```sql
   select * from public.studio_settings;
   ```

4. [ ] **Vencimiento automático de packs (pg_cron).** La migración `20261014001100_credit_expiry_job.sql` habilita la extensión `pg_cron` y programa la tarea `expire-credit-grants` cada hora (minuto 7). Confirma que quedó activa:

   ```sql
   select jobname, schedule, command, active from cron.job where jobname = 'expire-credit-grants';
   ```

   Tiene que devolver **una** fila: `7 * * * *`, `select private.expire_credit_grants()`, `active = true`.

   Si la consulta falla porque no existe `cron.job` (la extensión no se pudo habilitar) o no devuelve filas, la tarea no quedó programada. La migración no falla por eso: los saldos siguen siendo correctos y solo se demora la fila de "Vencimiento del pack" en el historial. En ese caso:
   1. Si falta la extensión: Dashboard → **Integrations → Cron** (o **Database → Extensions**) → habilita **pg_cron**.
   2. En el **SQL Editor**, programa la tarea una sola vez:

      ```sql
      select cron.schedule('expire-credit-grants', '7 * * * *', 'select private.expire_credit_grants()');
      ```

   3. Repite la consulta de arriba. Después de la primera ejecución puedes ver el resultado en `select * from cron.job_run_details order by start_time desc limit 5;`.

> La lista de espera es de la **Fase 4.4** y llega con su propia migración.

---

## 5. First admin (Lou)

Los roles viven en `public.profiles.role` (`student` | `staff`). Ninguna usuaria puede cambiar su propio rol desde la app: se promueve una sola vez desde el SQL Editor.

1. [ ] Lou entra **una vez** con su email por la app (local, paso 7, apuntando a producción) y completa el código. Eso crea su usuaria y su perfil `student`.
2. [ ] En **SQL Editor**, reemplaza el email y ejecuta:

   ```sql
   -- Promote Lou to staff. Only matches a confirmed email; returns the updated row.
   update public.profiles p
      set role = 'staff'
     from auth.users u
    where u.id = p.id
      and lower(u.email) = lower('EMAIL_DE_LOU_AQUI')
      and u.email_confirmed_at is not null
   returning p.id, p.email, p.role;
   ```

3. [ ] Tiene que devolver **exactamente 1 fila** con `role = staff`.
   - **0 filas:** Lou todavía no entró o no confirmó el código. Repite el paso 1.
4. [ ] Lou cierra sesión y vuelve a entrar; ahora tiene acceso a `/admin/`.

---

## 6. GitHub repository variables

Estas tres son **variables, no secrets**: son públicas por diseño (quedan dentro del JavaScript del sitio) y la seguridad la dan RLS y las RPC.

Ruta: repo en GitHub → **Settings → Secrets and variables → Actions → pestaña Variables → New repository variable**.

| Name | Value | Dónde se obtiene |
|------|-------|------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | Dashboard → botón **Connect**, o **Project Settings → API Keys** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | La **publishable key** (`sb_publishable_...`) o, si solo ves las legacy, la **`anon`** | **Project Settings → API Keys** |
| `NEXT_PUBLIC_BOOKING_DATA_SOURCE` | `supabase` | — |

> ⛔ **Nunca uses la `service_role` ni la secret key (`sb_secret_...`)**: saltean todo RLS y darían acceso total a la base. No van en el repo, ni en GitHub, ni en `.env.local`, ni en el chat. La app rechaza una key que parezca secreta y muestra error de configuración, pero no dependas de eso.

1. [ ] Crea las 3 variables (pestaña **Variables**, no **Secrets**).

> **Todavía no tienen efecto.** Hoy `.github/workflows/main.yml` no le pasa estas variables al build, así que en producción `/reservas` muestra el estado de error de configuración (ADR-013) y la landing no tiene link a `/reservas`. Conectarlas al workflow (`${{ vars.NOMBRE }}` en el paso *Build*) es un **cambio separado, que tú apruebas**, al momento del lanzamiento.

---

## 7. Local `.env.local`

Para probar la app en tu máquina contra `bylou-prod`.

1. [ ] En la raíz del repo, crea el archivo `.env.local` (ya está en `.gitignore` y no se sube):

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable o anon key>
   NEXT_PUBLIC_BOOKING_DATA_SOURCE=supabase
   ```

2. [ ] Levanta la app:

   ```bash
   npx pnpm@9 run dev
   ```

3. [ ] Abre <http://localhost:3000/reservas/> y entra con tu email: el código tiene que llegar por el SMTP del paso 3.

> Para volver a los datos de demostración, pon `NEXT_PUBLIC_BOOKING_DATA_SOURCE=mock`.
>
> Las cuentas y reservas que crees ahora son reales en `bylou-prod`. Usa emails descartables para las pruebas y, antes del lanzamiento, pídele al orquestador un plan de limpieza de esos datos.

---

## 8. What to send back

Envíale al orquestador **solo** esto:

```text
Project ref: <ref>
[x] 1 Proyecto creado (sa-east-1)
[x] 2 Auth configurado (OTP 6 dígitos, templates con {{ .Token }}, URLs)
[x] 3 SMTP propio activo y dominio verificado   (o: pendiente)
[x] 4 Migraciones aplicadas, RLS verificado, tarea pg_cron "expire-credit-grants" activa
[x] 5 Lou promovida a staff
[x] 6 Variables de GitHub creadas
[x] 7 .env.local funcionando
```

> ⛔ **Nunca envíes** la Database Password, la `service_role`/secret key, el access token de la CLI, la API key del SMTP ni la secret key de Turnstile. Tampoco hace falta la publishable key: si alguna vez se necesita, se lee desde la variable de GitHub.

---

## 9. Rollback and cost notes

### Costos (plan Free)

| Tema | Dato |
|------|------|
| Proyectos gratis | 2 activos. Los pausados no cuentan. |
| Límites relevantes | 500 MB de base por proyecto, 50.000 usuarias activas por mes, 5 GB de egress. Sobra para el MVP. |
| **Pausa por inactividad** | Los proyectos Free **se pausan después de 1 semana de inactividad**. Con la app en uso no pasa; durante pausas largas de desarrollo, sí. |
| Restaurar una pausa | Desde el dashboard del proyecto, con un clic (**Restore**). El proyecto pausado muestra cuántos días quedan para restaurar. Pasado ese plazo, todavía se puede descargar el backup desde el dashboard. |
| Plan pago | Los proyectos pagos no se pausan. Evalúa pasarte antes del lanzamiento si una pausa sería inaceptable (precio actual en supabase.com/pricing). |

### Rollback

- **Antes del lanzamiento** (sin datos reales): la forma más limpia de deshacer todo es borrar el proyecto (**Project Settings → General → Delete project**) y repetir esta guía.
- **Con datos reales:** Supabase no tiene migraciones "down". Un error se corrige con una **nueva migración hacia adelante** (`DATA_MODEL.md` §11). Los cambios destructivos requieren tu autorización explícita.
- **Backup manual** antes de cambios importantes (guárdalo fuera del repo):

  ```bash
  supabase db dump --linked -f ~/backups/bylou-schema.sql          # esquema
  supabase db dump --linked --data-only -f ~/backups/bylou-data.sql  # datos
  ```

- **GitHub:** borrar las 3 variables no cambia nada hoy, porque el workflow no las usa.
- **SMTP/DNS:** desactivar *custom SMTP* en Supabase devuelve el envío al email incorporado (limitado). Los registros DNS del subdominio de envío se pueden borrar sin afectar el sitio.

---

## Sources

Consultadas el 2026-10-14:

- Email OTP, `{{ .Token }}`, expiración, 1 pedido cada 60 s: <https://supabase.com/docs/guides/auth/auth-email-passwordless>
- Nombres de templates (Confirm sign up, Magic link or OTP): <https://supabase.com/docs/guides/auth/auth-email-templates>
- Allow new users to sign up / Confirm email: <https://supabase.com/docs/guides/auth/general-configuration>
- Site URL, Redirect URLs, comodines `*`/`**`: <https://supabase.com/docs/guides/auth/redirect-urls>
- Rate limits por defecto: <https://supabase.com/docs/guides/auth/rate-limits>
- SMTP propio (límites del incorporado, 30/h inicial, proveedores): <https://supabase.com/docs/guides/auth/auth-smtp>
- CAPTCHA / Turnstile: <https://supabase.com/docs/guides/auth/auth-captcha>
- API keys (publishable/secret, anon/service_role): <https://supabase.com/docs/guides/api/api-keys>
- `supabase db push`, `link`, `login`: <https://supabase.com/docs/reference/cli/supabase-db-push>
- `supabase config push`: <https://supabase.com/docs/reference/cli/supabase-config-push>
- Plan Free, proyectos, límites: <https://supabase.com/docs/guides/platform/billing-on-supabase>
- Pausa tras 1 semana de inactividad: <https://supabase.com/pricing>
- Restaurar proyecto pausado: <https://supabase.com/docs/guides/platform/upgrading>
- Resend + Supabase SMTP: <https://resend.com/docs/send-with-supabase-smtp>; plan Free: <https://resend.com/pricing>; subdominios: <https://resend.com/docs/dashboard/domains/introduction>
- Variables de GitHub Actions: <https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables>
