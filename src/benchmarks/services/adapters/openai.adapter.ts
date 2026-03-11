import { AiModelAdapterOptions } from './ai-adapter.interface';
import { BaseOpenAiAdapter } from './base-openai.adapter';

export class OpenAiAdapter extends BaseOpenAiAdapter {
  readonly provider = 'openai';

  async generate(prompt: string, options: AiModelAdapterOptions) {
    return this.generateWithResponsesAPI(prompt, options);
  }
}
