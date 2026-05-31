import { spawn, ChildProcessWithoutNullStreams } from "child_process";

import { appDir } from "./paths.js";
import { HistorySub } from "./PubSub.js";


type CodexLogin = {
  process: ChildProcessWithoutNullStreams;
  output: HistorySub<{ stream: 'stdout' | 'stderr', text: string }>;
} | undefined;

const codexCliPath = `${appDir}/node_modules/.bin/codex`;
let _login: CodexLogin = undefined;

export const codex = {
  login() {
    if (_login) {
      return _login;
    }

    const login = _login = {
      process: spawn(codexCliPath, ["login", "--device-auth"], {
        env: process.env,
        timeout: 600000
      }),
      output: new HistorySub()
    };

    login.process.stdout.on("data", (data) => {
      login.output.publish({ stream: 'stdout', text: data.toString() });
    });

    login.process.stderr.on("data", (data) => {
      login.output.publish({ stream: 'stderr', text: data.toString() });
    });

    return login;
  }
}