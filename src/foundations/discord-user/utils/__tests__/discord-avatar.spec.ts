import { describe, expect, it } from "vitest";
import { DISCORD_AVATAR_PREFIX, shouldUseDiscordAvatar } from "../discord-avatar";

describe("shouldUseDiscordAvatar", () => {
  it("uses the Discord CDN prefix", () => {
    expect(DISCORD_AVATAR_PREFIX).toBe("https://cdn.discordapp.com/");
  });

  it.each([undefined, null, "", "https://cdn.discordapp.com/avatars/1/a.png"])("is true for %s", (avatar) => {
    expect(shouldUseDiscordAvatar(avatar)).toBe(true);
  });

  it.each(["users/u-1/avatar.png", "https://lh3.googleusercontent.com/x"])("is false for %s", (avatar) => {
    expect(shouldUseDiscordAvatar(avatar)).toBe(false);
  });
});
