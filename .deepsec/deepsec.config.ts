import { type DeepsecPlugin, defineConfig } from "deepsec/config";
import { devMcpEntryPoints } from "./matchers/dev-mcp-entry-points.js";

const devMcpPlugin: DeepsecPlugin = {
  name: "dev-mcp",
  matchers: [devMcpEntryPoints],
};

export default defineConfig({
  projects: [
    { id: "dev-mcp", root: ".." },
    // <deepsec:projects-insert-above>
  ],
  plugins: [devMcpPlugin],
});
