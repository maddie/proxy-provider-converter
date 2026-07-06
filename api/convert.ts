import { z } from "zod";
import { convertFromSubscription } from "../src/core/convert.js";

export default async function handler(request: any, response: any) {
  const toString = (value: unknown): string | undefined => {
    if (Array.isArray(value)) return value[0] as string | undefined;
    return value as string | undefined;
  };

  const querySchema = z.object({
    url: z.string().url(),
    target: z.enum(["clash", "surge"]).default("clash"),
    "user-agent": z.string().optional(),
  });

  const parsed = querySchema.safeParse({
    url: toString(request.query?.url),
    target: toString(request.query?.target),
    "user-agent": toString(request.query?.["user-agent"]),
  });

  if (!parsed.success) {
    response.status(400).json({
      error: "Invalid query parameters",
      details: parsed.error.flatten(),
    });
    return;
  }

  const { url, target } = parsed.data;
  const userAgent = parsed.data["user-agent"] || request.headers?.["user-agent"];
  try {
    const result = await convertFromSubscription(url, target, userAgent);
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.status(200).send(result);
  } catch (error) {
    response.status(500).send(`${error}`);
  }
}
