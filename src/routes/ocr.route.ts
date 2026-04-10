import { Router } from "express";

import { validateOcrRequest } from "../middleware/validate-ocr-request";
import { processOcr } from "../controllers/ocr.controller";
import { upload } from "../middleware/upload";

const ocrRouter = Router();

ocrRouter.post("/", upload.single("file"), validateOcrRequest, processOcr);

export { ocrRouter };
