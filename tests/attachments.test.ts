import { describe, expect, it } from "vitest";
import {
  attachmentContext,
  mergeAttachments,
  type Attachment,
  decodeAttachment,
  droppedAttachments,
  prepareAttachments,
  renderAttachments,
} from "../src/context/attachments";
import { formatDuration } from "../src/components/ResponseTimer";

const file = (name: string, content = "actual text"): Attachment => ({
  path: `/selected/${name}`,
  name,
  content,
});
describe("file attachments", () => {
  it("reads dropped File objects and reports unsupported/oversized files independently", async () => {
    const result = await droppedAttachments([
      new File(["\ufeffFROM_FINDER_✓"], "notes.txt"),
      new File([new Uint8Array([0, 1, 2])], "binary.bin"),
      new File(["%PDF-document"], "document.pdf"),
      new File(["x".repeat(512 * 1024 + 1)], "large.txt"),
    ]);
    expect(result.files.map((file) => file.content)).toEqual(["FROM_FINDER_✓"]);
    expect(result.errors).toHaveLength(3);
    expect(() => decodeAttachment(new Uint8Array([0xff, 0xfe]))).toThrow(
      "UTF-8",
    );
  });
  it("persists excerpts separately from the prompt and can reconstruct model context for retry", () => {
    const packed = prepareAttachments(
      [file("long.txt", "start" + "x".repeat(60000) + "end")],
      2000,
    );
    const restored = JSON.parse(JSON.stringify(packed));
    expect(restored[0].originalCharacters).toBe(60008);
    expect(renderAttachments(restored)).toBe(renderAttachments(packed));
    expect(renderAttachments(restored).length).toBeLessThanOrEqual(2000);
  });
  it("deduplicates selected files, replaces refreshed contents and reports capacity without dropping earlier files", () => {
    const original = Array.from({ length: 8 }, (_, i) => file(`${i}.txt`));
    const result = mergeAttachments(original, [
      file("0.txt", "updated"),
      file("extra.txt"),
    ]);
    expect(result.files).toHaveLength(8);
    expect(result.files[0].content).toBe("updated");
    expect(result.skipped).toBe(1);
    expect(original[0].content).toBe("actual text");
  });
  it("includes exact small text and explicitly excerpts long files inside the allowance", () => {
    const small = file("small.txt", "ATTACHED_EXACT_TEXT");
    const large = file("large.txt", "START" + "middle".repeat(20000) + "END");
    const result = attachmentContext([small, large], 3000);
    expect(result.length).toBeLessThanOrEqual(3000);
    expect(result).toContain(small.content);
    expect(result).toContain("START");
    expect(result).toContain("END");
    expect(result).toContain("middle omitted");
    expect(large.content.length).toBe(120008);
    expect(attachmentContext([], 0)).toBe("");
  });
  it.each([
    [0, "0 s"],
    [1000, "1 s"],
    [59999, "59 s"],
    [60000, "1 min 0 s"],
    [3601000, "1 h 0 min 1 s"],
    [90061000, "1 d 1 h 1 min 1 s"],
    [-1000, "0 s"],
  ])("formats %i milliseconds as %s", (ms, text) => {
    expect(formatDuration(Number(ms))).toBe(text);
  });
});
