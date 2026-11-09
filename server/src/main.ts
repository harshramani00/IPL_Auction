import { serverGameData } from "@auction/shared/server-data";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const { httpServer } = createApp(config, { data: serverGameData });

httpServer.listen(config.port, () => {
  console.log(`Auction Room server on http://localhost:${config.port}` +
    (config.aiEnabled ? "" : " (AI franchises off)"));
});
