import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSettings } from "./db";
import { summariseNote, summariseReflection } from "./claude";

vi.mock("./db", () => ({ getSettings: vi.fn() }));

const fetchMock = vi.fn<typeof fetch>();
const settingsMock = vi.mocked(getSettings);

function useModel(aiModel: string) {
  settingsMock.mockResolvedValue({ aiModel } as Awaited<ReturnType<typeof getSettings>>);
}

function openAIResponse(text: string) {
  return Response.json({
    status: "completed",
    output: [
      { type: "reasoning" },
      { type: "message", content: [{ type: "output_text", text }] },
    ],
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  vi.stubEnv("AI_FALLBACK_TO_ANTHROPIC", undefined);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("AI model selection", () => {
  it("uses Claude Sonnet for a legacy default", async () => {
    useModel("sonnet");
    fetchMock.mockResolvedValueOnce(Response.json({ content: [{ type: "text", text: '["Fictional note"]' }] }));
    await expect(summariseNote("Fictional session")).resolves.toEqual(["Fictional note"]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/messages");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).model).toBe("claude-sonnet-5");
  });

  it("chooses a model by task and disables response storage in GPT Automatic", async () => {
    useModel("openai-auto");
    fetchMock.mockResolvedValueOnce(openAIResponse("Fictional reflection"));
    fetchMock.mockResolvedValueOnce(openAIResponse('["Fictional note"]'));
    await expect(summariseReflection("Fictional session")).resolves.toBe("Fictional reflection");
    await expect(summariseNote("Fictional session")).resolves.toEqual(["Fictional note"]);
    expect(fetchMock.mock.calls.map(([url, request]) => [url, JSON.parse(String(request?.body))])).toEqual([
      ["https://api.openai.com/v1/responses", expect.objectContaining({ model: "gpt-6-luna", store: false })],
      ["https://api.openai.com/v1/responses", expect.objectContaining({ model: "gpt-6.1-sol", store: false })],
    ]);
  });

  it("keeps a rate-limited request with its selected provider unless backup is enabled", async () => {
    useModel("openai-fast");
    fetchMock.mockResolvedValueOnce(new Response("Fictional sensitive content", { status: 429 }));
    await expect(summariseNote("Fictional session")).rejects.toThrow(/^OpenAI request failed \(429\)$/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("tries Claude after a GPT rate limit when backup is explicitly enabled", async () => {
    useModel("openai-fast");
    vi.stubEnv("AI_FALLBACK_TO_ANTHROPIC", "true");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }));
    fetchMock.mockResolvedValueOnce(Response.json({ content: [{ type: "text", text: '["Fictional note"]' }] }));
    await expect(summariseNote("Fictional session")).resolves.toEqual(["Fictional note"]);
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.anthropic.com/v1/messages");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).model).toBe("claude-haiku-4-5-20251001");
  });

  it("does not route model refusals to backup", async () => {
    useModel("openai-capable");
    vi.stubEnv("AI_FALLBACK_TO_ANTHROPIC", "true");
    fetchMock.mockResolvedValueOnce(Response.json({
      status: "completed",
      output: [{ type: "message", content: [{ type: "refusal" }] }],
    }));
    await expect(summariseNote("Fictional session")).rejects.toThrow("declined");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
