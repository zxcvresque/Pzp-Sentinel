import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import BmcConnection from "@/components/BmcConnection";
export default async function BmcConnectionPage() {
  const user = await getCurrentUser();
  if (!user?.roles.includes("ADMIN")) redirect("/login");
  return <BmcConnection />;
}
