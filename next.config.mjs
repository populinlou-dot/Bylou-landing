/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,

  // IMPORTANTE para "project pages":
  // tu sitio va a vivir en /Bylou-landing/
  // Solo aplicar basePath en producción (GitHub Pages)
  basePath: process.env.NODE_ENV === "production" ? "/Bylou-landing" : "",
  assetPrefix: process.env.NODE_ENV === "production" ? "/Bylou-landing/" : "",

  images: {
    unoptimized: true, // GitHub Pages no soporta el optimizador de next/image
  },
};

export default nextConfig;
