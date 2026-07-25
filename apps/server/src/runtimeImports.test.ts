import assert from "node:assert/strict";
import test from "node:test";
import { makeId } from "./conversationUtils.ts";
import { getActualImageSize } from "./providers/fintopiaPayload.ts";

const onePixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

test("conversation ids use a UUID", () => {
  assert.match(
    makeId("conv"),
    /^conv_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test("image metadata helper remains available to the provider", async () => {
  assert.deepEqual(await getActualImageSize(onePixelPng), {
    width: 1,
    height: 1,
  });
});
