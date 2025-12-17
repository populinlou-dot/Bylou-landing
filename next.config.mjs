/** @type {import('next').NextConfig} */
const basePath =
  process.env.NEXT_PUBLIC_BASE_PATH ??
  (process.env.NODE_ENV === "production" ? "/Bylou-landing" : "");

const nextConfig = {
  output: "export",
  trailingSlash: true,

  // IMPORTANTE:
  // - Si usás dominio personalizado (ej: bylou.com.ar), setea NEXT_PUBLIC_BASE_PATH=""
  // - Si usás GitHub Pages sin custom domain, dejá /Bylou-landing en producción
  basePath,
  assetPrefix: basePath ? `${basePath}/` : "",

  images: {
    unoptimized: true, // GitHub Pages no soporta el optimizador de next/image
  },

  // Exportar basePath al cliente para usar en componentes
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
