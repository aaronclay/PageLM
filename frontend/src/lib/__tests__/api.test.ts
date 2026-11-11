import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getChats, type ChatsList } from "../api";
import { env } from "../../config/env";

describe("getChats API", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should fetch chats list with GET method and return parsed data", async () => {
    const mockChatsResponse: ChatsList = {
      ok: true,
      chats: [
        { id: "chat-1", title: "Chat 1", createdAt: 1700000000 },
        { id: "chat-2", title: "Chat 2", createdAt: 1700000001 },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (h: string) => (h.toLowerCase() === "content-type" ? "application/json" : null),
      },
      json: async () => mockChatsResponse,
      text: async () => JSON.stringify(mockChatsResponse),
    });
    globalThis.fetch = mockFetch;

    const result = await getChats();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${env.backend}/chats`);
    expect(init?.method).toBe("GET");
    expect(result).toEqual(mockChatsResponse);
  });

  it("should return empty list of chats when no chats exist", async () => {
    const mockChatsResponse: ChatsList = {
      ok: true,
      chats: [],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (h: string) => (h.toLowerCase() === "content-type" ? "application/json" : null),
      },
      json: async () => mockChatsResponse,
      text: async () => JSON.stringify(mockChatsResponse),
    });
    globalThis.fetch = mockFetch;

    const result = await getChats();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mockChatsResponse);
    expect(result.chats).toHaveLength(0);
  });

  it("should throw an error when HTTP status is not ok", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "Database connection failure",
    });
    globalThis.fetch = mockFetch;

    await expect(getChats()).rejects.toThrow("http 500: Database connection failure");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should fallback to statusText when response text cannot be retrieved or is empty", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => {
        throw new Error("Cannot read body");
      },
    });
    globalThis.fetch = mockFetch;

    await expect(getChats()).rejects.toThrow("http 404: Not Found");
  });

  it("should propagate network failure when fetch rejects", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network Error"));
    globalThis.fetch = mockFetch;

    await expect(getChats()).rejects.toThrow("Network Error");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
