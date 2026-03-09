import { AiModelAdapterOptions } from './ai-adapter.interface';
import { BaseOpenAiAdapter } from './base-openai.adapter';

export class DeepSeekAdapter extends BaseOpenAiAdapter {
  readonly provider = 'deepseek';

  // DeepSeek just reuses the shared JSON generation fallback
  async generate(prompt: string, options: AiModelAdapterOptions) {
    return this.generateViaJsonMode(prompt, options);
  }
}
