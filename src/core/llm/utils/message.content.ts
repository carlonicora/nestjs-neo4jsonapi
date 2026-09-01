/**
 * Coerces a LangChain `AIMessage.content` into plain text.
 *
 * `.content` is NOT always a string. Depending on the provider surface it is
 * either a single string or an array of content parts
 * (`[{ type: "text", text: "…" }, …]`) — Gemini has always done the latter, and
 * the Azure Responses API surface returns parts for ordinary chat completions
 * too. `String(content)` on the array form yields the literal `"[object Object]"`,
 * which is indistinguishable from a real summary once it has been persisted:
 * it is a non-empty string, so every `?? ""` and `.trim().length > 0` guard
 * downstream happily passes it through to the database and into emails.
 *
 * Always route model output through this function instead of `String(...)`.
 */
export type MessageContent = string | Array<{ type?: string; text?: string }> | null | undefined;

export const extractMessageText = (content: MessageContent): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("");
  }
  return "";
};
