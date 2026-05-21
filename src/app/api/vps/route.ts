import { NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!hasRole(user.roles, "DEV") && !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Mock data — replace with real VPS agent polling when available
  const servers = [
    {
      id: "vps-1",
      name: "Production",
      provider: "Hetzner",
      ip: "XXX.XXX.XXX.XXX",
      specs: { cpu: "4 vCPU", ram: "8 GB", storage: "80 GB NVMe" },
      status: "online",
      uptime: "45d 12h 33m",
      metrics: {
        cpuUsage: 23,
        ramUsage: 61,
        diskUsage: 34,
        bandwidthUsed: "142 GB",
        bandwidthLimit: "20 TB",
      },
      lastChecked: new Date().toISOString(),
    },
    {
      id: "vps-2",
      name: "Staging",
      provider: "Hetzner",
      ip: "XXX.XXX.XXX.XXX",
      specs: { cpu: "2 vCPU", ram: "4 GB", storage: "40 GB NVMe" },
      status: "online",
      uptime: "12d 5h 18m",
      metrics: {
        cpuUsage: 8,
        ramUsage: 42,
        diskUsage: 21,
        bandwidthUsed: "38 GB",
        bandwidthLimit: "20 TB",
      },
      lastChecked: new Date().toISOString(),
    },
    {
      id: "vps-3",
      name: "Database",
      provider: "Hetzner",
      ip: "XXX.XXX.XXX.XXX",
      specs: { cpu: "2 vCPU", ram: "16 GB", storage: "160 GB NVMe" },
      status: "online",
      uptime: "45d 12h 33m",
      metrics: {
        cpuUsage: 14,
        ramUsage: 78,
        diskUsage: 52,
        bandwidthUsed: "84 GB",
        bandwidthLimit: "20 TB",
      },
      lastChecked: new Date().toISOString(),
    },
  ];

  return NextResponse.json({ servers });
}
