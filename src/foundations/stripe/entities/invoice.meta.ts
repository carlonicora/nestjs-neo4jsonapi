import { DataMeta } from "@carlonicora/nestjs-neo4jsonapi";

export const invoiceMeta: DataMeta = {
  type: "invoices",
  endpoint: "invoices",
  nodeName: "invoice",
  labelName: "Invoice",
};
