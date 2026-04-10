import express, { NextFunction, Request, Response } from "express";
import swaggerUi from "swagger-ui-express";
import morgan from "morgan";
import path from "path";
import cors from "cors";

import { HTTP_RESPONSE, HTTP_STATUS } from "./constants/index";
import { ocrRouter } from "./routes/ocr.route";
import { createError } from "./common/error";

export function main() {
  const app = express();

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(cors({ origin: "*" }));
  app.use(morgan("dev"));

  app.use(function (_err: Error, _req: Request, _res: Response, _: NextFunction) {
    if (_err instanceof SyntaxError) {
      return _res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: HTTP_STATUS.UNPROCESSABLE_ENTITY,
        message: "Invalid JSON payload passed.",
        status: HTTP_STATUS.UNPROCESSABLE_ENTITY,
        success: false,
        data: null,
      });
    }
  });

  app.get("/", (_req, res) => {
    res.status(200).json({ message: "Heirs OCR API" });
  });

  const swaggerDocument = require(path.join(__dirname, "..", "public", "docs", "openapi.json"));
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

  app.use("/api/ocr", ocrRouter);

  app.use((_req, _res, next) => {
    next(
      createError(HTTP_STATUS.NOT_FOUND, [
        {
          code: HTTP_STATUS.NOT_FOUND,
          status: HTTP_RESPONSE.ERROR,
          message: "Route not found.",
          data: null,
        },
      ]),
    );
  });

  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    console.log(error);
    const initialError = error;
    if (!error.statusCode) {
      error = createError(HTTP_STATUS.INTERNAL_SERVER_ERROR, [
        {
          code: HTTP_STATUS.INTERNAL_SERVER_ERROR,
          status: HTTP_RESPONSE.ERROR,
          message: initialError.message || "Internal Server Error.",
          data: error.data,
          stack: error.stack,
        },
      ]);
    }

    return res.status(error.statusCode).json({
      code: error.code,
      status: error.status,
      message: error.message,
      data: error.data || null,
      ...(process.env.NODE_ENV === "development" && { stack: error.stack }),
    });
  });

  return app;
}
