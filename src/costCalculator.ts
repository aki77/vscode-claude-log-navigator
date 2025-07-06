import { getModelPricing, getServiceTierMultiplier } from './pricing';
import { UsageInfo } from './models';

export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  cacheCreationCost: number;
  cacheReadCost: number;
  totalCost: number;
  model: string;
  serviceTier?: string;
}

export function calculateCost(
  usage: UsageInfo,
  model: string,
  serviceTier?: string
): CostBreakdown {
  const pricing = getModelPricing(model);
  const tierMultiplier = getServiceTierMultiplier(serviceTier);
  
  const inputCost = (usage.input_tokens * pricing.inputPrice * tierMultiplier) / 1_000_000;
  const outputCost = (usage.output_tokens * pricing.outputPrice * tierMultiplier) / 1_000_000;
  const cacheCreationCost = ((usage.cache_creation_input_tokens || 0) * pricing.cacheCreationPrice * tierMultiplier) / 1_000_000;
  const cacheReadCost = ((usage.cache_read_input_tokens || 0) * pricing.cacheReadPrice * tierMultiplier) / 1_000_000;
  
  const totalCost = inputCost + outputCost + cacheCreationCost + cacheReadCost;
  
  return {
    inputCost,
    outputCost,
    cacheCreationCost,
    cacheReadCost,
    totalCost,
    model,
    serviceTier
  };
}

export function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

export function formatCostSummary(cost: number): string {
  if (cost >= 1) {
    return `$${cost.toFixed(2)}`;
  } else if (cost >= 0.01) {
    return `$${cost.toFixed(3)}`;
  } else {
    return `$${cost.toFixed(4)}`;
  }
}