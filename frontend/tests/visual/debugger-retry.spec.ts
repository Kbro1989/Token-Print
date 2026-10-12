import { test, expect } from "@playwright/test";

for (const failure of ["HTTP 503", "network failure"]) {
  test(`debugger ${failure} stays visible until an explicit retry`, async ({ page }) => {
    let requests = 0;
    await page.route("**/architecture", async (route) => {
      requests++;
      if (failure === "network failure") {
        await route.abort("failed");
        return;
      }
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Architecture temporarily unavailable" }),
      });
    });

    await page.goto("/app?mode=debugger");
    const error = page.locator(".dbg-empty-error");
    const retry = page.getByRole("button", { name: "Load live Qwen model", exact: true });
    await expect(error).toBeVisible();
    await expect(retry).toBeEnabled();

    // Observe the settled error state long enough for a failing effect to retry.
    await page.waitForTimeout(1_000);
    expect(requests).toBe(1);
    const message = await error.innerText();
    expect(message).not.toBe("");

    await retry.click();
    await expect.poll(() => requests).toBe(2);
    await expect(error).toHaveText(message);
    await expect(retry).toBeEnabled();
    await page.waitForTimeout(1_000);
    expect(requests).toBe(2);
  });
}
