import "dotenv/config";
import http from "http";

import { logger } from "./observability/logger";
import { initTracing } from "./observability/otel";
import { env } from "./config/env";
import { main } from "./main";

initTracing();

const app = main();
const server = http.createServer(app);

server.listen(Number(env.PORT), () => logger.info(`service listening on http://localhost:${env.PORT}`));
