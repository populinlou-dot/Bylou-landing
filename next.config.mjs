/** @type {import('next').NextConfig} */
const basePath = process.env.NODE_ENV === "production" ? "/Bylou-landing" : ""

const nextConfig = {
  output: "export",
  trailingSlash: true,

  // IMPORTANTE para "project pages":
  // tu sitio va a vivir en /Bylou-landing/
  // Solo aplicar basePath en producción (GitHub Pages)
  basePath: basePath,
  assetPrefix: process.env.NODE_ENV === "production" ? "/Bylou-landing/" : "",

  images: {
    unoptimized: true, // GitHub Pages no soporta el optimizador de next/image
  },

  // Exportar basePath al cliente para usar en componentes
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
