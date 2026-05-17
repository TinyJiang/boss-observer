import { readConfig } from "../shared/config.js";
import { AccountIdentityProbe } from "./account-identity-probe.js";
import { CandidateDetailProbe } from "./candidate-detail-probe.js";
import { CandidateListProbe } from "./candidate-list-probe.js";
import { ChatRecordProbe } from "./chat-record-probe.js";
import { EventCollector } from "./event-collector.js";
import { FilterProbe } from "./filter-probe.js";
import { GreetingProbe } from "./greeting-probe.js";
import { JobContextProbe } from "./job-context-probe.js";
import { PageSessionProbe } from "./page-session-probe.js";
import { SessionContext } from "./session-context.js";

async function bootstrap() {
  const config = await readConfig();
  if (!config.enabled) {
    return;
  }

  const sessionContext = new SessionContext();
  const collector = new EventCollector({ config, sessionContext });
  const accountIdentityProbe = new AccountIdentityProbe({ config });
  const pageSessionProbe = new PageSessionProbe({ collector, sessionContext, config });
  const jobContextProbe = new JobContextProbe({ collector, sessionContext });
  const filterProbe = new FilterProbe({ collector, sessionContext });
  const candidateDetailProbe = new CandidateDetailProbe({ collector, sessionContext });
  const candidateListProbe = new CandidateListProbe({ collector, sessionContext });
  const chatRecordProbe = new ChatRecordProbe({ collector, sessionContext });
  const greetingProbe = new GreetingProbe({ collector, sessionContext });
  accountIdentityProbe.start();
  pageSessionProbe.start();
  jobContextProbe.start();
  filterProbe.start();
  candidateDetailProbe.start();
  candidateListProbe.start();
  chatRecordProbe.start();
  greetingProbe.start();
}

bootstrap().catch((error) => {
  console.warn("[BOSS Observer] bootstrap failed", error);
});
