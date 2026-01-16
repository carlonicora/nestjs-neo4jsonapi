import { DataMeta } from "@carlonicora/nestjs-neo4jsonapi";

export const userMeta: DataMeta = {
  type: "users",
  endpoint: "users",
  nodeName: "user",
  labelName: "User",
};

export const ownerMeta: DataMeta = {
  ...userMeta,
  endpoint: "owners",
  nodeName: "owner",
};

export const assigneeMeta: DataMeta = {
  ...userMeta,
  endpoint: "assignees",
  nodeName: "assignee",
};

export const authorMeta: DataMeta = {
  ...userMeta,
  endpoint: "authors",
  nodeName: "author",
};
