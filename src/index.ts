import "dotenv/config";
import http from "http";

import { logger } from "./observability/logger";
import { env } from "./config/env";
import { main } from "./main";

const app = main();
const server = http.createServer(app);

server.listen(Number(env.PORT), () => logger.info(`service listening on http://localhost:${env.PORT}`));
