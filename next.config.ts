import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/install.sh", destination: "/api/vps/install" },
      { source: "/agent.sh", destination: "/api/vps/agent" },
    ];
  },
};

export default nextConfig;
