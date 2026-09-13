import { ConnectGate } from "@/components/connect-gate";
import { LiveFeed } from "@/components/live-feed";

export default function LivePage() {
  return (
    <ConnectGate>
      <LiveFeed />
    </ConnectGate>
  );
}
