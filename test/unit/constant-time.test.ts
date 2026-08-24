import { describe, it, expect } from "vitest";
import { timingSafeEqual } from "../../src/security/constant-time";

describe("Security: constant-time comparison (timingSafeEqual)", () => {
  it("should return true for identical strings", () => {
    expect(timingSafeEqual("hello-world-secret", "hello-world-secret")).toBe(true);
    expect(timingSafeEqual("", "")).toBe(true);
  });

  it("should return false for different strings of same length", () => {
    expect(timingSafeEqual("hello-world-1", "hello-world-2")).toBe(false);
  });

  it("should return false for strings of different length", () => {
    expect(timingSafeEqual("short", "longer-string")).toBe(false);
    expect(timingSafeEqual("longer-string", "short")).toBe(false);
  });

  it("should work with Uint8Array buffers", () => {
    const buf1 = new Uint8Array([1, 2, 3, 4]);
    const buf2 = new Uint8Array([1, 2, 3, 4]);
    const buf3 = new Uint8Array([1, 2, 3, 5]);

    expect(timingSafeEqual(buf1, buf2)).toBe(true);
    expect(timingSafeEqual(buf1, buf3)).toBe(false);
  });
});
