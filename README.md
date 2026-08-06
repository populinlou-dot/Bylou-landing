# Bylou Landing

Landing page personal de **Lourdes Populin** (ByLou Yoga) — clases de yoga con base científica.

## Stack

- [Next.js](https://nextjs.org/) (React + TypeScript)
- Tailwind CSS
- Componentes UI: [shadcn/ui](https://ui.shadcn.com/)
- Exportado como sitio estático (`output: "export"`)

## Estructura

- `app/page.tsx` — contenido de la landing (todas las secciones)
- `app/layout.tsx` — layout global, fuentes, metadata, íconos
- `components/ui/` — componentes reutilizables (shadcn/ui)
- `public/images/` — imágenes del sitio
- `next.config.mjs` — configuración de build y `basePath` para GitHub Pages

## Desarrollo local

```bash
pnpm install
pnpm dev
```

Abrir [http://localhost:3000](http://localhost:3000).

## Build

```bash
pnpm run build
```

Genera una carpeta `out/` con el sitio estático (HTML/CSS/JS), lista para subir a cualquier hosting.

Por defecto, en producción el sitio usa el `basePath` `/Bylou-landing` (pensado para GitHub Pages). Si se despliega en un dominio propio, hay que compilar con:

```bash
NEXT_PUBLIC_BASE_PATH="" pnpm run build
```

## Deploy

El deploy a **GitHub Pages** es automático vía GitHub Actions ([.github/workflows/main.yml](.github/workflows/main.yml)): cada push a `main` dispara el build y la publicación.

Para subir el sitio a un hosting propio por FTP (cPanel/DonWeb/Ferozo), subir el **contenido** de la carpeta `out/` (generada con `NEXT_PUBLIC_BASE_PATH=""`) a la raíz del hosting.

## Dominio

El sitio se publica en [www.bylou.com.ar](https://www.bylou.com.ar). El dominio
se declara en `public/CNAME`, que el build copia a `out/CNAME`.

## Autor

**Lourdes Populin**
