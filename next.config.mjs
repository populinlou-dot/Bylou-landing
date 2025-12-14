/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,

  // IMPORTANTE para "project pages":
  // tu sitio va a vivir en /Bylou-landing/
  basePath: "/Bylou-landing",
  assetPrefix: "/Bylou-landing/",

  images: {
    unoptimized: true, // GitHub Pages no soporta el optimizador de next/image
  },
};

export default nextConfig;
