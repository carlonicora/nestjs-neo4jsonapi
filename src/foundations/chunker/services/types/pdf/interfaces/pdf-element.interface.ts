export interface PdfTextElement {
  type: "text";
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  pageNumber: number;
  confidence?: number;
}

export interface PdfTableElement {
  type: "table";
  rows: PdfTableRow[];
  x: number;
  y: number;
  width: number;
  height: number;
  pageNumber: number;
  confidence?: number;
}

export interface PdfTableRow {
  cells: PdfTableCell[];
  y: number;
  height: number;
}

export interface PdfTableCell {
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rowSpan?: number;
  colSpan?: number;
}

export interface PdfImageElement {
  type: "image";
  data?: Buffer;
  x: number;
  y: number;
  width: number;
  height: number;
  pageNumber: number;
  extractedText?: string;
  confidence?: number;
}

export interface PdfHeaderElement {
  type: "header";
  level: number; // 1-6 for h1-h6
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pageNumber: number;
  fontSize: number;
}

export interface PdfParagraphElement {
  type: "paragraph";
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pageNumber: number;
  fontSize: number;
  alignment?: "left" | "center" | "right" | "justify";
}

export interface PdfListElement {
  type: "list";
  items: PdfListItem[];
  x: number;
  y: number;
  width: number;
  height: number;
  pageNumber: number;
  ordered: boolean;
}

export interface PdfListItem {
  content: string;
  level: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PdfElement =
  PdfTextElement | PdfTableElement | PdfImageElement | PdfHeaderElement | PdfParagraphElement | PdfListElement;

export interface PdfContent {
  type: "table" | "paragraphs" | "image" | "header" | "list";
  content: string | PdfTableElement | any;
  pageNumber: number;
  confidence?: number;
}
