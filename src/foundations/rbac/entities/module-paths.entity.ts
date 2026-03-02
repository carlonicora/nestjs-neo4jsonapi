import { Entity } from "../../../common/abstracts/entity";

export type ModuleRelationshipPaths = Entity & {
  moduleId: string;
  paths: string[];
};
