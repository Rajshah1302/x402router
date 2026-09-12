import { Chat } from "@/components/chat";
import { ConnectGate } from "@/components/connect-gate";

export default function ChatPage() {
  return (
    <ConnectGate>
      <Chat />
    </ConnectGate>
  );
}
