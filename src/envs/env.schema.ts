import { z } from 'zod';

export const envValidationSchema = z.object({
  GOOGLE_AI_API_KEY: z.string(),
  OPENAI_API_KEY: z.string(),
  GROQ_API_KEY: z.string(),
  DEEPSEEK_API_KEY: z.string(),
  MANUAL_CONFIRMATION_ENABLED: z
    .string()
    .transform((val) => val === 'true')
    .pipe(z.boolean()),
  PARSER_QUEUE_MAX_CONCURRENT: z.coerce.number().min(1),
});

// Automatically inferred type!
export type EnvironmentVariables = z.infer<typeof envValidationSchema>;
