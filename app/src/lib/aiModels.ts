export const AI_MODELS = [
  { value: "sonnet", label: "Claude Sonnet — capable", provider: "anthropic" },
  { value: "haiku", label: "Claude Haiku — fast", provider: "anthropic" },
  { value: "openai-auto", label: "GPT — automatic", provider: "openai" },
  { value: "openai-fast", label: "GPT-6 Luna — fast", provider: "openai" },
  { value: "openai-capable", label: "GPT-6.1 Sol — capable", provider: "openai" },
] as const;

export function getAIModelOption(value: unknown) {
  return AI_MODELS.find((model) => model.value === value);
}
