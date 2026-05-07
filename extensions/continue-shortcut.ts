import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerShortcut("ctrl+shift+enter", {
    description: "Send 'continue' to the agent",
    handler: async (ctx) => {
      pi.sendUserMessage("continue");
    },
  });
}
