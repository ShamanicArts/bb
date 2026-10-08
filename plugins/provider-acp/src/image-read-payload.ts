import { z } from "zod";

export const cursorImageReadPayloadSchema = z
  .object({
    path: z.string().min(1),
  })
  .strict();
