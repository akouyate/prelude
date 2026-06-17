import { z } from "zod";

export const createJobInputSchema = z.object({
  title: z.string().trim().min(2).max(120),
  location: z.string().trim().max(120).optional(),
  description: z.string().trim().min(80).max(12000)
});

export type CreateJobInput = z.infer<typeof createJobInputSchema>;
