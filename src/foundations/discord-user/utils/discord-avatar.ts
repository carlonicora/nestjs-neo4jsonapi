/**
 * The prefix of a Discord profile picture stored on `User.avatar`
 * (an external http(s) URL; see `fetchUserDetails`).
 */
export const DISCORD_AVATAR_PREFIX = "https://cdn.discordapp.com/";

/**
 * The picture rule for Discord connect and every Discord login: the Discord picture is written only
 * when the user has no picture of their own, i.e. the avatar is empty or is already a Discord picture.
 * An uploaded picture (S3 key) or any other external picture is never replaced.
 */
export function shouldUseDiscordAvatar(currentAvatar: string | null | undefined): boolean {
  return !currentAvatar || currentAvatar.startsWith(DISCORD_AVATAR_PREFIX);
}
