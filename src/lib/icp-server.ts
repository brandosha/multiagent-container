import net from "net";
import readline from "readline";

export function createIcpServer(): net.Server {
  return net.createServer((socket) => {
    const rl = readline.createInterface({ input: socket });

    rl.on("line", (line) => {
      try {
        const message = JSON.parse(line);
        console.log("Received message:", message);
      } catch (err) {
        console.error("Error parsing message:", err);
      }
    });

    socket.on("error", (err) => {
      console.error("Socket error:", err);
    });
  });
}