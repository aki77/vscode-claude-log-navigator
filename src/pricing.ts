export interface ModelPricing {
  inputPrice: number;
  outputPrice: number;
  cacheCreationPrice: number;
  cacheReadPrice: number;
}

export interface ServiceTierMultiplier {
  priority: number;
  standard: number;
  batch: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Claude Opus 4
  'claude-opus-4': {
    inputPrice: 15.0,
    outputPrice: 75.0,
    cacheCreationPrice: 18.75,
    cacheReadPrice: 1.5
  },
  'claude-3-5-opus-20241022': {
    inputPrice: 15.0,
    outputPrice: 75.0,
    cacheCreationPrice: 18.75,
    cacheReadPrice: 1.5
  },
  
  // Claude Sonnet 4
  'claude-sonnet-4': {
    inputPrice: 3.0,
    outputPrice: 15.0,
    cacheCreationPrice: 3.75,
    cacheReadPrice: 0.3
  },
  'claude-3-5-sonnet-20241022': {
    inputPrice: 3.0,
    outputPrice: 15.0,
    cacheCreationPrice: 3.75,
    cacheReadPrice: 0.3
  },
  'claude-3-5-sonnet-20240620': {
    inputPrice: 3.0,
    outputPrice: 15.0,
    cacheCreationPrice: 3.75,
    cacheReadPrice: 0.3
  },
  
  // Claude Haiku 3.5
  'claude-haiku-3-5': {
    inputPrice: 0.8,
    outputPrice: 4.0,
    cacheCreationPrice: 1.0,
    cacheReadPrice: 0.08
  },
  'claude-3-5-haiku-20241022': {
    inputPrice: 0.8,
    outputPrice: 4.0,
    cacheCreationPrice: 1.0,
    cacheReadPrice: 0.08
  },
  
  // Legacy models
  'claude-3-opus-20240229': {
    inputPrice: 15.0,
    outputPrice: 75.0,
    cacheCreationPrice: 18.75,
    cacheReadPrice: 1.5
  },
  'claude-3-sonnet-20240229': {
    inputPrice: 3.0,
    outputPrice: 15.0,
    cacheCreationPrice: 3.75,
    cacheReadPrice: 0.3
  },
  'claude-3-haiku-20240307': {
    inputPrice: 0.25,
    outputPrice: 1.25,
    cacheCreationPrice: 0.3,
    cacheReadPrice: 0.03
  }
};

export const SERVICE_TIER_MULTIPLIERS: ServiceTierMultiplier = {
  priority: 1.0,
  standard: 1.0,
  batch: 0.5
};

export function getModelPricing(modelName: string): ModelPricing {
  const pricing = MODEL_PRICING[modelName];
  if (!pricing) {
    console.warn(`Unknown model: ${modelName}, using default pricing`);
    return MODEL_PRICING['claude-3-5-sonnet-20241022'];
  }
  return pricing;
}

export function getServiceTierMultiplier(serviceTier?: string): number {
  if (!serviceTier) {
    return SERVICE_TIER_MULTIPLIERS.standard;
  }
  
  const tier = serviceTier.toLowerCase();
  switch (tier) {
    case 'priority':
      return SERVICE_TIER_MULTIPLIERS.priority;
    case 'standard':
      return SERVICE_TIER_MULTIPLIERS.standard;
    case 'batch':
      return SERVICE_TIER_MULTIPLIERS.batch;
    default:
      return SERVICE_TIER_MULTIPLIERS.standard;
  }
}