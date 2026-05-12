import { readConfig } from "../shared/config.js";
import { EventCollector } from "./event-collector.js";
import { PageSessionProbe } from "./page-session-probe.js";
import { SessionContext } from "./session-context.js";

async function bootstrap() {
  const config = await readConfig();
  if (!config.enabled) {
    return;
  }

  const sessionContext = new SessionContext();
  const collector = new EventCollector({ config, sessionContext });
  const pageSessionProbe = new PageSessionProbe({ collector, sessionContext, config });
  pageSessionProbe.start();
}

bootstrap().catch((error) => {
  console.warn("[BOSS Observer] bootstrap failed", error);
});
