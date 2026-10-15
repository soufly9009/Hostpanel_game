import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Les migrations SQL sont lues à l'exécution par /api/admin/db/deploy.
  outputFileTracingIncludes: {
    "/api/admin/db/deploy": ["./drizzle/**/*"],
    "/admin/migrations": ["./drizzle/**/*"],
  },
  // ssh2 charge des modules natifs optionnels : ne pas le bundler.
  serverExternalPackages: ["ssh2", "nodemailer"],
}

export default nextConfig
