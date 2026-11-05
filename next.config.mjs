/** @type {import('next').NextConfig} */
const nextConfig = {
  // Native / heavy server-only packages are loaded from node_modules at runtime
  serverExternalPackages: ['@xenova/transformers', 'onnxruntime-node', 'sharp', 'mysql2', 'mongodb', 'pg'],
  poweredByHeader: false,
};
export default nextConfig;
