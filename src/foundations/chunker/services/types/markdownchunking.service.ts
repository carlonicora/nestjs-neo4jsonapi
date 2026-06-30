import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppLoggingService } from "../../../../core/logging/services/logging.service";
import { BaseConfigInterface } from "../../../../config/interfaces/base.config.interface";
import { ConfigChunkerInterface } from "../../../../config/interfaces/config.chunker.interface";

@Injectable()
export class MarkdownChunkingService {
  constructor(
    private readonly logger: AppLoggingService,
    private readonly config: ConfigService<BaseConfigInterface>,
  ) {}

  async splitMarkdownToChunks(params: { content: string; title?: string }): Promise<Document[]> {
    if (!params.content || params.content.trim().length === 0) {
      return [new Document({ pageContent: params.content || "" })];
    }
    const targetChars = this.config.get<ConfigChunkerInterface>("chunker")?.targetChars ?? 1500;
    try {
      const fullContent = params.title ? `# ${params.title}\n\n${params.content}` : params.content;
      const sections = this.splitMarkdownByStructure(fullContent);

      if (sections.length <= 1) {
        if (fullContent.length <= targetChars) {
          return [
            new Document({
              pageContent: fullContent,
              metadata: { type: "markdown_section", split_method: "single_chunk" },
            }),
          ];
        }
        const singleHeadingMatch = fullContent.match(/^(#+)\s+(.+)/);
        const singleHeading = singleHeadingMatch ? singleHeadingMatch[2] : undefined;
        return this.splitLargeSection(fullContent, singleHeading, 0, targetChars);
      }

      const out: Document[] = [];
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i].trim();
        if (section.length < 50) continue;
        const headerMatch = section.match(/^(#+)\s+(.+)/);
        const heading = headerMatch ? headerMatch[2] : undefined;

        if (this.isTableSection(section)) {
          out.push(
            new Document({
              pageContent: section,
              metadata: { type: "table_section", split_method: "table", section_index: i, heading },
            }),
          );
        } else if (section.length > targetChars) {
          out.push(...(await this.splitLargeSection(section, heading, i, targetChars)));
        } else {
          out.push(
            new Document({
              pageContent: section,
              metadata: { type: "markdown_section", split_method: "header_section", section_index: i, heading },
            }),
          );
        }
      }
      return out.length > 0 ? out : [new Document({ pageContent: fullContent })];
    } catch (error) {
      this.logger.error("Error splitting markdown to chunks", error);
      return [new Document({ pageContent: params.content })];
    }
  }

  private async splitLargeSection(
    content: string,
    heading: string | undefined,
    sectionIndex: number,
    targetChars: number,
  ): Promise<Document[]> {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: targetChars,
      chunkOverlap: 200,
      separators: ["\n\n", "\n", ". ", " "],
    });
    const docs = await splitter.createDocuments([content]);
    docs.forEach((d, chunkIndex) => {
      d.metadata = {
        type: "markdown_section",
        split_method: "recursive_section",
        section_index: sectionIndex,
        chunk_index: chunkIndex,
        heading,
      };
    });
    return docs;
  }

  private splitMarkdownByStructure(content: string): string[] {
    const sections: string[] = [];
    const lines = content.split("\n");
    let current = "";
    for (const line of lines) {
      if (line.trim().startsWith("#")) {
        if (current.trim()) sections.push(current.trim());
        current = line + "\n";
      } else {
        current += line + "\n";
      }
    }
    if (current.trim()) sections.push(current.trim());
    return sections.length > 0 ? sections : [content];
  }

  private isTableSection(section: string): boolean {
    const lines = section.trim().split("\n");
    const firstLine = lines[0]?.trim() || "";
    if (!firstLine.startsWith("## ")) return false;
    return lines.slice(1).filter((l) => l.trim() !== "").length > 0;
  }
}
