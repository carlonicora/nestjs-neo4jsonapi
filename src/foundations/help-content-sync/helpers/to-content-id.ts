import { v5 as uuidv5 } from "uuid";
import { HelpMode } from "../interfaces/help-article.interface";

export function toContentId(mode: HelpMode, slug: string, namespaceUuid: string): string {
  return uuidv5(`${mode}/${slug}`, namespaceUuid);
}
