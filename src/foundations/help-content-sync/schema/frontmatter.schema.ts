import { z } from "zod";
import { HELP_MODES } from "../interfaces/help-article.interface";

export const helpFrontmatterSchema = z.object({
  title: z.string().min(1),
  mode: z.enum(HELP_MODES),
  order: z.number().int(),
  summary: z.string().min(1),
  tags: z.array(z.string()).optional().default([]),
  contextual_keys: z
    .array(z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/))
    .optional()
    .default([]),
  ai_indexed: z.boolean().optional().default(true),
  draft: z.boolean().optional().default(false),
  related: z.array(z.string()).optional().default([]),
});

export type HelpFrontmatter = z.infer<typeof helpFrontmatterSchema>;
