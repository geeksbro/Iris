import { WealthDashboard } from "@/features/dashboard/WealthDashboard";
import { LoginGate } from "@/features/auth/LoginGate";

export default function Home() {
  return (
    <LoginGate>
      <WealthDashboard />
    </LoginGate>
  );
}
