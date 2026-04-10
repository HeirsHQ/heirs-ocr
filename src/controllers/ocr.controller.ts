import { Request, Response, NextFunction } from "express";

import { OcrFunctionName } from "../types/ocr.types";
import { getStrategy } from "../strategies/index";
import { HTTP_STATUS } from "../constants/index";

export async function processOcr(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const payload = req.ocrPayload!;
    const fileBuffer = req.file!.buffer;

    const strategy = getStrategy(payload.function as OcrFunctionName)!;
    const result = await strategy.execute(fileBuffer, payload);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: `${payload.function} completed successfully.`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}
