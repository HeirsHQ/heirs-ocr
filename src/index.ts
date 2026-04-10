import "dotenv/config";

import dotenv from "dotenv";
import http from "http";

import { env } from "./common/env";
import { main } from "./main";

dotenv.config();

const app = main();
const server = http.createServer(app);

server.listen(env.PORT || 8080, () =>
  console.log(`service is now running, see docs at http://localhost:${env.PORT}/docs`),
);
