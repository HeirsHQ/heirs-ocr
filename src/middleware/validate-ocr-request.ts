import { Request, Response, NextFunction } from "express";

import { OcrFunction, OcrFunctionName, OcrRequestPayload } from "../types/ocr.types";
import { getStrategy } from "../strategies/index";
import { HTTP_STATUS } from "../constants/index";

declare global {
  namespace Express {
    interface Request {
      ocrPayload?: OcrRequestPayload;
    }
  }
}

export function validateOcrRequest(req: Request, res: Response, next: NextFunction): void {
  if (!req.file) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      message: "File is required. Send a file in the 'file' form field.",
      data: null,
    });
    return;
  }

  let payload: OcrRequestPayload;

  // Support both formats: separate form fields (function, fields, comparisonData)
  // and the legacy single JSON `payload` field
  if (req.body.function) {
    const functionName = req.body.function;

    let fields: Record<string, unknown> = {};
    if (req.body.fields) {
      try {
        fields = typeof req.body.fields === "string" ? JSON.parse(req.body.fields) : req.body.fields;
      } catch {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          message: "'fields' must be a valid JSON string.",
          data: null,
        });
        return;
      }
    }

    let comparisonData: Record<string, unknown> | undefined;
    if (req.body.comparisonData) {
      try {
        comparisonData =
          typeof req.body.comparisonData === "string" ? JSON.parse(req.body.comparisonData) : req.body.comparisonData;
      } catch {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          message: "'comparisonData' must be a valid JSON string.",
          data: null,
        });
        return;
      }
    }

    payload = { function: functionName, fields, ...(comparisonData && { comparisonData }) } as OcrRequestPayload;
  } else if (req.body.payload) {
    try {
      payload = typeof req.body.payload === "string" ? JSON.parse(req.body.payload) : req.body.payload;
    } catch {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: "'payload' must be a valid JSON string.",
        data: null,
      });
      return;
    }
  } else {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      message: "'function' and 'fields' are required in the form body.",
      data: null,
    });
    return;
  }

  const validFunctions = Object.values(OcrFunction) as string[];
  if (!payload.function || !validFunctions.includes(payload.function)) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      message: `Invalid function '${payload.function}'. Must be one of: ${validFunctions.join(", ")}`,
      data: null,
    });
    return;
  }

  const strategy = getStrategy(payload.function as OcrFunctionName);
  if (!strategy) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: `Strategy not registered for function '${payload.function}'.`,
      data: null,
    });
    return;
  }

  const fieldErrors = strategy.validate(payload);
  if (fieldErrors.length > 0) {
    res.status(HTTP_STATUS.UNPROCESSABLE_ENTITY).json({
      success: false,
      message: "Validation failed.",
      data: { errors: fieldErrors },
    });
    return;
  }

  req.ocrPayload = payload;
  next();
}
