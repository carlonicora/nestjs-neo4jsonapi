import { Module } from "@nestjs/common";
import { LLMModule } from "../../core/llm/llm.module";
import { ChunkerService } from "./services/chunker.service";
import { DocXService } from "./services/types/docx.service";
import { EmailParserService } from "./services/types/email.service";
import { ImageExtractorService } from "./services/types/imageextractor.service";
import { PdfService } from "./services/types/pdf.service";
import { PptxService } from "./services/types/pptx.service";
import { SemanticSplitterService } from "./services/types/semanticsplitter.service";
import { XlsxService } from "./services/types/xlsx.service";
import { S3Module } from "../s3/s3.module";

@Module({
  providers: [
    ChunkerService,
    SemanticSplitterService,
    ImageExtractorService,
    EmailParserService,
    DocXService,
    PdfService,
    PptxService,
    XlsxService,
  ],
  exports: [ChunkerService, ImageExtractorService, EmailParserService],
  imports: [LLMModule, S3Module],
})
export class ChunkerModule {}
