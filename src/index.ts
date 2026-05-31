import { startAgentServer } from "./lib/agent-manager-server.js";

let port = 80;
if (process.env.SERVER_PORT) {
  port = parseInt(process.env.SERVER_PORT);
} else {
  console.warn("SERVER_PORT environment variable is not set. Defaulting to port 80.");
}

startAgentServer(port);