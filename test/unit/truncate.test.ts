import { describe, it, expect } from "vitest";
import { truncateByBytes, getUtf8ByteLength } from "../../src/notification/truncate";

describe("Notification: UTF-8 Byte Truncation", () => {
  it("should calculate correct UTF-8 byte length", () => {
    expect(getUtf8ByteLength("abc")).toBe(3);
    expect(getUtf8ByteLength("你好")).toBe(6); // 2 个中文字符，每个 3 字节
    expect(getUtf8ByteLength("🚀")).toBe(4); // 1 个 emoji，4 字节
  });

  it("should not modify text if within byte limit", () => {
    const text = "Hello 世界";
    expect(truncateByBytes(text, 50)).toBe(text);
  });

  it("should safely truncate multi-byte Chinese characters without corruption", () => {
    const text = "一二三四五六七八九十"; // 30 字节
    // 截断到 12 字节（包含 3 字节 "..."，剩余 9 字节 = 3 个汉字）
    const truncated = truncateByBytes(text, 12, "...");

    expect(getUtf8ByteLength(truncated)).toBeLessThanOrEqual(12);
    expect(truncated).toBe("一二三...");
  });

  it("should safely truncate emoji without splitting surrogate pairs", () => {
    const text = "🚀🔥🎉✨🌟"; // 每个 emoji 4 字节，共 20 字节
    const truncated = truncateByBytes(text, 11, "...");

    expect(getUtf8ByteLength(truncated)).toBeLessThanOrEqual(11);
    expect(truncated).toBe("🚀🔥...");
  });

  it("should handle edge cases (empty string, 0 maxBytes)", () => {
    expect(truncateByBytes("", 10)).toBe("");
    expect(truncateByBytes("hello", 0)).toBe("");
  });
});
